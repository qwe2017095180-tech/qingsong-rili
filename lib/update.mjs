import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = 'qwe2017095180-tech/qingsong-rili';
const REPO_URL = `https://github.com/${REPO}`;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

function compareVersions(a, b) {
  const left = VERSION.exec(a);
  const right = VERSION.exec(b);
  if (!left || !right) throw new Error('版本号格式有误');
  return left.slice(1).reduce((order, part, i) => order || Math.sign(Number(part) - Number(right[i + 1])), 0);
}

export function createUpdater(root, current, fetchRelease = fetch) {
  let installed = null;
  let installing = false;

  async function git(...args) {
    const { stdout } = await run('git', args, {
      cwd: root,
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
    });
    return stdout.trim();
  }

  async function release() {
    const response = await fetchRelease(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'qingsong-rili' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
    const data = await response.json();
    if (data.draft || data.prerelease || !VERSION.test(data.tag_name)) {
      throw new Error('发布页上的稳定版版本号格式有误');
    }
    return data;
  }

  async function check() {
    if (installed) return { current, latest: installed, restartRequired: true };
    const remote = await release();
    if (!remote) return { current, latest: null, hasUpdate: false };
    const latest = remote.tag_name.replace(/^v/, '');
    return {
      current,
      latest,
      tag: remote.tag_name,
      hasUpdate: compareVersions(latest, current) > 0,
      notes: typeof remote.body === 'string' ? remote.body : '',
      url: `${REPO_URL}/releases/tag/${remote.tag_name}`,
      canInstall: fs.existsSync(path.join(root, '.git')),
    };
  }

  async function install(tag) {
    if (installed) return { current, latest: installed, restartRequired: true };
    if (!fs.existsSync(path.join(root, '.git'))) throw new Error('当前是压缩包安装，请从发布页下载新版');
    if (installing) throw new Error('更新正在进行，请稍候');
    installing = true;
    try {
      const latest = await check();
      if (!latest.hasUpdate || tag !== latest.tag) throw new Error('可用版本已变化，请重新检查');
      const ensureClean = async () => {
        if (await git('status', '--porcelain', '--untracked-files=no')) {
          throw new Error('程序目录有未提交的代码修改，请先处理后再更新');
        }
      };
      await ensureClean();
      const head = await git('rev-parse', 'HEAD');
      const ref = 'refs/qingsong/update/' + latest.tag;
      let commit;
      try {
        await git('fetch', '--no-tags', REPO_URL + '.git', `+refs/tags/${latest.tag}:${ref}`);
        commit = await git('rev-parse', ref + '^{commit}');
      } catch {
        throw new Error('下载更新失败，请检查 GitHub 网络连接');
      }
      const target = JSON.parse(await git('show', commit + ':version.json'));
      if (target.version !== latest.latest) throw new Error('发布标签与程序版本不一致');
      await ensureClean();
      if (await git('rev-parse', 'HEAD') !== head) throw new Error('本地代码已发生变化，请重新检查');
      if (await git('diff', '--name-only', head, commit, '--', 'data/')) {
        throw new Error('更新包包含本机数据目录的改动，已取消安装');
      }
      try {
        await git('merge', '--ff-only', '--no-overwrite-ignore', commit);
      } catch {
        throw new Error('本地代码与发布版存在冲突，无法直接更新');
      }
      installed = latest.latest;
      return { current, latest: installed, restartRequired: true };
    } finally {
      installing = false;
    }
  }

  return { check, install };
}

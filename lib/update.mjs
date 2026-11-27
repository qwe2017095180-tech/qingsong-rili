import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = 'qwe2017095180-tech/qingsong-rili';
const REPO_URL = `https://github.com/${REPO}`;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

export const FALLBACK_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
];

export function normalizeMirrorPrefix(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

export function applyMirrorPrefix(url, prefix) {
  const norm = normalizeMirrorPrefix(prefix);
  return norm ? `${norm}${url}` : url;
}

function compareVersions(a, b) {
  const left = VERSION.exec(a);
  const right = VERSION.exec(b);
  if (!left || !right) throw new Error('版本号格式有误');
  return left.slice(1).reduce((order, part, i) => order || Math.sign(Number(part) - Number(right[i + 1])), 0);
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function formatNetworkError(err, fallback = '网络连接失败，请稍后重试') {
  const msg = String(err?.message || err || '');
  const lower = msg.toLowerCase();
  if (err?.name === 'TimeoutError' || lower.includes('timed out') || lower.includes('timeout')) {
    return '连接 GitHub 超时，请检查网络或配置下载加速镜像后重试';
  }
  if (lower.includes('fetch failed') || lower.includes('econnreset') || lower.includes('enotfound') || lower.includes('econnrefused')) {
    return '无法连接 GitHub，请检查网络或代理设置后重试';
  }
  const clean = msg.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 120) : fallback;
}

export function createUpdater(root, current, fetchRelease = fetch, options = {}) {
  let installed = null;
  let installing = false;
  const getMirror = typeof options.getMirror === 'function' ? options.getMirror : () => '';
  const fallbackMirrors = Array.isArray(options.fallbackMirrors) ? options.fallbackMirrors : FALLBACK_MIRRORS;
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
  const retryDelayMs = options.retryDelayMs ?? 600;

  async function git(...args) {
    const { stdout } = await run('git', args, {
      cwd: root,
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
    });
    return stdout.trim();
  }

  async function fetchNotesForTag(tag) {
    const rawUrl = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(tag)}/version.json`;
    const configured = normalizeMirrorPrefix(getMirror());
    const urls = configured ? [applyMirrorPrefix(rawUrl, configured), rawUrl] : [rawUrl];
    for (const url of urls) {
      try {
        const res = await fetchRelease(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'qingsong-rili' },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (typeof data?.notes === 'string') return data.notes;
      } catch {}
    }
    return '';
  }

  async function releaseFromWeb() {
    const response = await fetchRelease(`${REPO_URL}/releases/latest`, {
      redirect: 'manual',
      headers: { Accept: 'text/html', 'User-Agent': 'qingsong-rili' },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) {
      throw new Error('GitHub 接口请求受限，请稍后再试');
    }
    const target = response.headers?.get?.('location') || response.url || '';
    const tagMatch = /\/releases\/tag\/([^/?#]+)/.exec(target);
    if (tagMatch) {
      const tag = decodeURIComponent(tagMatch[1]);
      if (!VERSION.test(tag)) throw new Error('发布页上的稳定版版本号格式有误');
      const body = await fetchNotesForTag(tag);
      return { tag_name: tag, draft: false, prerelease: false, body };
    }
    if ((response.status >= 300 && response.status < 400 && /\/releases\/?$/.test(target))
      || (response.ok && /\/releases\/?$/.test(target))) {
      return null;
    }
    throw new Error(response.ok ? '发布页解析失败' : `GitHub 返回 HTTP ${response.status}`);
  }

  async function release() {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchRelease(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'qingsong-rili' },
          signal: AbortSignal.timeout(12_000),
        });
        if (response.status === 404) return null;
        if (response.status === 403 || response.status === 429) {
          return await releaseFromWeb();
        }
        if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
        const data = await response.json();
        if (data.draft || data.prerelease || !VERSION.test(data.tag_name)) {
          throw new Error('发布页上的稳定版版本号格式有误');
        }
        return data;
      } catch (err) {
        lastError = err;
        // Non-network validation / HTTP status errors should not be retried blindly.
        if (err instanceof Error && /版本号格式有误|请求受限|发布页解析失败|HTTP 4/.test(err.message)) {
          throw err;
        }
        if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
      }
    }
    throw new Error(formatNetworkError(lastError, '检查更新失败，请检查网络连接'));
  }

  function candidateRemotes(explicitMirror) {
    const configured = normalizeMirrorPrefix(explicitMirror ?? getMirror());
    const base = `${REPO_URL}.git`;
    const urls = [];
    if (configured) {
      urls.push(applyMirrorPrefix(base, configured));
      urls.push(base);
    } else {
      urls.push(base);
      for (const prefix of fallbackMirrors) {
        const mirrored = applyMirrorPrefix(base, prefix);
        if (!urls.includes(mirrored)) urls.push(mirrored);
      }
    }
    return urls;
  }

  async function fetchTagWithFallback(tag, ref, explicitMirror) {
    const remotes = candidateRemotes(explicitMirror);
    for (const remoteUrl of remotes) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await git('fetch', '--no-tags', remoteUrl, `+refs/tags/${tag}:${ref}`);
          return await git('rev-parse', `${ref}^{commit}`);
        } catch {
          if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
        }
      }
    }
    throw new Error('下载更新失败，请检查网络或在「更多 → 应用更新」里设置加速镜像后重试');
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

  async function install(tag, { mirror } = {}) {
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
      const commit = await fetchTagWithFallback(latest.tag, ref, mirror);
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

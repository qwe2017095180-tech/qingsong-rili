import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_UPDATE_MIRROR,
  DIRECT_MIRROR_SENTINEL,
  applyMirrorPrefix,
  createUpdater,
  formatNetworkError,
  normalizeMirrorPrefix,
} from '../lib/update.mjs';

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qingsong-update-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, 'remote');
  const install = path.join(dir, 'install');
  mkdirSync(remote);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  git(remote, 'init', '-b', 'main');
  git(remote, 'config', 'user.name', 'Update Test');
  git(remote, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(remote, 'version.json'), '{"version":"1.2.0"}');
  writeFileSync(path.join(remote, '.gitignore'), 'data/\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'Initial installation');
  git(dir, 'clone', remote, install);
  git(install, 'config', `url.${remote}.insteadOf`, 'https://github.com/qwe2017095180-tech/qingsong-rili.git');
  mkdirSync(path.join(install, 'data'));
  writeFileSync(path.join(install, 'data', 'notices.json'), 'local notices');

  function publish({ dataFile = false } = {}) {
    writeFileSync(path.join(remote, 'version.json'), '{"version":"1.3.0"}');
    git(remote, 'add', 'version.json');
    if (dataFile) {
      mkdirSync(path.join(remote, 'data'));
      writeFileSync(path.join(remote, 'data', 'notices.json'), 'release notices');
      git(remote, 'add', '-f', 'data/notices.json');
    }
    git(remote, 'commit', '-m', 'Release 1.3.0');
    git(remote, 'tag', 'v1.3.0');
  }

  const updater = createUpdater(install, '1.2.0', async () => Response.json({
    tag_name: 'v1.3.0', draft: false, prerelease: false, body: '发布日期',
  }), { retryDelayMs: 0, getMirror: () => DIRECT_MIRROR_SENTINEL, fallbackMirrors: [] });
  return { dir, remote, install, publish, updater };
}

test('checks, installs the stable tag and retains local notices', async (t) => {
  const { install, publish, updater } = setup(t);
  publish();
  const available = await updater.check();
  assert.equal(available.hasUpdate, true);
  assert.equal(available.canInstall, true);
  await assert.rejects(updater.install('v1.4.0'), /重新检查/);
  const result = await updater.install(available.tag);
  assert.equal(result.restartRequired, true);
  assert.equal((await updater.check()).restartRequired, true);
  assert.equal(readFileSync(path.join(install, 'version.json'), 'utf8'), '{"version":"1.3.0"}');
  assert.equal(readFileSync(path.join(install, 'data', 'notices.json'), 'utf8'), 'local notices');
});

test('rejects local edits without overwriting them', async (t) => {
  const { install, publish, updater } = setup(t);
  publish();
  writeFileSync(path.join(install, 'version.json'), 'local edits');
  await assert.rejects(updater.install('v1.3.0'), /未提交/);
  assert.equal(readFileSync(path.join(install, 'version.json'), 'utf8'), 'local edits');
});

test('rejects releases that would change the data directory', async (t) => {
  const { install, publish, updater } = setup(t);
  publish({ dataFile: true });
  await assert.rejects(updater.install('v1.3.0'), /数据目录/);
  assert.equal(readFileSync(path.join(install, 'data', 'notices.json'), 'utf8'), 'local notices');
});

test('a repository without a stable release has no update', async () => {
  const updater = createUpdater(tmpdir(), '1.3.0', async () => new Response(null, { status: 404 }), {
    retryDelayMs: 0,
  });
  assert.deepEqual(await updater.check(), { current: '1.3.0', latest: null, hasUpdate: false });
});

test('retries transient release check failure and formats network errors cleanly', async () => {
  let calls = 0;
  const updater = createUpdater(tmpdir(), '1.3.0', async () => {
    calls++;
    if (calls === 1) throw new TypeError('fetch failed');
    return Response.json({ tag_name: 'v1.3.2', draft: false, prerelease: false, body: '修复断流' });
  }, { retryDelayMs: 0, maxAttempts: 2, getMirror: () => DIRECT_MIRROR_SENTINEL, fallbackMirrors: [] });

  const res = await updater.check();
  assert.equal(calls, 2);
  assert.equal(res.hasUpdate, true);
  assert.equal(res.latest, '1.3.2');

  assert.equal(normalizeMirrorPrefix('https://gh-proxy.com'), 'https://gh-proxy.com/');
  assert.equal(normalizeMirrorPrefix('direct'), DIRECT_MIRROR_SENTINEL);
  assert.equal(normalizeMirrorPrefix('not-a-url'), '');
  assert.equal(
    applyMirrorPrefix('https://github.com/a/b.git', 'https://gh-proxy.com'),
    'https://gh-proxy.com/https://github.com/a/b.git',
  );
  assert.equal(
    applyMirrorPrefix('https://github.com/a/b.git', 'direct'),
    'https://github.com/a/b.git',
  );
  assert.match(formatNetworkError(new Error('fetch failed https://secret.example/x?jwt=123')), /无法连接更新源/);
});

test('uses mirror by default for both release checks and git fetch on all platforms', async (t) => {
  const { remote, install, publish } = setup(t);
  publish();
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  // Make direct GitHub URL point to a broken path, and mirror URL point to the real local remote.
  git(install, 'config', '--unset', `url.${remote}.insteadOf`);
  git(install, 'config', 'url.file:///nonexistent-qingsong-repo.insteadOf', 'https://github.com/qwe2017095180-tech/qingsong-rili.git');
  git(install, 'config', `url.${remote}.insteadOf`, 'https://mirror.example/https://github.com/qwe2017095180-tech/qingsong-rili.git');

  const seenUrls = [];
  const updater = createUpdater(install, '1.2.0', async (url) => {
    seenUrls.push(url);
    assert.ok(url.startsWith('https://mirror.example/https://raw.githubusercontent.com/'));
    return Response.json({ version: '1.3.0', notes: '默认镜像优先测试' });
  }, {
    retryDelayMs: 0,
    maxAttempts: 1,
    getMirror: () => 'https://mirror.example/',
    fallbackMirrors: ['https://mirror.example/'],
  });

  // 确认默认候选顺序是镜像在前、直连在后
  const remotes = updater.candidateRemotes();
  assert.ok(remotes[0].startsWith('https://mirror.example/'));
  assert.ok(remotes[remotes.length - 1].startsWith('https://github.com/'));

  const result = await updater.install('v1.3.0');
  assert.equal(result.restartRequired, true);
  assert.equal(seenUrls.length, 1);
  assert.equal(readFileSync(path.join(install, 'version.json'), 'utf8'), '{"version":"1.3.0"}');
  assert.equal(DEFAULT_UPDATE_MIRROR, 'https://gh-proxy.com/');
});

test('falls back to web release redirect when GitHub API returns 403 rate limit', async () => {
  const seenUrls = [];
  const updater = createUpdater(tmpdir(), '1.3.1', async (url) => {
    seenUrls.push(url);
    if (url.startsWith('https://api.github.com/')) {
      return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });
    }
    if (url.endsWith('/releases/latest')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/qwe2017095180-tech/qingsong-rili/releases/tag/v1.3.2' },
      });
    }
    if (url.endsWith('/v1.3.2/version.json')) {
      return Response.json({ version: '1.3.2', notes: '绕过 API 限流检查更新' });
    }
    throw new Error(`unexpected url: ${url}`);
  }, { retryDelayMs: 0, maxAttempts: 1, getMirror: () => DIRECT_MIRROR_SENTINEL, fallbackMirrors: [] });

  const res = await updater.check();
  assert.equal(res.hasUpdate, true);
  assert.equal(res.latest, '1.3.2');
  assert.equal(res.tag, 'v1.3.2');
  assert.equal(res.notes, '绕过 API 限流检查更新');
  assert.equal(seenUrls.length, 3);
});

test('web fallback returns no update when repository redirects to /releases without a tag', async () => {
  const updater = createUpdater(tmpdir(), '1.3.2', async (url) => {
    if (url.startsWith('https://api.github.com/')) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 302,
      headers: { location: 'https://github.com/qwe2017095180-tech/qingsong-rili/releases' },
    });
  }, { retryDelayMs: 0, maxAttempts: 1, getMirror: () => DIRECT_MIRROR_SENTINEL, fallbackMirrors: [] });

  assert.deepEqual(await updater.check(), { current: '1.3.2', latest: null, hasUpdate: false });
});

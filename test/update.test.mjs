import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdater } from '../lib/update.mjs';

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
  }));
  return { install, publish, updater };
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
  const updater = createUpdater(tmpdir(), '1.3.0', async () => new Response(null, { status: 404 }));
  assert.deepEqual(await updater.check(), { current: '1.3.0', latest: null, hasUpdate: false });
});

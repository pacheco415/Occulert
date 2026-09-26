import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

test('static server rejects encoded parent paths and symlinks outside its root', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'occulert-server-'));
  const root = join(fixture, 'site'), sibling = join(fixture, 'site-private.txt');
  await mkdir(root);
  await writeFile(join(root, 'vercel.json'), '{}');
  await writeFile(join(root, 'index.html'), 'public fixture');
  await writeFile(sibling, 'private fixture marker');
  await symlink(sibling, join(root, 'linked.txt'));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.execPath, [fileURLToPath(new URL('./serve-static.mjs', import.meta.url))],
    { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture server did not start')), 5000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(Error(`Server exited ${code}`)); });
      server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    });
    const base = `http://127.0.0.1:${port}`;
    assert.equal(await (await fetch(base + '/')).text(), 'public fixture');
    for (const path of ['/%2e%2e%2fsite-private.txt', '/linked.txt', '/%00', '/%ZZ']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, `must reject ${path}`);
      assert.doesNotMatch(await response.text(), /private fixture marker/);
    }
  } finally {
    server.kill();
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    await rm(fixture, { recursive: true, force: true });
  }
});

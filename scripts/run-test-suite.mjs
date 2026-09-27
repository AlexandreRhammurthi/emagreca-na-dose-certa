import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localRoot = resolve(projectRoot, 'tests', 'local');
const noNetworkGuard = resolve(localRoot, 'no-network.mjs');

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files;
}

const tests = (await collectTests(localRoot)).sort((left, right) => left.localeCompare(right));
if (tests.length === 0) throw new Error('Nenhum teste local foi encontrado.');

const result = spawnSync(process.execPath, ['--import', pathToFileURL(noNetworkGuard).href, '--test', ...tests], {
  cwd: projectRoot,
  env: { ...process.env, TEST_TARGET: 'local' },
  stdio: 'inherit'
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

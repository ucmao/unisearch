import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const testsDirectory = resolve(import.meta.dirname);
const testFiles = readdirSync(testsDirectory)
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => resolve(testsDirectory, file));

const result = spawnSync(electron, ['--import', 'tsx', '--test', ...testFiles], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

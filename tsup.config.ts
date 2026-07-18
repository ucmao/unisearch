import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'crawler/worker': 'src/crawler/worker.ts',
  },
  format: ['cjs'],
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    'better-sqlite3',
    'playwright',
    'playwright-core',
    'fsevents',
    'electron',
  ],
  platform: 'node',
  target: 'node20',
});

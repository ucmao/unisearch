import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fitWindowBoundsToDisplays, loadWindowState, saveWindowState } from '../src/main/windowState';

test('window state persists independent windows', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-window-state-'));
  const filePath = path.join(directory, 'window-state.json');

  saveWindowState(filePath, 'main', { bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: true });
  saveWindowState(filePath, 'crawler', { bounds: { x: 30, y: 40, width: 1000, height: 700 }, maximized: false });

  assert.deepEqual(loadWindowState(filePath, 'main'), {
    bounds: { x: 10, y: 20, width: 1200, height: 800 },
    maximized: true,
  });
  assert.equal(loadWindowState(filePath, 'missing'), undefined);
});

test('off-screen bounds are centered on the primary display', () => {
  const bounds = fitWindowBoundsToDisplays(
    { x: 4000, y: 100, width: 1200, height: 800 },
    [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    { width: 1200, height: 800 },
  );
  assert.deepEqual(bounds, { x: 360, y: 140, width: 1200, height: 800 });
});

test('oversized saved bounds are clamped to the available work area', () => {
  const bounds = fitWindowBoundsToDisplays(
    { x: -100, y: -100, width: 2400, height: 1400 },
    [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }],
    { width: 1200, height: 800 },
  );
  assert.deepEqual(bounds, { x: 0, y: 25, width: 1440, height: 875 });
});

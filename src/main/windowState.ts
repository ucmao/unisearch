import fs from 'fs';
import path from 'path';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindowState {
  bounds: WindowBounds;
  maximized: boolean;
}

export interface DisplayLike {
  workArea: WindowBounds;
}

type WindowStateFile = Record<string, SavedWindowState>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Partial<WindowBounds>;
  return isFiniteNumber(bounds.x)
    && isFiniteNumber(bounds.y)
    && isFiniteNumber(bounds.width)
    && isFiniteNumber(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function readStateFile(filePath: string): WindowStateFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as WindowStateFile : {};
  } catch {
    return {};
  }
}

export function loadWindowState(filePath: string, key: string): SavedWindowState | undefined {
  const state = readStateFile(filePath)[key];
  if (!state || !isWindowBounds(state.bounds) || typeof state.maximized !== 'boolean') return undefined;
  return state;
}

export function saveWindowState(filePath: string, key: string, state: SavedWindowState): void {
  const states = readStateFile(filePath);
  states[key] = state;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(states, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch {
    // Windows cannot always atomically replace an existing destination.
    fs.writeFileSync(filePath, `${JSON.stringify(states, null, 2)}\n`, 'utf8');
    try { fs.unlinkSync(temporaryPath); } catch { /* best-effort cleanup */ }
  }
}

function intersectionArea(left: WindowBounds, right: WindowBounds): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

export function fitWindowBoundsToDisplays(
  savedBounds: WindowBounds,
  displays: DisplayLike[],
  fallbackBounds: Pick<WindowBounds, 'width' | 'height'>,
): WindowBounds {
  if (displays.length === 0) return savedBounds;

  const display = displays.reduce((best, candidate) => (
    intersectionArea(savedBounds, candidate.workArea) > intersectionArea(savedBounds, best.workArea)
      ? candidate
      : best
  ));
  const visibleArea = intersectionArea(savedBounds, display.workArea);
  const workArea = visibleArea >= 10_000 ? display.workArea : displays[0].workArea;
  const width = Math.min(Math.max(320, savedBounds.width || fallbackBounds.width), workArea.width);
  const height = Math.min(Math.max(240, savedBounds.height || fallbackBounds.height), workArea.height);

  if (visibleArea >= 10_000) {
    return {
      x: Math.min(Math.max(savedBounds.x, workArea.x), workArea.x + workArea.width - width),
      y: Math.min(Math.max(savedBounds.y, workArea.y), workArea.y + workArea.height - height),
      width,
      height,
    };
  }

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

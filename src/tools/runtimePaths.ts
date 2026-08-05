import path from 'path';

function configuredDirectory(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? path.resolve(value) : undefined;
}

/** Root containing read-only files shipped with the application. */
export function getRuntimeResourcesDir(): string {
  return configuredDirectory('UNISEARCH_RESOURCES_DIR') || process.cwd();
}

export function resolveRuntimeResource(...segments: string[]): string {
  return path.join(getRuntimeResourcesDir(), ...segments);
}

/** Root for crawler profiles and other mutable runtime state. */
export function getRuntimeDataDir(): string {
  const configured = configuredDirectory('UNISEARCH_USER_DATA_DIR');
  if (configured) return configured;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'data');
    }
  } catch {}

  return path.resolve(process.cwd(), 'data');
}

export function getBrowserDataDir(): string {
  return path.join(getRuntimeDataDir(), 'browser_data');
}

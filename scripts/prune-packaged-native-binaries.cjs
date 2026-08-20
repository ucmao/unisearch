const fs = require('node:fs/promises');
const path = require('node:path');

const ARCH_NAMES = {
  1: 'x64',
  3: 'arm64',
};

async function removePath(target, removed) {
  await fs.rm(target, { recursive: true, force: true });
  removed.push(target);
}

async function readEntries(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function pruneBetterSqlite3(modulesRoot, platform, arch, removed) {
  const prebuilds = path.join(modulesRoot, 'better-sqlite3', 'prebuilds');
  const allowed = platform === 'linux'
    ? new Set([`linux-${arch}.node`, `linuxmusl-${arch}.node`])
    : new Set([`${platform}-${arch}.node`]);

  for (const entry of await readEntries(prebuilds)) {
    if (/^(darwin|linux|linuxmusl|win32)-(arm64|x64)\.node$/.test(entry.name) && !allowed.has(entry.name)) {
      await removePath(path.join(prebuilds, entry.name), removed);
    }
  }
}

async function pruneOnnxRuntime(modulesRoot, platform, arch, removed) {
  const binaries = path.join(modulesRoot, 'onnxruntime-node', 'bin', 'napi-v3');

  for (const platformEntry of await readEntries(binaries)) {
    if (!platformEntry.isDirectory() || !['darwin', 'linux', 'win32'].includes(platformEntry.name)) continue;

    const platformDirectory = path.join(binaries, platformEntry.name);
    for (const archEntry of await readEntries(platformDirectory)) {
      if (!archEntry.isDirectory() || !['arm64', 'x64'].includes(archEntry.name)) continue;
      if (platformEntry.name !== platform || archEntry.name !== arch) {
        await removePath(path.join(platformDirectory, archEntry.name), removed);
      }
    }
  }
}

function isSharpVariant(name) {
  return /^(darwin|linux|linuxmusl|win32)-(arm64|arm64v8|x64)$/.test(name);
}

function isAllowedSharpVariant(name, platform, arch) {
  const allowedArchNames = arch === 'arm64' ? ['arm64', 'arm64v8'] : ['x64'];
  return allowedArchNames.some((archName) => name === `${platform}-${archName}`);
}

async function pruneSharp(modulesRoot, platform, arch, removed) {
  const sharpRoot = path.join(modulesRoot, 'sharp');
  const releaseDirectory = path.join(sharpRoot, 'build', 'Release');

  for (const entry of await readEntries(releaseDirectory)) {
    const match = /^sharp-((?:darwin|linux|linuxmusl|win32)-(?:arm64|arm64v8|x64))\.node$/.exec(entry.name);
    if (match && !isAllowedSharpVariant(match[1], platform, arch)) {
      await removePath(path.join(releaseDirectory, entry.name), removed);
    }
  }

  const vendorRoot = path.join(sharpRoot, 'vendor');
  for (const versionEntry of await readEntries(vendorRoot)) {
    if (!versionEntry.isDirectory()) continue;
    const versionDirectory = path.join(vendorRoot, versionEntry.name);
    for (const platformEntry of await readEntries(versionDirectory)) {
      if (platformEntry.isDirectory() && isSharpVariant(platformEntry.name) && !isAllowedSharpVariant(platformEntry.name, platform, arch)) {
        await removePath(path.join(versionDirectory, platformEntry.name), removed);
      }
    }
  }
}

module.exports = async function prunePackagedNativeBinaries(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch];
  if (!['darwin', 'linux', 'win32'].includes(platform) || !arch) return;

  const resourcesRoot = context.packager.getResourcesDir(context.appOutDir);
  const modulesRoot = path.join(resourcesRoot, 'app.asar.unpacked', 'node_modules');
  const removed = [];

  await pruneBetterSqlite3(modulesRoot, platform, arch, removed);
  await pruneOnnxRuntime(modulesRoot, platform, arch, removed);
  await pruneSharp(modulesRoot, platform, arch, removed);

  console.log(`  • pruned non-target native binaries  platform=${platform} arch=${arch} removed=${removed.length}`);
};

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { listPackage } from '@electron/asar';

const target = path.resolve(process.argv[2] || 'dist');

function findUnpackedResources(directory) {
  if (!fs.existsSync(directory)) return [];
  const matches = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.shift();
    if (path.basename(current) === 'app.asar.unpacked') {
      matches.push(current);
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
    }
  }
  return matches;
}

const candidates = findUnpackedResources(target);
if (!candidates.length) throw new Error(`在 ${target} 中未找到 app.asar.unpacked`);

// 保持输出顺序稳定，并逐一校验找到的所有打包目录
candidates.sort((a, b) => a.localeCompare(b));

if (candidates.length > 1) {
  console.log(`💡 在 ${target} 中找到 ${candidates.length} 个打包目录，将逐一进行校验:\n${candidates.map((candidate) => `   -> ${candidate}`).join('\n')}`);
}

const requiredUnpackedPaths = [
  'dist/crawler/worker.js',
  'dist/processor/worker.js',
  'node_modules/playwright/package.json',
  'node_modules/playwright-core/package.json',
  'node_modules/better-sqlite3/package.json',
];

function verifyUnpackedResources(unpacked) {
  for (const relativePath of requiredUnpackedPaths) {
    const absolutePath = path.join(unpacked, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`安装包缺少解包运行时文件: ${relativePath}`);
  }

  const resourcesRoot = path.dirname(unpacked);
  const asarPath = path.join(resourcesRoot, 'app.asar');
  if (!fs.existsSync(asarPath)) throw new Error(`安装包缺少 app.asar 主包: ${asarPath}`);

  const asarEntries = new Set(listPackage(asarPath, { isPack: false }));
  for (const relativePath of [
    'node_modules/@xenova/transformers/src/backends/onnx.js',
    'node_modules/onnxruntime-web/package.json',
    'node_modules/sharp/package.json',
  ]) {
    if (!asarEntries.has(`/${relativePath}`)) {
      throw new Error(`app.asar 缺少运行时依赖: ${relativePath}`);
    }
  }

  const forbiddenAsarEntries = [...asarEntries].filter((entry) => (
    (/^\/node_modules\/@xenova\/transformers\/dist\/.*\.wasm$/.test(entry))
    || (/^\/node_modules\/@xenova\/transformers\/.*\.map$/.test(entry))
    || (/^\/node_modules\/onnxruntime-web\/.*\.map$/.test(entry))
  ));
  if (forbiddenAsarEntries.length) {
    throw new Error(`app.asar 包含应排除的 Web/WASM 调试资源:\n${forbiddenAsarEntries.join('\n')}`);
  }

  const workerRequire = createRequire(path.join(unpacked, 'dist/crawler/worker.js'));
  for (const moduleName of ['playwright', 'playwright-core', 'better-sqlite3']) {
    workerRequire.resolve(moduleName);
  }

  for (const relativePath of [
    'resources/hit_stopwords.txt',
    'resources/models/bge-small-zh-v1.5/onnx/model_quantized.onnx',
    'resources/models/bge-small-zh-v1.5/tokenizer.json',
  ]) {
    if (!fs.existsSync(path.join(resourcesRoot, relativePath))) {
      throw new Error(`安装包缺少只读资源: ${relativePath}`);
    }
  }

  // 检查 onnxruntime-node 是否正确解压且仅保留目标平台库
  const onnxNodePkg = path.join(unpacked, 'node_modules/onnxruntime-node/package.json');
  if (!fs.existsSync(onnxNodePkg)) {
    throw new Error('安装包缺少 onnxruntime-node 运行时');
  }
}

for (const unpacked of candidates) {
  try {
    verifyUnpackedResources(unpacked);
    console.log(`安装包运行时检查通过: ${path.dirname(unpacked)}`);
  } catch (error) {
    throw new Error(`安装包运行时检查失败: ${path.dirname(unpacked)}\n${error.message}`, { cause: error });
  }
}

if (candidates.length > 1) {
  console.log(`全部安装包运行时检查通过，共 ${candidates.length} 个打包目录。`);
}

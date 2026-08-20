import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
if (candidates.length > 1) {
  throw new Error(`在 ${target} 中找到多个打包目录，请指定具体平台目录:\n${candidates.join('\n')}`);
}
const [unpacked] = candidates;

const requiredPaths = [
  'dist/crawler/worker.js',
  'dist/processor/worker.js',
  'node_modules/playwright/package.json',
  'node_modules/playwright-core/package.json',
  'node_modules/better-sqlite3/package.json',
];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(unpacked, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`安装包缺少运行时文件: ${relativePath}`);
}

const workerRequire = createRequire(path.join(unpacked, 'dist/crawler/worker.js'));
for (const moduleName of ['playwright', 'playwright-core', 'better-sqlite3']) {
  workerRequire.resolve(moduleName);
}

const resourcesRoot = path.dirname(unpacked);
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

console.log(`安装包运行时检查通过: ${path.dirname(unpacked)}`);


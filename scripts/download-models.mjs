import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const MODEL_NAME = 'bge-small-zh-v1.5';
const TARGET_DIR = path.join(rootDir, 'resources', 'models', MODEL_NAME);

const MODEL_FILES = [
  { path: 'config.json', minBytes: 500 },
  { path: 'tokenizer.json', minBytes: 1000000 },
  { path: 'tokenizer_config.json', minBytes: 300 },
  { path: 'special_tokens_map.json', minBytes: 100 },
  { path: 'onnx/model_quantized.onnx', minBytes: 30000000 },
];

const MIRROR_BASES = [
  'https://modelscope.cn/models/Xenova/bge-small-zh-v1.5/resolve/master',
  'https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main',
  'https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main',
];

function isModelComplete() {
  for (const file of MODEL_FILES) {
    const fullPath = path.join(TARGET_DIR, file.path);
    if (!fs.existsSync(fullPath)) return false;
    const stat = fs.statSync(fullPath);
    if (stat.size < file.minBytes) return false;
  }
  return true;
}

async function downloadFileWithFallback(relativePath) {
  const destination = path.join(TARGET_DIR, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const tempDestination = `${destination}.tmp`;
  let lastError = null;

  for (const mirrorBase of MIRROR_BASES) {
    const url = `${mirrorBase}/${relativePath}`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'UniSearch-Model-Fetcher/1.0' },
        signal: AbortSignal.timeout(180000), // 3 min timeout per file
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const fileStream = fs.createWriteStream(tempDestination);
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }

      await new Promise((resolve, reject) => {
        fileStream.end();
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      });

      // Atomic rename
      if (fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }
      fs.renameSync(tempDestination, destination);
      return;
    } catch (err) {
      lastError = err;
      if (fs.existsSync(tempDestination)) {
        try { fs.unlinkSync(tempDestination); } catch {}
      }
    }
  }

  throw new Error(`Failed to download ${relativePath} from all mirrors: ${lastError?.message || 'Unknown error'}`);
}

async function main() {
  const missingFiles = MODEL_FILES.filter((file) => {
    const fullPath = path.join(TARGET_DIR, file.path);
    return !fs.existsSync(fullPath) || fs.statSync(fullPath).size < file.minBytes;
  });

  if (missingFiles.length === 0) {
    return;
  }

  console.log(`Downloading embedding model (${MODEL_NAME})...`);
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const startedAt = Date.now();
  for (const file of missingFiles) {
    await downloadFileWithFallback(file.path);
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`✓ Embedding model ready (${durationSec}s)`);
}

main().catch((err) => {
  console.error(`❌ Failed to prepare model:`, err.message || err);
  process.exit(1);
});

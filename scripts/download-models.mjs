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
      console.log(`[download-models] Downloading ${relativePath} from ${new URL(mirrorBase).host}...`);
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
      console.log(`[download-models] ✓ Successfully downloaded: ${relativePath} (${(fs.statSync(destination).size / (1024 * 1024)).toFixed(2)} MB)`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[download-models] Mirror ${mirrorBase} failed for ${relativePath}: ${err.message}, trying fallback mirror...`);
      if (fs.existsSync(tempDestination)) {
        try { fs.unlinkSync(tempDestination); } catch {}
      }
    }
  }

  throw new Error(`Failed to download ${relativePath} from all mirrors: ${lastError?.message || 'Unknown error'}`);
}

async function main() {
  console.log(`[download-models] Checking local embedding model: ${MODEL_NAME}`);
  if (isModelComplete()) {
    console.log(`[download-models] ✓ Local model is ready: ${TARGET_DIR}`);
    return;
  }

  console.log(`[download-models] Local model files missing, starting auto-download...`);
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const startedAt = Date.now();
  for (const file of MODEL_FILES) {
    const fullPath = path.join(TARGET_DIR, file.path);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size >= file.minBytes) {
      console.log(`[download-models] - File already exists, skipping: ${file.path}`);
      continue;
    }
    await downloadFileWithFallback(file.path);
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[download-models] 🎉 All model files are ready! Elapsed: ${durationSec}s, path: ${TARGET_DIR}`);
}

main().catch((err) => {
  console.error(`[download-models] ❌ Failed to prepare model:`, err);
  process.exit(1);
});

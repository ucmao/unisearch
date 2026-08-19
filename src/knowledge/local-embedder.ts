import fs from 'fs';
import path from 'path';
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

const MODEL_FOLDER_NAME = 'bge-small-zh-v1.5';
export const LOCAL_EMBEDDING_MODEL = 'BAAI/bge-small-zh-v1.5';
export const LOCAL_EMBEDDING_DIMENSIONS = 512;

function resolveModelsDirectory(): string | null {
  const candidates = [
    (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'resources', 'models') : '',
    path.join(process.cwd(), 'resources', 'models'),
    path.join(__dirname, '..', '..', 'resources', 'models'),
    path.join(__dirname, '..', 'resources', 'models'),
    path.join(__dirname, 'resources', 'models'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const onnxPath = path.join(candidate, MODEL_FOLDER_NAME, 'onnx', 'model_quantized.onnx');
    if (fs.existsSync(onnxPath)) {
      return candidate;
    }
  }
  return null;
}

export class LocalEmbedder {
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  public isAvailable(): boolean {
    return Boolean(resolveModelsDirectory());
  }

  public getModelsPath(): string | null {
    return resolveModelsDirectory();
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractorPromise) {
      return this.extractorPromise;
    }

    const modelsDir = resolveModelsDirectory();
    if (!modelsDir) {
      throw new Error(`本地向量模型文件未找到 (${MODEL_FOLDER_NAME})，请确保已执行 npm run setup:models`);
    }

    // Configure transformers.js for local execution
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = modelsDir;

    this.extractorPromise = pipeline('feature-extraction', MODEL_FOLDER_NAME, {
      quantized: true,
      local_files_only: true,
    }).catch((err) => {
      this.extractorPromise = null;
      throw new Error(`本地向量模型加载失败: ${err.message}`, { cause: err });
    });

    return this.extractorPromise;
  }

  public async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const extractor = await this.getExtractor();
    const batchSize = 32;
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => (t && t.trim() ? t.trim() : ' '));
      const output = await extractor(batch, {
        pooling: 'mean',
        normalize: true,
      });

      const raw = output.tolist() as number[][];
      for (const vector of raw) {
        if (!Array.isArray(vector) || vector.length !== LOCAL_EMBEDDING_DIMENSIONS) {
          throw new Error(`本地向量输出维度无效，预期 ${LOCAL_EMBEDDING_DIMENSIONS}，实际 ${vector?.length}`);
        }
        allVectors.push(vector);
      }
    }

    return allVectors;
  }

  public async test(): Promise<{ success: true; latency_ms: number; dimensions: number; message: string }> {
    const started = Date.now();
    const vectors = await this.embed(['UniSearch 本地检索模型连接测试']);
    const latency_ms = Date.now() - started;
    return {
      success: true,
      latency_ms,
      dimensions: vectors[0]?.length || LOCAL_EMBEDDING_DIMENSIONS,
      message: '本地内置向量模型运行正常 (BAAI/bge-small-zh-v1.5 INT8)',
    };
  }
}

export const localEmbedder = new LocalEmbedder();

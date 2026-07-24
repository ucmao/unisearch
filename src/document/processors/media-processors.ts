import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Artifact, Document } from '../../core/documents/types';
import type { DocumentProcessor, ProcessorResult } from '../../core/processors/types';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function storageDirectory(): string {
  const directory = process.env.UNISEARCH_PROCESSOR_STORAGE_DIR || path.resolve(process.cwd(), 'data', 'processor-assets');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function safeExtension(url: string, fallback: string): string {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    return /^[.][a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
  } catch {
    return fallback;
  }
}

async function runCommand(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error: any) => {
      signal?.removeEventListener('abort', abort);
      reject(error.code === 'ENOENT' ? new Error(`缺少本地命令：${command}`) : error);
    });
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('Processor pipeline cancelled'));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${command} 执行失败：${stderr.trim().slice(-500) || `退出码 ${code}`}`));
    });
  });
}

function artifact(document: Document, type: Artifact['type'], processorId: string, inputHash: string, content: string, metadata: Record<string, unknown>): Artifact {
  return {
    artifactId: randomUUID(),
    documentId: document.documentId,
    type,
    processorId,
    processorVersion: '1.0.0',
    inputHash,
    content,
    metadata,
    createdAt: new Date().toISOString(),
  };
}

export const assetDownloadProcessor: DocumentProcessor = {
  id: 'asset.download',
  version: '1.0.0',
  resourceClass: 'io',
  async process(document, context): Promise<ProcessorResult> {
    const assets = [];
    for (const asset of document.assets) {
      if (context.signal?.aborted) throw new Error('Processor pipeline cancelled');
      if (asset.localPath || !/^https?:\/\//i.test(asset.url)) {
        assets.push(asset);
        continue;
      }
      const extension = safeExtension(asset.url, asset.kind === 'video' ? '.mp4' : asset.kind === 'audio' ? '.mp3' : '.bin');
      const target = path.join(storageDirectory(), `${asset.assetId}${extension}`);
      const response = await fetch(asset.url, { signal: context.signal });
      if (!response.ok) throw new Error(`资源下载失败：HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      assets.push({
        ...asset,
        localPath: target,
        mimeType: response.headers.get('content-type') || asset.mimeType,
        metadata: { ...asset.metadata, sizeBytes: bytes.length, downloadedAt: context.now().toISOString() },
      });
    }
    return { document: { ...document, assets, updatedAt: context.now().toISOString() } };
  },
};

export const pandocConvertProcessor: DocumentProcessor = {
  id: 'pandoc.convert',
  version: '1.0.0',
  resourceClass: 'cpu',
  async process(document, context): Promise<ProcessorResult> {
    const artifacts: Artifact[] = [];
    for (const asset of document.assets.filter((item) => item.localPath && item.kind === 'file')) {
      const output = path.join(storageDirectory(), `${asset.assetId}.md`);
      await runCommand('pandoc', [asset.localPath!, '--to=gfm', '--output', output], context.signal);
      const markdown = fs.readFileSync(output, 'utf8');
      artifacts.push(artifact(document, 'markdown', 'pandoc.convert', hash(asset.localPath!), markdown, { sourceAssetId: asset.assetId, outputPath: output }));
    }
    return { document, artifacts };
  },
};

export const ffmpegExtractAudioProcessor: DocumentProcessor = {
  id: 'ffmpeg.extract_audio',
  version: '1.0.0',
  resourceClass: 'cpu',
  async process(document, context): Promise<ProcessorResult> {
    const assets = [...document.assets];
    const artifacts: Artifact[] = [];
    for (const asset of document.assets.filter((item) => item.localPath && item.kind === 'video')) {
      const output = path.join(storageDirectory(), `${asset.assetId}.wav`);
      await runCommand('ffmpeg', ['-y', '-i', asset.localPath!, '-vn', '-ac', '1', '-ar', '16000', output], context.signal);
      const audioAssetId = hash(`${asset.assetId}:audio`);
      assets.push({
        assetId: audioAssetId,
        documentId: document.documentId,
        kind: 'audio',
        url: `file://${output}`,
        mimeType: 'audio/wav',
        localPath: output,
        metadata: { derivedFrom: asset.assetId },
      });
      artifacts.push(artifact(document, 'metadata', 'ffmpeg.extract_audio', hash(asset.localPath!), output, { sourceAssetId: asset.assetId, audioAssetId }));
    }
    return { document: { ...document, assets, updatedAt: context.now().toISOString() }, artifacts };
  },
};

export const whisperTranscribeProcessor: DocumentProcessor = {
  id: 'whisper.transcribe',
  version: '1.0.0',
  resourceClass: 'cpu',
  async process(document, context): Promise<ProcessorResult> {
    const artifacts: Artifact[] = [];
    for (const asset of document.assets.filter((item) => item.localPath && ['audio', 'video'].includes(item.kind))) {
      const outputDirectory = storageDirectory();
      await runCommand('whisper', [asset.localPath!, '--output_format', 'txt', '--output_dir', outputDirectory], context.signal);
      const transcriptPath = path.join(outputDirectory, `${path.basename(asset.localPath!, path.extname(asset.localPath!))}.txt`);
      if (!fs.existsSync(transcriptPath)) throw new Error('Whisper 未生成转写文件');
      const transcript = fs.readFileSync(transcriptPath, 'utf8').trim();
      artifacts.push(artifact(document, 'transcript', 'whisper.transcribe', hash(asset.localPath!), transcript, { sourceAssetId: asset.assetId, outputPath: transcriptPath }));
    }
    return { document, artifacts };
  },
};


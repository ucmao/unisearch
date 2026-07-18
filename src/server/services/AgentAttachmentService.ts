import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { getDatabasePath } from '../../database/connection';
import { agentRepository, type AgentAttachmentRecord } from './AgentRepository';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 120_000;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.tsv']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx']);

function safeName(value: string): string {
  return path.basename(value).replace(/[\u0000-\u001f]/g, '').slice(0, 180) || '未命名文件';
}

function extensionForMime(mimeType: string): string {
  const mapping: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  };
  return mapping[mimeType] || '';
}

function publicAttachment(record: AgentAttachmentRecord) {
  return {
    attachment_id: record.attachment_id,
    file_name: record.file_name,
    mime_type: record.mime_type,
    kind: record.kind,
    size_bytes: record.size_bytes,
    created_at: record.created_at,
  };
}

async function extractSpreadsheet(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const lines: string[] = [];
  let cells = 0;
  for (const sheet of workbook.worksheets) {
    lines.push(`# 工作表：${sheet.name}`);
    sheet.eachRow((row) => {
      if (cells >= 5000) return;
      const values = (row.values as any[]).slice(1).map((value) => {
        if (value && typeof value === 'object') {
          if ('text' in value) return String(value.text);
          if ('result' in value) return String(value.result ?? '');
          return JSON.stringify(value);
        }
        return String(value ?? '');
      });
      cells += values.length;
      lines.push(values.join('\t'));
    });
    if (cells >= 5000) break;
  }
  return lines.join('\n').slice(0, MAX_EXTRACTED_CHARS);
}

export class AgentAttachmentService {
  async upload(threadId: string, input: { fileName?: string; mimeType?: string; dataBase64?: string }) {
    if (!agentRepository.getThread(threadId)) throw new Error('任务不存在');
    const fileName = safeName(String(input.fileName || ''));
    const mimeType = String(input.mimeType || 'application/octet-stream').toLowerCase();
    const extension = path.extname(fileName).toLowerCase() || extensionForMime(mimeType);
    const encoded = String(input.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!encoded || !/^[a-z0-9+/=\r\n]+$/i.test(encoded)) throw new Error('文件内容无效');
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length) throw new Error('文件为空');
    if (buffer.length > MAX_FILE_BYTES) throw new Error('单个文件不能超过 8MB');

    let kind: AgentAttachmentRecord['kind'];
    let textContent = '';
    let storagePath = '';
    if (IMAGE_EXTENSIONS.has(extension) && mimeType.startsWith('image/')) {
      kind = 'image';
    } else if (TEXT_EXTENSIONS.has(extension)) {
      kind = 'text';
      textContent = buffer.toString('utf8').replace(/\u0000/g, '').slice(0, MAX_EXTRACTED_CHARS);
    } else if (SPREADSHEET_EXTENSIONS.has(extension)) {
      kind = 'spreadsheet';
      try { textContent = await extractSpreadsheet(buffer); }
      catch { throw new Error('无法读取这个 Excel 文件，请确认文件未损坏'); }
    } else {
      throw new Error('暂支持图片、TXT、Markdown、CSV、JSON 和 XLSX 文件；PDF、Word、旧版 XLS 与视频将在后续支持');
    }

    if (kind === 'image') {
      const directory = path.join(path.dirname(getDatabasePath()), 'agent-attachments', threadId);
      fs.mkdirSync(directory, { recursive: true });
      storagePath = path.join(directory, `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`);
      fs.writeFileSync(storagePath, buffer, { mode: 0o600 });
    }

    const record = agentRepository.createAttachment({
      thread_id: threadId, file_name: fileName, mime_type: mimeType, kind,
      size_bytes: buffer.length, text_content: textContent, storage_path: storagePath,
    });
    return publicAttachment(record);
  }

  remove(threadId: string, attachmentId: string): boolean {
    const record = agentRepository.deleteAttachment(threadId, attachmentId);
    if (!record) return false;
    if (record.storage_path) {
      try { fs.unlinkSync(record.storage_path); } catch {}
    }
    return true;
  }

  removeThreadFiles(threadId: string) {
    if (!/^[a-f0-9]{32}$/i.test(threadId)) return;
    const directory = path.join(path.dirname(getDatabasePath()), 'agent-attachments', threadId);
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }

  toPublic(record: AgentAttachmentRecord) {
    return publicAttachment(record);
  }
}

export const agentAttachmentService = new AgentAttachmentService();

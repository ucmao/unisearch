import fs from 'fs';
import path from 'path';
import { documentProcessorRegistry } from '../document/processor-registry';

const COMMANDS: Record<string, string> = {
  'pandoc.convert': 'pandoc',
  'ffmpeg.extract_audio': 'ffmpeg',
  'whisper.transcribe': 'whisper',
};

function executable(command: string): string | null {
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

export function listProcessorCapabilities() {
  return documentProcessorRegistry.list().map((processor) => {
    const command = COMMANDS[processor.id];
    const executablePath = command ? executable(command) : null;
    return {
      id: processor.id,
      version: processor.version,
      resourceClass: processor.resourceClass,
      available: command ? Boolean(executablePath) : true,
      command: command || null,
      executablePath,
      unavailableReason: command && !executablePath ? `缺少本地命令：${command}` : null,
    };
  });
}


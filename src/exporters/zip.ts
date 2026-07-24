import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function createZipBuffer(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = entry.data;
    const crc = zlib.crc32(dataBuffer);
    const size = dataBuffer.length;

    // Local file header (30 bytes + name + data)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4);        // Version needed (2.0)
    localHeader.writeUInt16LE(0.0, 6);       // General purpose bit flag
    localHeader.writeUInt16LE(0, 8);         // Compression method (0 = store)
    localHeader.writeUInt16LE(0, 10);        // Mod time
    localHeader.writeUInt16LE(0, 12);        // Mod date
    localHeader.writeUInt32LE(crc, 14);      // CRC-32
    localHeader.writeUInt32LE(size, 18);     // Compressed size
    localHeader.writeUInt32LE(size, 22);     // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28);        // Extra field length
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, dataBuffer);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed
    centralHeader.writeUInt16LE(0, 8);          // General purpose bit flag
    centralHeader.writeUInt16LE(0, 10);         // Compression method (0 = store)
    centralHeader.writeUInt16LE(0, 12);         // Mod time
    centralHeader.writeUInt16LE(0, 14);         // Mod date
    centralHeader.writeUInt32LE(crc, 16);       // CRC-32
    centralHeader.writeUInt32LE(size, 20);      // Compressed size
    centralHeader.writeUInt32LE(size, 24);      // Uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // File comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk number start
    centralHeader.writeUInt16LE(0, 36);         // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);         // External file attributes
    centralHeader.writeUInt32LE(offset, 42);    // Relative offset of local header
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + dataBuffer.length;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const buf of centralHeaders) centralDirSize += buf.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);               // Signature
  eocd.writeUInt16LE(0, 4);                        // Disk number
  eocd.writeUInt16LE(0, 6);                        // Disk with central dir
  eocd.writeUInt16LE(entries.length, 8);           // Entries on this disk
  eocd.writeUInt16LE(entries.length, 10);          // Total entries
  eocd.writeUInt32LE(centralDirSize, 12);          // Size of central directory
  eocd.writeUInt32LE(centralDirStart, 16);         // Offset of central directory
  eocd.writeUInt16LE(0, 20);                       // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export function zipDirectoryToBuffer(dirPath: string): Buffer {
  const entries: ZipEntry[] = [];

  function collect(currentPath: string, relativePrefix: string) {
    const files = fs.readdirSync(currentPath);
    for (const file of files) {
      const fullPath = path.join(currentPath, file);
      const relPath = relativePrefix ? `${relativePrefix}/${file}` : file;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        collect(fullPath, relPath);
      } else {
        entries.push({ name: relPath, data: fs.readFileSync(fullPath) });
      }
    }
  }

  collect(dirPath, '');
  return createZipBuffer(entries);
}

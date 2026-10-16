import { Inflate } from 'fflate';
import type { ReaderZipEntry } from '../../features/reader/reader-types';

export class ZipValidationError extends Error {}
export type ZipSource = { size: number; read(start: number, length: number): Uint8Array };
export type ZipLimits = { file: number; entry: number; total: number; entries: number };
export const EPUB_LIMITS: ZipLimits = {
  file: 256 * 1024 * 1024, entry: 64 * 1024 * 1024,
  total: 512 * 1024 * 1024, entries: 20000,
};
export const BACKUP_LIMITS: ZipLimits = {
  file: 512 * 1024 * 1024, entry: 256 * 1024 * 1024,
  total: 512 * 1024 * 1024, entries: 40000,
};
const u16 = (bytes: Uint8Array, offset: number) => bytes[offset] | bytes[offset + 1] << 8;
const u32 = (bytes: Uint8Array, offset: number) => (u16(bytes, offset) | u16(bytes, offset + 2) << 16) >>> 0;

function read(source: ZipSource, start: number, length: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length)
    || start < 0 || length < 0 || start + length > source.size) {
    throw new ZipValidationError('压缩文件的资源范围无效。');
  }
  const bytes = source.read(start, length);
  if (bytes.length !== length) throw new ZipValidationError('压缩文件读取不完整。');
  return bytes;
}

export function byteSource(bytes: Uint8Array): ZipSource {
  return { size: bytes.length, read: (start, length) => bytes.subarray(start, start + length) };
}

export function readZipDirectory(source: ZipSource, limits = EPUB_LIMITS): ReaderZipEntry[] {
  if (source.size > limits.file) throw new ZipValidationError('文件过大，请使用较小的文件。');
  const tailLength = Math.min(source.size, 22 + 0xffff);
  const tail = read(source, source.size - tailLength, tailLength);
  let end = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (u32(tail, offset) === 0x06054b50 && offset + 22 + u16(tail, offset + 20) === tail.length) {
      end = offset; break;
    }
  }
  if (end < 0) throw new ZipValidationError('压缩文件缺少目录记录。');
  const count = u16(tail, end + 10);
  const length = u32(tail, end + 12);
  const offset = u32(tail, end + 16);
  if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    throw new ZipValidationError('暂不支持 ZIP64 压缩文件。');
  }
  if (u16(tail, end + 4) || u16(tail, end + 6) || u16(tail, end + 8) !== count) {
    throw new ZipValidationError('暂不支持多磁盘压缩文件。');
  }
  if (count > limits.entries || length > limits.entries * 1024
    || offset + length > source.size - tailLength + end) {
    throw new ZipValidationError('压缩文件目录过大或无效。');
  }
  const directory = read(source, offset, length);
  const entries: ReaderZipEntry[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder();
  let cursor = 0; let records = 0; let total = 0;
  while (cursor < directory.length) {
    if (cursor + 46 > directory.length || u32(directory, cursor) !== 0x02014b50) {
      throw new ZipValidationError('压缩文件目录记录无效。');
    }
    const flags = u16(directory, cursor + 8);
    const method = u16(directory, cursor + 10);
    const compressedSize = u32(directory, cursor + 20);
    const uncompressedSize = u32(directory, cursor + 24);
    const nameLength = u16(directory, cursor + 28);
    const recordLength = 46 + nameLength + u16(directory, cursor + 30) + u16(directory, cursor + 32);
    const localHeaderOffset = u32(directory, cursor + 42);
    if (cursor + recordLength > directory.length || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipValidationError('压缩文件目录长度无效或使用 ZIP64。');
    }
    if (flags & 1) throw new ZipValidationError('暂不支持加密压缩文件。');
    if (method !== 0 && method !== 8) throw new ZipValidationError('不支持此 ZIP 压缩方式。');
    const name = decoder.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, '/');
    if (!name || name.startsWith('/') || name.includes('\0') || name.split('/').includes('..') || names.has(name)) {
      throw new ZipValidationError('压缩文件包含无效或重复的资源路径。');
    }
    names.add(name);
    records++;
    total += uncompressedSize;
    if (uncompressedSize > limits.entry || total > limits.total || records > limits.entries) {
      throw new ZipValidationError('压缩文件展开后过大。');
    }
    if (localHeaderOffset + 30 + compressedSize > offset) throw new ZipValidationError('压缩资源范围无效。');
    if (!name.endsWith('/')) entries.push({
      name, compressedSize, uncompressedSize, localHeaderOffset,
      compressionMethod: method as 0 | 8, crc32: u32(directory, cursor + 16),
    });
    cursor += recordLength;
  }
  if (records !== count) throw new ZipValidationError('压缩文件资源数量不匹配。');
  return entries;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
});
export function extractZipEntry(source: ZipSource, entry: ReaderZipEntry): Uint8Array {
  const header = read(source, entry.localHeaderOffset, 30);
  if (u32(header, 0) !== 0x04034b50) throw new ZipValidationError('压缩资源头无效。');
  const start = entry.localHeaderOffset + 30 + u16(header, 26) + u16(header, 28);
  const compressed = read(source, start, entry.compressedSize);
  let bytes = compressed;
  if (entry.compressionMethod === 8) {
    // A ZIP can lie about its expanded size. Check actual output as small
    // compressed chunks are decoded; a fixed inflateSync output silently
    // truncates excess bytes and cannot enforce this boundary.
    bytes = new Uint8Array(entry.uncompressedSize);
    let produced = 0;
    const inflater = new Inflate((chunk) => {
      if (produced + chunk.length > bytes.length) throw new ZipValidationError('压缩资源展开后超过声明大小。');
      bytes.set(chunk, produced);
      produced += chunk.length;
    });
    try {
      for (let offset = 0; offset < compressed.length; offset += 4096) {
        const end = Math.min(offset + 4096, compressed.length);
        inflater.push(compressed.subarray(offset, end), end === compressed.length);
      }
    } catch (error) {
      if (error instanceof ZipValidationError) throw error;
      throw new ZipValidationError('压缩资源无法解码。');
    }
    if (produced !== entry.uncompressedSize) throw new ZipValidationError('压缩资源大小不匹配。');
  }
  if (bytes.length !== entry.uncompressedSize) throw new ZipValidationError('压缩资源大小不匹配。');
  if (entry.crc32 !== undefined) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new ZipValidationError('压缩资源校验失败。');
  }
  return bytes;
}

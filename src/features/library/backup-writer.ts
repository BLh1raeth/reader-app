import { File } from 'expo-file-system';
import { Zip, ZipPassThrough } from 'fflate';
import { BACKUP_LIMITS } from '../../shared/epub/zip';

export type BackupWriteOptions = {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
};
export type BackupSource = { name: string; data: Uint8Array | File };

/** Store already-compressed EPUBs directly; never assemble a whole ZIP in RAM. */
export async function writeBackupArchive(output: File, sources: BackupSource[], options: BackupWriteOptions = {}) {
  const sizeOf = (source: BackupSource) => source.data instanceof Uint8Array ? source.data.length : source.data.size;
  const total = sources.reduce((sum, source) => sum + sizeOf(source), 0);
  if (total > BACKUP_LIMITS.total || sources.length > BACKUP_LIMITS.entries
    || sources.some((source) => sizeOf(source) > BACKUP_LIMITS.entry)) {
    throw new Error('书库超过当前备份容量限制（512 MB）。');
  }
  const checkCanceled = () => {
    if (options.signal?.aborted) throw new Error('备份已取消。');
  };
  checkCanceled();
  output.create({ overwrite: true, intermediates: true });
  const handle = output.open();
  let written = 0; let processed = 0; let complete = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    written += chunk.length;
    if (written > BACKUP_LIMITS.file) throw new Error('备份文件超过 512 MB。');
    handle.writeBytes(chunk);
    complete ||= final;
  });
  const chunkSize = 256 * 1024;
  try {
    for (const source of sources) {
      checkCanceled();
      const entry = new ZipPassThrough(source.name);
      zip.add(entry);
      const size = sizeOf(source);
      if (source.data instanceof Uint8Array) {
        entry.push(source.data, true);
        processed += size;
      } else {
        const input = source.data.open();
        try {
          for (let offset = 0; offset < size; offset += chunkSize) {
            checkCanceled();
            const length = Math.min(chunkSize, size - offset);
            const chunk = input.readBytes(length);
            if (chunk.length !== length) throw new Error('备份时图书文件读取不完整。');
            entry.push(chunk, offset + length === size);
            processed += length;
            options.onProgress?.(total ? processed / total : 0);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          if (!size) entry.push(new Uint8Array(), true);
        } finally { input.close(); }
      }
      options.onProgress?.(total ? processed / total : 0);
    }
    checkCanceled();
    zip.end();
    if (!complete) throw new Error('备份文件未能完整写入。');
    options.onProgress?.(1);
  } catch (error) {
    zip.terminate();
    handle.close();
    try { if (output.exists) output.delete(); } catch { /* Keep the original failure. */ }
    throw error;
  } finally {
    if (handle.offset !== null) handle.close();
  }
}

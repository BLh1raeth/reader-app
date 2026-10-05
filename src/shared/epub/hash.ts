import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/** Bounded working memory, with opportunities for the UI to paint progress. */
export async function hashEpub(bytes: Uint8Array): Promise<string> {
  const digest = sha256.create();
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    digest.update(bytes.subarray(offset, offset + chunkSize));
    if (offset + chunkSize < bytes.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return bytesToHex(digest.digest());
}

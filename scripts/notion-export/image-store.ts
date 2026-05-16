// Storage backend for downloaded images. Pluggable per transforms-plan §5.
//
// Today only LocalImageStore is implemented (writes under static/images/notion).
// A future R2ImageStore can slot in here without touching the download or
// rewrite paths.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ImageStore {
  /** Has an object with this key already been stored? */
  has(key: string): Promise<boolean>;
  /** Store the bytes; return the PUBLIC URL the image will be served at. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** Resolve a key to its public URL without I/O. */
  urlFor(key: string): string;
}

export class LocalImageStore implements ImageStore {
  private outDir: string;
  private publicPrefix: string;

  constructor(outDir: string, publicPrefix: string) {
    this.outDir = outDir;
    this.publicPrefix = publicPrefix;
  }

  async has(key: string): Promise<boolean> {
    return existsSync(join(this.outDir, key));
  }

  async put(
    key: string,
    bytes: Uint8Array,
    _contentType: string,
  ): Promise<string> {
    await mkdir(this.outDir, { recursive: true });
    await writeFile(join(this.outDir, key), bytes);
    return this.urlFor(key);
  }

  urlFor(key: string): string {
    return `${this.publicPrefix}/${key}`;
  }
}

/**
 * Factory: returns LocalImageStore for now. When R2_ACCOUNT_ID is set in env,
 * swap in R2ImageStore (not yet implemented).
 */
export function makeImageStore(): ImageStore {
  return new LocalImageStore("static/images/notion", "/images/notion");
}

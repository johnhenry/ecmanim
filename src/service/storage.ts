// Artifact storage behind a driver interface. FsStorage is v1 (coordinator
// local disk); S3Storage arrives via lazy @aws-sdk import in storage-s3.ts
// (optionalDependencies pattern) without touching this interface.

import { createReadStream, createWriteStream, mkdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export interface StorageDriver {
  /** Persist an artifact stream under a job-scoped key; returns the key. */
  put(jobId: string, filename: string, data: Readable): Promise<string>;
  /** Open the stored artifact for reading. */
  getStream(key: string): Readable;
  /** Byte size of a stored artifact. */
  size(key: string): number;
  exists(key: string): boolean;
  /** Local filesystem path when the driver has one (FsStorage); S3-style
   *  drivers return null and the coordinator redirects instead. */
  localPath(key: string): string | null;
}

/** Keys are `<jobId>/<filename>`; both segments are sanitized (separators
 *  AND dot-runs neutralized, so a key can never spell a traversal). */
function safeKeySegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
}

export class FsStorage implements StorageDriver {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  private keyPath(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) {
      throw new Error(`FsStorage: key escapes storage root: ${JSON.stringify(key)}`);
    }
    return p;
  }

  async put(jobId: string, filename: string, data: Readable): Promise<string> {
    const key = `${safeKeySegment(jobId)}/${safeKeySegment(filename)}`;
    const path = this.keyPath(key);
    mkdirSync(join(this.root, safeKeySegment(jobId)), { recursive: true });
    await pipeline(data, createWriteStream(path));
    return key;
  }

  getStream(key: string): Readable {
    return createReadStream(this.keyPath(key));
  }

  size(key: string): number {
    return statSync(this.keyPath(key)).size;
  }

  exists(key: string): boolean {
    return existsSync(this.keyPath(key));
  }

  localPath(key: string): string | null {
    return this.keyPath(key);
  }
}

// S3-backed artifact storage. @aws-sdk/client-s3 and
// @aws-sdk/s3-request-presigner are lazy-imported (same optional-dependency
// pattern as the physics/rapier loaders) — installing them is only needed
// when S3Storage is actually constructed via createS3Storage().
//
// Downloads don't proxy through the coordinator: S3Storage implements
// presignGetUrl(), and the coordinator's artifact route 302-redirects to the
// presigned URL instead of streaming bytes itself.

import type { Readable } from "node:stream";
import type { StorageDriver } from "./storage.ts";

export interface S3StorageOptions {
  bucket: string;
  /** Key prefix inside the bucket (default "ecmanim-artifacts/"). */
  prefix?: string;
  region?: string;
  /** Presigned-GET validity in seconds (default 3600). */
  presignTtlSec?: number;
  /** Injectable clients for tests. */
  client?: any;
  presigner?: (client: any, command: any, opts: { expiresIn: number }) => Promise<string>;
  commands?: { PutObjectCommand: any; GetObjectCommand: any; HeadObjectCommand: any };
}

function safeKeySegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
}

export interface S3StorageDriver extends StorageDriver {
  presignGetUrl(key: string): Promise<string>;
}

export async function createS3Storage(options: S3StorageOptions): Promise<S3StorageDriver> {
  const prefix = options.prefix ?? "ecmanim-artifacts/";
  const ttl = options.presignTtlSec ?? 3600;

  let client = options.client;
  let commands = options.commands;
  let presigner = options.presigner;
  if (!client || !commands || !presigner) {
    // Non-literal specifiers keep TS from demanding the (optional, not
    // installed by default) AWS SDK's types at compile time.
    const importOptional = (name: string): Promise<any> => import(/* @vite-ignore */ name);
    let s3mod: any, presignMod: any;
    try {
      s3mod = await importOptional("@aws-sdk/client-s3");
      presignMod = await importOptional("@aws-sdk/s3-request-presigner");
    } catch (e: any) {
      throw new Error(
        "S3 storage requires the AWS SDK. Install it with:\n" +
        "  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner\n" +
        "Original error: " + e.message,
      );
    }
    client = client ?? new s3mod.S3Client(options.region ? { region: options.region } : {});
    commands = commands ?? {
      PutObjectCommand: s3mod.PutObjectCommand,
      GetObjectCommand: s3mod.GetObjectCommand,
      HeadObjectCommand: s3mod.HeadObjectCommand,
    };
    presigner = presigner ?? ((c, cmd, opts) => presignMod.getSignedUrl(c, cmd, opts));
  }

  const fullKey = (key: string) => `${prefix}${key}`;

  return {
    async put(jobId: string, filename: string, data: Readable): Promise<string> {
      const key = `${safeKeySegment(jobId)}/${safeKeySegment(filename)}`;
      // Buffer the stream: S3 PutObject wants a known length (multipart is
      // overkill at typical artifact sizes; revisit if artifacts grow).
      const chunks: Buffer[] = [];
      for await (const c of data) chunks.push(c as Buffer);
      await client.send(new commands!.PutObjectCommand({
        Bucket: options.bucket, Key: fullKey(key), Body: Buffer.concat(chunks),
      }));
      return key;
    },
    getStream(): Readable {
      throw new Error("S3Storage: use presignGetUrl() — the coordinator redirects instead of streaming");
    },
    size(): number {
      throw new Error("S3Storage: size is not tracked locally");
    },
    exists(key: string): any {
      return client.send(new commands!.HeadObjectCommand({ Bucket: options.bucket, Key: fullKey(key) }))
        .then(() => true, () => false);
    },
    localPath(): string | null {
      return null;
    },
    presignGetUrl(key: string): Promise<string> {
      return presigner!(client, new commands!.GetObjectCommand({ Bucket: options.bucket, Key: fullKey(key) }), { expiresIn: ttl });
    },
  };
}

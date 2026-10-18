import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { storageKeyFor } from "./attachment-core";

/**
 * Where attachment bytes live.
 *
 * The local filesystem, content-addressed. Not because object storage is wrong
 * — it is where this ends up — but because the interface here is three methods
 * wide, and swapping the body of `write` and `readStream` for an S3 client
 * changes nothing above it. Choosing a bucket today would mean choosing a
 * region and a retention policy for a regulated firm before anybody has asked
 * what those should be.
 *
 * Two consequences of content addressing worth knowing:
 *
 *   - The same file attached to forty tasks is stored once. Forty rows point
 *     at one blob.
 *   - Nothing is ever overwritten. A write of a checksum that already exists is
 *     a no-op, so a re-upload cannot replace what an earlier task relied on.
 */
@Injectable()
export class AttachmentStorage {
  private readonly logger = new Logger(AttachmentStorage.name);
  readonly root: string;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>("ATTACHMENT_DIR")?.trim();
    this.root = configured
      ? isAbsolute(configured)
        ? configured
        : resolve(process.cwd(), configured)
      : resolve(process.cwd(), "storage", "attachments");
  }

  /**
   * Write the bytes and return where they went.
   *
   * `deduplicated` is reported rather than hidden: the service records it in
   * the audit trail, so "this is the same file that was already on WP-000412"
   * is answerable without comparing files by hand.
   */
  async write(bytes: Buffer): Promise<{ checksum: string; storageKey: string; deduplicated: boolean }> {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = storageKeyFor(checksum);
    const path = this.pathFor(storageKey);

    const existing = await stat(path).catch(() => null);
    if (existing) return { checksum, storageKey, deduplicated: true };

    await mkdir(dirname(path), { recursive: true });
    // wx: fail rather than overwrite. Two uploads of the same file racing is
    // not an error - the loser just found the bytes already there.
    await writeFile(path, bytes, { flag: "wx" }).catch(async (e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });

    return { checksum, storageKey, deduplicated: false };
  }

  readStream(storageKey: string) {
    return createReadStream(this.pathFor(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    return Boolean(await stat(this.pathFor(storageKey)).catch(() => null));
  }

  /**
   * Resolve a key under the root, and refuse anything that escapes it. Keys are
   * generated from checksums so this should never fire; it is here because
   * "should never" and "cannot" are different, and this is the one place a
   * path is built at all.
   */
  private pathFor(storageKey: string): string {
    const full = resolve(join(this.root, storageKey));
    if (!full.startsWith(resolve(this.root))) {
      this.logger.error(`Refusing an attachment path outside the root: ${storageKey}`);
      throw new Error("Invalid attachment location");
    }
    return full;
  }
}

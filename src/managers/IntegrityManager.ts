// IntegrityManager — TASK-401, TASK-402, TASK-403, TASK-404
// SHA-256 hashing for file integrity verification.
// RULE-301: Every file transfer must be verified.
// RULE-304: Hash mismatch must never be reported as success.
// RULE-701: Hashing must not block the event loop.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as stream from 'stream';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

export class IntegrityManager {
  /**
   * Calculate SHA-256 of a file by streaming (RULE-205, RULE-702).
   * Does not load the entire file into memory.
   */
  async hashFile(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const readStream = fs.createReadStream(filePath);
    await pipeline(readStream, hash);
    return hash.digest('hex');
  }

  /**
   * Calculate SHA-256 of a buffer (for small text/link payloads).
   */
  hashBuffer(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Compare expected vs actual hash.
   * Returns 'match' or 'mismatch' (TASK-404).
   */
  compare(expected: string, actual: string): 'match' | 'mismatch' {
    // Constant-time comparison to avoid timing attacks
    const a = Buffer.from(expected.toLowerCase());
    const b = Buffer.from(actual.toLowerCase());
    if (a.length !== b.length) return 'mismatch';
    return crypto.timingSafeEqual(a, b) ? 'match' : 'mismatch';
  }
}

export const integrityManager = new IntegrityManager();

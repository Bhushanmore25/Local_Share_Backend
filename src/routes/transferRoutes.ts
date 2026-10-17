// Transfer Routes — TASK-301, TASK-302, TASK-303, TASK-304
// Express routes for the DATA plane (file upload/download).
// RULE-505: Data channel is separate from control channel.
// RULE-201: Only authorized (ACCEPTED) transfers proceed.
// RULE-205, RULE-702: Streaming — no full file in memory.
// RULE-405: Path traversal protection.
// RULE-406: Files written to approved location only.

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { transferManager } from '../managers/TransferManager';
import { integrityManager } from '../managers/IntegrityManager';
import { controlManager } from '../managers/ControlManager';

const UPLOADS_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'localshare-uploads')
  : path.join(__dirname, '../../uploads');

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (_) {}

// Auth tokens: transferId → { token, receiverId, expires }
const authTokens = new Map<string, { token: string; receiverId: string; expires: number }>();

/** Generate a short-lived upload token (RULE-403) */
export function issueTransferToken(transferId: string, receiverId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(transferId, { token, receiverId, expires: Date.now() + 5 * 60 * 1000 }); // 5 min
  return token;
}

function validateToken(transferId: string, token: string, receiverId: string): boolean {
  const record = authTokens.get(transferId);
  if (!record) return false;
  if (Date.now() > record.expires) { authTokens.delete(transferId); return false; } // RULE-403
  if (record.receiverId !== receiverId) return false;
  return crypto.timingSafeEqual(Buffer.from(record.token), Buffer.from(token));
}

// Multer: stream directly to disk (RULE-205 / RULE-702)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, _file, cb) => {
    // Never use incoming filename as path directly (RULE-405)
    cb(null, `${crypto.randomBytes(16).toString('hex')}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max
});

export const transferRouter = Router();

/**
 * POST /api/transfer/upload/:transferId
 * Sender uploads file to receiver (after acceptance).
 */
transferRouter.post('/upload/:transferId', upload.single('file'), async (req: Request, res: Response) => {
  const { transferId } = req.params;
  const { token, senderId, receiverId } = req.body;

  // Validate authorization (RULE-402)
  if (!validateToken(transferId, token, receiverId)) {
    res.status(403).json({ error: 'UNAUTHORIZED_TRANSFER' });
    return;
  }

  const transfer = transferManager.getTransfer(transferId);
  if (!transfer) {
    res.status(404).json({ error: 'INVALID_METADATA' });
    return;
  }

  const recipient = transfer.recipients.find((r) => r.receiverId === receiverId);
  if (!recipient || recipient.status !== 'ACCEPTED') {
    res.status(400).json({ error: 'UNAUTHORIZED_TRANSFER' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file received' });
    return;
  }

  const filePath = req.file.path;
  const item = transfer.item;

  // Move to verify state
  transferManager.updateRecipientStatus(transferId, receiverId, 'TRANSFER');
  transferManager.updateRecipientStatus(transferId, receiverId, 'VERIFY');

  // Hash verification (TASK-403, TASK-404)
  try {
    const actualHash = await integrityManager.hashFile(filePath);
    const expectedHash = item.kind === 'file' ? item.sha256 : '';
    const result = integrityManager.compare(expectedHash, actualHash);

    if (result === 'match') {
      transferManager.updateRecipientStatus(transferId, receiverId, 'COMPLETED', {
        verificationResult: 'match',
        progress: 100,
        bytesTransferred: req.file.size,
      });

      controlManager.broadcast({
        version: 1,
        type: 'TRANSFER_COMPLETE',
        payload: { transferId, receiverId, verificationResult: 'match', filePath: req.file.filename },
      });

      res.json({ success: true, verificationResult: 'match', savedAs: req.file.filename });
    } else {
      // RULE-304: mismatch = FAILED
      fs.unlinkSync(filePath); // delete corrupt file
      transferManager.updateRecipientStatus(transferId, receiverId, 'FAILED', {
        verificationResult: 'mismatch',
        error: 'INTEGRITY_MISMATCH',
      });

      controlManager.broadcast({
        version: 1,
        type: 'TRANSFER_FAILED',
        payload: { transferId, receiverId, error: 'INTEGRITY_MISMATCH' },
      });

      res.status(422).json({ error: 'INTEGRITY_MISMATCH' });
    }
  } catch (err) {
    transferManager.updateRecipientStatus(transferId, receiverId, 'FAILED', {
      error: 'TRANSFER_FAILED',
    });
    res.status(500).json({ error: 'TRANSFER_FAILED' });
  } finally {
    authTokens.delete(transferId);
  }
});

/**
 * GET /api/transfer/download/:filename
 * Receiver downloads a file that was received (RULE-407: no auto-execute).
 */
transferRouter.get('/download/:filename', (req: Request, res: Response) => {
  // Sanitize filename — never trust incoming path (RULE-405)
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, safeName);

  if (!filePath.startsWith(UPLOADS_DIR)) {
    res.status(403).json({ error: 'UNAUTHORIZED_TRANSFER' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(filePath);
});

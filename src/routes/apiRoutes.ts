// API Routes — device, discovery, transfer control
import { Router, Request, Response } from 'express';
import { deviceManager } from '../managers/DeviceManager';
import { discoveryManager } from '../managers/DiscoveryManager';
import { transferManager } from '../managers/TransferManager';
import { controlManager } from '../managers/ControlManager';
import { issueTransferToken } from './transferRoutes';
import { ShareableItem, Device, DevicePlatform } from '../shared/types';

export const apiRouter = Router();

// ── Device ────────────────────────────────────────────────────────────────────

/** GET /api/device — Return this device's identity */
apiRouter.get('/device', (_req: Request, res: Response) => {
  res.json(deviceManager.device);
});

/** PATCH /api/device/name — Rename this device */
apiRouter.patch('/device/name', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Invalid name' });
    return;
  }
  deviceManager.setName(name.trim().slice(0, 64));
  res.json({ name: deviceManager.device.name });
});

// ── Discovery ─────────────────────────────────────────────────────────────────

/** GET /api/devices — List discovered nearby devices */
apiRouter.get('/devices', (req: Request, res: Response) => {
  const callerId = (req.query.deviceId as string) || '';
  const callerIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

  // 1. UDP-discovered peers (always on the same local subnet)
  const udpDevices = discoveryManager.getDevices()
    .filter((d) => !callerId || d.device.deviceId !== callerId)
    .map((d) => ({
      ...d.device,
      ip: d.ip,
      serverPort: d.serverPort,
      sameNetwork: true,
    }));

  // 2. Connected WebSocket clients (tagged with sameNetwork relative to caller's IP)
  const wsDevices = controlManager.getConnectedDevices(callerId, callerIp);

  // Merge map by deviceId
  const deviceMap = new Map<string, Device>();
  for (const d of udpDevices) deviceMap.set(d.deviceId, d);
  for (const d of wsDevices) deviceMap.set(d.deviceId, d);

  res.json(Array.from(deviceMap.values()));
});

// ── Dev / Simulation ──────────────────────────────────────────────────────────

/** POST /api/dev/mock-peer — Inject a simulated peer for testing */
apiRouter.post('/dev/mock-peer', (req: Request, res: Response) => {
  const { name = 'Pixel 8 Pro (Nearby)', platform = 'android' } = req.body || {};
  const mockId = 'mock-' + Math.random().toString(36).slice(2, 8);
  const mockDevice: Device = {
    deviceId: mockId,
    name,
    platform: platform as DevicePlatform,
    appVersion: '1.0.0',
    transferPort: 5001,
    availability: 'available',
  };
  discoveryManager.addPeer(mockDevice, '192.168.1.105');
  res.status(201).json(mockDevice);
});

/** DELETE /api/dev/mock-peer/:deviceId — Remove simulated peer */
apiRouter.delete('/dev/mock-peer/:deviceId', (req: Request, res: Response) => {
  discoveryManager.removePeer(req.params.deviceId);
  res.json({ success: true });
});

// ── Transfers ─────────────────────────────────────────────────────────────────

/** GET /api/transfers — List all transfers */
apiRouter.get('/transfers', (_req: Request, res: Response) => {
  res.json(transferManager.getAllTransfers());
});

/**
 * POST /api/transfers — Create a new transfer request
 * Body: { recipientIds: string[], item: ShareableItem, senderId?: string }
 */
apiRouter.post('/transfers', (req: Request, res: Response) => {
  const { recipientIds, item, senderId: reqSenderId } = req.body as {
    recipientIds: string[];
    item: ShareableItem;
    senderId?: string;
  };

  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    res.status(400).json({ error: 'INVALID_METADATA' });
    return;
  }
  if (!item || !item.kind) {
    res.status(400).json({ error: 'INVALID_METADATA' });
    return;
  }

  const senderId = reqSenderId || deviceManager.device.deviceId;
  const transfer = transferManager.createTransfer(senderId, item, recipientIds);

  // Move each recipient from REQUEST → PENDING
  for (const rid of recipientIds) {
    transferManager.updateRecipientStatus(transfer.transferId, rid, 'PENDING');
  }

  // Send request to each recipient via WebSocket (TASK-206)
  for (const recipient of transfer.recipients) {
    controlManager.sendTo(recipient.receiverId, {
      version: 1,
      type: 'TRANSFER_REQUEST',
      payload: {
        transferId: transfer.transferId,
        senderId,
        receiverId: recipient.receiverId,
        item,
      },
    });

    // Auto-accept mock peers for demo/automated testing
    if (recipient.receiverId.startsWith('mock-')) {
      setTimeout(() => {
        const ok = transferManager.updateRecipientStatus(transfer.transferId, recipient.receiverId, 'ACCEPTED');
        if (ok) {
          const token = issueTransferToken(transfer.transferId, recipient.receiverId);
          controlManager.sendTo(senderId, {
            version: 1,
            type: 'TRANSFER_ACCEPT',
            payload: { transferId: transfer.transferId, receiverId: recipient.receiverId, uploadToken: token },
          });
        }
      }, 1000);
    }
  }

  res.status(201).json(transfer);
});

/**
 * POST /api/transfers/:transferId/accept — Receiver accepts
 * Body: { receiverId: string }
 */
apiRouter.post('/transfers/:transferId/accept', (req: Request, res: Response) => {
  const { transferId } = req.params;
  const { receiverId } = req.body;

  if (!receiverId) { res.status(400).json({ error: 'INVALID_METADATA' }); return; }

  const ok = transferManager.updateRecipientStatus(transferId, receiverId, 'ACCEPTED');
  if (!ok) { res.status(400).json({ error: 'Invalid state transition' }); return; }

  // Issue short-lived upload token (RULE-403)
  const token = issueTransferToken(transferId, receiverId);

  // Notify sender to start upload
  const transfer = transferManager.getTransfer(transferId);
  if (transfer) {
    controlManager.sendTo(transfer.senderId, {
      version: 1,
      type: 'TRANSFER_ACCEPT',
      payload: { transferId, receiverId, uploadToken: token },
    });
  }

  res.json({ success: true, uploadToken: token });
});

/**
 * POST /api/transfers/:transferId/reject — Receiver rejects
 * Body: { receiverId: string }
 */
apiRouter.post('/transfers/:transferId/reject', (req: Request, res: Response) => {
  const { transferId } = req.params;
  const { receiverId } = req.body;

  if (!receiverId) { res.status(400).json({ error: 'INVALID_METADATA' }); return; }

  const ok = transferManager.updateRecipientStatus(transferId, receiverId, 'REJECTED');
  if (!ok) { res.status(400).json({ error: 'Invalid state transition' }); return; }

  const transfer = transferManager.getTransfer(transferId);
  if (transfer) {
    controlManager.sendTo(transfer.senderId, {
      version: 1,
      type: 'TRANSFER_REJECT',
      payload: { transferId, receiverId },
    });
  }

  res.json({ success: true });
});

/**
 * POST /api/transfers/:transferId/cancel — Cancel a transfer
 * Body: { deviceId: string }
 */
apiRouter.post('/transfers/:transferId/cancel', (req: Request, res: Response) => {
  const { transferId } = req.params;
  const { receiverId } = req.body;

  const transfer = transferManager.getTransfer(transferId);
  if (!transfer) { res.status(404).json({ error: 'Not found' }); return; }

  const ok = transferManager.updateRecipientStatus(transferId, receiverId, 'CANCELLED');
  if (!ok) { res.status(400).json({ error: 'Invalid state transition' }); return; }

  controlManager.broadcast({
    version: 1,
    type: 'TRANSFER_CANCEL',
    payload: { transferId, receiverId },
  });

  res.json({ success: true });
});

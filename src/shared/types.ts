// LocalShare — Shared Types (TASK-002, TASK-003, TASK-004)
// Used by both server and client.

export const SHARED_TYPES_VERSION = 1;

// ─── Transfer State Machine ───────────────────────────────────────────────────
export type TransferStatus =
  | 'REQUEST'
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'TRANSFER'
  | 'VERIFY'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

// ─── Device Identity (TASK-101) ───────────────────────────────────────────────
export type DevicePlatform = 'web' | 'android' | 'ios' | 'windows' | 'macos' | 'linux';
export type DeviceAvailability = 'available' | 'connecting' | 'offline' | 'unavailable';

export interface Device {
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string;
  transferPort: number;
  availability: DeviceAvailability;
  ip?: string;
}

// ─── Shareable Items (TASK-202) ───────────────────────────────────────────────
export interface FileItem {
  kind: 'file';
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
}

export interface TextItem {
  kind: 'text';
  content: string;
}

export interface LinkItem {
  kind: 'link';
  url: string;
}

export type ShareableItem = FileItem | TextItem | LinkItem;

// ─── Transfer (TASK-201, TASK-204) ────────────────────────────────────────────
export interface TransferRequest {
  version: number;
  transferId: string;
  senderId: string;
  receiverId: string;
  item: ShareableItem;
  timestamp: number;
}

export interface TransferRecipient {
  receiverId: string;
  transferId: string;
  status: TransferStatus;
  progress: number;
  bytesTransferred: number;
  error?: string;
  verificationResult?: 'match' | 'mismatch';
}

export interface Transfer {
  transferId: string;
  senderId: string;
  item: ShareableItem;
  recipients: TransferRecipient[];
  createdAt: number;
}

// ─── Control Plane Messages (TASK-004) ────────────────────────────────────────
export type ControlMessageType =
  | 'DEVICE_ANNOUNCE'
  | 'TRANSFER_REQUEST'
  | 'TRANSFER_ACCEPT'
  | 'TRANSFER_REJECT'
  | 'TRANSFER_CANCEL'
  | 'TRANSFER_PROGRESS'
  | 'TRANSFER_COMPLETE'
  | 'TRANSFER_FAILED'
  | 'PING'
  | 'PONG';

export interface ControlMessage {
  version: number;
  type: ControlMessageType;
  payload: unknown;
}

// ─── Error codes ──────────────────────────────────────────────────────────────
export type LocalShareError =
  | 'DISCOVERY_FAILED'
  | 'DEVICE_UNREACHABLE'
  | 'REQUEST_REJECTED'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_CANCELLED'
  | 'INTEGRITY_MISMATCH'
  | 'INVALID_METADATA'
  | 'UNAUTHORIZED_TRANSFER';

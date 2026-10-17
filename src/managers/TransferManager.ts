// TransferManager — TASK-201, TASK-204, TASK-205, TASK-207, TASK-304, TASK-306, TASK-307
// Manages all in-memory transfer records.
// RULE-202: Every recipient has independent state.
// RULE-204: One failure does not cancel others.

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import {
  Transfer,
  TransferRecipient,
  TransferStatus,
  ShareableItem,
} from '../shared/types';

class TransferManager extends EventEmitter {
  /** Map of transferId → Transfer */
  private transfers = new Map<string, Transfer>();

  /** Create a new outgoing transfer record (one per sender-item pair) */
  createTransfer(senderId: string, item: ShareableItem, recipientIds: string[]): Transfer {
    const transferId = `TR-${uuidv4()}`;
    const recipients: TransferRecipient[] = recipientIds.map((rid) => ({
      receiverId: rid,
      transferId: `${transferId}-${rid}`,  // unique per recipient (RULE-502)
      status: 'REQUEST',
      progress: 0,
      bytesTransferred: 0,
    }));

    const transfer: Transfer = {
      transferId,
      senderId,
      item,
      recipients,
      createdAt: Date.now(),
    };

    this.transfers.set(transferId, transfer);
    console.log(`[TransferManager] Created transfer ${transferId} → ${recipientIds.join(', ')}`);
    this.emit('transferCreated', transfer);
    return transfer;
  }

  getTransfer(transferId: string): Transfer | undefined {
    return this.transfers.get(transferId);
  }

  getAllTransfers(): Transfer[] {
    return Array.from(this.transfers.values());
  }

  /** Update recipient-level state (RULE-202) */
  updateRecipientStatus(
    transferId: string,
    receiverId: string,
    status: TransferStatus,
    extra?: Partial<Pick<TransferRecipient, 'progress' | 'bytesTransferred' | 'error' | 'verificationResult'>>
  ): boolean {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return false;

    const recipient = transfer.recipients.find((r) => r.receiverId === receiverId);
    if (!recipient) return false;

    // Validate transition (RULE-SM)
    if (!this.isValidTransition(recipient.status, status)) {
      console.warn(`[TransferManager] Invalid transition ${recipient.status} → ${status} for ${receiverId}`);
      return false;
    }

    recipient.status = status;
    if (extra) Object.assign(recipient, extra);

    this.emit('recipientUpdated', { transfer, recipient });
    return true;
  }

  private isValidTransition(from: TransferStatus, to: TransferStatus): boolean {
    const allowed: Record<TransferStatus, TransferStatus[]> = {
      REQUEST:   ['PENDING'],
      PENDING:   ['ACCEPTED', 'REJECTED', 'CANCELLED'],
      ACCEPTED:  ['TRANSFER', 'CANCELLED'],
      REJECTED:  [],
      TRANSFER:  ['VERIFY', 'FAILED', 'CANCELLED'],
      VERIFY:    ['COMPLETED', 'FAILED'],
      COMPLETED: [],
      FAILED:    [],
      CANCELLED: [],
    };
    return allowed[from]?.includes(to) ?? false;
  }
}

export const transferManager = new TransferManager();

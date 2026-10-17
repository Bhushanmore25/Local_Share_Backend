// DiscoveryManager — TASK-102, TASK-103, TASK-104
// UDP broadcast-based local network discovery.
// RULE-101: No manual IP entry for normal discovery.
// RULE-103: Stale devices are expired after timeout.

import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { Device } from '../shared/types';
import { deviceManager } from './DeviceManager';

const BROADCAST_PORT = 5000;
const BROADCAST_INTERVAL_MS = 3000;   // Advertise every 3s
const STALE_TIMEOUT_MS = 10000;       // Expire after 10s silence (RULE-103)
const MAGIC = 'LOCALSHARE_DISC_V1';

interface DiscoveryPacket {
  magic: string;
  device: Device;
  serverPort: number;
}

interface DiscoveredDevice {
  device: Device;
  ip: string;
  serverPort: number;
  lastSeen: number;
}

export class DiscoveryManager extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private peers = new Map<string, DiscoveredDevice>(); // keyed by deviceId

  start(serverPort: number) {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo, serverPort));
    this.socket.on('error', (err) => console.error('[Discovery] UDP error:', err.message));

    this.socket.bind(BROADCAST_PORT, () => {
      this.socket!.setBroadcast(true);
      console.log(`[Discovery] Listening on UDP :${BROADCAST_PORT}`);
      this.startBroadcast(serverPort);
      this.startCleanup();
    });
  }

  stop() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.socket?.close();
    this.socket = null;
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.peers.values());
  }

  addPeer(device: Device, ip = '192.168.1.50', serverPort = 5001) {
    this.peers.set(device.deviceId, {
      device: { ...device, ip },
      ip,
      serverPort,
      lastSeen: Date.now() + 600000, // 10 minutes so mock peers stay active
    });
    this.emit('deviceFound', this.peers.get(device.deviceId));
  }

  removePeer(deviceId: string) {
    this.peers.delete(deviceId);
    this.emit('deviceLeft', deviceId);
  }

  private startBroadcast(serverPort: number) {
    const send = () => {
      const packet: DiscoveryPacket = {
        magic: MAGIC,
        device: { ...deviceManager.device, availability: 'available' },
        serverPort,
      };
      const buf = Buffer.from(JSON.stringify(packet));
      this.socket?.send(buf, 0, buf.length, BROADCAST_PORT, '255.255.255.255', (err) => {
        if (err) console.error('[Discovery] Broadcast error:', err.message);
      });
    };
    send();
    this.broadcastTimer = setInterval(send, BROADCAST_INTERVAL_MS);
  }

  private startCleanup() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > STALE_TIMEOUT_MS) {
          this.peers.delete(id);
          console.log(`[Discovery] Device expired: ${id}`);
          this.emit('deviceLeft', id);
        }
      }
    }, STALE_TIMEOUT_MS / 2);
  }

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo, serverPort: number) {
    try {
      const packet: DiscoveryPacket = JSON.parse(msg.toString());
      if (packet.magic !== MAGIC) return;
      if (packet.device.deviceId === deviceManager.device.deviceId) return; // Skip self

      const existing = this.peers.get(packet.device.deviceId);
      const discovered: DiscoveredDevice = {
        device: { ...packet.device, ip: rinfo.address },
        ip: rinfo.address,
        serverPort: packet.serverPort,
        lastSeen: Date.now(),
      };

      this.peers.set(packet.device.deviceId, discovered);

      if (!existing) {
        console.log(`[Discovery] New device: ${packet.device.name} @ ${rinfo.address}`);
        this.emit('deviceFound', discovered);
      } else {
        this.emit('deviceUpdated', discovered);
      }
    } catch (e) {
      // Ignore malformed packets — RULE-404
    }
  }
}

export const discoveryManager = new DiscoveryManager();

// ControlManager — TASK-004 (WebSocket control plane)
// Manages the WebSocket server for control plane messages.
// RULE-505: Separate control and data channels.
// RULE-501: Messages include protocol version.

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { EventEmitter } from 'events';
import { ControlMessage, Device } from '../shared/types';
import { deviceManager } from './DeviceManager';

interface ConnectedClient {
  ws: WebSocket;
  deviceId: string;
  ip: string;
  device?: Device;
}

class ControlManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ConnectedClient>(); // keyed by deviceId

  attach(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress || 'unknown';
      let clientDeviceId = '';

      ws.on('message', (raw) => {
        try {
          const msg: ControlMessage = JSON.parse(raw.toString());
          if (!msg.version || !msg.type) return; // RULE-404

          if (msg.type === 'DEVICE_ANNOUNCE') {
            const payload = msg.payload as { deviceId?: string; device?: Device };
            const dev = payload.device;
            clientDeviceId = payload.deviceId || dev?.deviceId || '';
            if (!clientDeviceId) return;

            const clientDevice: Device = dev || {
              deviceId: clientDeviceId,
              name: `Device-${clientDeviceId.slice(0, 6)}`,
              platform: 'web',
              appVersion: '1.0.0',
              transferPort: 5001,
              availability: 'available',
              ip,
            };

            this.clients.set(clientDeviceId, { ws, deviceId: clientDeviceId, ip, device: clientDevice });
            console.log(`[Control] Client connected: ${clientDevice.name} (${clientDeviceId}) @ ${ip}`);

            // Notify other clients about the new device
            this.broadcast({
              version: 1,
              type: 'DEVICE_ANNOUNCE',
              payload: { device: clientDevice },
            }, clientDeviceId);
          } else if (msg.type === 'PING') {
            this.sendTo(clientDeviceId, { version: 1, type: 'PONG', payload: {} });
          }

          this.emit('message', { msg, from: clientDeviceId, ip });
        } catch (e) {
          // Malformed message — RULE-404
        }
      });

      ws.on('close', () => {
        if (clientDeviceId) {
          this.clients.delete(clientDeviceId);
          console.log(`[Control] Client disconnected: ${clientDeviceId}`);
        }
      });

      ws.on('error', (err) => console.error('[Control] WS error:', err.message));
    });

    console.log('[Control] WebSocket server ready on /ws');
  }

  /** Send a control message to a specific device */
  sendTo(deviceId: string, msg: ControlMessage): boolean {
    const client = this.clients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Broadcast to all connected clients */
  broadcast(msg: ControlMessage, excludeDeviceId?: string) {
    const data = JSON.stringify(msg);
    for (const [id, client] of this.clients.entries()) {
      if (id === excludeDeviceId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  getConnectedClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  getConnectedDevices(excludeId?: string): Device[] {
    const list: Device[] = [];
    for (const [id, c] of this.clients.entries()) {
      if (id !== excludeId && c.device) {
        list.push(c.device);
      }
    }
    return list;
  }
}

export const controlManager = new ControlManager();

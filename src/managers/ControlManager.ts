// ControlManager — TASK-004 (WebSocket control plane)
// Manages the WebSocket server for control plane messages and WebRTC signaling.
// Identifies devices sharing the same router / Wi-Fi network.
// Facilitates direct P2P transfers via WebRTC DataChannel (zero server relay of files).

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { EventEmitter } from 'events';
import { ControlMessage, Device } from '../shared/types';

interface ConnectedClient {
  ws: WebSocket;
  deviceId: string;
  ip: string;
  networkId: string;
  device?: Device;
}

export function extractClientIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export function getNetworkId(ip: string): string {
  if (ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1')) {
    return 'local-network';
  }
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = (hash << 5) - hash + ip.charCodeAt(i);
    hash |= 0;
  }
  return `wifi-${Math.abs(hash).toString(36)}`;
}

export function isSameNetwork(ip1: string, ip2: string): boolean {
  if (!ip1 || !ip2) return false;
  const isLoopback1 = ip1 === '127.0.0.1' || ip1 === '::1' || ip1.includes('127.0.0.1');
  const isLoopback2 = ip2 === '127.0.0.1' || ip2 === '::1' || ip2.includes('127.0.0.1');
  if (isLoopback1 && isLoopback2) return true;
  return ip1 === ip2;
}

class ControlManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ConnectedClient>(); // keyed by deviceId

  attach(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const ip = extractClientIp(req);
      const networkId = getNetworkId(ip);
      let clientDeviceId = '';

      ws.on('message', (raw) => {
        try {
          const msg: ControlMessage = JSON.parse(raw.toString());
          if (!msg.version || !msg.type) return;

          if (msg.type === 'DEVICE_ANNOUNCE') {
            const payload = msg.payload as { deviceId?: string; device?: Device };
            const dev = payload.device;
            clientDeviceId = payload.deviceId || dev?.deviceId || '';
            if (!clientDeviceId) return;

            const clientDevice: Device = {
              deviceId: clientDeviceId,
              name: dev?.name || `Device-${clientDeviceId.slice(0, 6)}`,
              platform: dev?.platform || 'web',
              appVersion: dev?.appVersion || '1.0.0',
              transferPort: dev?.transferPort || 5001,
              availability: 'available',
              ip,
              networkId,
            };

            this.clients.set(clientDeviceId, {
              ws,
              deviceId: clientDeviceId,
              ip,
              networkId,
              device: clientDevice,
            });

            console.log(`[Control] Client joined: ${clientDevice.name} (${clientDeviceId}) @ ${ip} [Network: ${networkId}]`);

            // 1. Send the newly connected client a list of all current peers, tagged with sameNetwork
            const peerList: Device[] = [];
            for (const [otherId, otherClient] of this.clients.entries()) {
              if (otherId !== clientDeviceId && otherClient.device) {
                peerList.push({
                  ...otherClient.device,
                  sameNetwork: isSameNetwork(ip, otherClient.ip),
                });
              }
            }

            this.sendTo(clientDeviceId, {
              version: 1,
              type: 'PEER_LIST',
              payload: { devices: peerList, networkId },
            });

            // 2. Announce this new device to all existing clients with their relative sameNetwork flag
            for (const [otherId, otherClient] of this.clients.entries()) {
              if (otherId === clientDeviceId) continue;
              if (otherClient.ws.readyState === WebSocket.OPEN) {
                const customizedDevice: Device = {
                  ...clientDevice,
                  sameNetwork: isSameNetwork(otherClient.ip, ip),
                };
                otherClient.ws.send(JSON.stringify({
                  version: 1,
                  type: 'DEVICE_ANNOUNCE',
                  payload: { device: customizedDevice },
                }));
              }
            }
          } else if (msg.type === 'PING') {
            this.sendTo(clientDeviceId, { version: 1, type: 'PONG', payload: {} });
          } else {
            // Forward signaling and transfer messages to the destination peer
            const payloadAny = msg.payload as any;
            const targetId = msg.targetDeviceId || payloadAny?.receiverId || payloadAny?.targetDeviceId || payloadAny?.senderId;
            if (targetId && targetId !== clientDeviceId) {
              const delivered = this.sendTo(targetId, msg);
              if (!delivered) {
                console.warn(`[Control] Target peer not reachable: ${targetId} for ${msg.type}`);
              }
            }
          }

          this.emit('message', { msg, from: clientDeviceId, ip });
        } catch (e) {
          // Malformed message
        }
      });

      ws.on('close', () => {
        if (clientDeviceId) {
          const disconnected = this.clients.get(clientDeviceId)?.device;
          this.clients.delete(clientDeviceId);
          console.log(`[Control] Client left: ${clientDeviceId}`);
          if (disconnected) {
            this.broadcast({
              version: 1,
              type: 'DEVICE_ANNOUNCE',
              payload: { device: { ...disconnected, availability: 'offline' } },
            });
          }
        }
      });

      ws.on('error', (err) => console.error('[Control] WS error:', err.message));
    });

    console.log('[Control] WebSocket server ready on /ws with WebRTC signaling');
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

  getConnectedDevices(callerId?: string, callerIp?: string): Device[] {
    const list: Device[] = [];
    for (const [id, c] of this.clients.entries()) {
      if (id !== callerId && c.device) {
        list.push({
          ...c.device,
          sameNetwork: callerIp ? isSameNetwork(callerIp, c.ip) : false,
        });
      }
    }
    return list;
  }
}

export const controlManager = new ControlManager();

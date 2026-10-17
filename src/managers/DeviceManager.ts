// DeviceManager — TASK-101
// Manages this server's identity (stable UUID, name, platform).
// RULE-102: Never use IP as permanent Device ID.

import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Device, DevicePlatform } from '../shared/types';

const IDENTITY_FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), '.device-identity.json')
  : path.join(__dirname, '../../.device-identity.json');
const TRANSFER_PORT = parseInt(process.env.TRANSFER_PORT || '5001', 10);
const APP_VERSION = '1.0.0';

function detectPlatform(): DevicePlatform {
  const p = os.platform();
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  if (p === 'linux') return 'linux';
  return 'web';
}

function loadOrCreateIdentity(): Device {
  if (fs.existsSync(IDENTITY_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
      if (data.deviceId && data.name) {
        return {
          ...data,
          transferPort: TRANSFER_PORT,
          availability: 'available',
        };
      }
    } catch (_) { /* fall through to create */ }
  }

  const device: Device = {
    deviceId: uuidv4(),
    name: process.env.DEVICE_NAME || (process.env.VERCEL ? 'Vercel Cloud Relay' : `${os.hostname()}'s PC`),
    platform: process.env.VERCEL ? 'web' : detectPlatform(),
    appVersion: APP_VERSION,
    transferPort: TRANSFER_PORT,
    availability: 'available',
  };

  try {
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify({ deviceId: device.deviceId, name: device.name, platform: device.platform, appVersion: device.appVersion }), 'utf-8');
  } catch (_) {}
  return device;
}

class DeviceManager {
  private _device: Device;

  constructor() {
    this._device = loadOrCreateIdentity();
    console.log(`[DeviceManager] Identity: ${this._device.deviceId} | "${this._device.name}" | ${this._device.platform}`);
  }

  get device(): Device {
    return this._device;
  }

  setName(name: string) {
    this._device.name = name;
    // Persist new name
    try {
      const saved = fs.existsSync(IDENTITY_FILE) ? JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8')) : {};
      fs.writeFileSync(IDENTITY_FILE, JSON.stringify({ ...saved, name }), 'utf-8');
    } catch (_) {}
  }
}

export const deviceManager = new DeviceManager();

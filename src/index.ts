// LocalShare Server — Entry point
// Wires together Express, WebSocket, UDP Discovery.

import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { discoveryManager } from './managers/DiscoveryManager';
import { controlManager } from './managers/ControlManager';
import { apiRouter } from './routes/apiRoutes';
import { transferRouter } from './routes/transferRoutes';

const PORT = parseInt(process.env.PORT || '5001', 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const httpServer = http.createServer(app);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: true, // Allow all origins (web, mobile, localhost, vercel, etc.)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'token', 'senderId', 'receiverId'],
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Root & Health ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'LocalShare Backend API',
    status: 'online',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'standalone-node',
    timestamp: Date.now(),
  });
});
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
app.use('/api/transfer', transferRouter);

// ── WebSocket (Control plane) & Server Lifecycle ──────────────────────────────
if (!process.env.VERCEL) {
  controlManager.attach(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 LocalShare server running on http://0.0.0.0:${PORT}`);
    console.log(`   Client origin: ${CLIENT_ORIGIN}`);

    // Start UDP discovery AFTER server is listening
    try {
      discoveryManager.start(PORT);
    } catch (e: any) {
      console.warn('[Discovery] Could not bind UDP:', e.message);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    discoveryManager.stop();
    httpServer.close(() => process.exit(0));
  });
}

export default app;

# LocalShare Backend API

The backend server for LocalShare — LAN & Local File Transfer, providing device discovery, WebSocket signaling, transfer negotiation, and streaming file uploads with SHA-256 verification.

---

## 🚀 Deployment

### Option A: Vercel (Serverless REST API)
This repository includes `vercel.json` configured with `@vercel/node`.

1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **Add New...** ➔ **Project**.
3. Import your GitHub repository: `Local_Share_Backend`.
4. Keep the default settings and click **Deploy**.
5. Once deployed, test your API at `https://your-project.vercel.app/` or `https://your-project.vercel.app/health`.

> **Note on Vercel Serverless**:
> Vercel runs stateless serverless functions. Persistent WebSocket connections and raw UDP broadcast are only active when running on a persistent server (like Render, Railway, or local Node.js). All REST endpoints (`/api/device`, `/api/devices`, `/api/transfers`, `/api/dev/mock-peer`, `/health`) function out of the box on Vercel.

---

### Option B: Render / Railway (Persistent Node.js + Full WebSockets)
If you want persistent WebSockets (`/ws`) in the cloud:
1. Connect this repo to **Render.com** (as a **Web Service**) or **Railway.app**.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start development server with hot-reload (port 5001 + UDP 5000)
npm run dev

# Build for production
npm run build

# Start production build
npm start
```

## 📡 API Endpoints

- `GET /` — API status and runtime info
- `GET /health` — Health check
- `GET /api/device` — This device's identity and metadata
- `GET /api/devices` — Discovered nearby devices
- `POST /api/dev/mock-peer` — Inject a simulated peer for testing
- `POST /api/transfers` — Create transfer request
- `POST /api/transfers/:id/accept` — Accept incoming transfer
- `POST /api/transfers/:id/reject` — Reject incoming transfer
- `POST /api/transfers/:id/cancel` — Cancel transfer
- `POST /api/transfer/upload/:transferId` — Authorized file upload stream
- `GET /api/transfer/download/:filename` — Download received file

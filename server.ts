/**
 * Twitch Drops Miner – Main Server
 *
 * All bugs from session 1 fixed, all improvements from session 2 applied.
 * Single shared DB, watchdog-wrapped services, token refresh scheduler.
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Shared singletons ────────────────────────────────────────────────────────
import db from './src/core/db.js';
import { apiRouter }       from './src/api/routes.js';
import { dashboardRouter } from './src/api/dashboard-routes.js';

// ─── Services ─────────────────────────────────────────────────────────────────
import TokenRefreshService  from './src/services/token-refresh.service.js';
import { ServiceWatchdog }  from './src/services/service-watchdog.js';
import DropIndexerService   from './src/services/drop-indexer.service.js';
import ChatFarmerService    from './src/services/chat-farmer.service.js';
import FollowedChannelsService from './src/services/followed-channels.service.js';
import PointClaimerService  from './src/services/point-claimer.service.js';
import CampaignDiscoveryService from './src/services/campaign-discovery.service.js';
import StreamAllocatorService   from './src/services/stream-allocator.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = createServer(app);
const PORT   = Number(process.env.PORT) || 3000;

// ─── Middleware (order matters) ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());  // MUST come before logger so req.body is populated

app.use((req, _res, next) => {
  const body = req.body ? JSON.stringify(req.body).substring(0, 200) : '-';
  console.log(`[API] ${req.method} ${req.path} | ${body}`);
  next();
});

// ─── API Routes (registered BEFORE static / SPA catch-all) ───────────────────
app.use('/api', apiRouter);
app.use('/api', dashboardRouter);

// ─── Static Frontend ──────────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback — only for non-API GET requests
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `No such route: ${req.path}` });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

export const broadcast = (data: object) => {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
};

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  try {
    ws.send(JSON.stringify({ type: 'stats', data: getStats() }));
  } catch {}
  ws.on('close', () => console.log('[WS] Client disconnected'));
  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

setInterval(() => {
  try { broadcast({ type: 'stats', data: getStats() }); } catch {}
}, 15_000);

function getStats() {
  return {
    totalAccounts:  (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as any).n,
    activeAccounts: (db.prepare(`SELECT COUNT(*) as n FROM accounts WHERE status='farming'`).get() as any).n,
    totalDrops:     (db.prepare('SELECT COUNT(*) as n FROM drops').get() as any).n,
    claimedDrops:   (db.prepare('SELECT COUNT(*) as n FROM drops WHERE claimed=1').get() as any).n,
    activeStreams:  (db.prepare('SELECT COUNT(*) as n FROM active_streams').get() as any).n,
    timestamp: new Date().toISOString(),
  };
}

// ─── Client ID resolution ─────────────────────────────────────────────────────
function resolveClientId(): string {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get() as any;
    return row?.value || process.env.TWITCH_CLIENT_ID || '';
  } catch { return process.env.TWITCH_CLIENT_ID || ''; }
}

const clientId = resolveClientId();
if (!clientId) {
  console.warn('⚠️  No Twitch Client ID found. Set it in Settings or via TWITCH_CLIENT_ID env var.');
} else {
  console.log('✅ Client ID loaded');
}

// ─── Services with watchdog ───────────────────────────────────────────────────
console.log('🔧 Initializing services…');

// Token refresh is most critical — must start first
const tokenRefreshSvc = new TokenRefreshService(clientId, broadcast);
new ServiceWatchdog('TokenRefresh', tokenRefreshSvc, broadcast).start();

// Hot-reload client ID when settings are updated
const originalBroadcast = broadcast;
const broadcastProxy = (data: any) => {
  originalBroadcast(data);
  if (data?.type === 'settings_saved' && data?.settings?.twitchClientId) {
    tokenRefreshSvc.setClientId(data.settings.twitchClientId);
    console.log('[Server] Client ID updated from settings');
  }
};

const dropIndexerSvc   = new DropIndexerService(broadcastProxy);
const chatFarmerSvc    = new ChatFarmerService(broadcast);
const followedSvc      = new FollowedChannelsService(db, clientId);
const pointClaimerSvc  = new PointClaimerService(broadcast);

const campaignDiscoverySvc = new CampaignDiscoveryService(db, clientId, broadcast);
const streamAllocatorSvc   = new StreamAllocatorService(db, clientId, broadcast);

new ServiceWatchdog('DropIndexer',      dropIndexerSvc,  broadcast).start();
new ServiceWatchdog('ChatFarmer',       chatFarmerSvc,   broadcast).start();
new ServiceWatchdog('FollowedChannels', followedSvc,     broadcast).start();
new ServiceWatchdog('PointClaimer',     pointClaimerSvc, broadcast).start();
new ServiceWatchdog('CampaignDiscovery', campaignDiscoverySvc, broadcast).start();
new ServiceWatchdog('StreamAllocator',   streamAllocatorSvc,   broadcast).start();

// Expose to routes for /api/health
(global as any).services = {
  tokenRefreshSvc, dropIndexerSvc, chatFarmerSvc, followedSvc, pointClaimerSvc,
  campaignDiscoverySvc, streamAllocatorSvc,
};
(global as any).broadcast = broadcastProxy;

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`🎯 API:       http://localhost:${PORT}/api`);
  console.log(`🖥️  UI:        http://localhost:${PORT}`);
});

process.on('SIGINT',  () => { console.log('\n🛑 Shutting down…'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n🛑 SIGTERM…');       process.exit(0); });
process.on('uncaughtException',  (e) => console.error('[UNCAUGHT]', e));
process.on('unhandledRejection', (e) => console.error('[UNHANDLED]', e));

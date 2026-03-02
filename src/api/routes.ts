import express from 'express';
import db from '../core/db.js';
import { requestDeviceCode, pollForToken, refreshAccessToken, getUserInfo } from '../core/auth.js';
import { logInfo, logError } from '../core/logger.js';

const router = express.Router();

// ─── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', (_req, res) => {
  try {
    const rows: any[] = db.prepare('SELECT key, value FROM settings').all();
    const obj: Record<string, string> = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    res.json(obj);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/settings', (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Invalid settings' });

    const upsert = db.prepare(
      `INSERT INTO settings (key,value,updated_at) VALUES (@key,@value,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=@value, updated_at=datetime('now')`
    );
    db.transaction((s: Record<string, string>) => {
      for (const [key, value] of Object.entries(s)) upsert.run({ key, value: String(value) });
    })(settings);

    logInfo('Settings saved');
    const bc = (global as any).broadcast;
    if (typeof bc === 'function') bc({ type: 'settings_saved', settings });

    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/settings/meta', (_req, res) => {
  res.json([
    { key: 'twitchClientId', label: 'Twitch Client ID', category: 'Twitch Configuration', type: 'password',
      description: 'From dev.twitch.tv/console — Device Code Flow, no client secret needed' },
    { key: 'THEME_MODE',     label: 'Theme',            category: 'Appearance',            type: 'select',  options: ['dark','light','auto'] },
    { key: 'ACCENT_COLOR',   label: 'Accent Color',     category: 'Appearance',            type: 'color' },
    { key: 'NOTIFY_DROPS',   label: 'Drop Alerts',      category: 'Notifications',         type: 'toggle' },
    { key: 'NOTIFY_POINTS',  label: 'Points Alerts',    category: 'Notifications',         type: 'toggle' },
    { key: 'NOTIFY_ERRORS',  label: 'Error Alerts',     category: 'Notifications',         type: 'toggle' },
  ]);
});

// ─── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', (_req, res) => {
  try {
    res.json({
      totalAccounts:  (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as any).n,
      activeAccounts: (db.prepare(`SELECT COUNT(*) as n FROM accounts WHERE status='farming'`).get() as any).n,
      totalDrops:     (db.prepare('SELECT COUNT(*) as n FROM drops').get() as any).n,
      claimedDrops:   (db.prepare('SELECT COUNT(*) as n FROM drops WHERE claimed=1').get() as any).n,
      recentClaims:   (db.prepare(`SELECT COUNT(*) as n FROM point_claim_history WHERE datetime(claimed_at)>datetime('now','-24 hours')`).get() as any).n,
      activeStreams:  (db.prepare('SELECT COUNT(*) as n FROM active_streams').get() as any).n,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.json({ totalAccounts:0, activeAccounts:0, totalDrops:0, claimedDrops:0, recentClaims:0, activeStreams:0, timestamp: new Date().toISOString() });
  }
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

router.get('/accounts', (_req, res) => {
  try {
    res.json(db.prepare(
      'SELECT id,username,status,createdAt,lastActive,user_id,token_expires_at FROM accounts'
    ).all());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/accounts/:id/toggle', (req, res) => {
  try {
    const a: any = db.prepare('SELECT status FROM accounts WHERE id=?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const s = a.status === 'farming' ? 'idle' : 'farming';
    db.prepare(`UPDATE accounts SET status=?,lastActive=datetime('now') WHERE id=?`).run(s, req.params.id);
    res.json({ success: true, status: s });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/accounts/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

router.get('/campaigns', (_req, res) => {
  try {
    // Try with createdAt first, fallback to last_updated
    let campaigns;
    try {
      campaigns = db.prepare('SELECT * FROM campaigns ORDER BY createdAt DESC').all();
    } catch {
      campaigns = db.prepare('SELECT * FROM campaigns ORDER BY last_updated DESC').all();
    }
    res.json(campaigns);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Logs ─────────────────────────────────────────────────────────────────────

router.get('/logs', (req, res) => {
  try {
    const conds: string[] = [];
    const params: any[]   = [];
    if (req.query.level)      { conds.push('level=?');      params.push(req.query.level); }
    if (req.query.type)       { conds.push('type=?');        params.push(req.query.type); }
    if (req.query.streamer_id){ conds.push('streamer_id=?'); params.push(req.query.streamer_id); }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    res.json(db.prepare(`SELECT * FROM logs${where} ORDER BY time DESC LIMIT 200`).all(...params));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Betting ──────────────────────────────────────────────────────────────────

router.get('/betting/stats', (_req, res) => {
  try {
    const bettingSvc = (global as any).services?.bettingSvc;
    if (!bettingSvc) return res.json({ error: 'Betting service not available' });

    const stats = bettingSvc.getBettingStats();
    res.json(stats);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/betting/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 500);
    res.json(db.prepare('SELECT * FROM betting_history ORDER BY timestamp DESC LIMIT ?').all(limit));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/betting/streamers', (req, res) => {
  try {
    const bettingSvc = (global as any).services?.bettingSvc;
    if (!bettingSvc) return res.json({ error: 'Betting service not available' });

    const limit = Math.min(parseInt(String(req.query.limit || '10'), 10), 50);
    const streamers = bettingSvc.getTopStreamers(limit);
    res.json(streamers);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/betting/streamer/:streamer', (req, res) => {
  try {
    const bettingSvc = (global as any).services?.bettingSvc;
    if (!bettingSvc) return res.json({ error: 'Betting service not available' });

    const analysis = bettingSvc.getStreamerAnalysis(req.params.streamer);
    res.json(analysis);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/betting/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    const bettingSvc = (global as any).services?.bettingSvc;
    if (!bettingSvc) return res.status(404).json({ error: 'Betting service not available' });

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    bettingSvc.setEnabled(enabled);
    res.json({ success: true, enabled });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/betting/config', (req, res) => {
  try {
    const { maxBetPercentage, strategy } = req.body;
    const bettingSvc = (global as any).services?.bettingSvc;
    if (!bettingSvc) return res.status(404).json({ error: 'Betting service not available' });

    const config: any = {};
    if (typeof maxBetPercentage === 'number') {
      config.maxBetPercentage = maxBetPercentage;
    }
    if (typeof strategy === 'string' && ['conservative', 'moderate', 'aggressive'].includes(strategy)) {
      config.strategy = strategy;
    }

    bettingSvc.setConfig(config);
    res.json({ success: true, config });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Streamer analysis ────────────────────────────────────────────────────────

router.get('/streamer-analysis', (_req, res) => {
  try {
    res.json(db.prepare(`
      SELECT streamer_id as streamer, COUNT(*) as pointsClaimed,
        SUM(points_claimed) as totalPoints, MAX(claimed_at) as lastClaimed
      FROM point_claim_history
      WHERE datetime(claimed_at) > datetime('now','-7 days')
      GROUP BY streamer ORDER BY totalPoints DESC LIMIT 50
    `).all());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  const svcs   = (global as any).services || {};
  const mem    = process.memoryUsage();
  const upSecs = Math.floor(process.uptime());
  res.json({
    services: {
      dropIndexer:      { name: 'Drop Indexer',      status: svcs.dropIndexerSvc      ? 'online' : 'offline' },
      pointClaimer:     { name: 'Point Claimer',     status: svcs.pointClaimerSvc     ? 'online' : 'offline' },
      chatFarmer:       { name: 'Chat Farmer',       status: svcs.chatFarmerSvc       ? 'online' : 'offline' },
      followedChannels: { name: 'Followed Channels', status: svcs.followedSvc         ? 'online' : 'offline' },
      tokenRefresh:     { name: 'Token Refresh',     status: svcs.tokenRefreshSvc     ? 'online' : 'offline' },
    },
    system: {
      uptime:   `${Math.floor(upSecs / 3600)}h ${Math.floor((upSecs % 3600) / 60)}m`,
      memory: {
        used:       Math.round(mem.heapUsed  / 1024 / 1024),
        total:      Math.round(mem.heapTotal / 1024 / 1024),
        percentage: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      },
      database: { health: 'healthy' },
    },
    performance: {
      activeCampaigns: (db.prepare(`SELECT COUNT(*) as n FROM campaigns WHERE status='active'`).get() as any).n,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── Auth – Device Code Flow ───────────────────────────────────────────────────

function getClientId(body?: any): string {
  return body?.clientId
    || (db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get() as any)?.value
    || process.env.TWITCH_CLIENT_ID
    || '';
}

router.post('/auth/device', async (req, res) => {
  try {
    const clientId = getClientId(req.body);
    if (!clientId) {
      return res.status(400).json({
        error: 'Twitch Client ID is required.',
        message: 'Please get a Client ID from https://dev.twitch.tv/console and add it in Settings',
        setupUrl: 'https://dev.twitch.tv/console'
      });
    }
    const resp = await requestDeviceCode(clientId);
    res.json(resp);
  } catch (e: any) {
    logError(`Device code: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

router.post('/auth/device/poll', async (req, res) => {
  try {
    const { deviceCode, interval } = req.body;
    const clientId = getClientId(req.body);
    if (!clientId || !deviceCode) return res.status(400).json({ error: 'clientId and deviceCode required' });

    const tokenResponse = await pollForToken(clientId, deviceCode, interval || 5);

    // DEBUG: Log token response details
    logInfo(`[Auth] Token response received - access_token length: ${tokenResponse.access_token?.length || 0}, refresh_token length: ${tokenResponse.refresh_token?.length || 0}`);

    // Validate token before proceeding
    if (!tokenResponse.access_token || tokenResponse.access_token.length < 30) {
      logError(`[Auth] Invalid access token received: length=${tokenResponse.access_token?.length || 0}`);
      return res.status(500).json({ error: 'Invalid access token received from Twitch' });
    }

    const userInfo      = await getUserInfo(tokenResponse.access_token, clientId);
    const expiresAt     = Math.floor(Date.now() / 1000) + tokenResponse.expires_in;

    // FIX: account was never saved – this is the fix from session 1
    const existing: any = db.prepare('SELECT id FROM accounts WHERE user_id=?').get(userInfo.id);
    if (existing) {
      db.prepare(`UPDATE accounts SET accessToken=?,refreshToken=?,token_expires_at=?,
        lastActive=datetime('now'),status=CASE WHEN status='error' THEN 'idle' ELSE status END WHERE user_id=?`)
        .run(tokenResponse.access_token, tokenResponse.refresh_token, expiresAt, userInfo.id);
      logInfo(`Account re-authenticated: ${userInfo.login}`);
    } else {
      db.prepare(`INSERT INTO accounts (username,accessToken,refreshToken,user_id,token_expires_at,status,createdAt,lastActive)
        VALUES (?,?,?,?,?,'idle',datetime('now'),datetime('now'))`)
        .run(userInfo.login, tokenResponse.access_token, tokenResponse.refresh_token, userInfo.id, expiresAt);
      logInfo(`New account: ${userInfo.login}`);
    }

    res.json({ success: true, user: userInfo, expires_in: tokenResponse.expires_in });
  } catch (e: any) {
    if (e.message?.includes('authorization_pending')) return res.status(202).json({ pending: true });

    // Provide helpful error messages
    if (e.message?.includes('getUserInfo failed')) {
      logError(`Auth error: ${e.message}`);
      return res.status(500).json({
        error: 'Failed to get user info from Twitch',
        message: 'The Client-ID may not be authorized for this application. Please create your own app at https://dev.twitch.tv/console',
        details: e.message
      });
    }

    logError(`Poll: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

router.get('/auth/status', (_req, res) => {
  const clientId = getClientId();
  res.json({ configured: !!clientId });
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken, clientId: bodyClientId } = req.body;
    const clientId = bodyClientId || getClientId();
    if (!refreshToken || !clientId) return res.status(400).json({ error: 'refreshToken and clientId required' });
    const t = await refreshAccessToken(refreshToken, clientId);
    res.json({ success: true, expires_in: t.expires_in });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Factory reset ────────────────────────────────────────────────────────────

router.post('/factory-reset', (req, res) => {
  try {
    db.prepare('DELETE FROM settings').run();
    db.prepare('DELETE FROM accounts').run();
    db.prepare('DELETE FROM drops').run();
    db.prepare('DELETE FROM campaigns').run();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export { router as apiRouter };

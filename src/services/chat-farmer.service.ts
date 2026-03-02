import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';

type Broadcaster = (d: object) => void;

class ChatFarmerService {
  private pollId: NodeJS.Timeout | null = null;
  private connections = new Map<number, any>();
  constructor(private broadcast: Broadcaster = () => {}) {}

  start() {
    logInfo('[ChatFarmer] Starting');
    this.syncConnections();
    this.pollId = setInterval(() => this.syncConnections(), 5 * 60 * 1000);
  }

  stop() {
    if (this.pollId) { clearInterval(this.pollId); this.pollId = null; }
    for (const c of this.connections.values()) { try { c.disconnect?.(); } catch {} }
    this.connections.clear();
  }

  private syncConnections() {
    const accounts: any[] = db.prepare(`SELECT id,username,accessToken,user_id FROM accounts WHERE status!='error'`).all();
    const live = new Set(accounts.map((a: any) => a.id));
    for (const [id] of this.connections) {
      if (!live.has(id)) { this.connections.get(id)?.disconnect?.(); this.connections.delete(id); }
    }
    for (const a of accounts) {
      if (!this.connections.has(a.id)) this.connectAccount(a);
    }
  }

  private connectAccount(account: any) {
    const channels: any[] = db.prepare(
      `SELECT streamer_id FROM followed_channels WHERE account_id=? AND streamer_id IS NOT NULL`
    ).all(account.id);
    if (!channels.length) { logDebug(`[ChatFarmer] No followed channels for ${account.username}`); return; }

    const topics = channels.map((c: any) => `community-points-channel-v1.${c.streamer_id}`);
    const WS: any = (globalThis as any).WebSocket;
    if (!WS) { logWarn('[ChatFarmer] WebSocket not available in this environment'); return; }

    let ws: any = null;
    let pingId: NodeJS.Timeout | null = null;
    let alive = true;

    const connect = () => {
      ws = new WS('wss://pubsub-edge.twitch.tv');
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'LISTEN', nonce: Math.random().toString(36).slice(2),
          data: { topics, auth_token: account.accessToken } }));
        pingId = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'PING' })), 4 * 60 * 1000);
        logInfo(`[ChatFarmer] Listening on ${topics.length} topic(s) for ${account.username}`);
      };
      ws.onmessage = (e: any) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'MESSAGE') {
            const inner = JSON.parse(msg.data.message);
            if (inner.type === 'claim-available') this.claimBonus(account, inner.data?.claim).catch(() => {});
          }
        } catch {}
      };
      ws.onclose = () => {
        if (pingId) { clearInterval(pingId); pingId = null; }
        if (alive) setTimeout(connect, 5000);
      };
    };

    connect();
    this.connections.set(account.id, { disconnect: () => { alive = false; ws?.close(); if (pingId) clearInterval(pingId); } });
  }

  private async claimBonus(account: any, claim: any) {
    if (!claim?.id || !claim?.channel_id) return;
    const clientId = this.clientId();
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${account.accessToken}`,
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        operationName: 'ClaimCommunityPoints',
        variables: { input: { claimID: claim.id, channelID: claim.channel_id } },
        extensions: { persistedQuery: { version: 1, sha256Hash: 'ad4de94e9975f3a93d5e07ee5e20acee' } },
      }]),
    });
    const data = await res.json();
    const pts = data?.[0]?.data?.claimCommunityPoints?.currentPoints ?? 0;
    db.prepare(`INSERT INTO point_claim_history (account_id,streamer,points_claimed,bonus_type) VALUES (?,?,?,'CLAIM')`)
      .run(account.id, claim.channel_id, pts);
    logInfo(`[ChatFarmer] 💰 ${account.username} claimed ${pts} pts`);
    this.broadcast({ type: 'POINTS_CLAIMED', amount: pts, accountId: account.id, username: account.username });
  }

  private clientId(): string {
    const r: any = db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get();
    return r?.value || process.env.TWITCH_CLIENT_ID || '';
  }
}

export default ChatFarmerService;

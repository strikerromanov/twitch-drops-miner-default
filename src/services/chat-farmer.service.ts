import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';
import WebSocket from 'ws';

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
    // Get channels from both followed_channels and active_streams
    const followedChannels: any[] = db.prepare(
      `SELECT streamer_id FROM followed_channels WHERE account_id=? AND streamer_id IS NOT NULL`
    ).all(account.id);

    // Also get active farming streams - now includes streamer_id
    const activeStreams: any[] = db.prepare(
      `SELECT streamer_id FROM active_streams WHERE account_id=? AND streamer_id IS NOT NULL`
    ).all(account.id);

    // Merge both sources, deduplicating by streamer_id
    const channelsMap = new Map<string, string>();
    for (const c of followedChannels) {
      if (c.streamer_id) channelsMap.set(c.streamer_id, c.streamer_id);
    }
    for (const s of activeStreams) {
      if (s.streamer_id) channelsMap.set(s.streamer_id, s.streamer_id);
    }

    const topics = Array.from(channelsMap.keys()).map(id => `community-points-channel-v1.${id}`);
    if (!topics.length) {
      logDebug(`[ChatFarmer] No channels for ${account.username} - will retry on next cycle`);
      return;
    }

    let ws: any = null;
    let pingId: NodeJS.Timeout | null = null;
    let alive = true;

    const connect = () => {
      ws = new WebSocket('wss://pubsub-edge.twitch.tv');
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

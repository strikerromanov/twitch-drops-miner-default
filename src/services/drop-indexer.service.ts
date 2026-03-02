import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';
import { withRetry } from './token-refresh.service.js';

type Broadcaster = (d: object) => void;
const SYNC_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;

class DropIndexerService {
  private syncId: NodeJS.Timeout | null = null;
  private tickId: NodeJS.Timeout | null = null;
  constructor(private broadcast: Broadcaster = () => {}) {}

  start() {
    logInfo('[DropIndexer] Starting');
    this.syncCampaigns();
    this.syncId = setInterval(() => this.syncCampaigns(), SYNC_MS);
    this.tickId = setInterval(() => this.tickProgress(), TICK_MS);
  }

  stop() {
    if (this.syncId) { clearInterval(this.syncId); this.syncId = null; }
    if (this.tickId) { clearInterval(this.tickId); this.tickId = null; }
  }

  async syncCampaigns() {
    const accounts: any[] = db.prepare(`SELECT id,username,accessToken,user_id FROM accounts WHERE status!='error'`).all();
    if (!accounts.length) return;
    const clientId = this.clientId();
    if (!clientId) { logWarn('[DropIndexer] No client ID'); return; }
    for (const a of accounts) {
      try {
        const data: any = await withRetry(
          () => this.fetchEntitlements(a.accessToken, clientId),
          { retries: 3, baseDelayMs: 2000, label: `drops:${a.username}` }
        );
        if (data?.data) {
          for (const item of data.data) this.upsertDrop(item, a.id);
          logInfo(`[DropIndexer] Synced ${data.data.length} entitlement(s) for ${a.username}`);
        }
        break;
      } catch (e: any) { logError(`[DropIndexer] ${a.username}: ${e.message}`); }
    }
  }

  private async fetchEntitlements(token: string, clientId: string) {
    const res = await fetch('https://api.twitch.tv/helix/entitlements/drops?fulfillment_status=UNFULFILLED', {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': clientId },
    });
    if (res.status === 401) throw new Error('Unauthorized');
    if (res.status === 429) throw new Error('Rate limited');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  private upsertDrop(item: any, accountId: number) {
    const cid = item.benefit_id || item.id;
    db.prepare(`INSERT INTO campaigns (id,name,game,status,last_updated) VALUES (?,?,?,'active',datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,game=excluded.game,last_updated=excluded.last_updated`)
      .run(cid, item.benefit?.name || 'Unknown Drop', item.game?.name || null);
    db.prepare(`INSERT INTO drops (account_id,campaign_id,claimed,current_minutes) VALUES (?,?,0,0) ON CONFLICT DO NOTHING`)
      .run(accountId, cid);
  }

  async tickProgress() {
    const streams: any[] = db.prepare(`SELECT DISTINCT account_id FROM active_streams`).all();
    if (!streams.length) return;
    const ids = streams.map((r: any) => r.account_id);
    const ph  = ids.map(() => '?').join(',');
    db.prepare(`UPDATE drops SET current_minutes=current_minutes+1,last_updated=datetime('now')
      WHERE account_id IN (${ph}) AND claimed=0`).run(...ids);
    db.prepare(`UPDATE campaigns SET current_minutes=(SELECT MAX(d.current_minutes) FROM drops d WHERE d.campaign_id=campaigns.id)
      WHERE id IN (SELECT DISTINCT campaign_id FROM drops WHERE account_id IN (${ph}))`).run(...ids);
    const done: any[] = db.prepare(`SELECT d.id,d.account_id,d.campaign_id,c.name,a.username
      FROM drops d JOIN campaigns c ON c.id=d.campaign_id JOIN accounts a ON a.id=d.account_id
      WHERE d.claimed=0 AND c.required_minutes>0 AND d.current_minutes>=c.required_minutes`).all();
    for (const drop of done) {
      db.prepare(`UPDATE drops SET claimed=1,last_updated=datetime('now') WHERE id=?`).run(drop.id);
      db.prepare(`UPDATE campaigns SET status='claimed' WHERE id=?`).run(drop.campaign_id);
      logInfo(`[DropIndexer] ✅ Drop complete: ${drop.name} for ${drop.username}`);
      this.broadcast({ type: 'DROP_CLAIMED', dropName: drop.name, accountId: drop.account_id, username: drop.username });
    }
  }

  private clientId(): string {
    const r: any = db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get();
    return r?.value || process.env.TWITCH_CLIENT_ID || '';
  }
}

export default DropIndexerService;

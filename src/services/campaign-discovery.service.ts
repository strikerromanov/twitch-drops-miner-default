import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';
import { withRetry } from './token-refresh.service.js';

type Broadcaster = (d: object) => void;
const SYNC_MS = 10 * 60 * 1000; // Sync every 10 minutes

class CampaignDiscoveryService {
  private syncId: NodeJS.Timeout | null = null;
  constructor(private broadcast: Broadcaster = () => {}) {}

  start() {
    logInfo('[CampaignDiscovery] Starting');
    this.syncCampaigns();
    this.syncId = setInterval(() => this.syncCampaigns(), SYNC_MS);
  }

  stop() {
    if (this.syncId) { clearInterval(this.syncId); this.syncId = null; }
  }

  async syncCampaigns() {
    const accounts: any[] = db.prepare(`SELECT id,username,accessToken FROM accounts WHERE status!='error'`).all();

    if (!accounts.length) {
      logWarn('[CampaignDiscovery] No active accounts - skipping campaign discovery');
      return;
    }

    const clientId = this.getClientId();
    if (!clientId) {
      logWarn('[CampaignDiscovery] No client ID - skipping campaign discovery');
      return;
    }

    // Try each account until we get a successful response
    for (const account of accounts) {
      try {
        const campaigns = await withRetry(
          () => this.fetchCampaignsHelix(account.accessToken, clientId),
          { retries: 3, baseDelayMs: 2000, label: `campaigns:${account.username}` }
        );

        if (campaigns && campaigns.length > 0) {
          logInfo(`[CampaignDiscovery] Found ${campaigns.length} campaign(s) for ${account.username}`);

          let discovered = 0;
          for (const campaign of campaigns) {
            if (this.processCampaign(campaign)) {
              discovered++;
            }
          }

          logInfo(`[CampaignDiscovery] Discovered/updated ${discovered} active campaign(s)`);
          this.broadcast({
            type: 'campaigns_discovered',
            count: discovered,
            accountUsername: account.username
          });
          break; // Success - no need to try other accounts
        }
      } catch (e: any) {
        logError(`[CampaignDiscovery] Failed for ${account.username}: ${e.message}`);
        // Continue to next account
      }
    }
  }

  // Use Helix API instead of GraphQL - more reliable
  private async fetchCampaignsHelix(token: string, clientId: string): Promise<any[]> {
    try {
      // First try to get the inventory through the drops API
      const response = await fetch('https://api.twitch.tv/helix/inventory/drops', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Client-Id': clientId,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        logError(`[CampaignDiscovery] Helix API error: ${response.status} ${text}`);
        throw new Error(`Helix API ${response.status}: ${text}`);
      }

      const data = await response.json();

      // The response structure might vary, log it for debugging
      logDebug(`[CampaignDiscovery] Helix response: ${JSON.stringify(data).substring(0, 500)}`);

      // Parse the response based on actual structure
      if (data.data && Array.isArray(data.data)) {
        return data.data;
      } else if (data.drop_campaigns && Array.isArray(data.drop_campaigns)) {
        return data.drop_campaigns;
      } else if (data.campaigns && Array.isArray(data.campaigns)) {
        return data.campaigns;
      }

      // If we can't find campaigns in the response, return empty array
      logWarn('[CampaignDiscovery] Unexpected Helix API response structure');
      return [];
    } catch (e: any) {
      logError(`[CampaignDiscovery] Helix API fetch error: ${e.message}`);
      throw e;
    }
  }

  private processCampaign(campaign: any): boolean {
    try {
      // Handle various possible response structures
      const campaignId = campaign.id || campaign.campaign_id;
      const name = campaign.name || campaign.title || 'Unknown Campaign';
      const game = campaign.game?.name || campaign.game?.displayName || campaign.game_name || null;
      const imageUrl = campaign.image_url || campaign.imageURL || campaign.image || null;
      const status = campaign.status || 'ACTIVE';
      const requiredMinutes = campaign.required_minutes_watch || campaign.requiredMinutes || 0;

      if (!campaignId) {
        logWarn('[CampaignDiscovery] Skipping campaign without ID');
        return false;
      }

      // Upsert campaign into database
      db.prepare(`
        INSERT INTO campaigns (id, name, game, required_minutes, status, image_url, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          game = excluded.game,
          required_minutes = excluded.required_minutes,
          status = excluded.status,
          image_url = excluded.image_url,
          last_updated = excluded.last_updated
      `).run(campaignId, name, game, requiredMinutes, status, imageUrl);

      logInfo(`[CampaignDiscovery] ✅ Campaign: ${name} (${game}) - ${requiredMinutes}min`);
      return true;
    } catch (e: any) {
      logError(`[CampaignDiscovery] Error processing campaign: ${e.message}`);
      return false;
    }
  }

  private getClientId(): string {
    const row: any = db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get();
    return row?.value || process.env.TWITCH_CLIENT_ID || '';
  }
}

export default CampaignDiscoveryService;

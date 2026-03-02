import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';
import { withRetry } from './token-refresh.service.js';
const SYNC_MS = 10 * 60 * 1000; // Sync every 10 minutes
class CampaignDiscoveryService {
    broadcast;
    syncId = null;
    constructor(broadcast = () => { }) {
        this.broadcast = broadcast;
    }
    start() {
        logInfo('[CampaignDiscovery] DEBUG: Current time: ' + new Date().toISOString());
        logInfo('[CampaignDiscovery] DEBUG: DB path: ' + (process.env.DATABASE_PATH || 'default (database.db in working directory)'));
        logInfo('[CampaignDiscovery] Starting');
        this.syncCampaigns();
        this.syncId = setInterval(() => this.syncCampaigns(), SYNC_MS);
    }
    stop() {
        if (this.syncId) {
            clearInterval(this.syncId);
            this.syncId = null;
        }
    }
    async syncCampaigns() {
        logInfo('[CampaignDiscovery] DEBUG: syncCampaigns() called');
        logInfo('[CampaignDiscovery] DEBUG: Current time: ' + new Date().toISOString());
        logInfo('[CampaignDiscovery] DEBUG: Querying accounts table...');
        logInfo('[CampaignDiscovery] DEBUG: DB path: ' + (process.env.DATABASE_PATH || 'default (database.db in working directory)'));
        const accounts = db.prepare(`SELECT id,username,accessToken FROM accounts WHERE status!='error'`).all();
        logInfo(`[CampaignDiscovery] DEBUG: Found ${accounts.length} accounts`);
        if (accounts.length > 0) {
            logInfo(`[CampaignDiscovery] DEBUG: Accounts: ${JSON.stringify(accounts.map(a => ({ id: a.id, username: a.username, status: a.status })))}`);
        }
        else {
            logWarn('[CampaignDiscovery] DEBUG: No accounts returned from query');
        }
        if (!accounts.length) {
            logWarn('[CampaignDiscovery] No active accounts - skipping campaign discovery');
            return;
        }
        logInfo('[CampaignDiscovery] DEBUG: Getting client ID from settings table...');
        const clientId = this.getClientId();
        logInfo(`[CampaignDiscovery] DEBUG: Client ID: ${clientId ? 'Found' : 'NOT FOUND'}`);
        if (!clientId) {
            logWarn('[CampaignDiscovery] No client ID - skipping campaign discovery');
            return;
        }
        // Try each account until we get a successful response
        for (const account of accounts) {
            try {
                logDebug(`[CampaignDiscovery] DEBUG: Attempting account ${account.id} (${account.username})`);
                const data = await withRetry(() => this.fetchCampaigns(account.accessToken, clientId), { retries: 3, baseDelayMs: 2000, label: `campaigns:${account.username}` });
                if (data?.data?.currentUser?.inventory?.campaigns) {
                    const campaigns = data.data.currentUser.inventory.campaigns;
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
                else {
                    logWarn('[CampaignDiscovery] No campaigns data in response');
                }
            }
            catch (e) {
                logError(`[CampaignDiscovery] Failed for ${account.username}: ${e.message}`);
                // Continue to next account
            }
        }
    }
    async fetchCampaigns(token, clientId) {
        const query = {
            operationName: 'InventoryViewCampaigns',
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: 'c6a332a9695a4615c524b4bb1e61b02e5d0d65229477504a18fb63fb0c347b05'
                }
            },
            variables: {}
        };
        const requestBody = JSON.stringify(query);
        const requestUrl = 'https://gql.twitch.tv/gql';
        // === EXTREME LOGGING: BEFORE REQUEST ===
        logInfo(`[CampaignDiscovery] ═════════════════════════════════════════`);
        logInfo(`[CampaignDiscovery] GraphQL Request Initiated`);
        logInfo(`[CampaignDiscovery] Request URL: ${requestUrl}`);
        logInfo(`[CampaignDiscovery] Request Method: POST`);
        logInfo(`[CampaignDiscovery] Authorization: Bearer ${token.substring(0, 20)}...${token.substring(Math.max(0, token.length - 5))}`);
        logInfo(`[CampaignDiscovery] Client-ID: ${clientId}`);
        logInfo(`[CampaignDiscovery] Request Body: ${requestBody}`);
        logInfo(`[CampaignDiscovery] Headers: ${JSON.stringify({
            'Authorization': `Bearer ${token.substring(0, 20)}...`,
            'Client-Id': clientId,
            'Content-Type': 'application/json'
        }, null, 2)}`);
        logInfo(`[CampaignDiscovery] ═════════════════════════════════════════`);
        let response;
        try {
            response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': clientId,
                    'Content-Type': 'application/json'
                },
                body: requestBody
            });
        }
        catch (error) {
            logError(`[CampaignDiscovery] ═════════════════════════════════════════`);
            logError(`[CampaignDiscovery] FETCH EXCEPTION`);
            logError(`[CampaignDiscovery] Exception Message: ${error.message}`);
            logError(`[CampaignDiscovery] Exception Stack: ${error.stack}`);
            logError(`[CampaignDiscovery] ═════════════════════════════════════════`);
            throw error;
        }
        // === EXTREME LOGGING: AFTER RESPONSE ===
        const responseStatus = response.status;
        const responseStatusText = response.statusText;
        const responseHeaders = Object.fromEntries(response.headers.entries());
        logInfo(`[CampaignDiscovery] ═════════════════════════════════════════`);
        logInfo(`[CampaignDiscovery] GraphQL Response Received`);
        logInfo(`[CampaignDiscovery] Response Status: ${responseStatus} ${responseStatusText}`);
        logInfo(`[CampaignDiscovery] Response Headers: ${JSON.stringify(responseHeaders, null, 2)}`);
        const responseBody = await response.text();
        logInfo(`[CampaignDiscovery] Response Body: ${responseBody}`);
        logInfo(`[CampaignDiscovery] Response Body Length: ${responseBody.length} characters`);
        if (responseStatus === 401) {
            logError(`[CampaignDiscovery] ❌ HTTP 401 Unauthorized - Token may be expired`);
            logError(`[CampaignDiscovery] Body: ${responseBody}`);
            throw new Error('Unauthorized - token may be expired');
        }
        if (responseStatus === 429) {
            logError(`[CampaignDiscovery] ❌ HTTP 429 Rate Limited`);
            logError(`[CampaignDiscovery] Body: ${responseBody}`);
            throw new Error('Rate limited');
        }
        if (!response.ok) {
            logError(`[CampaignDiscovery] ❌ HTTP ${responseStatus} Error`);
            logError(`[CampaignDiscovery] Body: ${responseBody}`);
            throw new Error(`HTTP ${responseStatus}: ${responseStatusText}`);
        }
        logInfo(`[CampaignDiscovery] ✅ Response OK (200)`);
        logInfo(`[CampaignDiscovery] ═════════════════════════════════════════`);
        let result;
        try {
            result = JSON.parse(responseBody);
        }
        catch (parseError) {
            logError(`[CampaignDiscovery] ❌ JSON Parse Error: ${parseError.message}`);
            logError(`[CampaignDiscovery] Response Body was: ${responseBody}`);
            throw new Error(`Failed to parse JSON response: ${parseError.message}`);
        }
        if (result.errors) {
            const errorMsg = result.errors.map((e) => e.message).join(', ');
            logError(`[CampaignDiscovery] ❌ GraphQL Errors: ${errorMsg}`);
            logError(`[CampaignDiscovery] Full Errors: ${JSON.stringify(result.errors, null, 2)}`);
            throw new Error(`GraphQL error: ${errorMsg}`);
        }
        return result;
    }
    processCampaign(campaign) {
        try {
            // Extract campaign data
            const campaignId = campaign.id;
            const name = campaign.name || 'Unknown Campaign';
            const game = campaign.game?.displayName || null;
            const requiredMinutes = campaign.requiredMinutesWatched || 0;
            const imageUrl = campaign.imageURL || null;
            const status = 'active'; // All discovered campaigns are considered active
            // Check if campaign is still active (not expired)
            const endTime = campaign.endsAt ? new Date(campaign.endsAt) : null;
            const startTime = campaign.startsAt ? new Date(campaign.startsAt) : null;
            const now = new Date();
            if (endTime && endTime < now) {
                logDebug(`[CampaignDiscovery] Skipping expired campaign: ${name}`);
                return false;
            }
            if (startTime && startTime > now) {
                logDebug(`[CampaignDiscovery] Skipping future campaign: ${name}`);
                return false;
            }
            // Log allowed channels if present
            if (campaign.channels && Array.isArray(campaign.channels)) {
                const channelCount = campaign.channels.length;
                logDebug(`[CampaignDiscovery] Campaign '${name}' allows ${channelCount} channel(s)`);
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
            logInfo(`[CampaignDiscovery] ✅ Campaign discovered: ${name} (${game}) - ${requiredMinutes}min required`);
            return true;
        }
        catch (e) {
            logError(`[CampaignDiscovery] Error processing campaign: ${e.message}`);
            return false;
        }
    }
    getClientId() {
        logInfo('[CampaignDiscovery] DEBUG: Querying settings table for twitchClientId...');
        const row = db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get();
        logInfo(`[CampaignDiscovery] DEBUG: Settings query result: ${row ? 'Found' : 'NOT FOUND'}`);
        return row?.value || process.env.TWITCH_CLIENT_ID || '';
    }
}
export default CampaignDiscoveryService;

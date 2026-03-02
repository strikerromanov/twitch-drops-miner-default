import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';
import { withRetry } from './token-refresh.service.js';
const ALLOCATE_MS = 5 * 60 * 1000; // Run every 5 minutes
const MAX_VIEWERS = 500; // Prefer streams with fewer viewers for easier drops
class StreamAllocatorService {
    broadcast;
    allocateId = null;
    gameCache = new Map(); // game_name -> game_id
    cacheExpiry = 0;
    constructor(broadcast = () => { }) {
        this.broadcast = broadcast;
    }
    start() {
        logInfo('[StreamAllocator] DEBUG: Current time: ' + new Date().toISOString());
        logInfo('[StreamAllocator] DEBUG: DB path: ' + (process.env.DATABASE_PATH || 'default (database.db in working directory)'));
        logInfo('[StreamAllocator] Starting');
        this.allocateStreams();
        this.allocateId = setInterval(() => this.allocateStreams(), ALLOCATE_MS);
    }
    stop() {
        if (this.allocateId) {
            clearInterval(this.allocateId);
            this.allocateId = null;
        }
    }
    async allocateStreams() {
        try {
            logInfo('[StreamAllocator] DEBUG: allocateStreams() called');
            logInfo('[StreamAllocator] DEBUG: Current time: ' + new Date().toISOString());
            logDebug('[StreamAllocator] Starting stream allocation cycle');
            // Get active accounts
            logInfo('[StreamAllocator] DEBUG: Querying accounts table...');
            logInfo('[StreamAllocator] DEBUG: DB path: ' + (process.env.DATABASE_PATH || 'default (database.db in working directory)'));
            const accounts = db.prepare(`SELECT id,username FROM accounts WHERE status!='error'`).all();
            logInfo(`[StreamAllocator] DEBUG: Found ${accounts.length} accounts`);
            if (accounts.length > 0) {
                logInfo(`[StreamAllocator] DEBUG: Accounts: ${JSON.stringify(accounts.map(a => ({ id: a.id, username: a.username })))}`);
            }
            else {
                logWarn('[StreamAllocator] DEBUG: No accounts returned from query');
            }
            if (!accounts.length) {
                logWarn('[StreamAllocator] No active accounts - skipping allocation');
                return;
            }
            // Get active campaigns with their games
            logInfo('[StreamAllocator] DEBUG: Querying campaigns table...');
            const campaigns = db.prepare(`
        SELECT DISTINCT id, name, game
        FROM campaigns
        WHERE status='active' AND game IS NOT NULL
      `).all();
            logInfo(`[StreamAllocator] DEBUG: Found ${campaigns.length} campaigns`);
            if (campaigns.length > 0) {
                logInfo(`[StreamAllocator] DEBUG: Campaigns: ${JSON.stringify(campaigns.map(c => ({ id: c.id, name: c.name, game: c.game })))}`);
            }
            else {
                logWarn('[StreamAllocator] DEBUG: No campaigns returned from query');
            }
            if (!campaigns.length) {
                logWarn('[StreamAllocator] No active campaigns - skipping allocation');
                return;
            }
            logInfo(`[StreamAllocator] Allocating ${accounts.length} account(s) across ${campaigns.length} campaign(s)`);
            // Clean up stale stream assignments (streams that ended)
            this.cleanupStaleStreams();
            // Get accounts that are already assigned to streams
            logInfo('[StreamAllocator] DEBUG: Querying active_streams table...');
            const assignedRows = db.prepare(`SELECT DISTINCT account_id FROM active_streams`).all();
            logInfo(`[StreamAllocator] DEBUG: Found ${assignedRows.length} assigned accounts`);
            const assignedAccountIds = new Set(assignedRows.map((r) => r.account_id));
            // Find unassigned accounts
            const unassignedAccounts = accounts.filter(a => !assignedAccountIds.has(a.id));
            logInfo(`[StreamAllocator] DEBUG: Unassigned accounts: ${unassignedAccounts.length}`);
            if (unassignedAccounts.length === 0) {
                logDebug('[StreamAllocator] All accounts already assigned to streams');
                return;
            }
            logDebug(`[StreamAllocator] Found ${unassignedAccounts.length} unassigned account(s)`);
            // Allocate each unassigned account to a suitable stream
            let allocatedCount = 0;
            for (const account of unassignedAccounts) {
                const stream = await this.findSuitableStream(campaigns);
                if (stream) {
                    this.assignStreamToAccount(account.id, stream);
                    allocatedCount++;
                    // Small delay to avoid overwhelming the API
                    await this.sleep(500);
                }
                else {
                    logWarn(`[StreamAllocator] No suitable stream found for account ${account.username}`);
                }
            }
            if (allocatedCount > 0) {
                logInfo(`[StreamAllocator] Allocated ${allocatedCount} account(s) to streams`);
                this.broadcast({
                    type: 'streams_allocated',
                    count: allocatedCount,
                    totalAccounts: accounts.length
                });
            }
        }
        catch (e) {
            logError(`[StreamAllocator] Allocation cycle failed: ${e.message}`);
        }
    }
    async findSuitableStream(campaigns) {
        for (const campaign of campaigns) {
            try {
                const gameName = campaign.game;
                logInfo(`[StreamAllocator] DEBUG: Finding suitable stream for game: ${gameName}`);
                const gameId = await this.getGameId(gameName);
                if (!gameId) {
                    logDebug(`[StreamAllocator] No game ID found for game: ${gameName}`);
                    continue;
                }
                const streams = await this.fetchStreamsForGame(gameId);
                if (!streams || streams.length === 0) {
                    logDebug(`[StreamAllocator] No live streams for game: ${gameName}`);
                    continue;
                }
                // Filter streams by viewer count (prefer lower viewer counts)
                const suitableStreams = streams.filter(s => s.viewer_count < MAX_VIEWERS && s.is_live);
                if (suitableStreams.length === 0) {
                    logDebug(`[StreamAllocator] No suitable streams (low viewer count) for game: ${gameName}`);
                    continue;
                }
                // Sort by viewer count (ascending) to get least crowded streams
                suitableStreams.sort((a, b) => a.viewer_count - b.viewer_count);
                // Prefer streams not already heavily used by our accounts
                const selected = this.selectLeastUsedStream(suitableStreams);
                if (selected) {
                    logDebug(`[StreamAllocator] Selected stream: ${selected.user_name} (${selected.viewer_count} viewers) for campaign: ${campaign.name}`);
                    return selected;
                }
            }
            catch (e) {
                logError(`[StreamAllocator] Error finding stream for campaign ${campaign.name}: ${e.message}`);
                // Continue to next campaign
            }
        }
        return null;
    }
    async getGameId(gameName) {
        // Check cache first
        if (this.gameCache.has(gameName) && Date.now() < this.cacheExpiry) {
            logInfo(`[StreamAllocator] DEBUG: Using cached game ID for ${gameName}`);
            return this.gameCache.get(gameName) || null;
        }
        logInfo(`[StreamAllocator] DEBUG: Fetching game ID from Twitch API for: ${gameName}`);
        // Refresh game ID from Twitch API
        const clientId = this.getClientId();
        if (!clientId) {
            logWarn('[StreamAllocator] No client ID for game lookup');
            return null;
        }
        try {
            logInfo('[StreamAllocator] DEBUG: Querying accounts for token (getGameId)...');
            const accounts = db.prepare(`SELECT accessToken FROM accounts WHERE status!='error' LIMIT 1`).all();
            logInfo(`[StreamAllocator] DEBUG: Found ${accounts.length} accounts for game ID lookup`);
            if (!accounts.length)
                return null;
            const token = accounts[0].accessToken;
            const response = await withRetry(() => this.fetchGameId(token, clientId, gameName), { retries: 2, baseDelayMs: 1000, label: 'game_id_lookup' });
            if (response?.data?.length > 0) {
                const gameId = response.data[0].id;
                // Cache for 1 hour
                this.gameCache.set(gameName, gameId);
                this.cacheExpiry = Date.now() + (60 * 60 * 1000);
                logInfo(`[StreamAllocator] DEBUG: Cached game ID ${gameId} for ${gameName}`);
                return gameId;
            }
            return null;
        }
        catch (e) {
            logError(`[StreamAllocator] Failed to get game ID for ${gameName}: ${e.message}`);
            return null;
        }
    }
    async fetchGameId(token, clientId, gameName) {
        const params = new URLSearchParams({ name: gameName });
        const response = await fetch(`https://api.twitch.tv/helix/games?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': clientId
            }
        });
        if (response.status === 401)
            throw new Error('Unauthorized');
        if (response.status === 429)
            throw new Error('Rate limited');
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
    async fetchStreamsForGame(gameId) {
        const clientId = this.getClientId();
        if (!clientId)
            return [];
        logInfo('[StreamAllocator] DEBUG: Querying accounts for token (fetchStreamsForGame)...');
        const accounts = db.prepare(`SELECT accessToken FROM accounts WHERE status!='error' LIMIT 1`).all();
        logInfo(`[StreamAllocator] DEBUG: Found ${accounts.length} accounts for streams fetch`);
        if (!accounts.length)
            return [];
        const token = accounts[0].accessToken;
        try {
            const response = await withRetry(() => this.fetchStreams(token, clientId, gameId), { retries: 2, baseDelayMs: 1000, label: 'streams_fetch' });
            const streams = response?.data || [];
            logInfo(`[StreamAllocator] DEBUG: Fetched ${streams.length} streams for game ${gameId}`);
            return streams;
        }
        catch (e) {
            logError(`[StreamAllocator] Failed to fetch streams for game ${gameId}: ${e.message}`);
            return [];
        }
    }
    async fetchStreams(token, clientId, gameId) {
        const params = new URLSearchParams({
            game_id: gameId,
            first: '100'
        });
        const response = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': clientId
            }
        });
        if (response.status === 401)
            throw new Error('Unauthorized');
        if (response.status === 429)
            throw new Error('Rate limited');
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
    selectLeastUsedStream(streams) {
        // Count how many accounts are already watching each stream
        const streamUsage = new Map();
        logInfo('[StreamAllocator] DEBUG: Querying active_streams for usage counts...');
        const activeStreams = db.prepare(`SELECT streamer, COUNT(*) as count FROM active_streams GROUP BY streamer`).all();
        logInfo(`[StreamAllocator] DEBUG: Found ${activeStreams.length} streamers with active assignments`);
        for (const row of activeStreams) {
            streamUsage.set(row.streamer, row.count);
        }
        // Sort by usage count (ascending), then by viewer count (ascending)
        const sorted = [...streams].sort((a, b) => {
            const usageA = streamUsage.get(a.user_login) || 0;
            const usageB = streamUsage.get(b.user_login) || 0;
            if (usageA !== usageB)
                return usageA - usageB;
            return a.viewer_count - b.viewer_count;
        });
        return sorted[0] || null;
    }
    assignStreamToAccount(accountId, stream) {
        db.prepare(`
      INSERT INTO active_streams (account_id, streamer, streamer_id, game, viewer_count, started_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(accountId, stream.user_login, stream.user_id, stream.game_name, stream.viewer_count);
        logInfo(`[StreamAllocator] ✅ Allocated account ${accountId} to ${stream.user_name} (${stream.game_name}) - ${stream.viewer_count} viewers`);
    }
    cleanupStaleStreams() {
        // Remove assignments for streams that might have ended
        // In a real implementation, you'd check if streams are still live
        // For now, we'll just clean up assignments older than 2 hours
        logInfo('[StreamAllocator] DEBUG: Cleaning up stale streams...');
        const result = db.prepare(`
      DELETE FROM active_streams
      WHERE datetime(started_at) < datetime('now', '-2 hours')
    `).run();
        logInfo(`[StreamAllocator] DEBUG: Cleanup result: ${result.changes} streams removed`);
        if (result.changes > 0) {
            logInfo(`[StreamAllocator] Cleaned up ${result.changes} stale stream assignment(s)`);
        }
    }
    getClientId() {
        logInfo('[StreamAllocator] DEBUG: Querying settings table for twitchClientId...');
        const row = db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get();
        logInfo(`[StreamAllocator] DEBUG: Settings query result: ${row ? 'Found' : 'NOT FOUND'}`);
        return row?.value || process.env.TWITCH_CLIENT_ID || '';
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
export default StreamAllocatorService;

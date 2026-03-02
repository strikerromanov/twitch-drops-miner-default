import db from '../core/db.js';
import { refreshAccessToken } from '../core/auth.js';
import { logInfo, logError, logWarn } from '../core/logger.js';
const THRESHOLD_SECS = 60 * 60; // refresh when within 60 min of expiry
const CHECK_MS = 30 * 60 * 1000;
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function withRetry(fn, opts) {
    let last;
    for (let i = 0; i <= opts.retries; i++) {
        try {
            return await fn();
        }
        catch (e) {
            last = e;
            if (e.message?.includes('invalid_grant') || e.message?.includes('Invalid refresh'))
                throw e;
            if (i < opts.retries) {
                await sleep(opts.baseDelayMs * 2 ** i);
            }
        }
    }
    throw last;
}
class TokenRefreshService {
    clientId;
    broadcast;
    id = null;
    constructor(clientId, broadcast) {
        this.clientId = clientId;
        this.broadcast = broadcast;
    }
    setClientId(id) { this.clientId = id; }
    start() {
        logInfo('[TokenRefresh] Started – checks every 30 min');
        this.run();
        this.id = setInterval(() => this.run(), CHECK_MS);
    }
    stop() { if (this.id) {
        clearInterval(this.id);
        this.id = null;
    } }
    async run() {
        if (!this.clientId) {
            logWarn('[TokenRefresh] No client ID – skipping');
            return;
        }
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + THRESHOLD_SECS;
        const rows = db.prepare(`SELECT id, username, accessToken, refreshToken FROM accounts
       WHERE status != 'error' AND (token_expires_at IS NULL OR token_expires_at <= ?)`).all(cutoff);
        if (!rows.length) {
            logInfo('[TokenRefresh] All tokens fresh');
            return;
        }
        logInfo(`[TokenRefresh] Refreshing ${rows.length} token(s)`);
        for (const a of rows) {
            await this.refreshOne(a);
            await sleep(1500);
        }
    }
    async refreshOne(a) {
        if (!a.refreshToken) {
            this.mark(a.id, 'error');
            return;
        }
        try {
            const t = await withRetry(() => refreshAccessToken(a.refreshToken, this.clientId), { retries: 3, baseDelayMs: 2000, label: `refresh:${a.username}` });
            const exp = Math.floor(Date.now() / 1000) + t.expires_in;
            db.prepare(`UPDATE accounts SET accessToken=?,refreshToken=?,token_expires_at=?,lastActive=datetime('now'),
        status=CASE WHEN status='error' THEN 'idle' ELSE status END WHERE id=?`)
                .run(t.access_token, t.refresh_token, exp, a.id);
            logInfo(`[TokenRefresh] ✅ ${a.username} (exp in ${t.expires_in}s)`);
            this.broadcast({ type: 'token_refreshed', accountId: a.id, username: a.username, expiresIn: t.expires_in });
        }
        catch (e) {
            logError(`[TokenRefresh] ❌ ${a.username}: ${e.message}`);
            this.mark(a.id, 'error');
            this.broadcast({ type: 'token_refresh_failed', accountId: a.id, username: a.username, error: e.message });
        }
    }
    mark(id, status) {
        db.prepare(`UPDATE accounts SET status=? WHERE id=?`).run(status, id);
    }
}
export default TokenRefreshService;

import db from '../core/db.js';
import { logInfo, logDebug } from '../core/logger.js';
class PointClaimerService {
    broadcast;
    id = null;
    constructor(broadcast = () => { }) {
        this.broadcast = broadcast;
    }
    start() {
        logInfo('[PointClaimer] Starting');
        this.id = setInterval(() => this.claimPoints(), 2 * 60 * 1000);
    }
    stop() { if (this.id) {
        clearInterval(this.id);
        this.id = null;
    } }
    async claimPoints() {
        // Aggregate stats for broadcast
        const claims = db.prepare(`SELECT COUNT(*) as n, COALESCE(SUM(points_claimed),0) as total FROM point_claim_history
       WHERE datetime(claimed_at) > datetime('now','-1 hour')`).get();
        if (claims.n > 0) {
            logDebug(`[PointClaimer] Last hour: ${claims.n} claims, ${claims.total} pts`);
            this.broadcast({ type: 'points_summary', claims: claims.n, total: claims.total });
        }
    }
}
export default PointClaimerService;

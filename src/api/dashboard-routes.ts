/**
 * Dashboard-specific API routes.
 * These were missing from the original app — their absence caused the
 * "Unexpected token '<'" JSON error (the SPA catch-all returned index.html).
 */
import express from 'express';
import db from '../core/db.js';

const router = express.Router();

router.get('/points-history', (req, res) => {
  try {
    const days = Math.min(parseInt(String(req.query.days || '7'), 10), 90);
    res.json(db.prepare(`
      SELECT date(claimed_at) AS bucket,
             COALESCE(SUM(points_claimed),0) AS total,
             strftime('%b %d', claimed_at) AS label
      FROM point_claim_history
      WHERE datetime(claimed_at) >= datetime('now','-${days} days')
      GROUP BY date(claimed_at) ORDER BY bucket ASC
    `).all());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/active-streams', (_req, res) => {
  try {
    res.json(db.prepare(`
      SELECT a.username, s.streamer, s.game, s.started_at, s.viewer_count
      FROM active_streams s JOIN accounts a ON a.id=s.account_id
      ORDER BY s.started_at DESC
    `).all());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/game-distribution', (_req, res) => {
  try {
    res.json(db.prepare(`
      SELECT COALESCE(c.game,'Unknown') AS game, COUNT(d.id) AS drops
      FROM drops d LEFT JOIN campaigns c ON c.id=d.campaign_id
      GROUP BY c.game ORDER BY drops DESC LIMIT 10
    `).all());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export { router as dashboardRouter };

import { logInfo, logError, logWarn } from '../core/logger.js';

class FollowedChannelsService {
  private id: NodeJS.Timeout | null = null;
  constructor(private db: any, private clientId: string) {}

  start() {
    logInfo('[FollowedChannels] Starting');
    this.indexChannels();
    this.id = setInterval(() => this.indexChannels(), 10 * 60 * 1000);
  }

  stop() { if (this.id) { clearInterval(this.id); this.id = null; } }

  private async indexChannels() {
    const cid = this.clientId ||
      (this.db.prepare(`SELECT value FROM settings WHERE key='twitchClientId'`).get() as any)?.value ||
      process.env.TWITCH_CLIENT_ID || '';
    if (!cid) return;

    const accounts: any[] = this.db.prepare(
      `SELECT id,username,accessToken,user_id FROM accounts WHERE status!='error' AND user_id IS NOT NULL`
    ).all();

    for (const a of accounts) {
      try {
        const res = await fetch(
          `https://api.twitch.tv/helix/streams/followed?user_id=${a.user_id}&first=100`,
          { headers: { 'Authorization': `Bearer ${a.accessToken}`, 'Client-Id': cid } }
        );
        if (!res.ok) continue;
        const data = await res.json();

        for (const stream of (data.data || [])) {
          this.db.prepare(`
            INSERT INTO followed_channels (account_id,streamer,streamer_id,status,game_name,viewer_count)
            VALUES (?,?,?,'live',?,?)
            ON CONFLICT DO UPDATE SET status='live',viewer_count=excluded.viewer_count,game_name=excluded.game_name
          `).run(a.id, stream.user_login, stream.user_id, stream.game_name, stream.viewer_count);
        }
        logInfo(`[FollowedChannels] ${a.username}: ${data.data?.length || 0} live followed channels`);
      } catch (e: any) { logError(`[FollowedChannels] ${a.username}: ${e.message}`); }
    }
  }
}

export default FollowedChannelsService;

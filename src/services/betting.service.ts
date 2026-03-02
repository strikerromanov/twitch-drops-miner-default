import db from '../core/db.js';
import { logInfo, logError, logWarn, logDebug } from '../core/logger.js';

type Broadcaster = (d: object) => void;

interface BettingOpportunity {
  accountId: number;
  streamer: string;
  streamerId: string;
  points: number;
  currentBet: number;
}

interface Prediction {
  id: string;
  title: string;
  outcomes: Array<{
    id: string;
    title: string;
    color: string;
    users: number;
    points: number;
    topPredictors: Array<any>;
  }>;
  startedAt: string;
  endsAt: string;
  windowSeconds: number;
  status: 'ACTIVE' | 'LOCKED' | 'RESOLVED';
}

class BettingService {
  private checkInterval: NodeJS.Timeout | null = null;
  private enabled: boolean = false;
  private isActive: boolean = false;
  private maxBetPercentage: number = 5; // Default max 5% of points
  private minBetPoints: number = 50;
  private strategy: 'conservative' | 'moderate' | 'aggressive' = 'conservative';

  constructor(private broadcast: Broadcaster = () => {}) {
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Database schema already exists in db.ts, just verify
    logInfo('[Betting] Database initialized');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logInfo(`[Betting] ${enabled ? 'Enabled' : 'Disabled'}`);

    if (enabled && !this.isActive) {
      this.start();
    } else if (!enabled && this.isActive) {
      this.stop();
    }

    this.broadcast({ type: 'betting_status_changed', enabled });
  }

  setConfig(config: { maxBetPercentage?: number; strategy?: 'conservative' | 'moderate' | 'aggressive' }): void {
    if (config.maxBetPercentage !== undefined) {
      this.maxBetPercentage = Math.max(1, Math.min(20, config.maxBetPercentage));
      logInfo(`[Betting] Max bet percentage: ${this.maxBetPercentage}%`);
    }
    if (config.strategy) {
      this.strategy = config.strategy;
      logInfo(`[Betting] Strategy: ${this.strategy}`);
    }
  }

  start(): void {
    if (this.isActive) return;
    this.isActive = true;
    logInfo('[Betting] Starting service');

    // Check for betting opportunities every 60 seconds
    this.checkInterval = setInterval(() => {
      if (this.enabled) {
        this.checkForBettingOpportunities();
      }
    }, 60000);

    // Initial check
    if (this.enabled) {
      this.checkForBettingOpportunities();
    }
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logInfo('[Betting] Stopped service');
  }

  private async checkForBettingOpportunities(): Promise<void> {
    try {
      // Get farming accounts with points in followed_channels or active_streams
      const accounts: any[] = db.prepare(`
        SELECT DISTINCT a.id, a.username, a.accessToken
        FROM accounts a
        WHERE a.status = 'farming' AND a.accessToken IS NOT NULL
      `).all();

      if (!accounts.length) {
        logDebug('[Betting] No farming accounts');
        return;
      }

      logDebug(`[Betting] Checking opportunities for ${accounts.length} account(s)`);

      for (const account of accounts) {
        await this.findAndPlaceBets(account);
      }
    } catch (error: any) {
      logError(`[Betting] Error checking opportunities: ${error.message}`);
    }
  }

  private async findAndPlaceBets(account: any): Promise<void> {
    try {
      // Get channels with points from both followed_channels and active_streams
      const channels: any[] = db.prepare(`
        SELECT streamer, streamer_id, points, game_name
        FROM (
          SELECT streamer, streamer_id, points, game_name
          FROM followed_channels
          WHERE account_id = ? AND points > ?
          UNION
          SELECT s.streamer, s.streamer_id, COALESCE(SUM(fc.points), 0) as points, s.game_name
          FROM active_streams s
          LEFT JOIN followed_channels fc ON fc.account_id = s.account_id AND fc.streamer = s.streamer
          WHERE s.account_id = ?
          GROUP BY s.streamer, s.streamer_id, s.game_name
        )
        WHERE points > ?
        ORDER BY points DESC
        LIMIT 10
      `).all(account.id, this.minBetPoints, account.id, this.minBetPoints);

      if (!channels.length) {
        logDebug(`[Betting] No channels with sufficient points for ${account.username}`);
        return;
      }

      for (const channel of channels) {
        // Check if there's an active prediction for this channel
        const prediction = await this.fetchActivePrediction(account, channel.streamer_id);
        if (prediction && prediction.status === 'ACTIVE') {
          await this.evaluateAndPlaceBet(account, channel, prediction);
        }
      }
    } catch (error: any) {
      logError(`[Betting] Error finding bets for ${account.username}: ${error.message}`);
    }
  }

  private async fetchActivePrediction(account: any, streamerId: string): Promise<Prediction | null> {
    try {
      const response = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${account.accessToken}`,
          'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          operationName: 'ViewerCard',
          variables: { channelLogin: streamerId },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: 'e2422ae1c5829fc33fe9071e46709b1be863ed6c7b13e8e2f4be50e636e96aa9'
            }
          }
        }]),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const communityPoints = data?.[0]?.data?.user?.channel?.communityPoints;

      if (!communityPoints) return null;

      // Check for active prediction
      if (communityPoints.activePrediction) {
        return communityPoints.activePrediction;
      }

      return null;
    } catch (error) {
      logDebug(`[Betting] Error fetching prediction for ${streamerId}`);
      return null;
    }
  }

  private async evaluateAndPlaceBet(account: any, channel: any, prediction: Prediction): Promise<void> {
    try {
      // Get or create stats for this streamer
      let stats: any = db.prepare('SELECT * FROM betting_stats WHERE streamer = ?').get(channel.streamer);

      if (!stats) {
        db.prepare('INSERT INTO betting_stats (streamer, totalBets, wins, totalProfit, avgOdds) VALUES (?, 0, 0, 0, 1.0)').run(channel.streamer);
        stats = db.prepare('SELECT * FROM betting_stats WHERE streamer = ?').get(channel.streamer);
      }

      // Calculate win rate and Kelly Criterion
      const totalBets = stats.totalBets || 0;
      const wins = stats.wins || 0;
      const winRate = totalBets > 0 ? wins / totalBets : 0.5; // Default 50% for new streamers

      // Kelly Criterion: f* = (bp - q) / b
      // where b = odds - 1, p = probability of winning, q = probability of losing
      // For simplicity, we assume even odds (b = 1)
      const kellyFraction = winRate - (1 - winRate); // Simplified Kelly

      // Adjust based on strategy
      let adjustedKelly = kellyFraction;
      switch (this.strategy) {
        case 'conservative':
          adjustedKelly = kellyFraction * 0.5; // Half Kelly
          break;
        case 'moderate':
          adjustedKelly = kellyFraction * 0.75; // Three-quarter Kelly
          break;
        case 'aggressive':
          adjustedKelly = kellyFraction * 1.0; // Full Kelly
          break;
      }

      // Calculate bet amount
      const availablePoints = channel.points || 0;
      const betPercentage = Math.max(0, Math.min(this.maxBetPercentage / 100, adjustedKelly));
      const betAmount = Math.floor(availablePoints * betPercentage);

      // Apply minimum bet
      if (betAmount < this.minBetPoints) {
        logDebug(`[Betting] Bet amount ${betAmount} below minimum ${this.minBetPoints} for ${channel.streamer}`);
        return;
      }

      // Select outcome based on odds (users distribution)
      const selectedOutcome = this.selectOutcome(prediction.outcomes, winRate);
      if (!selectedOutcome) return;

      // Place the bet
      await this.placeBet(account, channel, prediction, selectedOutcome, betAmount);

    } catch (error: any) {
      logError(`[Betting] Error evaluating bet: ${error.message}`);
    }
  }

  private selectOutcome(outcomes: any[], winRate: number): any | null {
    if (!outcomes || outcomes.length < 2) return null;

    // Simple strategy: bet on outcome with fewer users (underdog)
    // or more users (favorite) based on win rate
    const sortedOutcomes = [...outcomes].sort((a, b) => a.users - b.users);

    // If we have good data (high win rate), bet on favorite
    // Otherwise, bet on underdog for better odds
    if (winRate > 0.55) {
      return sortedOutcomes[sortedOutcomes.length - 1]; // Favorite
    } else {
      return sortedOutcomes[0]; // Underdog
    }
  }

  private async placeBet(account: any, channel: any, prediction: Prediction, outcome: any, amount: number): Promise<void> {
    try {
      const response = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${account.accessToken}`,
          'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          operationName: 'MakePrediction',
          variables: {
            input: {
              predictionId: prediction.id,
              outcomeId: outcome.id,
              points: amount,
              transactionID: crypto.randomUUID()
            }
          },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: 'b01cc237e2286a693c44b31cc732e2b89f88f7dbf4753fb5e518e8da9ada5a90'
            }
          }
        }]),
      });

      if (!response.ok) {
        logError(`[Betting] Bet request failed: ${response.status}`);
        return;
      }

      const result = await response.json();

      if (result.errors) {
        logError(`[Betting] Bet placement error: ${JSON.stringify(result.errors)}`);
        return;
      }

      // Record bet in database
      db.prepare(`
        INSERT INTO betting_history (
          account_id, streamer_name, prediction_title, outcome_selected,
          outcome_percentage, points_wagered, points_won, outcome, timestamp, strategy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).run(
        account.id,
        channel.streamer,
        prediction.title,
        outcome.title,
        Math.round((outcome.points / prediction.outcomes.reduce((sum, o) => sum + o.points, 0)) * 100),
        amount,
        0, // Will be updated when resolved
        'pending',
        this.strategy
      );

      // Deduct points
      db.prepare('UPDATE followed_channels SET points = points - ? WHERE account_id = ? AND streamer = ?')
        .run(amount, account.id, channel.streamer);

      logInfo(`[Betting] 💰 Placed ${amount} point bet on ${channel.streamer} - ${outcome.title}`);

      this.broadcast({
        type: 'bet_placed',
        accountId: account.id,
        username: account.username,
        streamer: channel.streamer,
        amount,
        outcome: outcome.title
      });

    } catch (error: any) {
      logError(`[Betting] Error placing bet: ${error.message}`);
    }
  }

  getBettingStats(): any {
    const raw: any = db.prepare(`
      SELECT
        COUNT(*) as totalBets,
        SUM(CASE WHEN outcome='won' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome='lost' THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN outcome='won' THEN points_won ELSE 0 END) as totalWon,
        SUM(points_wagered) as totalWagered,
        COALESCE(SUM(CASE WHEN outcome='won' THEN points_won - points_wagered
                 WHEN outcome='lost' THEN -points_wagered ELSE 0 END), 0) as netProfit
      FROM betting_history
      WHERE outcome IN ('won', 'lost')
    `).get();

    const winRate = raw.totalBets > 0 ? (raw.wins / raw.totalBets) * 100 : 0;
    const roi = raw.totalWagered > 0 ? (raw.netProfit / raw.totalWagered) * 100 : 0;

    return {
      ...raw,
      winRate: Math.round(winRate * 10) / 10,
      roi: Math.round(roi * 10) / 10,
      enabled: this.enabled,
      strategy: this.strategy,
      maxBetPercentage: this.maxBetPercentage
    };
  }

  getStreamerAnalysis(streamer: string): any {
    const stats: any = db.prepare('SELECT * FROM betting_stats WHERE streamer = ?').get(streamer);
    const history: any[] = db.prepare(`
      SELECT * FROM betting_history
      WHERE streamer_name = ?
      ORDER BY timestamp DESC
      LIMIT 20
    `).all(streamer);

    if (!stats) {
      return {
        streamer,
        totalBets: 0,
        wins: 0,
        winRate: 0,
        avgProfit: 0,
        recommendation: 'Insufficient data'
      };
    }

    const winRate = stats.totalBets > 0 ? (stats.wins / stats.totalBets) * 100 : 0;
    const avgProfit = stats.totalBets > 0 ? stats.totalProfit / stats.totalBets : 0;

    let recommendation = 'Neutral';
    if (winRate >= 60) recommendation = 'Strong candidate';
    else if (winRate >= 50) recommendation = 'Good candidate';
    else if (winRate < 40) recommendation = 'Avoid';

    return {
      streamer,
      totalBets: stats.totalBets,
      wins: stats.wins,
      losses: stats.totalBets - stats.wins,
      winRate: Math.round(winRate * 10) / 10,
      totalProfit: stats.totalProfit,
      avgProfit: Math.round(avgProfit),
      recommendation,
      recentBets: history.length
    };
  }

  getTopStreamers(limit: number = 10): any[] {
    return db.prepare(`
      SELECT
        streamer_name as streamer,
        COUNT(*) as totalBets,
        SUM(CASE WHEN outcome='won' THEN 1 ELSE 0 END) as wins,
        COALESCE(SUM(CASE WHEN outcome='won' THEN points_won - points_wagered
                 WHEN outcome='lost' THEN -points_wagered ELSE 0 END), 0) as netProfit
      FROM betting_history
      WHERE outcome IN ('won', 'lost')
      GROUP BY streamer_name
      ORDER BY netProfit DESC
      LIMIT ?
    `).all(limit);
  }
}

export default BettingService;

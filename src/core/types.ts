export interface Account {
  id:              number;
  username:        string;
  status:          'idle' | 'farming' | 'error';
  createdAt:       string;
  lastActive:      string | null;
  user_id:         string | null;
  token_expires_at: number | null;
}

export interface Campaign {
  id:               string;
  name:             string;
  game:             string | null;
  required_minutes: number | null;
  current_minutes:  number;
  status:           string;
  image_url:        string | null;
  last_updated:     string | null;
  createdAt:        string;
}

export interface Drop {
  id:              number;
  account_id:      number;
  campaign_id:     string;
  claimed:         number;
  current_minutes: number;
  last_updated:    string;
}

export interface BettingStats {
  totalBets:   number;
  wins:        number;
  losses:      number;
  netProfit:   number;
  winRate:     number;
}

export interface RecentBet {
  id:                  number;
  account_id:          number;
  streamer_name:       string;
  prediction_title:    string;
  outcome_selected:    string;
  outcome_percentage:  number;
  points_wagered:      number;
  points_won:          number;
  outcome:             string | null;
  profit:              number;
  timestamp:           string;
  strategy:            string;
}

export interface LogEntry {
  id:         number;
  time:       string;
  level:      string;
  message:    string;
  streamer_id: number | null;
  type:       string | null;
}

export interface Stats {
  totalAccounts:  number;
  activeAccounts: number;
  totalDrops:     number;
  claimedDrops:   number;
  recentClaims:   number;
  activeStreams:   number;
  timestamp:      string;
}

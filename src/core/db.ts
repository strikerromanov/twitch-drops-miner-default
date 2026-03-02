import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR  = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'farm.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT,
    accessToken      TEXT,
    refreshToken     TEXT,
    status           TEXT    DEFAULT 'idle',
    createdAt        TEXT    DEFAULT (datetime('now')),
    lastActive       TEXT,
    user_id          TEXT,
    token_expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS followed_channels (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER,
    streamer     TEXT,
    streamer_id  TEXT,
    status       TEXT,
    game_name    TEXT,
    viewer_count INTEGER DEFAULT 0,
    points       INTEGER DEFAULT 0,
    bets         INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS games (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT,
    activeCampaigns INTEGER,
    whitelisted     INTEGER,
    lastDrop        TEXT
  );

  CREATE TABLE IF NOT EXISTS point_claim_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER,
    streamer       TEXT,
    points_claimed INTEGER,
    claimed_at     TEXT    DEFAULT (datetime('now')),
    bonus_type     TEXT
  );

  CREATE TABLE IF NOT EXISTS betting_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer    TEXT,
    totalBets   INTEGER DEFAULT 0,
    wins        INTEGER DEFAULT 0,
    totalProfit INTEGER DEFAULT 0,
    avgOdds     REAL    DEFAULT 1.0,
    UNIQUE(streamer)
  );

  CREATE TABLE IF NOT EXISTS betting_history (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id           INTEGER,
    streamer_name        TEXT,
    prediction_title     TEXT,
    outcome_selected     TEXT,
    outcome_percentage   REAL    DEFAULT 0,
    points_wagered       INTEGER DEFAULT 0,
    points_won           INTEGER DEFAULT 0,
    outcome              TEXT,
    profit               INTEGER,
    timestamp            TEXT    DEFAULT (datetime('now')),
    strategy             TEXT
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id               TEXT PRIMARY KEY,
    name             TEXT,
    game             TEXT,
    required_minutes INTEGER,
    current_minutes  INTEGER DEFAULT 0,
    status           TEXT,
    image_url        TEXT,
    last_updated     TEXT,
    createdAt        TEXT    DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS drops (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER,
    campaign_id     TEXT,
    claimed         INTEGER DEFAULT 0,
    current_minutes INTEGER DEFAULT 0,
    last_updated    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    time        TEXT DEFAULT (datetime('now')),
    level       TEXT,
    message     TEXT,
    streamer_id INTEGER,
    type        TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stream_allocations (
    account_id  INTEGER,
    streamer    TEXT,
    assigned_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, streamer)
  );

  CREATE TABLE IF NOT EXISTS active_streams (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER,
    streamer     TEXT,
    streamer_id  TEXT,
    game         TEXT,
    viewer_count INTEGER DEFAULT 0,
    started_at   TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tmi_chat_status (
    account_id     INTEGER PRIMARY KEY,
    connected      INTEGER DEFAULT 0,
    channel        TEXT,
    last_connected TEXT
  );
`);

// ─── Idempotent migrations ────────────────────────────────────────────────────
const addCol = (table: string, col: string, def: string) => {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run(); } catch {}
};
addCol('accounts',         'token_expires_at', 'INTEGER');
addCol('followed_channels','streamer_id',      'TEXT');
addCol('followed_channels','game_name',        'TEXT');
addCol('followed_channels','bets',             'INTEGER DEFAULT 0');
addCol('active_streams',   'viewer_count',     'INTEGER DEFAULT 0');
addCol('active_streams',   'streamer_id',      'TEXT');
addCol('logs',             'streamer_id',      'INTEGER');
addCol('logs',             'type',             'TEXT');
addCol('drops',            'claimed',          'INTEGER DEFAULT 0');
addCol('drops',            'last_updated',     'TEXT    DEFAULT (datetime(\'now\'))');

// ─── Indexes ──────────────────────────────────────────────────────────────────
[
  'CREATE INDEX IF NOT EXISTS idx_followed_account ON followed_channels(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time DESC)',
  'CREATE INDEX IF NOT EXISTS idx_claims_time ON point_claim_history(account_id, claimed_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_drops_account ON drops(account_id)',
].forEach(s => { try { db.prepare(s).run(); } catch {} });

// ─── Default settings ─────────────────────────────────────────────────────────
const settingsInit = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
);
[
  ['twitchClientId',   ''],
  ['refreshInterval',  '600000'],
  ['maxAccounts',      '5'],
  ['betting_enabled',  'false'],
  ['betting_strategy', 'conservative'],
].forEach(([k, v]) => settingsInit.run(k, v));

export default db;

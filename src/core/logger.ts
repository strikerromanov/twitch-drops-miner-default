import db from './db.js';

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
const C: Record<Level, string> = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', DEBUG: '\x1b[90m' };
const R = '\x1b[0m';
const DEBUG = process.env.LOG_LEVEL === 'debug';

function log(level: Level, message: string, type?: string) {
  if (level === 'DEBUG' && !DEBUG) return;
  console.log(`${C[level]}[${level}]${R} ${message}`);
  try {
    db.prepare(`INSERT INTO logs (level, message, type) VALUES (?, ?, ?)`).run(level, message, type ?? null);
  } catch {}
}

export const logInfo  = (m: string, t?: string) => log('INFO',  m, t);
export const logWarn  = (m: string, t?: string) => log('WARN',  m, t);
export const logError = (m: string, t?: string) => log('ERROR', m, t);
export const logDebug = (m: string, t?: string) => log('DEBUG', m, t);

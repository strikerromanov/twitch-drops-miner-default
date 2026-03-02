import { logError, logInfo, logWarn } from '../core/logger.js';

interface Svc { start(): void; stop(): void; }
type Broadcaster = (d: object) => void;

const MAX = 10, BASE = 5000, CAP = 300_000;

export class ServiceWatchdog {
  private restarts = 0;
  private alive    = false;
  constructor(private name: string, private svc: Svc, private broadcast: Broadcaster) {}

  start() { this.alive = true; this.restarts = 0; this.safeStart(); }
  stop()  { this.alive = false; try { this.svc.stop(); } catch {} }

  private safeStart() {
    try {
      this.svc.start();
      logInfo(`[Watchdog:${this.name}] Running`);
      this.wrapTicks();
    } catch (e: any) { this.crash(e); }
  }

  private wrapTicks() {
    const names = ['run','checkAndRefreshAll','syncCampaigns','farmChat','claimPoints','indexChannels','tickProgress'];
    const self = this;
    for (const n of names) {
      const proto = Object.getPrototypeOf(this.svc) as any;
      if (typeof proto[n] === 'function' && !proto[`__${n}_w`]) {
        const orig = proto[n].bind(this.svc);
        proto[n] = async (...args: any[]) => {
          try { return await orig(...args); }
          catch (e: any) { logError(`[Watchdog:${self.name}] ${n} error: ${e.message}`); self.crash(e); }
        };
        proto[`__${n}_w`] = true;
      }
    }
  }

  private crash(e: Error) {
    if (!this.alive) return;
    this.restarts++;
    logError(`[Watchdog:${this.name}] Crash #${this.restarts}: ${e.message}`);
    this.broadcast({ type: 'service_crashed', service: this.name, error: e.message, restart: this.restarts });
    if (this.restarts >= MAX) { this.broadcast({ type: 'service_failed', service: this.name }); this.alive = false; return; }
    const delay = Math.min(BASE * 2 ** (this.restarts - 1), CAP);
    logWarn(`[Watchdog:${this.name}] Restarting in ${delay / 1000}s`);
    setTimeout(() => { if (this.alive) { try { this.svc.stop(); } catch {} this.safeStart(); } }, delay);
  }
}

export default ServiceWatchdog;

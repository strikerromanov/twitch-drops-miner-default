import { logError, logInfo, logWarn } from '../core/logger.js';
const MAX = 10, BASE = 5000, CAP = 300_000;
export class ServiceWatchdog {
    name;
    svc;
    broadcast;
    restarts = 0;
    alive = false;
    constructor(name, svc, broadcast) {
        this.name = name;
        this.svc = svc;
        this.broadcast = broadcast;
    }
    start() { this.alive = true; this.restarts = 0; this.safeStart(); }
    stop() { this.alive = false; try {
        this.svc.stop();
    }
    catch { } }
    safeStart() {
        try {
            this.svc.start();
            logInfo(`[Watchdog:${this.name}] Running`);
            this.wrapTicks();
        }
        catch (e) {
            this.crash(e);
        }
    }
    wrapTicks() {
        const names = ['run', 'checkAndRefreshAll', 'syncCampaigns', 'farmChat', 'claimPoints', 'indexChannels', 'tickProgress'];
        const self = this;
        for (const n of names) {
            const proto = Object.getPrototypeOf(this.svc);
            if (typeof proto[n] === 'function' && !proto[`__${n}_w`]) {
                const orig = proto[n].bind(this.svc);
                proto[n] = async (...args) => {
                    try {
                        return await orig(...args);
                    }
                    catch (e) {
                        logError(`[Watchdog:${self.name}] ${n} error: ${e.message}`);
                        self.crash(e);
                    }
                };
                proto[`__${n}_w`] = true;
            }
        }
    }
    crash(e) {
        if (!this.alive)
            return;
        this.restarts++;
        logError(`[Watchdog:${this.name}] Crash #${this.restarts}: ${e.message}`);
        this.broadcast({ type: 'service_crashed', service: this.name, error: e.message, restart: this.restarts });
        if (this.restarts >= MAX) {
            this.broadcast({ type: 'service_failed', service: this.name });
            this.alive = false;
            return;
        }
        const delay = Math.min(BASE * 2 ** (this.restarts - 1), CAP);
        logWarn(`[Watchdog:${this.name}] Restarting in ${delay / 1000}s`);
        setTimeout(() => { if (this.alive) {
            try {
                this.svc.stop();
            }
            catch { }
            this.safeStart();
        } }, delay);
    }
}
export default ServiceWatchdog;

import type { Config, ServiceConfig } from './config.ts';
import type { ServiceState, ServiceStatus, StatusSnapshot } from './types.ts';

const USER_AGENT = 'StatusBoard/1.0 (+https://github.com/status-board)';

/** One slot of the history ring. `null` means the slot has never been filled. */
type Slot = { ok: boolean; slow: boolean } | null;

const STATE_CHAR: Record<Exclude<ServiceState, 'pending'>, string> = {
  operational: 'o',
  degraded: 'd',
  down: 'x',
};

class ServiceMonitor {
  readonly config: ServiceConfig;
  private readonly size: number;
  private readonly slots: Slot[];
  /** Index of the next slot to write; the ring is read oldest-first from here. */
  private cursor = 0;
  private filled = 0;
  private latencyMs: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  lastCheckedAt = 0;

  constructor(config: ServiceConfig, historySize: number) {
    this.config = config;
    this.size = historySize;
    this.slots = new Array<Slot>(historySize).fill(null);
  }

  /**
   * Checks are staggered across the interval so a board with many services
   * doesn't fire every request in the same tick.
   */
  start(intervalSeconds: number, offsetMs: number): void {
    const period = intervalSeconds * 1000;
    this.startTimer = setTimeout(() => {
      void this.check();
      this.timer = setInterval(() => void this.check(), period);
      this.timer.unref?.();
    }, offsetMs);
    this.startTimer.unref?.();
  }

  stop(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    this.startTimer = null;
    this.timer = null;
  }

  private record(slot: NonNullable<Slot>): void {
    this.slots[this.cursor] = slot;
    this.cursor = (this.cursor + 1) % this.size;
    if (this.filled < this.size) this.filled++;
    this.lastCheckedAt = Date.now();
  }

  private async check(): Promise<void> {
    const { url, timeout, expectedStatus, degradedThresholdMs, headers } = this.config;
    const startedAt = performance.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: { 'user-agent': USER_AGENT, ...headers },
      });
      // Drain the body so the socket can be reused rather than left half-read.
      await res.body?.cancel();

      const ms = Math.round(performance.now() - startedAt);
      const ok = expectedStatus
        ? expectedStatus.includes(res.status)
        : res.status >= 200 && res.status < 400;

      if (ok) {
        this.latencyMs = ms;
        this.record({ ok: true, slow: ms > degradedThresholdMs });
      } else {
        this.record({ ok: false, slow: false });
      }
    } catch {
      // Timeouts, DNS failures, TLS errors, refused connections — all "down".
      this.record({ ok: false, slow: false });
    }
  }

  /** Slots oldest-first. Only meaningful once at least one check has landed. */
  private ordered(): Slot[] {
    if (this.filled < this.size) return this.slots.slice(0, this.filled);
    return [...this.slots.slice(this.cursor), ...this.slots.slice(0, this.cursor)];
  }

  snapshot(): ServiceStatus {
    const history = this.ordered();
    const last = history.at(-1);

    let state: ServiceState;
    if (!last) {
      state = 'pending';
    } else if (!last.ok) {
      state = 'down';
    } else if (last.slow || history.some((s) => s && !s.ok)) {
      // Up right now, but slow or recently flapping.
      state = 'degraded';
    } else {
      state = 'operational';
    }

    let up = 0;
    for (const slot of history) if (slot?.ok) up++;
    const uptimePct = history.length ? (up / history.length) * 100 : null;

    // Pad the left with empty slots so the strip is a fixed width from the start.
    const chars = history.map((slot) => {
      if (!slot) return '-';
      if (!slot.ok) return STATE_CHAR.down;
      return slot.slow ? STATE_CHAR.degraded : STATE_CHAR.operational;
    });
    const packed = '-'.repeat(this.size - chars.length) + chars.join('');

    return {
      name: this.config.name,
      state,
      latencyMs: this.latencyMs,
      uptimePct,
      history: packed,
    };
  }
}

/**
 * Drives the headline pill. `pending` sits below `operational` so a board that
 * has not finished its first sweep reads as healthy rather than alarming; it
 * still isn't counted in `healthy`.
 */
const SEVERITY: Record<ServiceState, number> = { pending: 0, operational: 1, degraded: 2, down: 3 };

export class Monitor {
  private readonly config: Config;
  private readonly monitors: ServiceMonitor[];

  constructor(config: Config) {
    this.config = config;
    this.monitors = config.services.map((s) => new ServiceMonitor(s, config.historySize));
  }

  start(): void {
    const period = this.config.checkInterval * 1000;
    const step = period / Math.max(this.monitors.length, 1);
    this.monitors.forEach((m, i) => m.start(this.config.checkInterval, Math.round(i * step)));
  }

  stop(): void {
    for (const m of this.monitors) m.stop();
  }

  snapshot(): StatusSnapshot {
    const services = this.monitors.map((m) => m.snapshot());
    const byName = new Map(services.map((s) => [s.name, s]));

    let overall: ServiceState = 'pending';
    let healthy = 0;
    for (const s of services) {
      if (s.state === 'operational') healthy++;
      if (SEVERITY[s.state] > SEVERITY[overall]) overall = s.state;
    }

    const groups =
      this.config.groups?.map((g) => ({
        name: g.name,
        services: g.services.map((n) => byName.get(n)!),
      })) ?? null;

    return {
      title: this.config.title,
      theme: this.config.theme,
      refreshInterval: this.config.refreshInterval,
      show: this.config.show,
      overall,
      healthy,
      total: services.length,
      updatedAt: Math.max(0, ...this.monitors.map((m) => m.lastCheckedAt)),
      services,
      groups,
    };
  }
}

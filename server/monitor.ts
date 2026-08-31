import type { Config, ServiceConfig } from './config.ts';
import { iconFor, warmIcons } from './icons.ts';
import type { ServiceState, ServiceStatus, StatusSnapshot } from './types.ts';

const USER_AGENT = 'StatusBoard/1.0 (+https://github.com/status-board)';

/** One slot of the history ring. `null` means the slot has never been filled. */
type Slot = { ok: boolean; slow: boolean; t: number } | null;

/**
 * How many recent checks a failure keeps colouring the state after recovery.
 * Without this, a single blip anywhere in a 30-slot ring pins the row to
 * degraded for the whole window, long after the service came back.
 */
const FLAP_WINDOW = 3;

const STATE_CHAR: Record<Exclude<ServiceState, 'pending'>, string> = {
  operational: 'o',
  degraded: 'd',
  down: 'x',
};

class ServiceMonitor {
  config: ServiceConfig;
  private readonly size: number;
  private readonly slots: Slot[];
  /** Index of the next slot to write; the ring is read oldest-first from here. */
  private cursor = 0;
  private filled = 0;
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

  /**
   * Takes on an edited service definition while keeping the recorded history.
   * Only called when `probeKey` matched, so the retained bars still describe
   * the same request being made the same way.
   */
  adopt(config: ServiceConfig): void {
    this.config = config;
  }

  private record(slot: Omit<NonNullable<Slot>, 't'>): void {
    this.slots[this.cursor] = { ...slot, t: Date.now() };
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
        // A null threshold means slow-but-successful is simply up.
        this.record({ ok: true, slow: degradedThresholdMs != null && ms > degradedThresholdMs });
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

  snapshot(icons: boolean): ServiceStatus {
    const history = this.ordered();
    const last = history.at(-1);

    let state: ServiceState;
    if (!last) {
      state = 'pending';
    } else if (!last.ok) {
      state = 'down';
    } else if (last.slow || history.slice(-FLAP_WINDOW).some((s) => s && !s.ok)) {
      // Up right now, but slow, or it failed within the last few checks.
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

    // Span from the oldest retained check to the newest.
    const first = history[0];
    const windowSeconds =
      first && last && last.t > first.t ? Math.round((last.t - first.t) / 1000) : null;

    return {
      name: this.config.name,
      state,
      description: this.config.description,
      url: this.config.url,
      descriptionIsUrl: this.config.descriptionIsUrl,
      icon: icons ? iconFor(this.config) : null,
      uptimePct,
      history: packed,
      windowSeconds,
    };
  }
}

/**
 * Drives the headline pill. `pending` sits below `operational` so a board that
 * has not finished its first sweep reads as healthy rather than alarming; it
 * still isn't counted in `healthy`.
 */
const SEVERITY: Record<ServiceState, number> = { pending: 0, operational: 1, degraded: 2, down: 3 };

/**
 * Identity of a service *as a probe*: everything that decides what request is
 * made and how the answer is graded. Two definitions sharing a key produce
 * comparable results, so history recorded under one is still true of the other.
 * Cosmetic keys (name, description) are deliberately absent.
 */
function probeKey(s: ServiceConfig): string {
  return JSON.stringify([
    s.url,
    s.timeout,
    s.expectedStatus,
    s.degradedThresholdMs,
    Object.entries(s.headers).sort(),
  ]);
}

export class Monitor {
  private config: Config;
  private monitors: ServiceMonitor[];
  private running = false;
  /** Bumped on every successful reload; surfaced to the client in snapshots. */
  configVersion = 1;

  /** The port the current config asks for. Binding it needs a restart. */
  get port(): number {
    return this.config.port;
  }

  constructor(config: Config) {
    this.config = config;
    this.monitors = config.services.map((s) => new ServiceMonitor(s, config.historySize));
  }

  start(): void {
    this.running = true;
    // Logo lookups are fire-and-forget: rows render immediately and pick up
    // their icons on a later poll, rather than the board waiting on svgl.
    void warmIcons(this.config.services);
    const period = this.config.checkInterval * 1000;
    const step = period / Math.max(this.monitors.length, 1);
    this.monitors.forEach((m, i) => m.start(this.config.checkInterval, Math.round(i * step)));
  }

  stop(): void {
    this.running = false;
    for (const m of this.monitors) m.stop();
  }

  /**
   * Swaps in an edited config without dropping what we already know.
   *
   * A service keeps its bars when its name and probe definition both survive
   * the edit; renaming it or changing what gets requested starts it fresh,
   * because the old history would no longer describe the new check. Changing
   * `history_size` also restarts every service, since the ring is fixed-width.
   */
  reload(next: Config): void {
    const previous = this.monitors;
    const sizeChanged = next.historySize !== this.config.historySize;

    // Keyed by name so a reordered list still finds its history. Names are
    // unique per config, which the parser enforces.
    const reusable = new Map<string, ServiceMonitor>();
    if (!sizeChanged) {
      for (const m of previous) reusable.set(m.config.name, m);
    }

    this.monitors = next.services.map((s) => {
      const existing = reusable.get(s.name);
      if (existing && probeKey(existing.config) === probeKey(s)) {
        existing.adopt(s);
        reusable.delete(s.name);
        return existing;
      }
      return new ServiceMonitor(s, next.historySize);
    });

    const carried = new Set(this.monitors);
    // Retire the timers of everything not carried over, so a removed or
    // redefined service stops making requests.
    for (const m of previous) if (!carried.has(m)) m.stop();

    this.config = next;
    this.configVersion++;
    void warmIcons(next.services);

    if (!this.running) return;
    // Restart the carried-over monitors too: check_interval may have changed,
    // and the stagger has to be recomputed across the new list either way.
    const period = next.checkInterval * 1000;
    const step = period / Math.max(this.monitors.length, 1);
    this.monitors.forEach((m, i) => {
      m.stop();
      m.start(next.checkInterval, Math.round(i * step));
    });
  }

  snapshot(): StatusSnapshot {
    const services = this.monitors.map((m) => m.snapshot(this.config.icons));
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
      favicon: this.config.favicon,
      theme: this.config.theme,
      refreshInterval: this.config.refreshInterval,
      configVersion: this.configVersion,
      show: this.config.show,
      iconsEnabled: this.config.icons,
      overall,
      healthy,
      total: services.length,
      updatedAt: Math.max(0, ...this.monitors.map((m) => m.lastCheckedAt)),
      services,
      groups,
    };
  }
}

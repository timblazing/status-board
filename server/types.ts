/** Shared API contract between server and client. */

export type ServiceState = 'operational' | 'degraded' | 'down' | 'pending';

/**
 * History is packed as one char per slot, oldest first, so a 30-slot strip
 * costs 30 bytes instead of an array of objects.
 *   'o' operational · 'd' degraded · 'x' down · '-' no data yet
 */
export type PackedHistory = string;

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  /** Config `description`, falling back to the service's URL. */
  description: string;
  /** The checked URL. Used to link the description when it is the fallback. */
  url: string;
  /** True when `description` is the URL fallback rather than configured text. */
  descriptionIsUrl: boolean;
  /**
   * Brand logo for the row, as light/dark variants — an explicit config
   * `icon`, or one resolved from svgl. Null when the board has icons off, or
   * when nothing was found: the client then falls back to the site's own
   * favicon, and to a monogram after that.
   */
  icon: { light: string; dark: string } | null;
  /** Uptime over recorded checks only; null until the first check lands. */
  uptimePct: number | null;
  history: PackedHistory;
  /**
   * Seconds covered by the recorded checks, for the "57m … now" labels under
   * the strip. Null until there are at least two checks to span.
   */
  windowSeconds: number | null;
}

export interface StatusGroup {
  name: string;
  services: ServiceStatus[];
}

export interface StatusSnapshot {
  title: string;
  /** Config `favicon`; null means the built-in activity mark. */
  favicon: string | null;
  theme: 'dark' | 'light' | 'system';
  refreshInterval: number;
  /**
   * Bumped every time config.yaml is reloaded. The client watches this to
   * re-apply title, theme and favicon without a page refresh.
   */
  configVersion: number;
  show: { description: boolean; bars: boolean; timeLabels: boolean };
  /**
   * Config `icons`. Distinct from a per-service `icon` being null: icons can
   * be on while a given service has no brand logo, which is exactly when the
   * client falls back to that site's favicon or a monogram.
   */
  iconsEnabled: boolean;
  /** Overall board state, derived from the worst service state. */
  overall: ServiceState;
  healthy: number;
  total: number;
  /** Epoch ms of the most recent check across all services. */
  updatedAt: number;
  /** Flat list when the config declares no groups. */
  services: ServiceStatus[];
  groups: StatusGroup[] | null;
}

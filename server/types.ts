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
  theme: 'dark' | 'light' | 'system';
  refreshInterval: number;
  show: { description: boolean; bars: boolean };
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

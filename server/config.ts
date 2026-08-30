import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface ServiceConfig {
  name: string;
  url: string;
  /** Shown under the name; defaults to the URL when unset. */
  description: string;
  /** True when `description` fell back to the URL, so the UI can link it. */
  descriptionIsUrl: boolean;
  timeout: number;
  expectedStatus: number[] | null;
  degradedThresholdMs: number;
  headers: Record<string, string>;
}

export interface GroupConfig {
  name: string;
  services: string[];
}

export interface Config {
  title: string;
  /** URL to an image used as the tab icon; null uses the built-in mark. */
  favicon: string | null;
  theme: 'dark' | 'light' | 'system';
  port: number;
  checkInterval: number;
  refreshInterval: number;
  historySize: number;
  degradedThresholdMs: number;
  show: { description: boolean; bars: boolean; timeLabels: boolean };
  services: ServiceConfig[];
  groups: GroupConfig[] | null;
}

export class ConfigError extends Error {}

const DEFAULTS = {
  title: 'Status',
  favicon: null,
  theme: 'system',
  port: 8080,
  checkInterval: 30,
  refreshInterval: 5,
  historySize: 30,
  degradedThresholdMs: 1000,
  timeout: 10000,
} as const;

function num(value: unknown, fallback: number, label: string, min: number, max: number): number {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${label} must be a number`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${label} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

function bool(value: unknown, fallback: boolean, label: string): boolean {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new ConfigError(`${label} must be true or false`);
  return value;
}

function parseService(raw: unknown, index: number, fallbackDegraded: number): ServiceConfig {
  if (raw == null || typeof raw !== 'object') {
    throw new ConfigError(`services[${index}] must be a mapping with a name and url`);
  }
  const s = raw as Record<string, unknown>;
  const label = typeof s.name === 'string' && s.name ? `service "${s.name}"` : `services[${index}]`;

  if (typeof s.name !== 'string' || !s.name.trim()) {
    throw new ConfigError(`services[${index}] is missing a name`);
  }
  if (typeof s.url !== 'string' || !s.url.trim()) {
    throw new ConfigError(`${label} is missing a url`);
  }
  if (s.description != null && typeof s.description !== 'string') {
    throw new ConfigError(`${label} description must be a string`);
  }
  let url: URL;
  try {
    url = new URL(s.url);
  } catch {
    throw new ConfigError(`${label} has an invalid url: ${s.url}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${label} must use http:// or https:// (got ${url.protocol})`);
  }

  let expectedStatus: number[] | null = null;
  if (s.expected_status != null) {
    const list = Array.isArray(s.expected_status) ? s.expected_status : [s.expected_status];
    expectedStatus = list.map((code) => {
      if (typeof code !== 'number' || !Number.isInteger(code)) {
        throw new ConfigError(`${label} has a non-integer expected_status: ${String(code)}`);
      }
      return code;
    });
  }

  const headers: Record<string, string> = {};
  if (s.headers != null) {
    if (typeof s.headers !== 'object' || Array.isArray(s.headers)) {
      throw new ConfigError(`${label} headers must be a mapping`);
    }
    for (const [key, value] of Object.entries(s.headers as Record<string, unknown>)) {
      headers[key] = String(value);
    }
  }

  return {
    name: s.name.trim(),
    url: url.toString(),
    // Fall back to the URL, trimmed of its scheme so it reads as a label.
    description: (s.description as string)?.trim() || s.url.replace(/^https?:\/\//, ''),
    descriptionIsUrl: !(s.description as string)?.trim(),
    timeout: num(s.timeout, DEFAULTS.timeout, `${label} timeout`, 100, 120_000),
    expectedStatus,
    degradedThresholdMs: num(
      s.degraded_threshold_ms,
      fallbackDegraded,
      `${label} degraded_threshold_ms`,
      1,
      120_000,
    ),
    headers,
  };
}

export function parseConfig(source: string): Config {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (err) {
    throw new ConfigError(`config.yaml is not valid YAML: ${(err as Error).message}`);
  }
  if (raw == null) throw new ConfigError('config.yaml is empty');
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config.yaml must be a mapping with a services: list');
  }
  const c = raw as Record<string, unknown>;

  if (c.theme != null && !['dark', 'light', 'system'].includes(c.theme as string)) {
    throw new ConfigError(`theme must be dark, light or system (got ${String(c.theme)})`);
  }
  if (c.title != null && typeof c.title !== 'string') {
    throw new ConfigError('title must be a string');
  }
  if (c.favicon != null && (typeof c.favicon !== 'string' || !c.favicon.trim())) {
    throw new ConfigError('favicon must be a url or path to an image');
  }
  if (!Array.isArray(c.services) || c.services.length === 0) {
    throw new ConfigError('config.yaml needs a services: list with at least one entry');
  }

  const degradedThresholdMs = num(
    c.degraded_threshold_ms,
    DEFAULTS.degradedThresholdMs,
    'degraded_threshold_ms',
    1,
    120_000,
  );
  const services = c.services.map((s, i) => parseService(s, i, degradedThresholdMs));

  const seen = new Set<string>();
  for (const s of services) {
    if (seen.has(s.name)) throw new ConfigError(`duplicate service name: "${s.name}"`);
    seen.add(s.name);
  }

  let groups: GroupConfig[] | null = null;
  if (c.groups != null) {
    if (!Array.isArray(c.groups)) throw new ConfigError('groups must be a list');
    groups = c.groups.map((raw, i) => {
      const g = raw as Record<string, unknown>;
      if (g == null || typeof g !== 'object' || typeof g.name !== 'string') {
        throw new ConfigError(`groups[${i}] is missing a name`);
      }
      if (!Array.isArray(g.services)) {
        throw new ConfigError(`group "${g.name}" is missing a services list`);
      }
      const names = g.services.map((n) => {
        if (typeof n !== 'string' || !seen.has(n)) {
          throw new ConfigError(`group "${g.name}" references unknown service "${String(n)}"`);
        }
        return n;
      });
      return { name: g.name, services: names };
    });
  }

  const show = (c.show ?? {}) as Record<string, unknown>;

  return {
    title: (c.title as string) ?? DEFAULTS.title,
    favicon: (c.favicon as string)?.trim() || DEFAULTS.favicon,
    theme: (c.theme as Config['theme']) ?? DEFAULTS.theme,
    port: num(c.port, DEFAULTS.port, 'port', 1, 65535),
    checkInterval: num(c.check_interval, DEFAULTS.checkInterval, 'check_interval', 1, 86_400),
    refreshInterval: num(c.refresh_interval, DEFAULTS.refreshInterval, 'refresh_interval', 1, 3600),
    historySize: num(c.history_size, DEFAULTS.historySize, 'history_size', 1, 200),
    degradedThresholdMs,
    show: {
      description: bool(show.description, true, 'show.description'),
      bars: bool(show.bars, true, 'show.bars'),
      timeLabels: bool(show.time_labels, true, 'show.time_labels'),
    },
    services,
    groups,
  };
}

export function loadConfig(path: string): Config {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ConfigError(
        `no config file at ${path}\n` +
          `Mount one into the container, e.g.\n` +
          `  docker run -v ./config.yaml:/config/config.yaml:ro -p 8080:8080 status-board`,
      );
    }
    throw new ConfigError(`could not read ${path}: ${(err as Error).message}`);
  }
  return parseConfig(source);
}

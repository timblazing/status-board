import type { ServiceConfig } from './config.ts';

/**
 * Resolves a brand logo for each service from svgl.app, so a board watching
 * well-known services shows real vector logos rather than 16px favicons.
 *
 * Lookups happen here, on the server, rather than in each viewer's browser:
 * svgl asks callers to cache instead of re-querying, and a wall display
 * polling every 30s would otherwise re-ask on every load. One request per
 * distinct domain, cached for the life of the process, and never repeated for
 * a domain we've already answered — including one we answered with "no logo".
 */

const API = 'https://api.svgl.app';
const TIMEOUT_MS = 5000;

/** A logo that differs between themes; the client picks per resolved theme. */
export interface IconPair {
  light: string;
  dark: string;
}

/**
 * Cache keyed by the lookup term. `null` is a real, cached answer — "svgl has
 * nothing for this" — so an unmatched domain costs exactly one request per
 * process, not one per config reload.
 */
const cache = new Map<string, IconPair | null>();

/** In-flight lookups, so a reload mid-resolve doesn't fire a second request. */
const pending = new Map<string, Promise<IconPair | null>>();

/**
 * The brand name to search svgl for, derived from the hostname: the
 * registrable label, minus `www.` and any subdomain. `status.grafana.com`
 * and `grafana.com` both look up "grafana".
 */
function brandTerm(hostname: string): string | null {
  const host = hostname.replace(/^www\./, '');
  // Bare hostnames and IPs are internal services; svgl will never have them.
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.endsWith('.local')) return null;

  const parts = host.split('.');
  // Two-part public suffixes (.co.uk, .com.au) put the brand one label further left.
  const suffixLen = parts.length >= 3 && parts.at(-2)!.length <= 3 && parts.at(-1)!.length <= 3 ? 3 : 2;
  const brand = parts.at(-suffixLen);
  return brand && brand.length > 1 ? brand.toLowerCase() : null;
}

/** svgl returns `{error}` with a 200 for a miss, so shape decides, not status. */
function pickRoute(payload: unknown, term: string): IconPair | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  // Prefer an exact title match over a substring one: searching "git" should
  // not hand back "GitHub Copilot" just because it sorted first.
  const entries = payload as Array<{ title?: unknown; route?: unknown }>;
  const exact = entries.find(
    (e) => typeof e.title === 'string' && e.title.toLowerCase() === term,
  );
  const chosen = exact ?? entries[0];
  const route = chosen?.route;

  if (typeof route === 'string') return { light: route, dark: route };
  if (route && typeof route === 'object') {
    const { light, dark } = route as Record<string, unknown>;
    if (typeof light === 'string' && typeof dark === 'string') return { light, dark };
    const only = typeof light === 'string' ? light : typeof dark === 'string' ? dark : null;
    if (only) return { light: only, dark: only };
  }
  return null;
}

async function lookup(term: string): Promise<IconPair | null> {
  try {
    const res = await fetch(`${API}?search=${encodeURIComponent(term)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return pickRoute(await res.json(), term);
  } catch {
    // svgl being slow, blocked or down must never hold up the board: the
    // client falls back to the site's own favicon, then to a monogram.
    return null;
  }
}

function resolve(term: string): Promise<IconPair | null> {
  const inflight = pending.get(term);
  if (inflight) return inflight;

  const promise = lookup(term)
    .then((pair) => {
      cache.set(term, pair);
      return pair;
    })
    .finally(() => pending.delete(term));

  pending.set(term, promise);
  return promise;
}

/**
 * Warms the cache for every service that could have a brand logo. Awaited at
 * startup and fired off after a config reload; failures are already swallowed
 * per-lookup, so this never rejects.
 */
export async function warmIcons(services: ServiceConfig[]): Promise<void> {
  const terms = new Set<string>();
  for (const s of services) {
    if (s.icon) continue; // An explicit icon: URL needs no lookup.
    const term = brandTerm(new URL(s.url).hostname);
    if (term && !cache.has(term)) terms.add(term);
  }
  await Promise.all([...terms].map(resolve));
}

/**
 * The logo for one service, from cache only — snapshots are synchronous and
 * must never block on the network. A domain not yet warmed returns null and
 * picks up its logo on the next poll, once `warmIcons` has landed.
 */
export function iconFor(service: ServiceConfig): IconPair | null {
  if (service.icon) return { light: service.icon, dark: service.icon };
  const term = brandTerm(new URL(service.url).hostname);
  return term ? (cache.get(term) ?? null) : null;
}

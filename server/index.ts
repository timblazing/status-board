import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ConfigError, loadConfig, parseConfig } from './config.ts';
import { Monitor } from './monitor.ts';

const CONFIG_PATH = process.env.CONFIG_PATH ?? '/config/config.yaml';
const STATIC_DIR =
  process.env.STATIC_DIR ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

interface Asset {
  body: Buffer;
  gzip: Buffer | null;
  type: string;
  cacheControl: string;
}

/**
 * The built site is a handful of small files, so it is read into memory once
 * at startup: no per-request disk I/O and no path-traversal surface.
 *
 * Nothing from config.yaml is baked into the HTML — title, theme and favicon
 * all arrive with the first /api/status response and are re-applied on every
 * reload, so editing the config never needs a rebuild or a page refresh.
 */
function loadAssets(dir: string): Map<string, Asset> {
  const assets = new Map<string, Asset>();
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    console.warn(`[status-board] no static assets at ${dir} — serving API only`);
    return assets;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;

    const ext = extname(entry);
    const body = readFileSync(full);

    // Hashed filenames from Vite are immutable; everything else must revalidate.
    const hashed = /-[A-Za-z0-9_-]{8,}\.\w+$/.test(entry);
    assets.set('/' + entry.split('\\').join('/'), {
      body,
      gzip: body.length > 1024 ? gzipSync(body, { level: 9 }) : null,
      type: MIME[ext] ?? 'application/octet-stream',
      cacheControl: hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }
  return assets;
}

/**
 * Applies edits to config.yaml without a restart.
 *
 * Two watchers, because a single one is not reliable: editors that save by
 * writing a temp file and renaming it over the original (vim, and the atomic
 * save most editors default to) leave a file watch pointing at a deleted
 * inode, and a Docker bind mount of a single file behaves the same way. The
 * directory watch catches those; the file watch catches in-place writes on
 * platforms where directory events are coarse.
 *
 * A bad edit is logged and ignored — the board keeps serving the last config
 * that parsed, rather than taking the container down over a typo.
 */
function watchConfig(monitor: Monitor): void {
  const file = resolve(CONFIG_PATH);
  let timer: NodeJS.Timeout | null = null;
  let lastSource: string | null = null;

  try {
    lastSource = readFileSync(file, 'utf8');
  } catch {
    // Already loaded once in main(); a read failure here is not fatal.
  }

  const reload = () => {
    timer = null;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // A rename-based save briefly unlinks the path; the follow-up event
      // after the new file lands is the one that matters.
      if (code !== 'ENOENT') {
        console.error(`[status-board] could not re-read config: ${(err as Error).message}`);
      }
      return;
    }

    // Editors often emit several events per save, and a directory watch fires
    // for sibling files too. Comparing content keeps those from churning
    // history for no reason.
    if (source === lastSource) return;
    lastSource = source;

    let next;
    try {
      next = parseConfig(source);
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(
          `[status-board] config.yaml has an error, keeping the previous config:\n  ${err.message}`,
        );
        return;
      }
      throw err;
    }

    const previousPort = monitor.port;
    monitor.reload(next);
    console.log(
      `[status-board] config reloaded · ${next.services.length} service(s) ` +
        `· checking every ${next.checkInterval}s`,
    );
    if (next.port !== previousPort) {
      console.warn(
        `[status-board] \`port\` changed to ${next.port}; still listening on ${previousPort}. ` +
          `Restart to bind the new port.`,
      );
    }
  };

  // Coalesce the burst of events a single save produces.
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reload, 150);
    timer.unref?.();
  };

  const name = basename(file);
  for (const [target, filter] of [
    [file, null],
    [dirname(file), name],
  ] as const) {
    try {
      const watcher = watch(target, (_event, changed) => {
        if (filter && changed && changed !== filter) return;
        schedule();
      });
      watcher.unref?.();
      // A watched path can vanish under us mid-save; the sibling watcher
      // covers the gap, so this must not be fatal.
      watcher.on('error', () => {});
    } catch (err) {
      console.warn(
        `[status-board] could not watch ${target} for changes: ${(err as Error).message}`,
      );
    }
  }
}

function main(): void {
  let config;
  try {
    config = loadConfig(CONFIG_PATH);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[status-board] configuration error:\n  ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const monitor = new Monitor(config);
  monitor.start();
  watchConfig(monitor);

  const assets = loadAssets(STATIC_DIR);
  const index = assets.get('/index.html');

  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }

    const path = (req.url ?? '/').split('?')[0];

    if (path === '/api/status') {
      const raw = Buffer.from(JSON.stringify(monitor.snapshot()));
      const gzip = raw.length > 512 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
      const body = gzip ? gzipSync(raw) : raw;
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        ...(gzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    // SPA fallback: unknown paths render the board rather than 404ing.
    const asset = assets.get(path) ?? (path === '/' ? index : undefined) ?? index;
    if (!asset) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }

    const wantsGzip = asset.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const body = wantsGzip ? asset.gzip! : asset.body;
    res.writeHead(200, {
      'content-type': asset.type,
      'content-length': body.length,
      'cache-control': asset.cacheControl,
      ...(wantsGzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n[status-board] port ${config.port} is already in use.\n` +
          `  Change \`port:\` in config.yaml, or stop whatever is using it.\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(config.port, () => {
    console.log(
      `[status-board] listening on :${config.port} · ${config.services.length} service(s) ` +
        `· checking every ${config.checkInterval}s`,
    );
  });

  const shutdown = () => {
    monitor.stop();
    server.close(() => process.exit(0));
    // Don't let a lingering keep-alive socket hold the container open.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();

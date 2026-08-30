import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ConfigError, loadConfig } from './config.ts';
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
 */
function loadAssets(dir: string, title: string, theme: string): Map<string, Asset> {
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
    const isHtml = ext === '.html';
    let body = readFileSync(full);

    if (isHtml) {
      // Bake the configured theme and title in so there is no wrong-theme
      // flash and no extra request before first paint.
      body = Buffer.from(
        body
          .toString('utf8')
          .replace('data-theme="system"', `data-theme="${theme}"`)
          .replace('<title>Status</title>', `<title>${escapeHtml(title)}</title>`),
      );
    }

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
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

  const assets = loadAssets(STATIC_DIR, config.title, config.theme);
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

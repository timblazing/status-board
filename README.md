# Status Board

A very small uptime page. It checks that a list of URLs respond, and shows one
card with a bar of recent history, latency and uptime per service.

There is no admin UI, no database and no login — the page *is* the whole app.
Everything is configured in a `config.yaml` you mount into the container.

## Run it

Prebuilt images are published to GitHub Container Registry for `linux/amd64`
and `linux/arm64` (Raspberry Pi 3 and later, on a 64-bit OS):

```bash
curl -O https://raw.githubusercontent.com/timblazing/status-board/main/config.example.yaml
mv config.example.yaml config.yaml   # then edit it

docker run -d --name status-board \
  -p 8080:8080 \
  -v "$PWD/config.yaml:/config/config.yaml:ro" \
  ghcr.io/timblazing/status-board:latest
```

Or build it yourself:

```bash
cp config.example.yaml config.yaml   # then edit it
docker compose up -d
```

Open <http://localhost:8080>.

## Configuration

The only required key is `services`. Everything else has a default:

```yaml
services:
  - name: My Site
    url: https://example.com
```

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | `Status` | Heading and browser tab title |
| `theme` | `system` | `dark`, `light` or `system` |
| `port` | `8080` | Port inside the container |
| `check_interval` | `30` | Seconds between checks of each service |
| `refresh_interval` | `5` | Seconds between browser refreshes |
| `history_size` | `30` | Number of bars kept per service |
| `degraded_threshold_ms` | `1000` | Slower than this while up = Degraded |
| `show.description` | `true` | Show the line under each service name |
| `show.bars` | `true` | Show the history bars |
| `show.time_labels` | `true` | Show the `15m … now` labels under the bars |

Per service: `name` and `url` are required. `description` sets the line under
the name and falls back to the URL when omitted. `timeout` (ms, default
`10000`), `expected_status` (default any 2xx/3xx), `degraded_threshold_ms` and
`headers` are optional.

Each service name is followed by a badge with that service's uptime percentage,
tinted by state — green operational, amber degraded, red down. When a service
has no `description`, the URL is shown instead and links to the service in a new
tab. Under the history bars, the left label is how far back the retained checks
reach and the right is always `now`.

Services can optionally be grouped:

```yaml
groups:
  - name: Core
    services: [API, Web App]
```

See `config.example.yaml` for a fully commented file.

## How a service is graded

Each check is a `GET` that follows redirects, with a per-service timeout.

- **Operational** — the last check passed, and no failures in the retained window.
- **Degraded** — up right now, but slower than `degraded_threshold_ms`, or there
  is at least one failure in the retained window.
- **Down** — the last check failed: a non-matching status, a timeout, or a
  connection/DNS/TLS error.

Uptime % is computed over the checks actually recorded, so it is honest about a
board that has only been running for a minute. History lives in memory only and
resets when the container restarts.

## Notes

- Changing `config.yaml` requires a restart: `docker compose restart`.
- The page polls `/api/status`, which returns the whole board as JSON. Polling
  pauses while the browser tab is hidden.
- If you change `port`, set `HEALTHCHECK_PORT` to match so Docker's healthcheck
  keeps working.
- There is no 32-bit ARM (`armv7`) image, because Node 24 does not publish one.
  A Raspberry Pi needs a 64-bit OS — the default on Pi 3 and later.

## Development

```bash
npm install
cp config.example.yaml config.yaml
npm run dev          # Vite on :5173, API proxied from :8080
```

`npm run build` emits the static site to `dist/` and the bundled server to
`dist-server/`; `npm start` serves both.

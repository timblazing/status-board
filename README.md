# Status Board

A very small uptime page. It checks that a list of URLs respond, and shows one
card with a bar of recent history, latency and uptime per service.

There is no admin UI, no database and no login — the page *is* the whole app.
Everything is configured in a `config.yaml` you mount into the container.

## Run it

Prebuilt images are published to GitHub Container Registry for `linux/amd64`
and `linux/arm64` (Raspberry Pi 3 and later, on a 64-bit OS):

```bash
mkdir -p config
curl -o config/config.yaml \
  https://raw.githubusercontent.com/timblazing/status-board/main/config.example.yaml
# then edit config/config.yaml

# Mount the directory, not the file — see the note under Configuration.
docker run -d --name status-board \
  -p 8080:8080 \
  -v "$PWD/config:/config:ro" \
  ghcr.io/timblazing/status-board:latest
```

Or build it yourself:

```bash
mkdir -p config
cp config.example.yaml config/config.yaml   # then edit it
docker compose up -d
```

Open <http://localhost:8080>.

## Configuration

The board watches this file: save a change and it applies within a second,
without restarting the container or refreshing the page.

Mount the *directory* that holds `config.yaml`, not the file itself. Editors
that save by writing a temp file and renaming it over the original swap the
file's inode; a single-file bind mount keeps pointing at the old one, and the
container stops seeing the file at all. `docker-compose.yml` already does this.

The only required key is `services`. Everything else has a default:

```yaml
services:
  - name: My Site
    url: https://example.com
```

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | `Status` | Heading and browser tab title |
| `favicon` | built-in | URL of an image to use as the tab icon |
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

By default the tab icon is a green activity glyph. Point `favicon` at any image
URL to replace it:

```yaml
favicon: https://example.com/logo.png
```

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

Across a config reload a service keeps its history as long as its name and what
it actually probes (`url`, `timeout`, `expected_status`, `degraded_threshold_ms`
and `headers`) are unchanged — so editing a `description` or reordering the list
costs nothing. Renaming a service, pointing it somewhere else or changing
`history_size` starts its history over, because the old bars would no longer
describe the new check.

## Notes

- Changing `config.yaml` applies immediately — the file is watched, and open
  tabs pick the change up on their next poll. No restart, no refresh. The one
  exception is `port`, which needs a restart to bind; a warning is logged if you
  change it. A config that fails to parse is logged and ignored, and the board
  keeps running on the last good one.
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

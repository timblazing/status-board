# Plan 001: Establish Node test and CI verification baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fadc48c..HEAD -- package.json .github/workflows/docker.yml server/*.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `fadc48c`, 2026-08-31

## Why this matters

The repository currently has a passing typecheck and production build, but no
test script, no test files, and no CI step that runs either typecheck or tests.
That leaves configuration parsing, monitor state transitions, and future fixes
without an executable regression contract. This plan adds tests using the
Node 24 test runner already available in the Docker image, so it does not add a
test framework dependency or alter the runtime bundle.

## Current state

- `package.json` — package metadata and scripts. The only static verification
  script is currently `"typecheck": "tsc --noEmit"` at lines 6–11.
- `server/config.ts` — pure YAML-to-`Config` parser and file loader.
- `server/monitor.ts` — service probe scheduler, history ring, state derivation,
  and aggregate snapshot.
- `.github/workflows/docker.yml` — Docker image build/publish workflow; it does
  not currently install Node on the runner or run project checks outside the
  image build.

The current script block is:

```json
"scripts": {
  "dev": "node --run dev:server & vite",
  "dev:server": "node --experimental-strip-types --watch server/index.ts",
  "build": "vite build && node build-server.mjs",
  "start": "node dist-server/index.js",
  "typecheck": "tsc --noEmit"
}
```

The runtime image is explicitly based on Node 24 (`Dockerfile:2,27`), and the
source already runs TypeScript directly with
`node --experimental-strip-types` (`package.json:8`). Use `node:test` and
`node:assert/strict`; do not introduce Vitest, Jest, or a browser test stack for
this baseline.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Tests | `npm test` | exit 0, all tests pass |
| Build | `npm run build` | Vite and server bundle complete successfully |
| Dependency audit | `npm audit --audit-level=high` | zero high/critical vulnerabilities |

## Scope

**In scope (the only files to modify):**

- `package.json`
- `server/config.test.ts` (create)
- `server/monitor.test.ts` (create)
- `.github/workflows/docker.yml`

**Out of scope:**

- `server/config.ts` and `server/monitor.ts` implementation behavior; later
  plans own those changes.
- Any web component, CSS, Dockerfile, package-lock, or production dependency.
- Adding a lint tool or changing the public API response shape.

## Steps

### Step 1: Add the built-in Node test command

Add a `test` script to `package.json`:

```json
"test": "node --experimental-strip-types --test server/*.test.ts"
```

Keep all existing scripts and dependency versions unchanged. The shell glob
must remain limited to `server/*.test.ts`, because the intended tests exercise
server behavior without importing `server/index.ts`, whose module-level `main()`
starts an HTTP server.

**Verify**: after Step 2, `npm test` → the new test files are discovered and all
tests pass. Do not rely on a no-test glob match as an intermediate success
signal.

### Step 2: Add parser characterization tests

Create `server/config.test.ts` using `node:test`, `node:assert/strict`, and
`parseConfig` from `./config.ts`. Keep fixtures as short YAML strings. Cover:

1. Minimal valid configuration applies defaults (`title`, intervals,
   `historySize`, timeout, HTTP status range, and `show` values).
2. A service with a custom description and expected status list preserves the
   trimmed name/description and parsed status values.
3. An invalid scheme, missing service name, duplicate service name, and
   unknown grouped service each throw `ConfigError` with a useful message.
4. A valid grouped configuration produces the expected group-to-service names.

Use `assert.throws` with predicates or message matching; do not assert private
implementation details or exact YAML parser wording. Import `ConfigError` so
the tests distinguish intended config failures from unrelated exceptions.

**Verify**: `node --experimental-strip-types --test server/config.test.ts` →
all parser tests pass.

### Step 3: Add monitor characterization tests

Create `server/monitor.test.ts` using `node:test`, `node:assert/strict`, and
the Node `http` module only. Import `Monitor` from `./monitor.ts` and build
valid configs through `parseConfig` rather than duplicating the `Config`
interface by hand.

Start a loopback HTTP server in the test that returns a chosen status, point a
parsed service at its URL, construct `new Monitor(config)`, and inspect
`monitor.snapshot()` before and after the first probe. Ensure every started
monitor is stopped and every HTTP server is closed in `finally` blocks.
Characterize at least:

1. Before a probe, the service is `pending`, `uptimePct` is `null`, and the
   aggregate total is correct.
2. A 2xx response becomes `operational`, increments `healthy`, and records an
   `o` history slot.
3. A non-expected status becomes `down` and records an `x` history slot.
4. A configured degraded threshold marks a slow successful response as
   `degraded` without counting it as healthy.

Use a short test interval only where needed and await observable state with a
bounded polling helper rather than an unbounded sleep. Do not test the exact
wall-clock timestamp or icon network lookup in this baseline.

**Verify**: `node --experimental-strip-types --test server/monitor.test.ts` →
all monitor tests pass and
the command exits 0 without leaving a listening port.

### Step 4: Make CI run the baseline checks

Update `.github/workflows/docker.yml` after checkout to set up Node 24 and run
the checks before the Docker build. Use the existing npm lockfile:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 24
- name: Verify source
  run: npm ci && npm run typecheck && npm test
```

Keep the existing Docker Buildx, registry permissions, tags, platforms, and
publish behavior unchanged. The CI command is intentionally separate from the
Docker build so a type or test failure is reported directly.

**Verify**: `npm run typecheck && npm test && npm run build` → all commands
exit 0. Also inspect `git diff -- .github/workflows/docker.yml` and confirm the
verification step appears before `docker/build-push-action@v6`.

## Test plan

- `server/config.test.ts`: defaulting, valid parsing, and representative
  validation failures.
- `server/monitor.test.ts`: pending, operational, down, degraded, history,
  and aggregate counts using loopback HTTP responses.
- Pattern: Node 24 built-in `node:test`; there is no existing test file to
  copy. Tests must use `finally` cleanup for monitors and servers.
- Verification: `npm run typecheck && npm test && npm run build` → exit 0.

## Done criteria

- [ ] `package.json` contains the exact `npm test` command above.
- [ ] `server/config.test.ts` and `server/monitor.test.ts` exist and pass.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` exits 0.
- [ ] `npm run build` exits 0.
- [ ] CI runs Node 24, `npm ci`, typecheck, and tests before Docker build.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row is updated to `DONE`.

## STOP conditions

- Stop if the Node test runner cannot execute `.ts` files with the repository's
  Node 24 command without adding a dependency; report the exact error instead
  of silently switching frameworks.
- Stop if a monitor test requires importing `server/index.ts`; that import has a
  module-level server startup and the test must be redesigned around
  `server/monitor.ts`.
- Stop if the test requires changing production source behavior; leave that to
  Plans 002 or 003 and report the required seam.
- Stop if CI requires changing Docker publishing or permissions to add the
  verification step.

## Maintenance notes

Future monitor changes must preserve deterministic cleanup and bounded waits in
the integration tests. Reviewers should reject tests that depend on external
URLs, real svgl responses, or exact timing beyond the bounded scheduler test in
Plan 002. If a lint tool is added later, add it as a separate plan rather than
expanding this baseline silently.

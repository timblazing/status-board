# Plan 002: Prevent overlapping service probes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fadc48c..HEAD -- server/monitor.ts server/monitor.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-test-and-ci-baseline.md`
- **Category**: bug
- **Planned at**: commit `fadc48c`, 2026-08-31

## Why this matters

Each `ServiceMonitor` starts a new asynchronous fetch from a fixed interval,
without waiting for the previous fetch to finish. The configuration allows a
1-second check interval and a 120-second timeout, so a slow or stalled endpoint
can have many probes in flight simultaneously. Their completions are recorded
in completion order, not probe-start order, which can produce misleading bars,
uptime timing, and current state while consuming unnecessary sockets and
resources.

## Current state

- `server/monitor.ts` — owns the per-service timer, fetch, history ring, and
  state snapshot.
- `server/monitor.test.ts` — created by Plan 001; extend its loopback-server
  tests for this regression.

The scheduler currently launches without awaiting:

```ts
this.startTimer = setTimeout(() => {
  void this.check();
  this.timer = setInterval(() => void this.check(), period);
}, offsetMs);
```

The check method performs the network request and records whichever result
finishes:

```ts
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
    await res.body?.cancel();
    // status grading and this.record(...) follow
  } catch {
    this.record({ ok: false, slow: false });
  }
}
```

`stop()` currently clears the timers but has no in-flight guard (`lines
54–59`), and `reload()` stops/restarts carried monitors (`lines 253–261`). The
fix must therefore also behave correctly when a monitor is stopped and started
again during an existing request.

Repository conventions: errors from a probe are intentionally collapsed to a
down record (`server/monitor.ts:101-104`); preserve that behavior. Keep the
public `StatusSnapshot` and `ServiceStatus` shapes in `server/types.ts`
unchanged.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Regression test | `node --experimental-strip-types --test server/monitor.test.ts` | all monitor tests pass |
| Full tests | `npm test` | all tests pass |
| Build | `npm run build` | Vite and server bundle complete successfully |

## Scope

**In scope (the only files to modify):**

- `server/monitor.ts`
- `server/monitor.test.ts`

**Out of scope:**

- `server/config.ts`; Plan 003 owns numeric validation.
- `server/index.ts`, the HTTP API, frontend polling, icon lookup, and Docker
  behavior.
- Changing the configured interval/timeout limits or public response shape.

## Steps

### Step 1: Add an explicit per-monitor in-flight guard

Add private state to `ServiceMonitor` that records whether a check is currently
running. At the start of `check()`, return immediately when a previous check is
still active. Set the guard before the first `await`, and clear it in a `finally`
block that surrounds the existing `try/catch` probe logic.

The intended invariant is: at most one invocation may be inside the network
request and result-recording portion of `check()` for a given monitor. Keep the
existing `setInterval` staggering and timer cleanup; skipped interval ticks
must not create another request. Preserve the current behavior that every
fetch error records `{ ok: false, slow: false }`.

Do not abort an in-flight fetch merely because `stop()` is called: the existing
`AbortSignal.timeout(timeout)` remains the request lifetime boundary, and the
guard prevents a restart from creating a second concurrent probe. If a future
change needs immediate cancellation, it requires a separate lifecycle design.

**Verify**: `npm run typecheck` → exit 0 with no errors.

### Step 2: Add a deterministic overlap regression test

Extend `server/monitor.test.ts` with a loopback HTTP handler that:

1. increments an `inFlight` counter and updates `maxInFlight`;
2. waits approximately 1.6 seconds before responding 200;
3. decrements the counter in a `finally` block before ending the response.

Use a parsed config with `check_interval: 1`, a timeout comfortably above the
handler delay, one service, and no degraded threshold. Start the monitor with
its normal scheduler, wait until at least the first request has completed and
the scheduler has had an opportunity to launch a second tick, then stop the
monitor and close the server in `finally`. Assert `maxInFlight === 1`.

Use a bounded polling helper with an overall timeout; do not use an unbounded
sleep or an external endpoint. The test may take a little over two seconds,
which is acceptable for a single scheduler regression test. Also preserve the
Plan 001 tests and ensure the server is closed even when an assertion fails.

**Verify**: `node --experimental-strip-types --test server/monitor.test.ts` →
the overlap test and all existing monitor tests pass; no process remains
listening after the command.

### Step 3: Verify lifecycle and behavior boundaries

Review the implementation and test these existing behaviors without changing
their semantics: a successful response records `o`, a failed status records
`x`, a timeout records down, and `reload()` can stop/restart a carried monitor.
If needed, add a focused test that calls `monitor.stop()` while the delayed
request is active and confirms no second request begins after restart until the
original request completes.

Do not add a queue, retry policy, concurrency pool, or history merge. The
required fix is one active probe per service; interval ticks skipped during a
probe are intentionally not replayed.

**Verify**: `npm run typecheck && npm test && npm run build` → all commands
exit 0.

## Test plan

- Extend `server/monitor.test.ts` from Plan 001.
- Regression case: delayed endpoint with 1-second interval must never exceed
  one active request.
- Lifecycle case: stopping and restarting during a request must not create an
  overlapping request.
- Preserve existing status/history cases from Plan 001.
- Verification: `npm test` → all tests pass.

## Done criteria

- [ ] `ServiceMonitor` never has more than one active `check()` probe.
- [ ] The guard is cleared on both successful and failed requests.
- [ ] A delayed loopback endpoint test asserts `maxInFlight === 1`.
- [ ] Existing status, history, timeout, and reload behavior remains covered.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` exits 0.
- [ ] `npm run build` exits 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row is updated to `DONE`.

## STOP conditions

- Stop if the code has moved from `setInterval` to a different scheduler and
  the cited overlap mechanism no longer exists.
- Stop if enforcing one active probe requires changing the public API contract,
  adding a retry policy, or changing interval/timeout limits.
- Stop if the regression test is flaky across three local runs; report timing
  evidence and do not weaken the assertion to permit concurrency.
- Stop if a failed request can bypass the new cleanup path; report before
  changing error semantics.

## Maintenance notes

The one-probe invariant depends on the fact that each service has one
`ServiceMonitor`. If monitoring is later parallelized or a queue is introduced,
the guard must move into the new scheduler's concurrency policy. Reviewers
should inspect every `await` in `check()` and verify that the active flag is set
before it and cleared in `finally`.

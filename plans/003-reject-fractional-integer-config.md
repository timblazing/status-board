# Plan 003: Reject fractional integer configuration values

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fadc48c..HEAD -- server/config.ts server/config.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-test-and-ci-baseline.md`
- **Category**: bug
- **Planned at**: commit `fadc48c`, 2026-08-31

## Why this matters

The generic numeric validator checks finiteness and range but not integrality.
That allows `history_size: 1.5` through parsing, after which the monitor
constructor calls `new Array(1.5)` and throws a raw `RangeError`. A malformed
initial file can therefore crash startup, and a malformed hot-reloaded file can
crash the reload callback instead of being handled as the documented
configuration error. Port values are also discrete by contract and should not
accept fractions.

## Current state

- `server/config.ts` — validates YAML and constructs `Config` and
  `ServiceConfig` objects.
- `server/config.test.ts` — created by Plan 001; extend it with parser
  regression cases.
- `server/monitor.ts` — allocates the fixed-size history ring from
  `config.historySize`.

Current generic numeric validation:

```ts
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
```

The affected calls are `port` at `server/config.ts:208` and `historySize` at
`server/config.ts:211`. `checkInterval`, `refreshInterval`, timeouts, and
latency thresholds may remain fractional because the current implementation
can represent sub-second durations and the existing public documentation does
not promise integer-only seconds/milliseconds for those fields. The existing
`expected_status` parser already enforces integers at `server/config.ts:106-109`;
retain that behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Parser tests | `node --experimental-strip-types --test server/config.test.ts` | all parser tests pass |
| Full tests | `npm test` | all tests pass |
| Build | `npm run build` | Vite and server bundle complete successfully |

## Scope

**In scope (the only files to modify):**

- `server/config.ts`
- `server/config.test.ts`

**Out of scope:**

- `server/monitor.ts`; validation must prevent the invalid value before the
  constructor receives it.
- Changing numeric ranges, default values, hot-reload behavior, or public API
  fields.
- Adding a schema library or changing YAML dependency versions.

## Steps

### Step 1: Make integer requirements explicit in the numeric validator

Extend `num` with a clear integer requirement, either as an optional boolean
parameter or a small dedicated helper that delegates to `num`. Use it for
`port` and `history_size` only. The error must be a `ConfigError` with a field
label and a message that states the value must be an integer; do not allow a
fraction to fall through to the range check or a later constructor.

Preserve the current defaults, min/max bounds, and error wording for fields
that remain on the generic number path. Keep the implementation TypeScript
strict-mode compatible and avoid a broad schema rewrite.

**Verify**: `npm run typecheck` → exit 0 with no errors.

### Step 2: Add regression tests for parser rejection

Extend `server/config.test.ts` with `assert.throws` cases proving that:

1. `history_size: 1.5` throws `ConfigError`, not `RangeError`.
2. `port: 8080.5` throws `ConfigError`.
3. Integer `history_size` and `port` values still parse successfully.
4. Existing fractional duration behavior, if already covered or accepted by
   the current parser, is unchanged.

Check the error class and a stable message fragment such as `history_size` or
`port`; do not assert the entire string if it duplicates incidental formatting.
Do not construct `Monitor` in these parser tests—the regression is that invalid
input is rejected before monitor allocation.

**Verify**: `node --experimental-strip-types --test server/config.test.ts` →
all parser tests pass, including the two fractional-value regressions.

### Step 3: Run the full verification gate

Run the full test suite and production build. Confirm that valid example
configuration from `config.example.yaml` still parses and that no source file
outside this plan's scope changed.

**Verify**: `npm run typecheck && npm test && npm run build` → all commands exit
0.

## Test plan

- Extend `server/config.test.ts` from Plan 001.
- Cover rejection of fractional `history_size` and `port` as `ConfigError`.
- Cover acceptance of valid integer values and preservation of other numeric
  defaults/behavior.
- Verification: `npm test` → all tests pass.

## Done criteria

- [ ] Fractional `history_size` is rejected by `parseConfig` with `ConfigError`.
- [ ] Fractional `port` is rejected by `parseConfig` with `ConfigError`.
- [ ] Valid integer port/history values still parse.
- [ ] No raw `RangeError` can result from a fractional `history_size` accepted
  by `parseConfig`.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` exits 0.
- [ ] `npm run build` exits 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row is updated to `DONE`.

## STOP conditions

- Stop if `num` or the affected call sites have changed so the cited integer
  boundary is no longer accurate.
- Stop if rejecting fractional values requires changing the documented ranges
  or defaults; report the conflict instead of changing documentation.
- Stop if an existing test demonstrates that fractional `port` or
  `history_size` is an intentional supported feature; report that evidence.
- Stop if the fix requires touching `server/monitor.ts` or another out-of-scope
  file.

## Maintenance notes

When adding future discrete configuration fields, use the same integer
validation path rather than relying on downstream constructors or Node APIs to
coerce values. Reviewers should verify that every value used as an array length,
port, count, or index has an explicit integer contract; duration fields should
remain separate when fractional timing is useful.

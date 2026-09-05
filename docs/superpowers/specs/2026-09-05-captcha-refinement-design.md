# Captcha Refinement — Design Spec

**Date:** 2026-09-05
**Status:** approved
**Phase:** diagnosis only. No production behaviour changes in this spec.

## Summary

G2's challenge solves roughly one attempt in four. This spec builds the instrument that
says *why*, because the four candidate explanations imply four different fixes and nothing
currently recorded can tell them apart.

It deliberately stops at diagnosis. `fan.ts`, `settleText` and `hasSettled` are frozen
until the run reports.

## Motivation

### The impatience explanation is already dead

The obvious reading — that the extractor gives up before the solver finishes — was true of
the original six-attempt poll (~4.2s) and is **not** true of what is on `main` now:

```ts
export function hasSettled(previous: string, current: string, waitThroughChallenge: boolean): boolean {
  if (current.length === 0 || current.length !== previous.length) return false
  ...
}
```

Every failed G2 attempt recorded `textLen: 0`. With zero characters `hasSettled` never
returns `true`, so the loop cannot short-circuit: it runs all 60 attempts and returns `""`.

**We already wait the full 42 seconds on every G2 failure.** Three times in four, 42
seconds of waiting produced zero characters. "Be more patient" is therefore not an
established fix, and any plan that assumes it is would be building on the same kind of
reasoning that produced the `smart` default.

### What the instrument cannot currently see

| unknown | why it matters |
|---|---|
| How long the successful solve took | No timing is captured anywhere. If it landed at 8s the 42s budget is ample; if at 41s it is marginal. Without this, "raise the budget" is unfalsifiable. |
| What the 2,669-character failure page is | Only `htmlLen` is stored, never the HTML. A challenge shell, a bare 403, and a JS stub that never executed are identical at that length. |
| Whether a solve was ever attempted | Solari surfaces no solve signal and the probe asks for none. |
| Whether n=4 means anything | All four attempts ran within minutes on the same static pool — as consistent with per-IP throttling as with a coin-flip solver. |

Four unknowns, four different remedies. Choosing among them by inspection is precisely the
error this project has already made twice: once reading a length as "no challenge widget"
when it was a challenge, and once reading a page load as proof of a proxy.

## Scope

**In scope:** one new paid eval script; per-attempt timing; a poll-by-poll trace; a
challenge-vendor fingerprint; a truncated HTML sample; a schedule that spreads attempts
across an hour; two pure helpers with unit tests; one committed report.

**Out of scope:** every production change. No retry policy, no budget change, no
`settleText` edit, no new `FailureReason`. Also out of scope: varying the proxy tier
(`us:mobile` was considered and deferred), Reddit (a separate route — its challenge does
not solve at all and pressing it produces rate limiting), and any G2 source-plan change.

## Architecture

One new file, `src/eval/captcha.ts`, standalone in the manner of `src/eval/yield.ts` and
`src/eval/egress.ts`. It spends money and CI never runs it.

The alternative of extending `egress.ts` was rejected: that script's shape is *vary the
config, hold time constant*, and this needs the inverse. Extracting a shared probe module
was also rejected as premature — parameterising one function to serve both "vary config"
and "vary time, trace every poll" yields something worse than either. If a third probe
appears, extract then.

### What each attempt records

```ts
interface Attempt {
  attempt: number
  startedAt: string
  totalMs: number
  /** Text and HTML size at each poll. The load-bearing field: see below. */
  pollTrace: { tMs: number; textLen: number; htmlLen: number }[]
  /** Challenge vendor named from iframe/script srcs, or null if none matched. */
  challenge: string | null
  /** First 4,000 characters of the final HTML. Only a length was ever stored before. */
  htmlSample: string
  outcome: FailureReason | "ok"
  /** The trace's shape, so the report interprets itself rather than needing a reader. */
  traceShape: "flat" | "late-arrival" | "cut-off" | "immediate"
  /** readEgress confirmation, so this run cannot repeat the `smart` mistake. */
  egress: Egress
  /** Present instead of the above when the attempt threw. */
  error?: string
}
```

**The poll trace is what makes the run decisive.** A failure today is a single number,
`0`, which cannot distinguish *the solve never fired* from *the solve was progressing when
the budget expired*. Text length sampled across the full 42 seconds separates those on
sight, and they imply opposite fixes.

### Hypotheses, recorded before the run

Written in advance so a result cannot be rationalised into whichever answer is convenient.

| hypothesis | predicted signature | implied fix |
|---|---|---|
| Coin-flip solver | successes scatter across the hour, no relation to spacing | bounded retries |
| Throttling | outcome tracks recency of the previous attempt; the bunched original four look worse than spread ones | pacing — and retries would make it *worse* |
| Solve is slow | successful traces show text arriving late (>30s); failed traces show movement that got cut off | raise the budget |
| Solve never fires | failed traces are flat zero end to end; fingerprint names a vendor Solari covers only "on a site-by-site basis" | abandon the route; keep `not read` |

A null result — no signature matching any of these — is recorded as a null result.

### The poll budget is production's, deliberately

The probe polls on the same schedule `settleText` uses with a solver running — 60 attempts
at 700ms, the full 42 seconds — and does not raise it. A probe with a different budget
would measure a system nobody runs, and its timings would not transfer to the fix. If the
evidence says the budget is the binding constraint, raising it is a *finding* of this run,
not a premise of it.

### Schedule and output

Eight attempts about seven minutes apart, roughly an hour, all configurable by argv.
Serial, one browser at a time, so no attempt's pressure on the host is attributed to
another.

Output to `reports/captcha-probe-2026-09-05.json`, committed. The HTML sample is truncated
to 4,000 characters so the report stays commit-sized — the one successful G2 page was
848KB, which is evidence worth summarising, not worth storing.

## Testing

Two pure helpers carry the logic worth testing, following the pattern `fan.ts` already uses
for `classifyFailure` and `hasSettled`:

- **`fingerprintChallenge(html: string): string | null`** — given page HTML, name the
  vendor (datadome, hcaptcha, recaptcha, turnstile, perimeterx) or return `null`. Table
  tests over representative markup, including that ordinary prose mentioning a vendor's
  name does not produce a match.
- **`classifyTrace(trace): "flat" | "late-arrival" | "cut-off" | "immediate"`** — given a
  poll trace, name its shape. Table tests: all zeros is `flat`; zeros then growth ending
  stable is `late-arrival`; growth still rising at the final sample is `cut-off`; non-zero
  from the first sample is `immediate`.

The script itself is not tested. It spends money, as `yield.ts` and `egress.ts` do.

## Error handling

An attempt that throws records its `error` and the schedule continues. One bad attempt must
not cost the other seven — the same invariant the fan already holds, that one refused
source never fails a run.

The evaluate-across-navigation race is already understood: a successful solve navigates,
and an `evaluate` in flight throws "Execution context was destroyed". The probe swallows
that and reads again rather than recording a failure, because it is the signature of the
one outcome being waited for.

## Definition of done

- Eight attempts recorded with timing, poll traces, fingerprints and HTML samples.
- The report is committed.
- One hypothesis from the table above is identified as consistent with the evidence, or
  the absence of a match is recorded as a null result.
- No production file is modified by this spec.

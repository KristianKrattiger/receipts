# Captcha Refinement — Design Spec

**Date:** 2026-09-05
**Status:** approved
**Phase:** diagnosis only. No production behaviour changes in this spec.
**Outcome:** the run disproved this document's own premise — see
[Findings](#findings--2026-09-05). Everything above that section states what was believed
*before* the run, and is kept as written so the change of mind is legible.

## Summary

G2's challenge was believed to solve roughly one attempt in four. This spec builds the instrument that
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

---

## Findings — 2026-09-05

Run: `reports/captcha-probe-2026-09-05.json`. Eight attempts, 7.8 minutes apart, 55.7 minutes
end to end.

**Validity, checked before interpreting:** all 8 attempts confirmed `egress.proxy` present
(`us/static`); all 8 recorded the full 60 poll samples; zero attempt errors; zero
`pollErrors`; zero `navigationGaps`. The run is usable, and the deferred worry about
`NAVIGATION_ERRORS` misfiling a crash as a navigation is moot — there were none of either.

### Result: 0 successes in 8

| attempt | outcome | shape | challenge | max text | max html |
|---|---|---|---|---|---|
| 1–8 (all identical) | `empty` | `flat` | **datadome** | 0 | 2,669 |

`maxHtml` was **2,669 on every one of 480 samples**. The page did not change by a single
byte in an hour.

### What the page actually is

The HTML sample settles the question the project has been guessing at since the beginning:

```html
<title>g2.com</title>
<iframe src="https://geo.captcha-delivery.com/interstitial/?initialCid=…"
        title="DataDome Device Check" …>
<script src="https://ct.captcha-delivery.com/i.js">
```

G2 is fronted by **DataDome**, and the challenge runs inside a **cross-origin iframe** on
`geo.captcha-delivery.com`. A second layer is present too: the page injects Cloudflare's
`/cdn-cgi/challenge-platform/scripts/jsd/main.js`. Solari's documentation covers DataDome
only "on a site-by-site basis", which is consistent with it going unsolved here.

### Which hypothesis survived — and the one the instrument cannot decide

**Recency-based throttling: ruled out. Egress-reputation throttling: untested.** Spacing
attempts eight minutes apart changed nothing, which rules out throttling keyed to how
recently we last asked. It does not rule out a durable reputation block on the exit itself:
all eight attempts used `us:static`, so egress was held fixed while only time varied. A
byte-identical interstitial for 56 straight minutes fits a flagged exit at least as well as
it fits an unsolvable challenge — and `Egress` records country, tier and timezone but not
the exit IP, so this record cannot tell them apart.

**Slow solve: ruled out.** No attempt showed any movement to be cut off.

**Coin-flip solver: weakened, not refuted.** At the 25% rate the earlier evidence implied,
0 successes in 8 has probability 0.75⁸ ≈ 0.10 — uncomfortable for that rate, but not
significant. Pooling the runs to 1-in-12 would not settle it either, and would be doubly
unsound: the first four attempts are the ones that *generated* the 25% figure, and one of
them predates the navigation-tolerance fix, so its instrument could not have recorded a
success had one occurred. The decision below does not rest on this — the cost argument
carries it alone.

**"The solve never fires": consistent with the evidence, but NOT established — and the
reason is a defect in this instrument.**

The poll reads `document.body.innerText` and `documentElement.outerHTML` of the **top**
document. The challenge is in a cross-origin iframe, so everything the solver might be doing
is invisible to the trace by construction. A `flat` shape here does not mean *nothing
happened*; it means *nothing we can see happened*. The top frame is stable at 2,669 bytes
whether the solve was never attempted or was attempted and never finished.

What the run does establish is narrower and still decisive for the decision at hand: **the
solve never *completed* in any of 8 attempts.** A completed solve navigates the top frame —
that is how the one historical success was observed, at 848KB — and the top frame never
navigated.

This is the same error the project has now made three times: reading a measurement as
though it covered something it structurally could not see. It is recorded here rather than
papered over, and `classifyTrace`'s `flat` label should be read as "top-document flat", not
"inert".

### The rate this project has been publishing is wrong

The README says G2 "solves about one attempt in four". That came from one success in four.
The record is now **1 success in 12**, and the 8 controlled attempts produced none. The
claim is not supported and must be corrected.

### Decision

**Do not build a retry policy for G2.** Retries were the remedy the coin-flip hypothesis
implied, and that hypothesis is the one the evidence most clearly weakens. Twelve attempts
for one success is not a source a ledger can rely on, and eight paid attempts to read one
review page is not a trade worth making.

**G2 stays `not read`, with the reason corrected from a captcha that mostly solves to a
DataDome device check that does not.** The `not read` column does its job here.

Reopening this would need one of: a rerun on a different egress — `us:mobile`, the tier
Solari documents for "the toughest targets that block residential IPs", which this spec
deferred and which is much the cheapest of the three; Solari adding site-specific DataDome
coverage for G2; or an instrument that can see inside the challenge iframe well enough to
say whether a solve is being attempted at all.

Known limitation left in place: `writeReport` overwrites the whole accumulated array with a
plain `writeFileSync` rather than writing to a temporary file and renaming, so a process
death mid-write could truncate it. The exposure is one short synchronous write per attempt
rather than the whole hour, but it should be closed before any rerun.

---

## Findings — mobile tier, 2026-09-05

Run: `reports/captcha-probe-2026-09-05-us-mobile.json`. Eight attempts, 7 minutes apart,
`us:mobile`. Compared against the `us:static` baseline in
`reports/captcha-probe-2026-09-05.json`, which is untouched.

**Validity:** all 8 attempts confirmed `egress.proxy.tier === "mobile"` — the tier under test
was actually delivered, not silently defaulted. All 8 recorded the full 60 poll samples. Zero
`pollErrors`, zero `navigationGaps`, zero attempt errors. Usable.

### Both tiers fail, and they fail differently

| | `us:static` | `us:mobile` |
|---|---|---|
| attempts | 8 | 8 |
| **reads** | **0** | **0** |
| max text | 0 | 43 |
| max html | 2,669 | 1,904 |
| trace shape | `flat` | `immediate` |
| fingerprint | datadome | datadome |
| DataDome interstitial iframe | **present** | **absent** |
| what our browser rendered | *DataDome Device Check* interstitial | the `cmsg` fallback, un-swapped |
| DataDome bootstrap (`rt`/`hsh`/`b`/`s`) | identical | identical |

Both figures were constant across all 60 samples of all 8 attempts in both runs. Neither page
moved a byte in an hour.

**The difference is in our rendering, not in DataDome's answer.** Both runs carry an
identical DataDome bootstrap — `'rt':'i'`, `'hsh':'229542D5C186C7F5A5BB092FBDD92B'`,
`'b':1648239`, `'s':48636` — with only the per-session `cid` and `e` differing. DataDome
returned the same verdict, with the same rule set, on both tiers. What differed is what
happened next in our browser: the `ct.captcha-delivery.com/i.js` loader replaced the
`<p id="cmsg">` fallback with the interstitial iframe on `us:static`, and did not on
`us:mobile`, leaving its 43-character "Please enable JS and disable any ad blocker" text in
place.

Which of those two it was — DataDome declining to escalate, or `i.js` failing or being
blocked in our browser — this instrument cannot say. It records neither network requests nor
console errors, and the prior Findings already note it cannot see inside the challenge
iframe. An earlier draft of this section asserted that DataDome "serves its pre-challenge
stub instead", which is a server-side decision the bytes contradict. It is corrected here
rather than quietly amended: reading a client-side difference as a server-side one is the
same class of error this project has now made four times.

### What this settles, and what it does not

**Neither tier available to this account reads G2.** Sixteen attempts, two tiers, zero reads.
That is the finding, and it is enough for the decision below.

**It does not rule out egress reputation, and an earlier draft of this section claimed it
did.** Three reasons, each of which should have been obvious before the claim was written:

1. *The response changed when the tier changed.* 2,669 bytes to 1,904, zero text to 43. A
   verdict that moves when only the exit moves is evidence that egress affects the path, not
   that it is irrelevant. What the run shows is that neither exit produced a read — a much
   narrower statement.
2. *"Two independent exit pools" was asserted, never measured.* The complaint that opened
   this whole line of work was that `Egress` records country, tier and timezone but **not the
   exit IP**. `types.ts` was frozen for this plan, so the mobile run records no IP either.
   Nothing here demonstrates the two tiers used different addresses or different ASNs, or
   that the eight mobile attempts rotated at all. The tier label was varied; the exit was
   not verified. That is the original defect repeated one level up.
3. *The device fingerprint was held fixed across both runs.* Every one of the sixteen
   attempts used the same Solari stealth browser. Against a *device* check — which is what
   DataDome calls this, in the interstitial's own title — that is the variable most likely to
   matter, and neither run touched it.

**It does not establish that G2's challenge is unsolvable in general.** It establishes that it
does not solve for us, with the levers this account has. Solari documents DataDome coverage as
site-by-site, and G2 is evidently not one of its sites.

### Decision

**G2 stays `not read`. The question is closed.** No retry policy, no tier switch, no further
spend. Reopening it would need Solari to add site-specific DataDome coverage for G2 — a change
on their side, not ours.

### Two labelling defects this run exposed

The first is fixed below; the review correctly pointed out that it was never out of scope —
`src/eval/captcha.ts` is a permitted file and the claim that it was not was simply wrong. The
second is in `src/fetch/fan.ts`, which this plan freezes, and is recorded for follow-up.

1. **`classifyTrace` called this `immediate`, whose documentation says "there was no challenge
   to solve".** There plainly was one — the 43 characters *are* the challenge's own message.
   The label is accurate about the trace's shape and wrong about its meaning. It is the same
   species of error as the two already fixed in that function.
   Corrected in this branch: `TraceShape`'s documentation no longer claims `immediate` means
   no challenge existed.
2. **`classifyFailure` reported "Please enable JS and disable any ad blocker" as `empty`**,
   which reads in a ledger as *this source had nothing to say* when the truth is *this source
   answered with a bot defence*. `CAPTCHA_MARKERS` carries "enable javascript and cookies" and
   does not match this wording. That is the sixth instance of this pattern in the codebase's
   history, and the fifth found by a run rather than by reading the code.

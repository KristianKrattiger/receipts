# Verified Egress — Design Spec

**Date:** 2026-09-05
**Status:** approved
**Supersedes:** the proxy-verification, `webBotAuth` and sticky-session items of Task 5 in
`docs/superpowers/plans/2026-09-04-density.md`. That task's full tier × country grid stays
open there.

## Summary

Receipts cannot currently tell a working proxy from an absent one. Every conclusion it
records about which sources refuse it — including the two it names in the README — rests on
measurements that could not have detected the difference.

This spec makes egress observable, then settles empirically what Reddit and G2 actually
return, then decides access per source from that evidence. It also reopens the project's
standing constraint against captcha solving, on the grounds that the constraint was written
against an assumed diagnosis rather than a measured one.

## Motivation

### The measurement that could not discriminate

Commit `b52d06e` moved the default proxy from `us` to `smart`, on this table:

```
  us (bare string)              FAIL   tunnel connection failed
  { country: us, residential }  FAIL   tunnel connection failed
  { country: us, tier: static } OK     3924 chars
  smart                         OK     3924 chars
```

Every cell was measured against `tesla.com/fsd`, which blocks nothing and is readable with
no proxy at all. "OK, 3924 chars" therefore proves the page loaded. It does not prove a
proxy was attached, and the two rows that pass are indistinguishable precisely because the
test could not separate them.

`smart` has been the default for every run since. It appears in the SDK typings
(`proxy?: string | ProxyRequest | "off" | "smart"`) and nowhere in the compiled JS — the SDK
forwards it verbatim to the API, so its behaviour is server-defined and, from here,
unobserved. It is absent from `docs.getsolari.com/proxies`, which documents only the
`{ country, tier, session }` object.

If `smart` resolves to no proxy, `b52d06e` was a regression from `us:static` presented as a
fix, and every access conclusion drawn since has been drawn from unproxied traffic.

### The check we never made

`docs.getsolari.com/proxies` states the confirmation method: to confirm you actually got a
proxied session, check that `session.proxy` is present rather than checking for a 201.

The SDK exposes it as `BrowserSession.proxy` — "Resolved proxy credentials, when a proxy was
requested." Nothing in `src/` reads it. That single omission is why the question above is
open at all, and it is the first thing this spec fixes.

### Two claims that outran their evidence

**The README asserts a test that never ran.** It says Reddit "blocks even stealth plus a
residential proxy". Per `b52d06e`, residential never opened a tunnel on this account — the
requests failed at egress and never reached Reddit. The sentence describes an experiment
whose result we do not have.

**Neither refusal is diagnosed.** Reddit returns an auth wall — "log in to your Reddit
account or use your developer token" — which is not a bot block and which captcha solving
does nothing for. G2 returns **zero characters**, which is not a diagnosis of anything: it is
equally consistent with a hard block, a challenge widget in an iframe, and `settleText`
giving up after ~4.2s on a slow render. The project has been reporting both as settled facts.

## Reopening the captcha constraint

`docs/superpowers/plans/2026-09-04-density.md` carries, under Global Constraints, a
prohibition on captcha solving and on defeating bot detection: a source that refuses is a
`not read` row, and that column is a feature of the tool rather than a gap in it.

The argument is sound and this spec does not overturn it. It observes only that the
constraint was written against an assumed diagnosis. G2 has never been shown to present a
captcha, and Reddit demonstrably does not. A policy forbidding a remedy for a condition
neither source has been shown to have is not currently doing the work it was written to do.

**The constraint therefore stands until the diagnostic run reports, and is then amended per
source with the argument written out.** If G2's failure turns out to be an extraction defect
or a hard block, the constraint is untouched and the revisit has still produced its answer.
The decision is recorded either way; a null result here is a result.

## Scope

**In scope:** egress telemetry on every fetch; richer failure evidence; a paid diagnostic
matrix; a recorded per-source access decision; Reddit access by browser login with a pinned
exit IP; whichever G2 route the evidence selects; README correction.

**Out of scope:** the tier × country matrix across four countries (density Task 5's full
grid) — this spec runs the three proxy values that bear on open questions, not an inventory
of the vendor's pools. New subjects, new source classes, and ledger density work all remain
density-plan concerns.

## Architecture

No new modules. The changes land in `fetch/` and `types.ts`, with one new script under
`eval/` following the `src/eval/yield.ts` precedent — a script, not a test, because it spends
money and CI must not run it.

### Egress telemetry

```ts
/** What the gateway actually gave us, read back from the session. */
export interface Egress {
  /** What we asked for: "smart", "us:static", "off". */
  requested: string
  stealth: boolean
  /**
   * Absent when the gateway attached no proxy. This is the distinction the
   * project could not previously make: a page that loads proves the page
   * loaded, and nothing about the route it took.
   */
  proxy?: { country: string; tier?: string; timezoneId?: string }
}
```

Recorded on `FetchedDoc` and `SourceFailure`, with a run-level summary on `Corpus` so a
report can state the egress that produced it. Reading it must never break a fetch: a failure
to read records `undefined` and the fetch proceeds.

### Failure evidence

Failure detail today is `text.slice(0, 200)`, which for G2 is two hundred characters of
nothing. On failure the fetch additionally records `title`, `text.length`, and
`document.documentElement.outerHTML.length`.

The HTML length is the load-bearing number. `settleText` reads `body.innerText`; a challenge
widget hosted in an iframe yields an empty innerText over a substantial document. HTML length
alone separates *the page had no text* from *there was no page*, which is exactly the
distinction between a `settleText` defect and a refusal.

### The diagnostic matrix — `src/eval/egress.ts`

| host | `smart` | `us:static` | `off` | `webBotAuth` |
|---|---|---|---|---|
| wikipedia.org (control) | × | × | × | |
| tesla.com/fsd | × | × | × | |
| g2.com/products/vercel/reviews | × | × | × | × |
| reddit.com/r/nextjs/search | × | × | × | × |

Per cell: proxy attached, HTTP status, innerText length, HTML length, `classifyFailure`
result, and the first 1000 characters.

The `tesla.com` row is present deliberately. It should report identically under `smart` and
`off`, putting into the record why the original measurement could not discriminate — the
same reason this spec exists.

`webBotAuth` is characterised here. It is in the SDK typings, has never been tried, and
density Task 5 wants it measured; it signs outbound requests with a key registered to a
verified bot directory, identifying the crawler rather than disguising it.

### Reddit — browser login with a pinned exit IP

- **Sticky IP** via a `--proxy-session <label>` flag rather than extending `country:tier`
  syntax to `country:tier:session`. The label selects nothing about the pool; overloading one
  positional syntax with two orthogonal concerns makes both harder to read.
- **Credentials** from `REDDIT_USERNAME` and `REDDIT_PASSWORD` in `.env`, which is already
  gitignored. Absent credentials are not an error: the source reports `auth_required` and the
  run continues.
- **One login ever**, not one per run. Solari's profiles API stores cookies and localStorage
  server-side (`profiles.create`, `profiles.save`, then `sessions.create({ profileId })`), so
  a login is performed once and every later run attaches the profile by id. Each login is an
  opportunity for a challenge; there is no reason to spend one per run, let alone per source.
- **New `FailureReason: "auth_required"`**, distinct from `blocked`. Reddit currently reports
  `blocked`, which reads in the ledger as *they refused us* when what happened is *they named
  the way in and we did not take it*. The ledger's whole claim is that it reports its coverage
  gaps accurately, so a misattributed reason is a defect in the product, not the plumbing.

**Known risk, accepted:** automating a logged-in account is contrary to Reddit's user
agreement in a way that the developer-token route is not. Recorded here as a deliberate
choice, not an oversight.

### G2 — three branches, evidence selects one

- HTML substantial, innerText empty: an extraction defect. Fix `settleText`; no policy change.
- A challenge widget present: the point at which the captcha revisit binds. Decide then, with
  the argument written into this spec's decision record.
- A hard block with no challenge: `not read`, with the reason corrected to what was observed.

### Documentation

Delete the residential sentence. Re-date the proxy table with measured numbers. State the
access stance in the README, which currently carries no mention of it — the reasoning lives
only in a plan file, where no reader of the repository will find it.

## Testing

Everything but the paid run and the live login is verifiable offline:

- `Egress` recording against a stubbed browser: `proxy` absent when the stub returns none,
  present and populated when it does, and a throwing accessor still yields a fetch.
- `--proxy-session` parsing: pure table tests beside the existing `parseProxy` cases.
- `auth_required`: extends the `classifyFailure` table, including that it takes precedence
  over `blocked` for a page carrying both an auth prompt and block wording.
- The diagnostic script is excluded from CI, as `src/eval/yield.ts` is.

## Error handling

One refused source must never fail a run — the existing invariant, extended to the new paths.
Missing credentials, a failed login, and an unreadable egress record are each one row's
reason, never an exception that escapes the worker.

## Definition of done

- Every fetched document and every failure records the egress that produced it.
- The diagnostic matrix has run and its numbers are committed.
- `smart` is characterised: either it attaches a proxy, or the default reverts to `us:static`.
- Reddit and G2 each carry a recorded, argued access decision, and the captcha constraint is
  amended or affirmed in writing.
- No claim in the README describes a measurement that was not taken.

---

## Decision record — measured 2026-09-05

Full results: [`reports/egress-2026-09-05.json`](../../../reports/egress-2026-09-05.json).
Fourteen cells, serial, each confirming `session.proxy` rather than a status code.

### `smart` attached no proxy

Its rows are byte-identical to `off` on every host — tesla 4,232/1,325,800 under both,
G2 403/0/2,638 under both, Reddit 403/222/190,292 under both — and the session
confirmation returned `NONE` every time. `b52d06e` did not move the default from a
broken tier to a working one; it moved it to no egress at all, and the tesla.com table
could not have shown that, because tesla.com returns the same bytes unproxied.

**Decision: the default reverts to `us:static`.** Done.

### Reddit is a captcha, not an auth wall — this overturns the spec's premise

The spec above says Reddit "returns an auth wall … which is not a bot block and which
captcha solving does nothing for". That was inferred from unproxied runs, and it is
wrong. Both readings were artefacts of the broken default:

| | unproxied (`smart`/`off`) | proxied (`us:static`) |
|---|---|---|
| status | 403 | **200** |
| body | "You've been blocked by network security … log in or use your developer token" | "Prove your humanity … Complete the challenge below and let us know you're a real person" |

The "log in or use your developer token" wording belongs to Reddit's **IP-reputation
block page**, not to a login requirement on the content. Given an acceptable IP, Reddit
serves the search page and gates it behind a human-verification challenge.

This changes what the captcha revisit is deciding. `captcha: true` is not a marginal
convenience for Reddit — it is the only remaining lever, and it very likely also
determines whether `npm run login` can complete at all, since the login form sits behind
the same challenge. **Decision deferred: this is the project's epistemic call, not an
implementation detail, and the Global Constraints require it be made in writing.**

### G2 is a hard block; the captcha constraint is untouched for it

`403`, 2,638 characters of body, title `"g2.com"`, zero text — identical under `smart`,
`us:static` and `off`. There is no challenge widget: Reddit's challenge page was 169,808
characters, and 2,638 is an error page. Captcha solving has nothing to act on here.

**Decision: branch C. G2 stays `not read`, with the reason corrected from "returns
nothing" to a measured 403.** No code change, no policy change. The captcha constraint
as it applies to G2 is **affirmed**, on evidence rather than assumption.

### `webBotAuth` is unavailable — a null result

`400 — "Web Bot Auth request signing is not available on this platform; requests were
never signed even when this option was accepted. Remove webBotAuth from your create
options."` Density Task 5 hoped this would be "the most effective and the most defensible
coverage win available". It is not available at all, and the wording confirms it was
previously accepted while doing nothing. Recorded as a null result, not left as untried.

### A correctness bug the run exposed

Reddit's challenge page is 240 characters, which clears `MIN_USEFUL_CHARS`, and matched
none of the existing `CAPTCHA_MARKERS`. `classifyFailure` returned `null`: the challenge
would have entered a ledger as a genuine independent Reddit source, with the model asked
to find contradictions against it. This is the fourth shape of a mistake the file already
documents three times. Fixed, with the page's verbatim text as the test fixture.

**It was only visible because the proxy started working** — the bug needed a *successful*
fetch to reach it. Every previous run was blocked before it could be triggered.

---

## Decision record, part two — captcha enabled 2026-09-05

The constraint was reversed and `captcha: true` enabled. What it actually bought,
measured across four attempts per source: **much less than the first result suggested.**

### The flag alone would have done nothing

`settleText` stops as soon as two consecutive reads agree. A challenge interstitial is
short and perfectly *stable*, so it fired on the challenge in roughly 1.4 seconds while
the solver was still working. Enabling captcha without fixing that would have changed
no outcome and looked like proof the feature does not work — the same shape of error as
the tesla.com measurement, arrived at from the other direction.

A successful solve also **navigates**, so an `evaluate` in flight throws "Execution
context was destroyed". Left uncaught, the one outcome worth waiting for reports as a
failed fetch.

### G2: opens occasionally, not reliably

| attempt | result |
|---|---|
| patient eval run | 0 chars / 2,669 html — challenge |
| navigation-tolerant eval run | **3,856 chars / 848,544 html — the real review page** |
| production fan (12 sources, concurrency 3) | 0 chars / 2,669 html — challenge |
| targeted re-probe | 0 chars / 2,669 html — challenge |

**One success in four.** The success was real and verified — title "Vercel Reviews 2026:
Details, Pricing, & Features | G2", body carrying "Vercel By Vercel 4.7/5 (84)" — so G2
is a solvable challenge rather than the hard 403 this spec first recorded. But a source
that yields one time in four is not a source you can plan a ledger around, and the
earlier entry in this record calling it a bare block was wrong in the other direction.

**Decision: keep G2 in the plan, expect `empty` most runs.** No further work; the honest
`not read` row does its job.

### Reddit: captcha solving does not open it

Still the "Prove your humanity" page after 42 seconds of waiting with the solver on.
Solari documents per-site coverage for non-standard challenges, and Reddit's is evidently
not covered.

Worse, sustained attempts moved it to a *different* refusal: `200` with 575 characters of
"Too Many Requests — whoa there, pardner! … far too many requests come from your IP
address recently". So the practical result of trying harder on Reddit is rate limiting.

**Decision: Reddit stays unread.** The browser-login route remains implemented and
unexercised; on this evidence the login form sits behind the same unsolvable challenge,
and the rate limiting makes repeated attempts actively counterproductive.

### Two more classification bugs, both found by running

Both admitted refusal pages into the corpus as genuine Reddit documents:

1. The "Prove your humanity" challenge — 240 chars, cleared the floor, matched no marker.
2. The "Too Many Requests" page — 575 chars, cleared the floor; `BLOCK_MARKERS` carried
   "rate limit" and the page never uses the phrase.

That is five instances of one class in this codebase's history. Every one cleared
`MIN_USEFUL_CHARS`, and **not one was found by reading the code** — each needed a run
that got far enough to see the page. The marker lists are a denylist against an open
world, which is a structural weakness worth naming even though nothing here fixes it.

### Net effect of the reversal

One source, one time in four. The policy question was worth settling on evidence, and the
evidence is that the constraint was costing almost nothing — the `not read` column was
never the reason coverage was thin.

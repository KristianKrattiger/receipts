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
- **One login per run**, not per target, with the resulting `storageState` reused across the
  fan. Logging in once per source would multiply the risk of a challenge for no benefit.
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

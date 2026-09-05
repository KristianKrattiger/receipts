# Captcha Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the instrument that says why G2's challenge solves about one attempt in four, and run it.

**Architecture:** One new file, `src/eval/captcha.ts`, holding two pure helpers and a paid probe script. The helpers are unit-tested; the script is not, because it spends money. A run-as-main guard (the pattern `src/eval/yield.ts:184` already uses) keeps the script inert on import so its own test file can load it.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, `@solarisdk/browser` ^0.1.1, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-captcha-refinement-design.md`. Every task serves it.
- **This plan changes no production file.** `src/fetch/fan.ts`, `settleText`, `hasSettled`,
  `src/cli/*` and `src/types.ts` are frozen. Only `src/eval/captcha.ts`,
  `src/eval/captcha.test.ts`, `package.json` and one report may be touched.
- **The poll budget is production's: 60 polls at 700ms, 42 seconds. Do not raise it.** A probe
  with a different budget measures a system nobody runs. If the evidence says the budget is
  binding, that is a *finding* of Task 4, never a premise.
- Scripts under `src/eval/` spend money and are never run by CI.
- Tests run with `npm test`; types with `npm run typecheck`. Both must pass before a commit.
- Commit after every task. Never `--no-verify`.
- Branch: `hard-gates`.

---

### Task 1: Name the challenge vendor from the page

The project has never recorded *what* G2's challenge is — only that the page was 2,669
characters. A vendor name decides whether Solari covers it at all, since its docs cover
DataDome and PerimeterX only "on a site-by-site basis".

**Files:**
- Create: `src/eval/captcha.ts`
- Create: `src/eval/captcha.test.ts`

**Interfaces:**
- Produces: `fingerprintChallenge(html: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/eval/captcha.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { fingerprintChallenge } from "./captcha.js"

describe("fingerprintChallenge — name the challenge, not just its size", () => {
  it("names DataDome from its delivery host", () => {
    const html = `<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>`
    expect(fingerprintChallenge(html)).toBe("datadome")
  })

  it("names Cloudflare Turnstile", () => {
    const html = `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`
    expect(fingerprintChallenge(html)).toBe("turnstile")
  })

  it("names reCaptcha", () => {
    const html = `<script src="https://www.google.com/recaptcha/api.js"></script>`
    expect(fingerprintChallenge(html)).toBe("recaptcha")
  })

  it("names hCaptcha", () => {
    const html = `<iframe src="https://newassets.hcaptcha.com/captcha/v1/frame"></iframe>`
    expect(fingerprintChallenge(html)).toBe("hcaptcha")
  })

  it("names PerimeterX", () => {
    const html = `<script src="https://client.perimeterx.net/PXabc123/main.min.js"></script>`
    expect(fingerprintChallenge(html)).toBe("perimeterx")
  })

  // The whole reason this matches asset hosts rather than vendor names: a page
  // that merely writes about captchas is a document, not a challenge. This is
  // the same mistake classifyFailure already guards against by scanning the
  // body rather than the title.
  it("does not name a vendor a page merely talks about", () => {
    const prose = "We evaluated hCaptcha and reCaptcha before choosing DataDome for our signup form."
    expect(fingerprintChallenge(prose)).toBeNull()
  })

  it("returns null for an ordinary page", () => {
    expect(fingerprintChallenge("<html><body><h1>Vercel Reviews</h1></body></html>")).toBeNull()
  })

  it("returns null for empty input", () => {
    expect(fingerprintChallenge("")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: FAIL — cannot resolve `./captcha.js`, or `fingerprintChallenge is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/eval/captcha.ts`:

```ts
/**
 * Why G2's challenge solves about one attempt in four.
 *
 * Spends money; CI never runs it. The two exported helpers are pure and tested;
 * everything below them is the probe, kept inert on import by the run-as-main
 * guard at the bottom so the test file can load this module safely.
 */

/**
 * Challenge vendors, matched on the asset hosts their widgets load from.
 *
 * Matching hosts rather than vendor names is the point. A page that discusses
 * captchas contains the word "hcaptcha"; only a page that *is* a challenge
 * loads `newassets.hcaptcha.com`. The same distinction classifyFailure draws
 * by scanning the body rather than the title.
 *
 * First match wins. A page loading two vendors is not something we have seen,
 * and inventing a precedence for it would be guessing.
 */
const CHALLENGE_VENDORS: readonly { name: string; hosts: readonly string[] }[] = [
  { name: "datadome", hosts: ["captcha-delivery.com", "datadome.co", "js.datadome"] },
  { name: "hcaptcha", hosts: ["hcaptcha.com"] },
  { name: "recaptcha", hosts: ["google.com/recaptcha", "gstatic.com/recaptcha"] },
  { name: "turnstile", hosts: ["challenges.cloudflare.com"] },
  { name: "perimeterx", hosts: ["perimeterx.net", "px-cloud.net", "px-cdn.net"] },
]

/** Pure: name the challenge vendor a page loads, or null if it loads none. */
export function fingerprintChallenge(html: string): string | null {
  const hay = html.toLowerCase()
  for (const vendor of CHALLENGE_VENDORS) {
    if (vendor.hosts.some((host) => hay.includes(host))) return vendor.name
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/eval/captcha.ts src/eval/captcha.test.ts
git commit -m "feat(receipts): name the challenge vendor, not just its size

The project has recorded that G2's challenge page is 2,669 characters and
nothing about what it is. The vendor decides whether Solari covers it at all
-- its docs cover DataDome and PerimeterX only on a site-by-site basis.

Matches asset hosts rather than vendor names, because a page discussing
captchas contains the word and only a challenge loads the widget.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Name the shape of a poll trace

A failure today is a single number, `0`. That cannot distinguish *the solve never fired*
from *the solve was progressing when the budget expired*, and those imply opposite fixes.

**Files:**
- Modify: `src/eval/captcha.ts`
- Modify: `src/eval/captcha.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PollSample` (`{ tMs: number; textLen: number; htmlLen: number }`),
  `TraceShape` (`"flat" | "immediate" | "late-arrival" | "cut-off"`),
  `classifyTrace(trace: readonly PollSample[]): TraceShape`

- [ ] **Step 1: Write the failing test**

In `src/eval/captcha.test.ts`, widen the existing import rather than adding a second one
from the same module:

```ts
import { classifyTrace, fingerprintChallenge, type PollSample } from "./captcha.js"
```

Then append:

```ts
/** Build a trace from text lengths; htmlLen is not what this reads. */
const trace = (...textLens: number[]): PollSample[] =>
  textLens.map((textLen, i) => ({ tMs: i * 700, textLen, htmlLen: 2669 }))

describe("classifyTrace — a zero is not one fact but two", () => {
  it("calls an all-zero trace flat: the solve never fired", () => {
    expect(classifyTrace(trace(0, 0, 0, 0, 0))).toBe("flat")
  })

  it("calls an empty trace flat, since nothing was ever seen", () => {
    expect(classifyTrace([])).toBe("flat")
  })

  it("calls zeros-then-growth-then-stable late-arrival: the solve landed", () => {
    expect(classifyTrace(trace(0, 0, 0, 500, 3856, 3856))).toBe("late-arrival")
  })

  it("calls a trace still rising at the last sample cut-off: the budget was binding", () => {
    expect(classifyTrace(trace(0, 0, 100, 900, 2400))).toBe("cut-off")
  })

  it("calls a trace non-zero from the first sample immediate: no challenge to solve", () => {
    expect(classifyTrace(trace(3856, 3856, 3856))).toBe("immediate")
  })

  // Precedence decision, made explicit because the spec left it open: a trace
  // that starts non-zero AND is still rising is `cut-off`, not `immediate`.
  // "Still growing when the budget expired" is the operationally important
  // fact whichever sample it started at, because it is the one that says the
  // budget is what to change.
  it("prefers cut-off over immediate when a page starts non-zero and is still growing", () => {
    expect(classifyTrace(trace(500, 700, 900))).toBe("cut-off")
  })

  it("handles a single zero sample", () => {
    expect(classifyTrace(trace(0))).toBe("flat")
  })

  it("handles a single non-zero sample", () => {
    expect(classifyTrace(trace(3856))).toBe("immediate")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: FAIL — `classifyTrace is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/eval/captcha.ts`, below `fingerprintChallenge`:

```ts
/** One poll of the page: how much text and HTML existed, and when. */
export interface PollSample {
  tMs: number
  textLen: number
  htmlLen: number
}

export type TraceShape = "flat" | "immediate" | "late-arrival" | "cut-off"

/**
 * Pure: name the shape of a poll trace.
 *
 * This exists because a failed fetch currently reports one number -- `0` -- and
 * that number is two different facts wearing the same clothes. A solve that
 * never fired and a solve that was still working when the budget expired both
 * end at zero text, and they call for opposite fixes: abandon the route, or
 * raise the budget.
 *
 * `cut-off` is checked before `immediate` deliberately. A trace that starts
 * non-zero and is still climbing is reported as cut off, because "still growing
 * when we stopped looking" is the fact that changes what we do.
 */
export function classifyTrace(trace: readonly PollSample[]): TraceShape {
  if (trace.length === 0) return "flat"
  if (trace.every((sample) => sample.textLen === 0)) return "flat"

  const last = trace[trace.length - 1]!
  const prior = trace[trace.length - 2]
  if (prior !== undefined && last.textLen > prior.textLen) return "cut-off"
  if (trace[0]!.textLen > 0) return "immediate"
  return "late-arrival"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: PASS, all sixteen cases across both describes.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/eval/captcha.ts src/eval/captcha.test.ts
git commit -m "feat(receipts): name the shape of a poll trace

A failed fetch reports one number, 0, and that number is two different facts
wearing the same clothes. A solve that never fired and a solve still working
when the budget expired both end at zero text, and they call for opposite
fixes -- abandon the route, or raise the budget.

cut-off is checked ahead of immediate: still growing when we stopped looking
is the fact that changes what we do, whichever sample it started at.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The probe

**Files:**
- Modify: `src/eval/captcha.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `fingerprintChallenge` (Task 1), `classifyTrace`, `PollSample`, `TraceShape` (Task 2).
- Consumes from the codebase: `classifyFailure`, `parseProxy`, `readEgress` from
  `../fetch/fan.js`; `normalizeText` from `../fetch/normalize.js`; `Egress` and
  `FailureReason` types from `../types.js`.
- Produces: `Attempt` interface; a `reports/captcha-probe-YYYY-MM-DD.json` file.

- [ ] **Step 1: Add the imports**

In `src/eval/captcha.ts`, insert this import block immediately after the file's opening
doc comment and immediately before `const CHALLENGE_VENDORS`:

```ts
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { Solari } from "@solarisdk/browser"
import { classifyFailure, parseProxy, readEgress } from "../fetch/fan.js"
import { normalizeText } from "../fetch/normalize.js"
import type { Egress, FailureReason } from "../types.js"
```

- [ ] **Step 2: Add the constants and the Attempt shape**

Append to `src/eval/captcha.ts`:

```ts
const TARGET = "https://www.g2.com/products/vercel/reviews"

/**
 * Production's budget with a solver running, deliberately unchanged.
 *
 * A probe with a different budget measures a system nobody runs, and its
 * timings would not transfer to the fix. If the evidence says the budget is
 * what binds, that is a finding of this run rather than a premise of it.
 */
const POLL_ATTEMPTS = 60
const POLL_INTERVAL_MS = 700

/** The one successful G2 page was 848KB. Evidence worth summarising, not storing. */
const HTML_SAMPLE_CHARS = 4000

export interface Attempt {
  attempt: number
  startedAt: string
  totalMs: number
  pollTrace: PollSample[]
  challenge: string | null
  htmlSample: string
  outcome: FailureReason | "ok"
  traceShape: TraceShape
  egress: Egress
  error?: string
}
```

- [ ] **Step 3: Write the attempt runner**

Append to `src/eval/captcha.ts`:

```ts
async function runAttempt(solari: Solari, attempt: number): Promise<Attempt> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const pollTrace: PollSample[] = []
  const requested = "us:static"

  let browser
  try {
    browser = await solari.launch({
      stealth: true,
      proxy: parseProxy(requested),
      captcha: true,
    })
  } catch (err) {
    return {
      attempt, startedAt, totalMs: Date.now() - t0, pollTrace,
      challenge: null, htmlSample: "", outcome: "http_error", traceShape: "flat",
      egress: { requested, stealth: true },
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const egress = readEgress(browser, requested, true)
  try {
    const page = await browser.newPage()
    await page.goto(TARGET, { timeout: 45_000, waitUntil: "load" })

    // Poll LENGTHS only. Pulling the full HTML sixty times would move megabytes
    // per attempt for a number that can be read once at the end.
    //
    // This runs the full budget every time and never stops early, which is the
    // one place the probe departs from settleText. The budget is identical; the
    // early exit is dropped because stopping the moment the page settles
    // destroys exactly the evidence being collected -- what happened after.
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      try {
        const sample = await page.evaluate(() => ({
          textLen: (document.body?.innerText ?? "").length,
          htmlLen: document.documentElement?.outerHTML.length ?? 0,
        }))
        pollTrace.push({ tMs: Date.now() - t0, ...sample })
      } catch {
        // A solve that succeeds navigates, and an evaluate in flight across
        // that navigation throws "Execution context was destroyed". That is the
        // outcome being waited for, so it is a gap in the trace, not a failure.
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }

    const rawText = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")
    const html = await page.evaluate(() => document.documentElement?.outerHTML ?? "").catch(() => "")
    const title = await page.title().catch(() => "")
    const text = normalizeText(rawText)

    return {
      attempt, startedAt, totalMs: Date.now() - t0, pollTrace,
      challenge: fingerprintChallenge(html),
      htmlSample: html.slice(0, HTML_SAMPLE_CHARS),
      outcome: classifyFailure(title, text) ?? "ok",
      traceShape: classifyTrace(pollTrace),
      egress,
    }
  } catch (err) {
    return {
      attempt, startedAt, totalMs: Date.now() - t0, pollTrace,
      challenge: null, htmlSample: "", outcome: "http_error",
      traceShape: classifyTrace(pollTrace), egress,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await browser.close()
  }
}
```

- [ ] **Step 4: Write main and the run-as-main guard**

Append to `src/eval/captcha.ts`:

```ts
async function main(argv: string[]): Promise<void> {
  // Arguments are validated BEFORE the key is read, so a typo reports as a typo
  // rather than masquerading as a missing credential -- and so the argv guards
  // can be smoke-tested without a key present.
  const attempts = Number(argv[0] ?? 8)
  const spacingMinutes = Number(argv[1] ?? 7)
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`captcha: attempts must be a positive whole number, got ${JSON.stringify(argv[0])}`)
  }
  if (!Number.isFinite(spacingMinutes) || spacingMinutes < 0) {
    throw new Error(`captcha: spacing must be a non-negative number of minutes, got ${JSON.stringify(argv[1])}`)
  }

  const apiKey = process.env["SOLARI_API_KEY"]
  if (!apiKey) throw new Error("captcha: SOLARI_API_KEY is not set")

  const solari = new Solari({ apiKey })
  const results: Attempt[] = []
  try {
    for (let i = 1; i <= attempts; i++) {
      const result = await runAttempt(solari, i)
      results.push(result)
      const finalText = result.pollTrace[result.pollTrace.length - 1]?.textLen ?? 0
      const proxied = result.egress.proxy
        ? `${result.egress.proxy.country}/${result.egress.proxy.tier ?? "default"}`
        : "NONE"
      console.error(
        `attempt ${i}/${attempts}: ${result.outcome} trace=${result.traceShape} ` +
        `challenge=${result.challenge ?? "none"} text=${finalText} ` +
        `proxy=${proxied} ${result.totalMs}ms${result.error ? ` ERROR ${result.error}` : ""}`,
      )
      // Spacing is the whole point of the run: four bunched attempts cannot
      // tell throttling from a coin flip.
      if (i < attempts) await new Promise((r) => setTimeout(r, spacingMinutes * 60_000))
    }
  } finally {
    // REQUIRED in Node: the client holds a loopback proxy server open and that
    // handle keeps the event loop alive.
    await solari.close()
  }

  const path = `reports/captcha-probe-${new Date().toISOString().slice(0, 10)}.json`
  // Written to a file rather than stdout on purpose: `npm run x > file` captures
  // npm's own banner into the JSON, which has already had to be stripped once.
  writeFileSync(path, `${JSON.stringify({ measuredAt: new Date().toISOString(), target: TARGET, attempts: results }, null, 2)}\n`)
  console.error(`wrote ${path}`)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
```

- [ ] **Step 5: Register the script**

In `package.json`, in `scripts`, after the `"egress"` line:

```json
    "captcha": "tsx --env-file-if-exists=.env src/eval/captcha.ts",
```

- [ ] **Step 6: Verify the guard keeps the script inert on import**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: PASS, all sixteen cases, and **no** "SOLARI_API_KEY is not set" error. If that
error appears, the guard is wrong and the test file is executing the probe.

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 7: Smoke-test the argv guards without spending money**

Run: `npx tsx src/eval/captcha.ts 0`
Expected: exits 1 with `captcha: attempts must be a positive whole number, got "0"`.

Run: `npx tsx src/eval/captcha.ts abc`
Expected: exits 1 with `captcha: attempts must be a positive whole number, got "abc"`.

These fail before the key is read and before any session is created, so neither spends
anything and neither needs `.env` loaded.

- [ ] **Step 8: Commit**

```bash
git add src/eval/captcha.ts package.json
git commit -m "feat(receipts): a probe that records why a solve failed

Records per-attempt timing, a poll-by-poll trace, the challenge vendor and a
truncated HTML sample -- the four things the last run could not see. It polls
production's budget exactly, 60 at 700ms, but never exits early: stopping the
moment a page settles destroys the evidence being collected.

Attempts are spaced across an hour because four bunched attempts on one IP
cannot tell throttling from a coin flip.

Writes to a file rather than stdout, because npm run x > file captures npm's
banner into the JSON and that has already had to be stripped once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Run it, and say which hypothesis survived

**Files:**
- Create: `reports/captcha-probe-2026-09-05.json`
- Modify: `docs/superpowers/specs/2026-09-05-captcha-refinement-design.md` (findings section)

- [ ] **Step 1: Run the probe**

```bash
npm run captcha
```

Expected: eight progress lines on stderr, one per attempt, roughly seven minutes apart;
about an hour total. Then `wrote reports/captcha-probe-2026-09-05.json`.

Run it in the background and do not poll it — it self-reports on completion.

- [ ] **Step 2: Confirm the run is usable before interpreting it**

Check, in the JSON:

1. **Every attempt has `egress.proxy` present.** If any says absent, that attempt ran
   unproxied and is not comparable — the `smart` failure all over again.
2. **`pollTrace` has close to 60 samples per attempt.** Many fewer means evaluates were
   throwing, and the gaps are navigations rather than measurements.

If either check fails, the run is void. Fix the probe and re-run rather than interpreting it.

- [ ] **Step 3: Match the evidence against the four hypotheses**

From the spec's table, using `traceShape`, `challenge` and the timing:

| if | then |
|---|---|
| successes scatter with no relation to spacing | **coin-flip solver** → bounded retries |
| outcome tracks recency of the previous attempt | **throttling** → pacing; retries would make it worse |
| successes are `late-arrival` near 42s, failures are `cut-off` | **slow solve** → raise the budget |
| failures are `flat` end to end, `challenge` names a vendor Solari covers site-by-site | **never fires** → abandon; keep `not read` |

Record which one the evidence supports. If none match, that is a null result and is recorded
as one — do not select the closest.

- [ ] **Step 4: Write the findings into the spec**

Append a `## Findings — 2026-09-05` section to
`docs/superpowers/specs/2026-09-05-captcha-refinement-design.md` stating: the success rate
observed, the winning hypothesis or the null result, the challenge vendor if one was named,
and the measured solve time if any solve landed. State plainly what the next change should
be, or that no change is warranted.

- [ ] **Step 5: Commit**

```bash
git add reports/captcha-probe-2026-09-05.json docs/superpowers/specs/2026-09-05-captcha-refinement-design.md
git commit -m "run(receipts): measure why G2's challenge mostly does not solve

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- `fingerprintChallenge` and `classifyTrace` are unit-tested and passing.
- `npm test` shows the probe's tests running without the script executing.
- Eight attempts recorded with timing, traces, fingerprints and HTML samples, committed.
- Every recorded attempt confirms `egress.proxy` was present.
- One hypothesis is named as consistent with the evidence, or a null result is recorded.
- No production file is modified: `git diff main --name-only` lists only
  `src/eval/captcha.ts`, `src/eval/captcha.test.ts`, `package.json`, the report, the spec
  and this plan.

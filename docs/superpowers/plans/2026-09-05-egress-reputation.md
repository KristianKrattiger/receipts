# Egress Reputation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle whether G2's unread challenge is an unsolvable device check or a flagged exit, by rerunning the existing probe on a different proxy tier.

**Architecture:** Three small changes to `src/eval/captcha.ts` — a durable atomic write, a tier-aware report path, and the proxy as an argument — then one paid run on `us:mobile` compared against the committed `us:static` baseline. No production file changes.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, `@solarisdk/browser` ^0.1.1, tsx.

## Why this exists

The 2026-09-05 run produced eight attempts against G2, all `flat`, all zero text, all reporting a
DataDome device check — and concluded the challenge does not solve. The final review found that
conclusion under-determined:

> The run varied *time* and held *egress fixed* (`us:static`, all 8). A durable IP/ASN reputation
> block fits the data at least as well as "the solve never fires": a byte-identical 2,669-byte
> interstitial for 56 straight minutes is what a flagged exit gets. Nothing in the report records
> the exit IP, so it cannot be checked.

Spacing ruled out throttling keyed to *recency*. It said nothing about reputation attached to the
exit itself. One variable was never moved, and moving it is cheap:

- **If `us:mobile` reads G2** → it was egress reputation. The challenge is solvable and the tier is
  the lever. G2 may be recoverable as a source.
- **If `us:mobile` returns the same 2,669 bytes** → the challenge genuinely does not solve for us,
  the `not read` decision is confirmed on stronger evidence, and G2 is settled.

Either way the question closes. Solari documents `mobile` as its tier for "the toughest targets
that block residential IPs", which is exactly this case.

## Global Constraints

- Spec: this plan is the spec. The prior spec it follows from is
  `docs/superpowers/specs/2026-09-05-captcha-refinement-design.md`; its Findings section records
  the open question and names `us:mobile` as the cheapest way to close it.
- **No production file changes.** `src/fetch/fan.ts`, `src/cli/*` and `src/types.ts` are frozen.
  Only `src/eval/captcha.ts`, `src/eval/captcha.test.ts`, one new report, and this plan may be
  touched.
- **The poll budget stays production's: `POLL_ATTEMPTS = 60`, `POLL_INTERVAL_MS = 700`.** Do not
  raise it. A probe with a different budget measures a system nobody runs.
- **`src/eval/captcha.ts` must stay inert on import** — `src/eval/captcha.test.ts` imports it. The
  run-as-main guard at the bottom is what makes that true; do not move or weaken it.
- **Do not overwrite `reports/captcha-probe-2026-09-05.json`.** It is the `us:static` baseline this
  run is compared against. Task 1 exists partly to make overwriting it impossible.
- Scripts under `src/eval/` spend money and are never run by CI.
- Tests: `npm test`. Types: `npm run typecheck`. Both pass before every commit.
- Commit after every task. Never `--no-verify`.
- Branch: `egress-reputation`.

---

### Task 1: A report that cannot be truncated, and cannot be overwritten by the next run

Two defects, both recorded as known limitations in the prior spec, both of which would corrupt the
comparison this plan depends on.

`writeReport` rewrites the entire accumulated array with a plain `writeFileSync` after every
attempt. A process death mid-write truncates the file — destroying precisely the evidence the
per-attempt write was added to protect.

And `reportPath()` names files by date alone, so a second run on the same day silently overwrites
the first. This run happens on the same day as the baseline it is compared against.

**Files:**
- Modify: `src/eval/captcha.ts`
- Modify: `src/eval/captcha.test.ts`

**Interfaces:**
- Produces: `reportPath(proxy: string, now?: Date): string`,
  `writeReportTo(path: string, payload: unknown): void`

- [ ] **Step 1: Write the failing tests**

In `src/eval/captcha.test.ts`, widen the existing `./captcha.js` import to include the two new
functions (do not add a second import statement from the same module):

```ts
import {
  classifyTrace, fingerprintChallenge, reportPath, writeReportTo, type PollSample,
} from "./captcha.js"
```

Add these imports at the top of the file, after the vitest import:

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
```

Then append these two describe blocks:

```ts
describe("reportPath — two tiers on one day are two measurements", () => {
  const day = new Date("2026-09-05T18:06:59.252Z")

  it("names the file after the date and the proxy", () => {
    expect(reportPath("us:static", day)).toBe("reports/captcha-probe-2026-09-05-us-static.json")
  })

  // The whole point: the mobile run must not land on top of the static
  // baseline it is being compared against.
  it("gives different tiers different paths on the same day", () => {
    expect(reportPath("us:mobile", day)).not.toBe(reportPath("us:static", day))
  })

  it("slugs a proxy that needs no punctuation", () => {
    expect(reportPath("smart", day)).toBe("reports/captcha-probe-2026-09-05-smart.json")
  })
})

describe("writeReportTo — a half-written report is worse than none", () => {
  const dir = mkdtempSync(join(tmpdir(), "captcha-report-"))

  it("writes JSON that reads back intact", () => {
    const path = join(dir, "a.json")
    writeReportTo(path, { attempts: [1, 2, 3] })
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ attempts: [1, 2, 3] })
  })

  it("leaves no temporary file behind", () => {
    const path = join(dir, "b.json")
    writeReportTo(path, { ok: true })
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  // Two things at once. The failure mode this replaces: each write rewrites the
  // whole accumulated array, so a shorter payload landing on a longer file must
  // not leave the tail of the old one behind and produce unparseable JSON. And
  // it is the only test that exercises rename-onto-an-existing-file, which is
  // not guaranteed across platforms -- do not delete it as redundant.
  it("replaces a longer previous report completely", () => {
    const path = join(dir, "c.json")
    writeFileSync(path, JSON.stringify({ padding: "x".repeat(5000) }, null, 2))
    writeReportTo(path, { small: true })
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ small: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: FAIL — `reportPath is not a function` / `writeReportTo is not a function`. (`reportPath`
exists but is not exported and takes no arguments, so the import itself fails.)

- [ ] **Step 3: Implement**

In `src/eval/captcha.ts`, change the `node:fs` import line to:

```ts
import { renameSync, writeFileSync } from "node:fs"
```

Replace the existing `reportPath` and `writeReport` functions entirely with:

```ts
/**
 * Pure: where a run's report belongs.
 *
 * The proxy is in the filename because the egress is the variable under test.
 * Two runs on the same day under different tiers are two different
 * measurements, and letting the second land on the first would destroy the
 * comparison being made -- which is the only reason the second run exists.
 */
export function reportPath(proxy: string, now: Date = new Date()): string {
  const slug = proxy.replace(/[^a-z0-9]+/gi, "-")
  return `reports/captcha-probe-${now.toISOString().slice(0, 10)}-${slug}.json`
}

/**
 * Write JSON so that a death mid-write cannot truncate what was already collected.
 *
 * The previous version called `writeFileSync` straight onto the report path
 * after every attempt. That made the durability it was added for -- "a crash at
 * attempt seven must not discard the six already paid for" -- exactly what a
 * crash *during* the write would break, because each write rewrites the whole
 * accumulated array in place. Writing beside the target and renaming is atomic
 * on every filesystem this runs on: a reader sees the old complete file or the
 * new complete file, never a half-written one.
 */
export function writeReportTo(path: string, payload: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
  renameSync(tmp, path)
}
```

- [ ] **Step 4: Update the two call sites in `main`**

`main` currently calls `writeReport(results)` and later `console.error(\`wrote ${reportPath()}\`)`.
Both now need a path. Add this line in `main`, immediately after the `apiKey` check:

```ts
  const path = reportPath("us:static")
```

Replace the `writeReport(results)` call with:

```ts
      writeReportTo(path, { measuredAt: new Date().toISOString(), target: TARGET, attempts: results })
```

Replace the final `console.error(\`wrote ${reportPath()}\`)` with:

```ts
  console.error(`wrote ${path}`)
```

The hardcoded `"us:static"` here is temporary — Task 2 replaces it with the argument. Leaving it
literal for one task keeps this task's diff about durability alone.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: PASS, 25 cases.

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Confirm the module is still inert on import**

Run: `npm test -- src/eval/captcha.test.ts`
Expected: no `SOLARI_API_KEY is not set` error anywhere in the output. If that appears, the
run-as-main guard has been broken and the probe is executing during tests.

- [ ] **Step 7: Commit**

```bash
git add src/eval/captcha.ts src/eval/captcha.test.ts
git commit -m "fix(receipts): a report that cannot truncate or overwrite itself

Two limitations recorded in the prior spec, both of which would corrupt the
comparison the mobile-tier run depends on.

writeReport rewrote the whole accumulated array in place after every attempt,
so a death mid-write truncated exactly the evidence the per-attempt write was
added to protect. It now writes beside the target and renames, which is
atomic: a reader sees the old complete file or the new one, never a half.

And the report path was named by date alone, so a second run on the same day
silently landed on the first. The proxy is now in the filename, because the
egress is the variable under test and two tiers on one day are two different
measurements.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The proxy tier becomes an argument

The probe hardcodes `us:static` in `runAttempt`, in `main`'s error fallback, and now in the report
path. The run this plan exists for needs `us:mobile`.

**Files:**
- Modify: `src/eval/captcha.ts`

**Interfaces:**
- Consumes: `reportPath(proxy: string, now?: Date): string` from Task 1.
- Produces: `runAttempt(solari: Solari, attempt: number, requested: string)`; a third CLI argument.

- [ ] **Step 1: Take the proxy as an argument in `runAttempt`**

Change the signature from:

```ts
async function runAttempt(solari: Solari, attempt: number): Promise<Attempt> {
```

to:

```ts
async function runAttempt(solari: Solari, attempt: number, requested: string): Promise<Attempt> {
```

and delete the line inside it that reads:

```ts
  const requested = "us:static"
```

Nothing else in `runAttempt` changes — it already uses `requested` for `parseProxy`, for
`readEgress`, and in its error-path `egress` field.

- [ ] **Step 2: Parse and validate the argument in `main`**

In `main`, immediately after the existing `spacingMinutes` validation block and BEFORE the
`apiKey` check, add:

```ts
  const proxy = argv[2] ?? "us:static"
  // Validate the proxy here, before the key is read and before anything is
  // launched. parseProxy throws on an unknown tier, and discovering that after
  // a session has been created would mean paying for the typo.
  parseProxy(proxy)
```

Then change the path line added in Task 1 from `reportPath("us:static")` to:

```ts
  const path = reportPath(proxy)
```

- [ ] **Step 3: Use it at the two remaining call sites**

Change the `runAttempt` call from `await runAttempt(solari, i)` to:

```ts
        result = await runAttempt(solari, i, proxy)
```

In `main`'s per-attempt catch fallback, change the hardcoded egress from
`egress: { requested: "us:static", stealth: true },` to:

```ts
          egress: { requested: proxy, stealth: true },
```

- [ ] **Step 4: Record the proxy at the top level of the report**

The per-attempt `egress` already carries what was resolved, but the payload should say what was
*asked for*, so the file is self-describing. Change the `writeReportTo` call's payload to:

```ts
      writeReportTo(path, {
        measuredAt: new Date().toISOString(), target: TARGET, requested: proxy, attempts: results,
      })
```

- [ ] **Step 5: Update the usage comment**

The file's opening doc comment documents invocation. Replace its two example lines:

```
 *   npm run captcha              # 8 attempts, 7 minutes apart, about an hour
 *   npm run captcha -- 4 2       # 4 attempts, 2 minutes apart
```

with:

```
 *   npm run captcha                          # 8 attempts, 7 min apart, us:static
 *   npm run captcha -- 4 2 us:mobile         # 4 attempts, 2 min apart, mobile tier
 *
 * The third argument is the egress under test. Whether it is the challenge or
 * the exit's reputation that blocks us is the open question this probe was
 * left with, and the tier is the only variable that separates them.
```

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS, all suites (25 cases in `captcha.test.ts`).

Run: `npm run typecheck`
Expected: no output.

Run: `npx tsx src/eval/captcha.ts 8 7 us:banana`
Expected: exits 1 with `unknown proxy tier "banana" — expected one of residential, static, mobile`.
This proves validation happens before the key is read and before any session is created, so a typo
costs nothing.

Run: `npx tsx src/eval/captcha.ts 0`
Expected: exits 1 with `captcha: attempts must be a positive whole number, got "0"`.

**Do NOT run `npm run captcha` with valid arguments.** It spends money and takes an hour; Task 3
runs it.

- [ ] **Step 7: Commit**

```bash
git add src/eval/captcha.ts
git commit -m "feat(receipts): put the egress under test on the command line

The probe hardcoded us:static, which is the one variable the last run never
moved -- and therefore the reason it could not tell an unsolvable challenge
from a flagged exit. The tier is now the third argument.

Validated before the key is read and before any session is created, so a
mistyped tier costs nothing rather than being discovered after paying for a
browser.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Run it on mobile, and close the question

**Files:**
- Create: `reports/captcha-probe-2026-09-05-us-mobile.json` (name depends on the run date)
- Modify: `docs/superpowers/specs/2026-09-05-captcha-refinement-design.md` (a new findings section)
- Modify: `README.md` — only if the result changes what it claims

- [ ] **Step 1: Run the probe on the mobile tier**

```bash
npm run captcha -- 8 7 us:mobile
```

Expected: eight progress lines on stderr, ~7.8 minutes apart, roughly 56 minutes total, then
`wrote reports/captcha-probe-<date>-us-mobile.json`.

Run it in the background and do not poll it — it self-reports on completion.

- [ ] **Step 2: Check the run is usable before interpreting it**

In the new JSON, confirm:

1. **Every attempt has `egress.proxy` present, with `tier: "mobile"`.** If any attempt reports no
   proxy, or reports `static`, the run did not test what it claims and is void.
2. **Every attempt has close to 60 `pollTrace` samples.** Many fewer means evaluates were throwing.
3. **`pollErrors` is empty on every attempt.** A `pollErrors` entry containing navigation-shaped
   text (`"Execution context was destroyed"`, `"Cannot find context"`) would mean the
   navigation-versus-crash classification missed a real crash — recorded as a known risk in the
   prior spec. If that appears, say so; it weakens the trace evidence.

If check 1 or 2 fails, the run is void. Re-run rather than interpreting it.

- [ ] **Step 3: Compare against the `us:static` baseline**

Baseline: `reports/captcha-probe-2026-09-05.json` — 8 attempts, all `flat`, all `outcome: empty`,
`challenge: datadome`, max text 0, max html 2,669 on every one of 480 samples.

| mobile result | reading | what follows |
|---|---|---|
| Any attempt reads real content (text in the thousands, html in the hundreds of thousands) | **Egress reputation.** The challenge is solvable; `us:static` was a flagged exit. | G2 is recoverable. Record the success rate. The `not read` decision needs revisiting, and the README's claim that the check "does not solve" is wrong. |
| All 8 `flat` at 2,669 bytes, as static | **The challenge does not solve for us.** Two independent egress pools, sixteen attempts, one outcome. | Confirms `not read` on much stronger evidence. Close the question. |
| Mixed — some reads, some flat | **Partly reputational.** Record the rate honestly and do not round it up. | Judge on the measured rate, not on the best attempt. One success in twelve is what the last such judgement cost. |
| Launch fails (`mobile` unavailable on this account) | **Null result, not evidence.** | Record it as unavailable. Do not read a plan restriction as a statement about G2. |

That last row matters: `us:mobile` has never been exercised on this account, and the residential
tier was found unavailable once before while surfacing as a transport error.

- [ ] **Step 4: Write the findings**

Append a `## Findings — mobile tier, <date>` section to
`docs/superpowers/specs/2026-09-05-captcha-refinement-design.md` recording: the validity checks,
the outcome table above with the actual result, which reading the evidence supports, and the
resulting decision. If the result contradicts the earlier Findings section, say so explicitly
rather than quietly superseding it.

- [ ] **Step 5: Correct the README only if the result requires it**

The README currently says G2 "sits behind a DataDome device check that does not solve". If mobile
reads G2, that sentence is false and must be corrected with the measured rate. If mobile is also
flat, the sentence is now better supported and the README may cite both runs.

- [ ] **Step 6: Commit**

```bash
git add reports/ docs/superpowers/specs/2026-09-05-captcha-refinement-design.md README.md
git commit -m "run(receipts): test whether it was the challenge or the exit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- `writeReportTo` is atomic and unit-tested; `reportPath` is tier-aware and unit-tested.
- The proxy tier is a validated CLI argument, checked before any session is created.
- `reports/captcha-probe-2026-09-05.json` is untouched — the baseline survives the new run.
- Eight mobile attempts are recorded and committed, with `tier: "mobile"` confirmed on each.
- The spec records which reading the evidence supports, or records a null result as a null result.
- The README says only what the two runs together support.

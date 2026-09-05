# Verified Egress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Receipts able to prove what egress a fetch actually used, then settle on evidence what Reddit and G2 return and act on the answer.

**Architecture:** Four pure, exported helpers in `src/fetch/fan.ts` (`readEgress`, `describeFailure`, extended `classifyFailure`, extended `parseProxy`) carry all the new logic, so every behavioural change is unit-testable offline with no Solari client — the same pattern the file already uses for `classifyFailure` and `docIdFor`. One paid script under `src/eval/` produces the measurements. Access changes land only after that script has reported.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, `@solarisdk/browser` ^0.1.1, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-verified-egress-design.md`. Every task serves it.
- **Do not enable `captcha: true` in Tasks 1–7.** The constraint from
  `docs/superpowers/plans/2026-09-04-density.md` stands until Task 6's evidence is recorded.
  Task 8 is the only place the question may be reopened, and only in writing.
- Telemetry must never break a fetch. An unreadable egress records `undefined`; a failed login
  is one row's reason. One refused source never fails a run — the existing invariant.
- `doc.text` is normalized once in `fetch/` and immutable thereafter.
- Commit after every task. Never `--no-verify`.
- Tests run with `npm test`; types with `npm run typecheck`. Both must pass before a commit.
- Scripts under `src/eval/` spend money and are never run by CI.

---

### Task 1: Record the egress every fetch actually got

The load-bearing change. Nothing in `src/` reads `BrowserSession.proxy`, so no run has ever
confirmed a proxy was attached.

**Files:**
- Modify: `src/types.ts` (add `Egress`, extend `FetchedDoc`, `SourceFailure`, `Corpus`)
- Modify: `src/fetch/fan.ts` (add `readEgress`, wire into `fetchOne` / `fetchCorpus`)
- Test: `src/fetch/fan.test.ts`

**Interfaces:**
- Produces: `Egress`, `readEgress(session: unknown, requested: string, stealth: boolean): Egress`

- [ ] **Step 1: Write the failing test**

Append to `src/fetch/fan.test.ts`:

```ts
import { classifyFailure, docIdFor, parseProxy, readEgress } from "./fan.js"

describe("readEgress — a page that loads proves nothing about the route", () => {
  it("reports no proxy when the gateway attached none", () => {
    expect(readEgress({ proxy: undefined }, "smart", true)).toEqual({
      requested: "smart", stealth: true,
    })
  })

  it("reports no proxy when the session says null", () => {
    expect(readEgress({ proxy: null }, "smart", true)).toEqual({
      requested: "smart", stealth: true,
    })
  })

  it("carries country, tier and timezone when a proxy was attached", () => {
    const session = { proxy: { country: "us", tier: "static", timezoneId: "America/Los_Angeles" } }
    expect(readEgress(session, "us:static", true)).toEqual({
      requested: "us:static",
      stealth: true,
      proxy: { country: "us", tier: "static", timezoneId: "America/Los_Angeles" },
    })
  })

  // Telemetry that can break a fetch is worse than no telemetry.
  it("survives a session whose accessor throws", () => {
    const session = { get proxy(): never { throw new Error("session released") } }
    expect(readEgress(session, "smart", true)).toEqual({ requested: "smart", stealth: true })
  })

  // An object of undefineds would read in the record as "we got something".
  it("reports no proxy when the confirmation carries no country", () => {
    expect(readEgress({ proxy: { tier: "static" } }, "us:static", true)).toEqual({
      requested: "us:static", stealth: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: FAIL — `readEgress is not a function` / no export named `readEgress`.

- [ ] **Step 3: Add the type**

In `src/types.ts`, after the `FetchedDoc` interface:

```ts
/**
 * What the gateway actually gave us, read back from the session.
 *
 * `proxy` absent means no proxy was attached. Solari's docs name this as the
 * confirmation to make -- check that `session.proxy` is present rather than
 * checking for a 201 -- and it is the distinction this project could not
 * previously draw. A page that loads proves the page loaded, and nothing about
 * the route it took: the measurement that set the current default read 3924
 * characters from tesla.com under both `smart` and `us:static`, because
 * tesla.com blocks nothing and would have returned them with no proxy at all.
 */
export interface Egress {
  /** What we asked for: "smart", "us:static", "off". */
  requested: string
  stealth: boolean
  proxy?: { country: string; tier?: string; timezoneId?: string }
}
```

Then extend the three carriers:

```ts
export interface FetchedDoc {
  docId: string
  url: string
  label: string
  role: SourceRole
  kind: SourceKind
  fetchedAt: string
  title: string
  text: string
  sessionId: string
  egress?: Egress
}
```

```ts
export interface SourceFailure {
  url: string
  label: string
  reason: FailureReason
  detail: string
  egress?: Egress
}
```

```ts
export interface Corpus {
  subject: string
  docs: FetchedDoc[]
  failures: SourceFailure[]
  labels?: RoleLabels
  /** The egress requested for this run, so a report can state what produced it. */
  egress?: Egress
}
```

`egress` is optional on all three so the committed fixtures — written before this field
existed — still parse through `readCorpusFile`.

- [ ] **Step 4: Implement `readEgress`**

In `src/fetch/fan.ts`, add `Egress` to the type import from `../types.js`, then add after
`parseProxy`:

```ts
/**
 * Pure: read back what the gateway resolved, tolerating a client that cannot say.
 *
 * The `try` is not defensive padding. `proxy` is a getter on a session that may
 * already have been released, and a fetch that succeeded must not be turned
 * into a failure by the telemetry describing it.
 */
export function readEgress(session: unknown, requested: string, stealth: boolean): Egress {
  let resolved: { country?: string; tier?: string; timezoneId?: string } | undefined
  try {
    resolved = (session as { proxy?: typeof resolved }).proxy ?? undefined
  } catch {
    resolved = undefined
  }
  // Country is the field Solari always fills when a proxy is attached. Without
  // it there is nothing to confirm, and an object of undefineds would read in
  // the record as "we got something".
  if (!resolved?.country) return { requested, stealth }
  return {
    requested,
    stealth,
    proxy: {
      country: resolved.country,
      ...(resolved.tier !== undefined ? { tier: resolved.tier } : {}),
      ...(resolved.timezoneId !== undefined ? { timezoneId: resolved.timezoneId } : {}),
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: PASS, all five new cases.

- [ ] **Step 6: Wire it into the fetch path**

In `src/fetch/fan.ts`, give `FetchError` an egress field:

```ts
class FetchError extends Error {
  constructor(public reason: FailureReason, message: string, public egress?: Egress) {
    super(message)
    this.name = "FetchError"
  }
}
```

In `fetchOne`, after the launch and before `newPage()`:

```ts
  const egress = readEgress(browser, proxyCountry, stealth)
```

Pass it to the `FetchError` throw:

```ts
      throw new FetchError(reason, `${target.label}: ${reason} — ${excerpt || "(no text)"}`, egress)
```

and add it to the returned doc, after `sessionId: browser.id,`:

```ts
      egress,
```

In `fetchCorpus`'s `worker` catch, carry it onto the failure. Replace the `failures.push({...})`
call with:

```ts
        failures.push({
          url: target.url,
          label: target.label,
          reason: err instanceof FetchError
            ? err.reason
            : isPlanError(detail) ? "plan_required"
            : isProxyError(detail) ? "proxy_error"
            : "http_error",
          detail,
          // A failure before launch has no session to read, so record what was
          // asked for. "We requested a proxy and never got one" and "we never
          // got far enough to ask" are different facts about the same row.
          egress: err instanceof FetchError && err.egress
            ? err.egress
            : { requested: proxyCountry, stealth },
        })
```

and set the run-level field on the returned corpus:

```ts
  return {
    subject,
    docs,
    failures,
    egress: { requested: proxyCountry, stealth },
    ...(opts.labels ? { labels: opts.labels } : {}),
  }
```

- [ ] **Step 7: Verify nothing regressed**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/fetch/fan.ts src/fetch/fan.test.ts
git commit -m "feat(receipts): record the egress every fetch actually got

Nothing read BrowserSession.proxy, so no run has ever confirmed a proxy was
attached. Solari's docs name that as the check -- session.proxy present, not
a 201 -- and its absence is why 'smart' has been the default since b52d06e
on a measurement that could not have detected the difference.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Capture enough of a failure to diagnose it

`G2 reviews: empty — (no text)` is the entire evidence the project holds about G2. It cannot
distinguish a refusal from an extraction defect.

**Files:**
- Modify: `src/fetch/fan.ts` (add `describeFailure`, call it from `fetchOne`)
- Test: `src/fetch/fan.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `describeFailure(label: string, reason: FailureReason, title: string, text: string, htmlLength: number): string`

- [ ] **Step 1: Write the failing test**

Append to `src/fetch/fan.test.ts`:

```ts
import type { FailureReason } from "../types.js"

describe("describeFailure — one number cannot diagnose an empty page", () => {
  it("separates an extraction defect from a refusal by html length", () => {
    const extraction = describeFailure("G2 reviews", "empty", "G2 Reviews", "", 84_000)
    expect(extraction).toContain("0 chars text")
    expect(extraction).toContain("84000 chars html")

    const refusal = describeFailure("G2 reviews", "empty", "", "", 0)
    expect(refusal).toContain("0 chars text")
    expect(refusal).toContain("0 chars html")
  })

  // A block page's title is often the most diagnostic thing on it.
  it("carries the title, which is frequently the whole diagnosis", () => {
    expect(describeFailure("G2 reviews", "captcha", "Just a moment...", "", 1200))
      .toContain("Just a moment...")
  })

  it("carries a long excerpt, not the old 200 characters", () => {
    const body = "x".repeat(1500)
    expect(describeFailure("Some source", "empty", "T", body, 1500)).toContain("x".repeat(1000))
  })

  it("collapses whitespace so one failure stays one line", () => {
    expect(describeFailure("S", "blocked", "T", "a\n\n  b", 10)).toContain("a b")
  })

  it("says so explicitly when there was no text at all", () => {
    expect(describeFailure("S", "empty", "T", "", 0)).toContain("(no text)")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: FAIL — `describeFailure is not a function`.

- [ ] **Step 3: Implement it**

In `src/fetch/fan.ts`, after `classifyFailure`:

```ts
/**
 * Pure: the one-line record of why a page was unusable.
 *
 * Text length and HTML length together are the diagnosis, and neither alone
 * will do. `settleText` reads `body.innerText`, so a challenge widget hosted in
 * an iframe yields no text over a substantial document: "0 chars text, 84000
 * chars html" is an extraction problem and "0 and 0" is a refusal. The old
 * detail carried 200 characters of body and neither number, which is how G2
 * came to be recorded as `empty` for a week without anyone being able to say
 * what it had actually returned.
 */
export function describeFailure(
  label: string,
  reason: FailureReason,
  title: string,
  text: string,
  htmlLength: number,
): string {
  const excerpt = text.slice(0, 1000).replace(/\s+/g, " ").trim()
  const shape = `${text.length} chars text, ${htmlLength} chars html`
  const titled = title.trim() ? ` title=${JSON.stringify(title.trim())}` : ""
  return `${label}: ${reason} [${shape}]${titled} — ${excerpt || "(no text)"}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: PASS.

- [ ] **Step 5: Read the HTML length in `fetchOne` and use the new detail**

In `src/fetch/fan.ts`, inside `fetchOne`, replace the failure block. Before it, read the
document size — this must come after `settleText` so a slow render is not measured mid-flight:

```ts
    const raw = await settleText(page)
    const title = await page.title()
    const text = normalizeText(raw)
    // Read from the live page, not from `raw`: the point of this number is to
    // describe the document that innerText failed to extract from.
    const htmlLength = await page
      .evaluate(() => document.documentElement?.outerHTML.length ?? 0)
      .catch(() => 0)

    const reason = classifyFailure(title, text)
    if (reason) {
      throw new FetchError(reason, describeFailure(target.label, reason, title, text, htmlLength), egress)
    }
```

The `.catch(() => 0)` matters: an evaluate on a page that navigated away during a challenge
throws, and diagnosis must not turn a classified failure into an unclassified one.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/fetch/fan.ts src/fetch/fan.test.ts
git commit -m "feat(receipts): capture enough of a failure to diagnose it

'G2 reviews: empty -- (no text)' was the whole evidence the project held
about G2, and it cannot tell a refusal from an extraction defect. settleText
reads body.innerText, so a challenge in an iframe yields no text over a
substantial document. Recording html length alongside text length separates
the two; the title usually names the answer outright.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `auth_required` — a named way in is not a refusal

Reddit says "log in to your Reddit account or use your developer token". Recording that as
`blocked` reads in the ledger as *they refused us*, when what happened is *they named the way
in and we did not take it*.

**Files:**
- Modify: `src/types.ts` (extend `FailureReason`)
- Modify: `src/fetch/fan.ts` (add `AUTH_MARKERS`, extend `classifyFailure`)
- Test: `src/fetch/fan.test.ts` — **this task changes an existing assertion**

**Interfaces:**
- Produces: `FailureReason` gains `"auth_required"`.

- [ ] **Step 1: Update the existing Reddit test and add new cases**

In `src/fetch/fan.test.ts`, the existing case asserts `blocked` for `REDDIT_BLOCK`. That
assertion is now wrong and must change — do not add a second case alongside it:

```ts
describe("classifyFailure — refusals are not documents", () => {
  // Reddit's page carries block wording AND names two ways in. It is the
  // second that is true: this is an auth wall, not a refusal of automation,
  // and captcha solving does nothing for it.
  it("flags Reddit's real block page as auth_required, not blocked", () => {
    expect(classifyFailure("Reddit", REDDIT_BLOCK)).toBe("auth_required")
  })

  it("still flags a bare refusal with no way in as blocked", () => {
    expect(classifyFailure("Denied", "Access denied. Your request was refused."))
      .toBe("blocked")
  })

  it("prefers auth_required over blocked when a page carries both", () => {
    expect(classifyFailure("Reddit", "You've been blocked. Please log in to continue."))
      .toBe("auth_required")
  })
})
```

Keep every other case in that describe block unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: FAIL — received `"blocked"`, expected `"auth_required"`.

- [ ] **Step 3: Extend the reason type**

In `src/types.ts`:

```ts
/**
 * `plan_required` is not a fault of the source: the Solari plan in use does not
 * include a feature the fan asked for (stealth is paid-only). It fails every
 * source identically, so telling it apart from a blocked page is the difference
 * between "this vendor is unreadable" and "turn a flag off".
 *
 * `auth_required` is the same distinction one step further out: the source did
 * not refuse us, it named a way in we did not take. Reporting it as `blocked`
 * overstates the refusal, and this ledger's whole claim is that it describes
 * its own coverage gaps accurately.
 */
export type FailureReason =
  | "timeout" | "blocked" | "captcha" | "empty" | "http_error"
  | "plan_required" | "proxy_error" | "auth_required"
```

- [ ] **Step 4: Add the markers and the check**

In `src/fetch/fan.ts`, above `BLOCK_MARKERS`:

```ts
/**
 * Pages that name a way in.
 *
 * Reddit answers an unauthenticated search with "You've been blocked by network
 * security. To continue, log in to your Reddit account or use your developer
 * token". It carries block wording, but the operative sentence is the second
 * one: this route needs an account, and no proxy tier or stealth shim will
 * change that. Checked before BLOCK_MARKERS because that page matches both and
 * the more specific reading is the true one.
 */
const AUTH_MARKERS = [
  "log in to your reddit account", "use your developer token",
  "log in to continue", "sign in to continue", "please log in",
]
```

In `classifyFailure`, inside the `body.length < CHALLENGE_MAX_CHARS` block, **before** the
`BLOCK_MARKERS` line:

```ts
    if (AUTH_MARKERS.some((m) => hay.includes(m))) return "auth_required"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the renderers need no change**

Run: `grep -rn "plan_required\|proxy_error" src/report/`
Expected: the three renderers interpolate `f.reason` as a bare string, so `auth_required`
renders with no mapping. Confirm no switch or lookup table needs a new arm.

Run: `npm test && npm run typecheck`
Expected: PASS, no output.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/fetch/fan.ts src/fetch/fan.test.ts
git commit -m "fix(receipts): a named way in is not a refusal

Reddit says 'log in to your Reddit account or use your developer token'. The
ledger recorded that as blocked, which reads as 'they refused us' when what
happened is 'they named the way in and we did not take it'. The distinction
matters here more than most places: a ledger whose pitch is that it reports
its own blind spots accurately cannot misattribute one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `--proxy-session`, so an exit IP can be pinned

Solari documents `proxy.session` for "account-bound scraping, or any flow where a changing IP
triggers a security challenge". Task 7 needs it; `parseProxy` cannot currently express it.

**Files:**
- Modify: `src/fetch/fan.ts` (`parseProxy` signature, `FanOptions`, `fetchOne`, `fetchCorpus`)
- Modify: `src/cli/args.ts` (flag, `CliOptions`)
- Modify: `src/cli/index.ts` (usage text, call site)
- Test: `src/fetch/fan.test.ts`, `src/cli/args.test.ts`

**Interfaces:**
- Produces: `parseProxy(value: string, session?: string)`, `FanOptions.proxySession?: string`,
  `CliOptions.proxySession?: string`.

- [ ] **Step 1: Write the failing tests**

In `src/fetch/fan.test.ts`, extend the existing `parseProxy` describe block:

```ts
  it("attaches a session label to the object form", () => {
    expect(parseProxy("us:static", "warm-1"))
      .toEqual({ country: "us", tier: "static", session: "warm-1" })
  })

  // A bare country with a label must become the object form -- the string
  // form has nowhere to put it.
  it("promotes a bare country to the object form when a label is given", () => {
    expect(parseProxy("us", "warm-1")).toEqual({ country: "us", session: "warm-1" })
  })

  it("still returns the bare string when no label is given", () => {
    expect(parseProxy("us")).toBe("us")
  })

  // "smart" and "off" select the pool themselves, so there is no IP to pin.
  // Silently dropping the label would leave the caller believing sessions
  // share an IP when they do not.
  it("refuses a label that cannot be honoured", () => {
    expect(() => parseProxy("smart", "warm-1")).toThrow(/needs a country/)
    expect(() => parseProxy("off", "warm-1")).toThrow(/needs a country/)
  })
```

In `src/cli/args.test.ts`, add to the accepting describe block:

```ts
  it("takes a proxy session label", () => {
    expect(parseArgs(["acme", "--proxy", "us:static", "--proxy-session", "warm-1"]))
      .toEqual({
        subject: "acme", concurrency: 3, asJson: false, fetchOnly: false, stealth: true,
        proxy: "us:static", proxySession: "warm-1", candidates: 40,
      })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/fetch/fan.test.ts src/cli/args.test.ts`
Expected: FAIL — `parseProxy` takes one argument; `--proxy-session` is an unknown option.

- [ ] **Step 3: Extend `parseProxy`**

Replace the function in `src/fetch/fan.ts`:

```ts
export function parseProxy(
  value: string,
  session?: string,
): string | { country: string; tier?: ProxyTier; session?: string } {
  if (value === "smart" || value === "off") {
    // Refuse rather than drop it. A silently ignored label leaves the caller
    // believing several sessions share an exit IP when they do not, and the
    // flows that want one -- a login, then the pages behind it -- break in a
    // way that looks like the site challenging them.
    if (session !== undefined) {
      throw new Error(
        `--proxy-session needs a country: "${value}" picks the pool itself, so there is no IP to pin`,
      )
    }
    return value
  }
  const [country, tier] = value.split(":")
  if (tier === undefined) {
    return session === undefined ? value : { country: country!, session }
  }
  if (!PROXY_TIERS.includes(tier as ProxyTier)) {
    throw new Error(`unknown proxy tier "${tier}" — expected one of ${PROXY_TIERS.join(", ")}`)
  }
  return {
    country: country!,
    tier: tier as ProxyTier,
    ...(session !== undefined ? { session } : {}),
  }
}
```

- [ ] **Step 4: Thread it through the fan**

In `FanOptions`, after `proxyCountry?: string`:

```ts
  /**
   * Pin the exit IP across sessions. Solari documents this for account-bound
   * scraping and for flows where a changing IP is itself what triggers a
   * challenge. Only meaningful with a country; "smart" and "off" refuse it.
   */
  proxySession?: string
```

In `fetchCorpus`, read it and pass it down:

```ts
  const proxySession = opts.proxySession
```

Change `fetchOne`'s signature to take it and use it:

```ts
async function fetchOne(
  solari: Solari,
  target: SourceTarget,
  timeoutMs: number,
  proxyCountry: string,
  stealth: boolean,
  proxySession?: string,
): Promise<FetchedDoc> {
  const browser = stealth
    ? await solari.launch({ stealth: true, proxy: parseProxy(proxyCountry, proxySession) })
    : await solari.launch()
```

and at the call site in `worker`:

```ts
        docs.push(await fetchOne(solari, target, timeoutMs, proxyCountry, stealth, proxySession))
```

- [ ] **Step 5: Add the CLI flag**

In `src/cli/args.ts`, add `"--proxy-session"` to `VALUE_FLAGS`, add to `CliOptions`:

```ts
  /** Pin the exit IP across sessions. Needs a country; "smart" and "off" refuse it. */
  proxySession?: string
```

and to the returned object, beside `proxy`:

```ts
    ...(values.get("--proxy-session") !== undefined
      ? { proxySession: values.get("--proxy-session")! }
      : {}),
```

In `src/cli/index.ts`, add to `USAGE` under the `--proxy` lines:

```
  --proxy-session <label> pin one exit IP across sessions (needs a country)
```

and to the `fetchCorpus` call:

```ts
    ...(opts.proxySession !== undefined ? { proxySession: opts.proxySession } : {}),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS, no output.

- [ ] **Step 7: Commit**

```bash
git add src/fetch/fan.ts src/fetch/fan.test.ts src/cli/args.ts src/cli/args.test.ts src/cli/index.ts
git commit -m "feat(receipts): --proxy-session, so an exit IP can be pinned

Solari documents proxy.session for account-bound scraping and for flows
where a changing IP is what triggers the challenge. A label with 'smart' or
'off' is refused rather than dropped: silently ignoring it would leave the
caller believing sessions share an IP when they do not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The diagnostic matrix

**Files:**
- Create: `src/eval/egress.ts`
- Modify: `package.json` (add the `egress` script)

**Interfaces:**
- Consumes: `readEgress`, `describeFailure`, `classifyFailure`, `parseProxy` from Tasks 1–4.

- [ ] **Step 1: Write the script**

Create `src/eval/egress.ts`:

```ts
/**
 * What each egress setting actually does, per host. Spends money; never run by CI.
 *
 * The tesla.com row is here on purpose. It should report identically under
 * `smart` and `off`, which is the whole reason this file exists: the
 * measurement that set the current default was taken against that host, where
 * a proxy makes no difference to whether the page loads.
 *
 *   npm run egress
 */
import { Solari } from "@solarisdk/browser"
import { classifyFailure, describeFailure, parseProxy, readEgress } from "../fetch/fan.js"
import { normalizeText } from "../fetch/normalize.js"

const HOSTS = [
  { label: "wikipedia (control)", url: "https://en.wikipedia.org/wiki/Vercel" },
  { label: "tesla (blocks nothing)", url: "https://www.tesla.com/fsd" },
  { label: "g2", url: "https://www.g2.com/products/vercel/reviews" },
  { label: "reddit", url: "https://www.reddit.com/r/nextjs/search/?q=vercel" },
] as const

/** `webBotAuth` is tried only on the two that refuse us; it is the sanctioned lever. */
const CELLS = [
  { proxy: "smart", webBotAuth: false },
  { proxy: "us:static", webBotAuth: false },
  { proxy: "off", webBotAuth: false },
  { proxy: "us:static", webBotAuth: true, only: ["g2", "reddit"] },
] as const

interface Row {
  host: string
  proxy: string
  webBotAuth: boolean
  proxied: string
  status: number | null
  textLen: number
  htmlLen: number
  reason: string
  excerpt: string
}

async function probe(
  solari: Solari,
  host: (typeof HOSTS)[number],
  cell: (typeof CELLS)[number],
): Promise<Row> {
  const base = { host: host.label, proxy: cell.proxy, webBotAuth: cell.webBotAuth }
  let browser
  try {
    // `off` still needs stealth: the shim is what we are holding constant so
    // the proxy is the only variable in the comparison.
    browser = await solari.launch({
      stealth: true,
      proxy: parseProxy(cell.proxy),
      ...(cell.webBotAuth ? { webBotAuth: true } : {}),
    })
  } catch (err) {
    return {
      ...base, proxied: "launch failed", status: null, textLen: 0, htmlLen: 0,
      reason: "launch_error", excerpt: err instanceof Error ? err.message : String(err),
    }
  }
  const egress = readEgress(browser, cell.proxy, true)
  const proxied = egress.proxy
    ? `${egress.proxy.country}/${egress.proxy.tier ?? "default"}`
    : "NONE"
  try {
    const page = await browser.newPage()
    const response = await page.goto(host.url, { timeout: 45_000, waitUntil: "load" })
    // Same settle the fan uses, so the numbers describe what a real run sees.
    let previous = ""
    for (let i = 0; i < 6; i++) {
      const current = await page.evaluate(() => document.body?.innerText ?? "")
      if (current.length > 0 && current.length === previous.length) break
      previous = current
      await new Promise((r) => setTimeout(r, 700))
    }
    const title = await page.title()
    const text = normalizeText(previous)
    const htmlLen = await page
      .evaluate(() => document.documentElement?.outerHTML.length ?? 0)
      .catch(() => 0)
    const reason = classifyFailure(title, text)
    return {
      ...base,
      proxied,
      status: response?.status() ?? null,
      textLen: text.length,
      htmlLen,
      reason: reason ?? "ok",
      excerpt: describeFailure(host.label, reason ?? "empty", title, text, htmlLen).slice(0, 1000),
    }
  } catch (err) {
    return {
      ...base, proxied, status: null, textLen: 0, htmlLen: 0,
      reason: "threw", excerpt: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const apiKey = process.env["SOLARI_API_KEY"]
  if (!apiKey) throw new Error("egress: SOLARI_API_KEY is not set")
  const solari = new Solari({ apiKey })
  const rows: Row[] = []
  try {
    for (const cell of CELLS) {
      for (const host of HOSTS) {
        const only = "only" in cell ? (cell.only as readonly string[]) : undefined
        if (only && !only.some((k) => host.label.startsWith(k))) continue
        // Serial on purpose: a shared concurrency slot would let one cell's
        // pressure on a host show up as another cell's block.
        const row = await probe(solari, host, cell)
        rows.push(row)
        console.error(
          `${row.proxy}${row.webBotAuth ? "+wba" : ""} ${row.host}: ` +
          `proxy=${row.proxied} status=${row.status} text=${row.textLen} ` +
          `html=${row.htmlLen} ${row.reason}`,
        )
      }
    }
  } finally {
    await solari.close()
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

- [ ] **Step 2: Add the script**

In `package.json` `scripts`, after `"yield"`:

```json
    "egress": "tsx --env-file-if-exists=.env src/eval/egress.ts"
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: PASS — this task adds no tests; the script is measurement, not behaviour.

- [ ] **Step 4: Commit**

```bash
git add src/eval/egress.ts package.json
git commit -m "feat(receipts): a matrix that can tell egress settings apart

Serial, one cell at a time, recording whether a proxy was actually attached
alongside status, text length and html length. The tesla.com row is in there
deliberately: it should read identically under smart and off, which is why
the measurement that set the current default proved nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Run it, and record what it says

**Files:**
- Create: `reports/egress-2026-09-05.json`
- Modify: `docs/superpowers/specs/2026-09-05-verified-egress-design.md` (decision record)

- [ ] **Step 1: Run the matrix**

```bash
npm run egress -- > reports/egress-2026-09-05.json
```

Expected: progress lines on stderr, one per cell; JSON on stdout. Runtime roughly 3–6 minutes
for 14 cells.

- [ ] **Step 2: Answer the three questions the run exists to settle**

Read the JSON and write down, literally:

1. **Does `smart` attach a proxy?** Look at `proxied` for every `smart` row. `NONE` on all of
   them means `b52d06e` was a regression and the default must revert to `us:static` in Task 9.
2. **What is G2?** Compare `textLen` and `htmlLen` on the g2 rows. Substantial HTML with zero
   text is an extraction defect (Task 8, branch A). A challenge title with short HTML is a
   captcha (branch B). Near-zero both is a hard block (branch C).
3. **Does `webBotAuth` change anything?** Compare the `+wba` rows against their `us:static`
   counterparts on g2 and reddit.

- [ ] **Step 3: Append the decision record to the spec**

Add a `## Decision record` section to
`docs/superpowers/specs/2026-09-05-verified-egress-design.md` stating, for each of Reddit and
G2, what was measured and which route follows — and whether the captcha constraint is amended
or affirmed, with the argument. A null result is recorded as a null result.

- [ ] **Step 4: Commit**

```bash
git add reports/egress-2026-09-05.json docs/superpowers/specs/2026-09-05-verified-egress-design.md
git commit -m "run(receipts): measure what each egress setting actually does

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Reddit, behind a stored profile

Solari's profiles API stores cookies and localStorage server-side and attaches them by id, so
the login happens **once**, not once per run. Fewer logins is the point: each one is an
opportunity for a challenge.

**Files:**
- Create: `src/cli/login.ts`
- Modify: `package.json` (add the `login` script)
- Modify: `src/fetch/fan.ts` (`FanOptions.profileId`, pass to `launch`)
- Modify: `src/cli/args.ts`, `src/cli/index.ts` (`--profile`)
- Test: `src/cli/args.test.ts`

**Interfaces:**
- Consumes: `FanOptions` from Tasks 1 and 4.
- Produces: `FanOptions.profileId?: string`, `CliOptions.profileId?: string`.

**Risk, accepted in the spec:** automating a logged-in account is contrary to Reddit's user
agreement. Credentials come from the environment and are never committed; `.env` is gitignored.

- [ ] **Step 1: Write the failing test for the flag**

In `src/cli/args.test.ts`:

```ts
  it("takes a stored profile id", () => {
    expect(parseArgs(["acme", "--profile", "prof_123"]))
      .toEqual({
        subject: "acme", concurrency: 3, asJson: false, fetchOnly: false, stealth: true,
        proxy: "smart", profileId: "prof_123", candidates: 40,
      })
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/cli/args.test.ts`
Expected: FAIL — unknown option `--profile`.

- [ ] **Step 3: Add the flag**

In `src/cli/args.ts`: add `"--profile"` to `VALUE_FLAGS`; add to `CliOptions`:

```ts
  /** A stored Solari profile (cookies + localStorage), from `npm run login`. */
  profileId?: string
```

and to the return object:

```ts
    ...(values.get("--profile") !== undefined ? { profileId: values.get("--profile")! } : {}),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- src/cli/args.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the profile through the fan**

In `src/fetch/fan.ts`, add to `FanOptions`:

```ts
  /**
   * A stored Solari profile, attached to every session in the fan. This is how
   * an authenticated source is read: log in once with `npm run login`, then
   * every later run carries the cookies without logging in again.
   */
  profileId?: string
```

In `fetchCorpus`: `const profileId = opts.profileId`, pass to `fetchOne` as a further
parameter, and in `fetchOne`:

```ts
  const browser = stealth
    ? await solari.launch({
        stealth: true,
        proxy: parseProxy(proxyCountry, proxySession),
        ...(profileId !== undefined ? { profileId } : {}),
      })
    : await solari.launch(profileId !== undefined ? { profileId } : {})
```

In `src/cli/index.ts`, add to `USAGE`:

```
  --profile <id>          attach a stored profile from `npm run login`
```

and to the `fetchCorpus` call:

```ts
    ...(opts.profileId !== undefined ? { profileId: opts.profileId } : {}),
```

- [ ] **Step 6: Write the login script**

Create `src/cli/login.ts`:

```ts
/**
 * Log in to Reddit once and store the cookies as a Solari profile.
 *
 *   REDDIT_USERNAME=... REDDIT_PASSWORD=... npm run login
 *
 * Prints a profile id. Pass it to later runs as `--profile <id>` and they
 * carry the session without logging in again -- which is the point: each
 * login is an opportunity for a challenge, and there is no reason to spend
 * one per run.
 *
 * The exit IP should be pinned for this and for the runs that use the
 * profile, or Reddit sees an account whose IP changes every request:
 *
 *   npm run login
 *   npm run cli -- vercel --proxy us:static --proxy-session reddit-1 --profile <id>
 */
import { Solari } from "@solarisdk/browser"

const LOGIN_URL = "https://www.reddit.com/login"

async function main(): Promise<void> {
  const apiKey = process.env["SOLARI_API_KEY"]
  const username = process.env["REDDIT_USERNAME"]
  const password = process.env["REDDIT_PASSWORD"]
  if (!apiKey) throw new Error("login: SOLARI_API_KEY is not set")
  if (!username || !password) {
    throw new Error("login: set REDDIT_USERNAME and REDDIT_PASSWORD in .env")
  }
  const label = process.argv[2] ?? "reddit"
  const proxySession = process.env["REDDIT_PROXY_SESSION"] ?? "reddit-1"

  const solari = new Solari({ apiKey })
  try {
    const browser = await solari.launch({
      stealth: true,
      proxy: { country: "us", tier: "static", session: proxySession },
    })
    try {
      const page = await browser.newPage()
      await page.goto(LOGIN_URL, { timeout: 45_000, waitUntil: "load" })
      await page.fill("input[name='username']", username)
      await page.fill("input[name='password']", password)
      await page.click("button[type='submit']")
      // Wait for the cookie, not for a timer: a fixed sleep either wastes time
      // or captures a half-finished login, and both fail silently later.
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45_000 })

      const state = await page.context().storageState()
      const profile = await solari.profiles.create({ name: label })
      const saved = await solari.profiles.save(profile.id, state)
      console.error(`saved ${saved.sizeBytes} bytes to profile ${profile.id}`)
      console.log(profile.id)
    } finally {
      await browser.close()
    }
  } finally {
    await solari.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

In `package.json` `scripts`:

```json
    "login": "tsx --env-file-if-exists=.env src/cli/login.ts"
```

Add to `.env.example`:

```
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
```

- [ ] **Step 7: Verify offline, then live**

Run: `npm test && npm run typecheck`
Expected: PASS, no output.

Then, with credentials in `.env`:

```bash
npm run login
```

Expected: a profile id on stdout. If Reddit presents a challenge instead, **stop** — record
that in the decision record as the measured outcome and leave Reddit as `auth_required`. Do
not add captcha solving to reach it; that decision belongs to Task 8 and to the record, not
to a login script.

- [ ] **Step 8: Commit**

```bash
git add src/cli/login.ts src/cli/args.ts src/cli/args.test.ts src/cli/index.ts src/fetch/fan.ts package.json .env.example
git commit -m "feat(receipts): read Reddit from behind a stored profile

Solari stores cookies server-side and attaches them by id, so the login
happens once rather than once per run -- which matters, because each login
is an opportunity for a challenge. Credentials come from the environment and
are never committed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: G2, on the branch the evidence selected

Task 6 chose one of three. Implement only that one.

**Branch A — substantial HTML, no text: an extraction defect.**

**Files:** `src/fetch/fan.ts` (`settleText`), `src/fetch/fan.test.ts`

`settleText` polls `body.innerText` six times at 700ms and gives up. Raise the budget and
stop on a stable non-empty read from the largest frame rather than the main one:

```ts
async function settleText(
  page: { evaluate: (fn: () => string) => Promise<string> },
  attempts = 10,
  intervalMs = 700,
): Promise<string> {
```

Extract the polling predicate into a pure `hasSettled(previous: string, current: string):
boolean` and unit-test it: empty then empty is not settled, "abc" twice is settled, growth is
not settled. Do not test the polling loop itself — it is a timing wrapper.

**Branch B — a challenge widget.** Do not implement anything in this task. Write the argument
for or against `captcha: true` into the spec's decision record, get it approved, and only then
open a follow-up task. The Global Constraints forbid the flag until that record exists.

**Branch C — a hard block.** No code. Confirm the failure now records the correct reason and
detail from Tasks 2 and 3, and carry the measured wording into the README in Task 9.

- [ ] **Step 1: Re-read Task 6's decision record and state which branch applies**
- [ ] **Step 2: Implement only that branch (A: code + tests; B: written argument only; C: no code)**
- [ ] **Step 3: `npm test && npm run typecheck`** — Expected: PASS, no output
- [ ] **Step 4: Commit, with a message naming the measurement that selected the branch**

---

### Task 9: Make the documentation true

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-04-density.md`
- Modify: `src/cli/args.ts` — only if Task 6 showed `smart` attaches no proxy

- [ ] **Step 1: Revert the default if the evidence says so**

If every `smart` row in `reports/egress-2026-09-05.json` reported `proxy=NONE`, change
`src/cli/args.ts`:

```ts
    // Measured 2026-09-05 (reports/egress-2026-09-05.json): "smart" resolved to
    // no proxy on every host tried, so it was never egress at all. "us:static"
    // is the tier this account actually has.
    proxy: values.get("--proxy") ?? "us:static",
```

and update **every** `parseArgs` default assertion in `src/cli/args.test.ts` from `"smart"` to
`"us:static"` — there are two in the original file and Task 7 adds a third.

- [ ] **Step 2: Delete the false sentence**

In `README.md`, the paragraph beginning "Reddit and G2 are in the source plan and usually
refuse" claims Reddit "blocks even stealth plus a residential proxy". Residential never opened
a tunnel on this account, so that experiment has no result. Replace the paragraph with what
Task 6 measured, naming the date and pointing at `reports/egress-2026-09-05.json`.

- [ ] **Step 3: State the access stance in the README**

The reasoning for reporting refusals as `not read` lives only in a plan file. Add a short
README section stating it, and — whichever way Task 6's record went — say what the project
does and does not do to reach a source that refuses it.

- [ ] **Step 4: Re-date the proxy table**

Update the README's proxy tier table with Task 6's numbers and the date measured, and record
what `webBotAuth` did.

- [ ] **Step 5: Mark the superseded items in the density plan**

In `docs/superpowers/plans/2026-09-04-density.md`, Task 5: tick the proxy-verification,
`webBotAuth` and sticky-session items and point them at this plan. Leave the tier × country
grid open.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck`
Expected: PASS, no output.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-04-density.md src/cli/args.ts src/cli/args.test.ts
git commit -m "docs: say only what was measured

The README claimed Reddit blocks stealth plus a residential proxy. That
experiment never ran -- residential never opened a tunnel on this account,
so the requests failed at egress and never reached Reddit. Replaced with the
2026-09-05 measurements, dated, alongside the run that produced them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Every fetched document and every failure records the egress that produced it.
- `reports/egress-2026-09-05.json` is committed, and `smart` is characterised either way.
- Reddit and G2 each carry a recorded, argued access decision in the spec's decision record.
- The captcha constraint is amended or affirmed **in writing**, on evidence.
- No claim in the README describes a measurement that was not taken.

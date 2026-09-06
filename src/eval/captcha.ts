/**
 * Why G2's challenge does not solve.
 *
 * Spends money; CI never runs it. The two exported helpers are pure and tested;
 * everything below them is the probe, kept inert on import by the run-as-main
 * guard at the bottom so the test file can load this module safely.
 *
 *   npm run captcha                          # 8 attempts, 7 min apart, us:static
 *   npm run captcha -- 4 2 us:mobile         # 4 attempts, 2 min apart, mobile tier
 *
 * The third argument is the egress under test. Whether it is the challenge or
 * the exit's reputation that blocks us is the open question this probe was
 * left with, and the tier is the only variable that separates them.
 */

import { renameSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { Solari } from "@solarisdk/browser"
import { classifyFailure, parseProxy, readEgress } from "../fetch/fan.js"
import { normalizeText } from "../fetch/normalize.js"
import type { Egress, FailureReason } from "../types.js"

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
  { name: "datadome", hosts: ["captcha-delivery.com", "datadome.co"] },
  { name: "hcaptcha", hosts: ["hcaptcha.com"] },
  { name: "recaptcha", hosts: ["google.com/recaptcha", "gstatic.com/recaptcha"] },
  { name: "turnstile", hosts: ["challenges.cloudflare.com"] },
  { name: "perimeterx", hosts: ["perimeterx.net", "px-cloud.net", "px-cdn.net"] },
]

/**
 * Pure: name the challenge vendor a page loads, or null if it loads none.
 *
 * The match is a substring test, not a domain-boundary or script-context one:
 * a page whose prose quotes a literal host would match. Acceptable in an
 * eval-only probe pointed at one known URL; not a general-purpose detector.
 */
export function fingerprintChallenge(html: string): string | null {
  const hay = html.toLowerCase()
  for (const vendor of CHALLENGE_VENDORS) {
    if (vendor.hosts.some((host) => hay.includes(host))) return vendor.name
  }
  return null
}

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
 * that number is two different facts wearing the same clothes.
 * A solve that produced nothing visible and a solve that was still working
 * when the budget expired both end at zero text, and they call for opposite
 * fixes: abandon the route, or raise the budget.
 *
 * `immediate` means only that text was present from the first sample. It does
 * NOT mean no challenge existed: measured against G2 on the mobile tier, the
 * text present from sample one was the challenge's own 43-character "Please
 * enable JS and disable any ad blocker" message.
 *
 * `flat` is scoped to what the poll can see. The poll reads the TOP document,
 * and a challenge hosted in a cross-origin iframe is invisible to it — so
 * `flat` means "nothing we can see happened", never "nothing happened".
 * Measured against G2 on 2026-09-05: the top frame held byte-identical at
 * 2,669 bytes for 480 consecutive samples while a DataDome device check ran
 * inside an iframe we could not read.
 *
 * `cut-off` is checked before `immediate` deliberately. A trace that starts
 * non-zero and is still climbing is reported as cut off, because "still growing
 * when we stopped looking" is the fact that changes what we do.
 */
export function classifyTrace(trace: readonly PollSample[]): TraceShape {
  if (trace.length === 0) return "flat"
  if (trace.every((sample) => sample.textLen === 0)) return "flat"

  // Ends empty after text had appeared: the page was mid-transition when the
  // budget expired. A successful solve navigates, and document.body reads
  // empty during that navigation -- so this is the budget binding, and
  // reporting it as `late-arrival` would claim the solve landed cleanly.
  if (trace[trace.length - 1]!.textLen === 0) return "cut-off"

  const last = trace[trace.length - 1]!
  const prior = trace[trace.length - 2]
  if (prior !== undefined && last.textLen > prior.textLen) return "cut-off"
  if (trace[0]!.textLen > 0) return "immediate"
  return "late-arrival"
}

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

/**
 * What a *successful solve* looks like from inside the poll loop: the page
 * navigates to the real content and the evaluate in flight loses its context.
 *
 * Anything not on this list -- a crashed tab, a killed session, a protocol
 * error -- also throws, also shortens the trace, and would otherwise be
 * indistinguishable from the outcome we are waiting for. A dead browser must
 * not be able to masquerade as a solve.
 */
const NAVIGATION_ERRORS = ["Execution context was destroyed", "Cannot find context"]

export interface Attempt {
  attempt: number
  startedAt: string
  totalMs: number
  pollTrace: PollSample[]
  /** Polls skipped because the page navigated: the signature of a solve landing. */
  navigationGaps: number
  /**
   * Polls that failed for any other reason. A non-empty list means the trace is
   * missing samples for reasons that are NOT a solve, so it must not be read as
   * though it were a complete record of the attempt.
   */
  pollErrors: string[]
  challenge: string | null
  htmlSample: string
  outcome: FailureReason | "ok"
  traceShape: TraceShape
  egress: Egress
  error?: string
}

async function runAttempt(solari: Solari, attempt: number, requested: string): Promise<Attempt> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const pollTrace: PollSample[] = []
  let navigationGaps = 0
  const pollErrors: string[] = []

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
      navigationGaps: 0, pollErrors: [],
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
      } catch (err) {
        // A solve that succeeds navigates, and an evaluate in flight across
        // that navigation throws "Execution context was destroyed". That is the
        // outcome being waited for, so it is a gap in the trace, not a failure.
        const message = err instanceof Error ? err.message : String(err)
        if (NAVIGATION_ERRORS.some((m) => message.includes(m))) navigationGaps++
        else pollErrors.push(message)
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }

    const rawText = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")
    const html = await page.evaluate(() => document.documentElement?.outerHTML ?? "").catch(() => "")
    const title = await page.title().catch(() => "")
    const text = normalizeText(rawText)

    return {
      attempt, startedAt, totalMs: Date.now() - t0, pollTrace,
      navigationGaps, pollErrors,
      challenge: fingerprintChallenge(html),
      htmlSample: html.slice(0, HTML_SAMPLE_CHARS),
      outcome: classifyFailure(title, text) ?? "ok",
      traceShape: classifyTrace(pollTrace),
      egress,
    }
  } catch (err) {
    return {
      attempt, startedAt, totalMs: Date.now() - t0, pollTrace,
      navigationGaps, pollErrors,
      challenge: null, htmlSample: "", outcome: "http_error",
      traceShape: classifyTrace(pollTrace), egress,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await browser.close()
  }
}

/**
 * Pure: where a run's report belongs.
 *
 * Under `reports/measurements/`, not `reports/` itself: the Pages workflow
 * globs `reports/*.json` and renders every match as a claim ledger. A
 * diagnostic file with no ledger `rows` crashed that build for two days
 * before anyone noticed -- the top-level directory is reports the site
 * renders, and this is not one.
 *
 * The proxy is in the filename because the egress is the variable under test.
 * Two runs on the same day under different tiers are two different
 * measurements, and letting the second land on the first would destroy the
 * comparison being made -- which is the only reason the second run exists.
 *
 * The slug is not injective -- "us:static" and "us-static" both become
 * "us-static". Safe here because the only caller passes a value parseProxy has
 * already validated against the country:tier grammar, and worth knowing before
 * feeding this anything less constrained.
 */
export function reportPath(proxy: string, now: Date = new Date()): string {
  const slug = proxy.replace(/[^a-z0-9]+/gi, "-")
  return `reports/measurements/captcha-probe-${now.toISOString().slice(0, 10)}-${slug}.json`
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

  const proxy = argv[2] ?? "us:static"
  // Validate the proxy here, before the key is read and before anything is
  // launched. parseProxy throws on an unknown tier, and discovering that after
  // a session has been created would mean paying for the typo.
  parseProxy(proxy)

  const apiKey = process.env["SOLARI_API_KEY"]
  if (!apiKey) throw new Error("captcha: SOLARI_API_KEY is not set")

  const path = reportPath(proxy)

  const solari = new Solari({ apiKey })
  const results: Attempt[] = []
  try {
    for (let i = 1; i <= attempts; i++) {
      let result: Attempt
      try {
        result = await runAttempt(solari, i, proxy)
      } catch (err) {
        // runAttempt guards its own body, but browser.close() in its finally
        // throws on a flaky session. Losing an hour of paid evidence to a
        // failed teardown would be the worst trade available.
        result = {
          attempt: i, startedAt: new Date().toISOString(), totalMs: 0, pollTrace: [],
          navigationGaps: 0, pollErrors: [],
          challenge: null, htmlSample: "", outcome: "http_error", traceShape: "flat",
          egress: { requested: proxy, stealth: true },
          error: err instanceof Error ? err.message : String(err),
        }
      }
      results.push(result)
      // Written after every attempt, not once at the end: the run spans an
      // hour, and a crash at attempt seven must not discard the six already
      // paid for.
      writeReportTo(path, { measuredAt: new Date().toISOString(), target: TARGET, requested: proxy, attempts: results })
      const finalText = result.pollTrace[result.pollTrace.length - 1]?.textLen ?? 0
      const proxied = result.egress.proxy
        ? `${result.egress.proxy.country}/${result.egress.proxy.tier ?? "default"}`
        : "NONE"
      console.error(
        `attempt ${i}/${attempts}: ${result.outcome} trace=${result.traceShape} ` +
        `challenge=${result.challenge ?? "none"} text=${finalText} ` +
        `proxy=${proxied} gaps=${result.navigationGaps} pollErrors=${result.pollErrors.length} ` +
        `${result.totalMs}ms${result.error ? ` ERROR ${result.error}` : ""}`,
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

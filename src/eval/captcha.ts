/**
 * Why G2's challenge solves about one attempt in four.
 *
 * Spends money; CI never runs it. The two exported helpers are pure and tested;
 * everything below them is the probe, kept inert on import by the run-as-main
 * guard at the bottom so the test file can load this module safely.
 */

import { writeFileSync } from "node:fs"
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

import { createHash } from "node:crypto"
import { Solari } from "@solarisdk/browser"
import { normalizeText } from "./normalize.js"
import type {
  Corpus, FailureReason, FetchedDoc, RoleLabels, SourceFailure, SourceTarget,
} from "../types.js"

export interface FanOptions {
  apiKey: string
  concurrency?: number
  perSourceTimeoutMs?: number
  proxyCountry?: string
  labels?: RoleLabels
  /**
   * Stealth and residential proxy egress. Defaults on, because the sources
   * worth reading (G2, Reddit, Trustpilot) block datacenter traffic — but it
   * is a paid Solari feature, and asking for it on a free plan fails every
   * source with 402 before a page is fetched. Off, the vendor's own pages
   * still read; the independent ones mostly will not.
   */
  stealth?: boolean
}

/**
 * The managed proxy could not open a tunnel to the host.
 *
 * Observed against hn.algolia.com and g2.com while getsolari.com and
 * reddit.com tunnelled fine on the same run, so it is per-host and not a
 * blanket outage. It is our egress failing, not the source refusing us --
 * reporting it as a generic http_error reads in the ledger as "this source
 * could not be reached", which is the same misattribution as blaming a vendor
 * for a plan restriction.
 */
export function isProxyError(message: string): boolean {
  return message.includes("ERR_TUNNEL_CONNECTION_FAILED")
    || message.includes("ERR_PROXY_CONNECTION_FAILED")
}

/** Solari rejected a feature the plan does not include — true of every source. */
export function isPlanError(message: string): boolean {
  return message.includes("FeatureRequiresPlan") || message.includes("requires a paid plan")
}

/** Interstitials that want the visitor to prove they are human. */
const CAPTCHA_MARKERS = [
  "verify you are human", "checking your browser", "captcha",
  "are you a robot", "enable javascript and cookies",
]

/**
 * Refusals — the host recognised automation and said no.
 *
 * Observed, not guessed: Reddit answers a non-stealth browser with 222
 * characters of "You've been blocked by network security", which clears the
 * useful-length floor and carries none of the captcha wording. It therefore
 * entered the corpus as a genuine independent source, and the model was asked
 * to find contradictions against a refusal notice. A short page that says it
 * blocked you is not a document.
 */
const BLOCK_MARKERS = [
  "blocked by network security", "you've been blocked", "you have been blocked",
  "access denied", "access to this page has been denied", "rate limit",
  "unusual traffic", "automated requests",
]

/**
 * Search pages reporting that they matched nothing.
 *
 * Hacker News answers a search with no hits in 248 characters — "0 results",
 * "We found no stories matching getsolari.com", and its own navigation. That
 * clears the useful-length floor, so it entered the corpus as an independent
 * source whose entire content was chrome and a statement of its own emptiness.
 *
 * This is the third shape of the same mistake, after a block notice and a
 * challenge interstitial: a page whose subject is its own failure to have
 * content is not content. Length alone cannot tell them apart from a document,
 * because site furniture is never short.
 */
const NO_RESULT_MARKERS = [
  "0 results", "no results", "found no stories", "did not match any",
  "no matches found", "nothing found",
]

/**
 * Much tighter than the challenge bound, because this wording is ordinary.
 * "No results were observed" is a normal sentence in a real article, so the
 * marker alone cannot carry the decision — an empty results page is only ever
 * site furniture, a few hundred characters at most.
 */
const NO_RESULT_MAX_CHARS = 600

const MIN_USEFUL_CHARS = 200
const CHALLENGE_MAX_CHARS = 2000

/** Pure: decide whether a fetched page is unusable, and why. */
export function classifyFailure(title: string, text: string): FailureReason | null {
  const body = text.trim()
  // Scan the body only, not the title — a headline like "Captcha solving guide"
  // carries a marker word the page content does not support.
  const hay = body.toLowerCase()
  // This marker check MUST stay ahead of the length gate below. A challenge
  // interstitial ("Checking your browser…") is usually short, so a length-gate
  // `return "empty"` placed first would shadow it and the marker check could
  // never fire. `captcha` is strictly more informative than `empty`, so it wins.
  // The size bound keeps a long article that merely mentions captchas — a
  // legitimate document — from being flagged.
  if (body.length < CHALLENGE_MAX_CHARS) {
    // Refusal before challenge: a page that says it blocked you is more
    // specific than one that asks you to prove yourself, and both beat "empty".
    if (BLOCK_MARKERS.some((m) => hay.includes(m))) return "blocked"
    if (CAPTCHA_MARKERS.some((m) => hay.includes(m))) return "captcha"
  }
  if (body.length < NO_RESULT_MAX_CHARS && NO_RESULT_MARKERS.some((m) => hay.includes(m))) {
    return "empty"
  }
  if (body.length < MIN_USEFUL_CHARS) return "empty"
  return null
}

/** Pure: stable per-URL document id. */
export function docIdFor(target: SourceTarget): string {
  return createHash("sha256").update(target.url).digest("hex").slice(0, 12)
}

/** Poll a page's text until two consecutive reads agree, or the budget runs out. */
async function settleText(
  page: { evaluate: (fn: () => string) => Promise<string> },
  attempts = 6,
  intervalMs = 700,
): Promise<string> {
  let previous = ""
  for (let i = 0; i < attempts; i++) {
    const current = await page.evaluate(() => document.body?.innerText ?? "")
    // Stable and non-trivial: nothing more is coming.
    if (current.length > 0 && current.length === previous.length) return current
    previous = current
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return previous
}

class FetchError extends Error {
  constructor(public reason: FailureReason, message: string) {
    super(message)
    this.name = "FetchError"
  }
}

async function fetchOne(
  solari: Solari,
  target: SourceTarget,
  timeoutMs: number,
  proxyCountry: string,
  stealth: boolean,
): Promise<FetchedDoc> {
  // `proxy` and `captcha` both require `stealth: true` — a proxied request from
  // an obviously-automated browser is the pairing that gets blocked. With
  // stealth off the proxy must go too, or the launch is rejected.
  const browser = stealth
    ? await solari.launch({ stealth: true, proxy: proxyCountry })
    : await solari.launch()
  try {
    const page = await browser.newPage()
    await page.goto(target.url, { timeout: timeoutMs, waitUntil: "load" })

    // Several sources worth reading render their content with JavaScript after
    // load: Hacker News' search UI returned 9,487 characters on one run and
    // nothing on the next, from the same URL. An unrendered page reports as
    // `empty`, which reads as "this source had nothing to say" — indistinguish-
    // able in the report from a source that genuinely didn't. Poll until the
    // text stops growing, then take it.
    const raw = await settleText(page)
    const title = await page.title()
    const text = normalizeText(raw)

    const reason = classifyFailure(title, text)
    if (reason) {
      // Carry what the page actually said. Without it the failure detail reads
      // "G2 reviews: empty", which cannot distinguish a 404 from a block page
      // from a genuinely empty result -- and that evidence is exactly what a
      // reader of the report needs to judge the gap in coverage.
      const excerpt = text.slice(0, 200).replace(/\s+/g, " ").trim()
      throw new FetchError(reason, `${target.label}: ${reason} — ${excerpt || "(no text)"}`)
    }

    return {
      docId: docIdFor(target),
      url: target.url,
      label: target.label,
      role: target.role,
      kind: target.kind,
      fetchedAt: new Date().toISOString(),
      title,
      text,
      sessionId: browser.id,
    }
  } finally {
    // close() RELEASES the session, not just the local handle. Skipping it holds
    // the concurrency slot until the plan deadline.
    await browser.close()
  }
}

export async function fetchCorpus(
  subject: string,
  targets: SourceTarget[],
  opts: FanOptions,
): Promise<Corpus> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const timeoutMs = opts.perSourceTimeoutMs ?? 45_000
  const proxyCountry = opts.proxyCountry ?? "us"
  const stealth = opts.stealth ?? true

  const solari = new Solari({ apiKey: opts.apiKey })
  const docs: FetchedDoc[] = []
  const failures: SourceFailure[] = []
  const queue = [...targets]

  async function worker(): Promise<void> {
    for (;;) {
      const target = queue.shift()
      if (!target) return
      try {
        docs.push(await fetchOne(solari, target, timeoutMs, proxyCountry, stealth))
      } catch (err) {
        // One blocked source must never fail the run. Partial coverage is a
        // legitimate result and the report says so.
        const detail = err instanceof Error ? err.message : String(err)
        failures.push({
          url: target.url,
          label: target.label,
          reason: err instanceof FetchError
            ? err.reason
            : isPlanError(detail) ? "plan_required"
            : isProxyError(detail) ? "proxy_error"
            : "http_error",
          detail,
        })
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
    )
  } finally {
    // REQUIRED in Node: the client keeps a loopback proxy server open for the
    // connection-retry path, and that handle keeps the event loop alive. Skip
    // this and the process prints its output and then hangs forever.
    await solari.close()
  }

  // Deterministic order so fixtures diff cleanly.
  docs.sort((a, b) => a.docId.localeCompare(b.docId))
  failures.sort((a, b) => a.url.localeCompare(b.url))
  return { subject, docs, failures, ...(opts.labels ? { labels: opts.labels } : {}) }
}

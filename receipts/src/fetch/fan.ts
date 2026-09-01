import { createHash } from "node:crypto"
import { Solari } from "@solarisdk/browser"
import { normalizeText } from "./normalize.js"
import type {
  Corpus, FailureReason, FetchedDoc, SourceFailure, SourceTarget,
} from "../types.js"

export interface FanOptions {
  apiKey: string
  concurrency?: number
  perSourceTimeoutMs?: number
  proxyCountry?: string
}

const CHALLENGE_MARKERS = [
  "verify you are human", "checking your browser", "captcha",
  "are you a robot", "access denied", "enable javascript and cookies",
]

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
  if (body.length < CHALLENGE_MAX_CHARS && CHALLENGE_MARKERS.some((m) => hay.includes(m))) {
    return "captcha"
  }
  if (body.length < MIN_USEFUL_CHARS) return "empty"
  return null
}

/** Pure: stable per-URL document id. */
export function docIdFor(target: SourceTarget): string {
  return createHash("sha256").update(target.url).digest("hex").slice(0, 12)
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
): Promise<FetchedDoc> {
  // `proxy` and `captcha` both require `stealth: true` — a proxied request from
  // an obviously-automated browser is the pairing that gets blocked.
  const browser = await solari.launch({ stealth: true, proxy: proxyCountry })
  try {
    const page = await browser.newPage()
    await page.goto(target.url, { timeout: timeoutMs, waitUntil: "domcontentloaded" })
    const title = await page.title()
    const raw = await page.evaluate(() => document.body?.innerText ?? "")
    const text = normalizeText(raw)

    const reason = classifyFailure(title, text)
    if (reason) throw new FetchError(reason, `${target.label}: ${reason}`)

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

  const solari = new Solari({ apiKey: opts.apiKey })
  const docs: FetchedDoc[] = []
  const failures: SourceFailure[] = []
  const queue = [...targets]

  async function worker(): Promise<void> {
    for (;;) {
      const target = queue.shift()
      if (!target) return
      try {
        docs.push(await fetchOne(solari, target, timeoutMs, proxyCountry))
      } catch (err) {
        // One blocked source must never fail the run. Partial coverage is a
        // legitimate result and the report says so.
        failures.push({
          url: target.url,
          label: target.label,
          reason: err instanceof FetchError ? err.reason : "http_error",
          detail: err instanceof Error ? err.message : String(err),
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
  return { subject, docs, failures }
}

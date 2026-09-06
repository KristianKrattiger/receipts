import { Solari } from "@solarisdk/browser"
import { docIdFor, FetchError } from "./common.js"
export { docIdFor } from "./common.js"
import { normalizeText } from "./normalize.js"
import { fetchRedditDoc, isRedditTarget, type RedditCreds } from "./reddit.js"
import type {
  Corpus, Egress, FailureReason, FetchedDoc, RoleLabels, SourceFailure, SourceTarget,
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
  /**
   * Pin the exit IP across sessions. Solari documents this for account-bound
   * scraping and for flows where a changing IP is itself what triggers a
   * challenge. Only meaningful with a country; "smart" and "off" refuse it.
   */
  proxySession?: string
  /**
   * A stored Solari profile, attached to every session in the fan. This is how
   * an authenticated source is read: log in once with `npm run login`, then
   * every later run carries the cookies without logging in again. Each login
   * is an opportunity for a challenge, so spending one per run is waste.
   */
  profileId?: string
  /**
   * Managed captcha solving. Requires `stealth: true`, so it is ignored when
   * stealth is off.
   *
   * Enabled by policy on 2026-09-05, reversing this project's original stance.
   * The reversal is recorded rather than assumed: reports/egress-2026-09-05.json
   * measured Reddit, behind a working proxy, answering 200 with a human-
   * verification challenge rather than the block page an unproxied run sees.
   * The README states what this does and does not mean.
   */
  captcha?: boolean
  /**
   * Reddit application credentials. Absent means Reddit reports `auth_required`
   * and the run continues -- a contributor without them still gets a ledger,
   * with Reddit named as unread, which is the honest coverage of that run.
   */
  reddit?: RedditCreds
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

/**
 * Interstitials that want the visitor to prove they are human.
 *
 * The last three were added from a measurement, not from imagination:
 * reports/egress-2026-09-05.json caught Reddit serving "Prove your humanity /
 * Complete the challenge below and let us know you're a real person" in 240
 * characters. That cleared MIN_USEFUL_CHARS and matched none of the first four,
 * so it classified as a readable document and would have entered a ledger as a
 * genuine independent Reddit source -- the model asked to find contradictions
 * against a challenge notice.
 */
const CAPTCHA_MARKERS = [
  "verify you are human", "checking your browser", "captcha",
  "are you a robot", "enable javascript and cookies",
  "prove your humanity", "complete the challenge", "you're a real person",
]

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
  // Reddit's rate-limit page, captured 2026-09-05: "whoa there, pardner! ...
  // We've seen far too many requests come from your IP address recently."
  // 575 characters, clearing the floor, and "rate limit" above did not match a
  // page that never uses the phrase. It entered a corpus as a Reddit document.
  "too many requests", "whoa there",
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
  //
  // Fold typographic apostrophes to ASCII first. Reddit's challenge page writes
  // "We’re" and "you’re" with U+2019, and normalizeText leaves them alone, so a
  // marker written the obvious way would silently never match. A marker list is
  // only as good as the shape of the text it is compared against.
  const hay = body.toLowerCase().replace(/[‘’]/g, "'")
  // This marker check MUST stay ahead of the length gate below. A challenge
  // interstitial ("Checking your browser…") is usually short, so a length-gate
  // `return "empty"` placed first would shadow it and the marker check could
  // never fire. `captcha` is strictly more informative than `empty`, so it wins.
  // The size bound keeps a long article that merely mentions captchas — a
  // legitimate document — from being flagged.
  if (body.length < CHALLENGE_MAX_CHARS) {
    // A named way in beats a refusal: Reddit's page matches both, and "they
    // told us to log in" is the true reading of it.
    if (AUTH_MARKERS.some((m) => hay.includes(m))) return "auth_required"
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

/**
 * Pure: have two consecutive reads agreed in a way worth stopping for?
 *
 * `waitThroughChallenge` is the whole subtlety. A challenge interstitial is
 * short and perfectly stable, so the agree-twice test fires on it in about
 * 1.4 seconds -- and with a solver running, that is precisely the page not to
 * stop on. Measured: G2 recorded 0 characters for weeks, and
 * reports/egress-2026-09-05-captcha.json turned that into 3,856 characters of
 * the real review page by doing nothing except waiting longer.
 */
export function hasSettled(
  previous: string,
  current: string,
  waitThroughChallenge: boolean,
): boolean {
  if (current.length === 0 || current.length !== previous.length) return false
  if (!waitThroughChallenge) return true
  return classifyFailure("", normalizeText(current)) !== "captcha"
}

/**
 * Poll a page's text until it settles, or the budget runs out.
 *
 * The budget is much larger with a solver running, because the solve takes
 * seconds and a navigation follows it.
 */
async function settleText(
  page: { evaluate: (fn: () => string) => Promise<string> },
  waitThroughChallenge = false,
  attempts = waitThroughChallenge ? 60 : 6,
  intervalMs = 700,
): Promise<string> {
  let previous = ""
  for (let i = 0; i < attempts; i++) {
    // A solve that succeeds NAVIGATES, and an evaluate in flight across that
    // navigation throws "Execution context was destroyed". Letting that escape
    // would turn the one outcome we are waiting for into a failed fetch.
    let current: string
    try {
      current = await page.evaluate(() => document.body?.innerText ?? "")
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    if (hasSettled(previous, current, waitThroughChallenge)) return current
    previous = current
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return previous
}

/** Proxy tiers Solari offers. `residential` is its default when none is named. */
const PROXY_TIERS = ["residential", "static", "mobile"] as const
type ProxyTier = (typeof PROXY_TIERS)[number]

/**
 * Turn a `--proxy` value into what `launch` wants.
 *
 * Solari accepts a bare country code, an object naming a country and a tier, or
 * the strings "smart" and "off". Only the bare-string form was reachable here,
 * which quietly pinned every run to the default `residential` tier — and a tier
 * that is unavailable fails as `ERR_TUNNEL_CONNECTION_FAILED` on page.goto,
 * indistinguishable from a host refusing the proxy. Both US and GB residential
 * failed that way on this account while `{ country: "us", tier: "static" }`
 * read the same page, so the country was never the variable.
 *
 * `us:static` is the syntax; a bare `us` still means what it always did.
 */
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

async function fetchOne(
  solari: Solari,
  target: SourceTarget,
  timeoutMs: number,
  proxyCountry: string,
  stealth: boolean,
  proxySession?: string,
  profileId?: string,
  captcha?: boolean,
): Promise<FetchedDoc> {
  // `proxy` and `captcha` both require `stealth: true` — a proxied request from
  // an obviously-automated browser is the pairing that gets blocked. With
  // stealth off the proxy must go too, or the launch is rejected.
  const browser = stealth
    ? await solari.launch({
        stealth: true,
        proxy: parseProxy(proxyCountry, proxySession),
        ...(captcha ? { captcha: true } : {}),
        ...(profileId !== undefined ? { profileId } : {}),
      })
    : await solari.launch(profileId !== undefined ? { profileId } : {})
  const egress = readEgress(browser, proxyCountry, stealth)
  try {
    const page = await browser.newPage()
    await page.goto(target.url, { timeout: timeoutMs, waitUntil: "load" })

    // Several sources worth reading render their content with JavaScript after
    // load: Hacker News' search UI returned 9,487 characters on one run and
    // nothing on the next, from the same URL. An unrendered page reports as
    // `empty`, which reads as "this source had nothing to say" — indistinguish-
    // able in the report from a source that genuinely didn't. Poll until the
    // text stops growing, then take it.
    const raw = await settleText(page, captcha)
    const title = await page.title().catch(() => "")
    const text = normalizeText(raw)
    // Read from the live page, not from `raw`: the point of this number is to
    // describe the document that innerText failed to extract from. The catch
    // matters -- an evaluate on a page that navigated away mid-challenge
    // throws, and diagnosis must not turn a classified failure into an
    // unclassified one.
    const htmlLength = await page
      .evaluate(() => document.documentElement?.outerHTML.length ?? 0)
      .catch(() => 0)

    const reason = classifyFailure(title, text)
    if (reason) {
      // Carry what the page actually said, and how big it was. Without both
      // the detail reads "G2 reviews: empty", which cannot distinguish a 404
      // from a block page from a challenge whose text lives in an iframe --
      // and that evidence is exactly what a reader of the report needs to
      // judge the gap in coverage.
      throw new FetchError(
        reason,
        describeFailure(target.label, reason, title, text, htmlLength),
        egress,
      )
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
      egress,
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
  const proxySession = opts.proxySession
  const profileId = opts.profileId
  const captcha = opts.captcha ?? false
  const reddit = opts.reddit

  const solari = new Solari({ apiKey: opts.apiKey })
  const docs: FetchedDoc[] = []
  const failures: SourceFailure[] = []
  const queue = [...targets]

  /** Missing credentials are a `not read` row with a reason, never a crash. */
  async function fetchRedditDocOrExplain(
    target: SourceTarget,
    creds: RedditCreds | undefined,
  ): Promise<FetchedDoc> {
    if (!creds) {
      throw new FetchError(
        "auth_required",
        `${target.label}: set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to read Reddit`,
      )
    }
    return fetchRedditDoc(target, creds)
  }

  async function worker(): Promise<void> {
    for (;;) {
      const target = queue.shift()
      if (!target) return
      try {
        docs.push(
          isRedditTarget(target.url)
            ? await fetchRedditDocOrExplain(target, reddit)
            : await fetchOne(solari, target, timeoutMs, proxyCountry, stealth, proxySession, profileId, captcha),
        )
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
          // A failure before launch has no session to read, so record what was
          // asked for. "We requested a proxy and never got one" and "we never
          // got far enough to ask" are different facts about the same row.
          //
          // A Reddit failure has no egress to report: that path is a plain
          // fetch, not a browser behind a proxy. Recording the requested proxy
          // here would put a claim in the snapshot -- this project's audit
          // artifact -- that nothing in the run actually did.
          ...(isRedditTarget(target.url)
            ? {}
            : {
                egress: err instanceof FetchError && err.egress
                  ? err.egress
                  : { requested: proxyCountry, stealth },
              }),
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
  return {
    subject,
    docs,
    failures,
    egress: { requested: proxyCountry, stealth },
    ...(opts.labels ? { labels: opts.labels } : {}),
  }
}

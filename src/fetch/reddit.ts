/**
 * Reddit, read through its published API rather than through a browser.
 *
 * Reddit is in every source plan and was never once read by the browser fan:
 * behind a working proxy it answers 200 with a "Prove your humanity" challenge
 * that Solari's solver does not clear, and pressing harder produces rate
 * limiting. App-only API access is the route Reddit publishes for this, and it
 * removes a risk rather than accepting one -- automating a logged-in account is
 * contrary to Reddit's user agreement; an application token is not.
 */

/** The shape of a search listing, narrowed to the fields this reads. */
export interface RedditListing {
  data?: { children?: { data?: { title?: string; selftext?: string } }[] }
}

/**
 * Pure: is this target Reddit's own site?
 *
 * A host check rather than a substring check. An article *about* Reddit is not
 * Reddit, and `reddit.com.evil.example` is not Reddit either -- the same
 * distinction the challenge fingerprinter draws by matching asset hosts rather
 * than vendor names.
 */
export function isRedditTarget(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === "reddit.com" || host.endsWith(".reddit.com")
}

/**
 * Pure: read the subreddit and query out of a plan's own URL.
 *
 * Plans keep the human `reddit.com/r/<sub>/search/?q=<query>` form, because
 * that URL is also the citation a reader clicks. This translates it; the API
 * endpoint never reaches the output.
 */
export function parseRedditSearchUrl(url: string): { subreddit: string; query: string } {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/^\/r\/([^/]+)\/search\/?$/)
  const query = parsed.searchParams.get("q")
  if (!match || !query) {
    throw new Error(`reddit: ${url} is not a subreddit search (want /r/<sub>/search/?q=...)`)
  }
  return { subreddit: match[1]!, query }
}

/**
 * Pure: flatten a listing into the document text the gate will anchor against.
 *
 * Every piece is joined by a newline, and that is load-bearing rather than
 * cosmetic. `anchor.ts` rejects any admitted quote containing a `\n`, so
 * newline-joining is what makes it impossible for a quote to stitch two
 * separate posts -- or a title and its own body -- into one apparent statement.
 * Joining with spaces would silently defeat that gate.
 */
export function redditDocText(listing: RedditListing): string {
  const pieces: string[] = []
  for (const child of listing.data?.children ?? []) {
    const title = child.data?.title?.trim()
    const selftext = child.data?.selftext?.trim()
    if (title) pieces.push(title)
    if (selftext) pieces.push(selftext)
  }
  return pieces.join("\n")
}

/**
 * Pure: the public, unauthenticated search endpoint for a target.
 *
 * `.json` rather than `oauth.reddit.com`: this is the interface Reddit serves
 * with no application and no token, the same one RSS readers have used for
 * years. `raw_json=1` matters here as much as on the OAuth path -- this
 * project's admission gate needs exact bytes, and Reddit HTML-escapes the
 * response without it.
 */
export function redditJsonUrl(target: SourceTarget): string {
  const { subreddit, query } = parseRedditSearchUrl(target.url)
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}&raw_json=1`
}

import { docIdFor, FetchError } from "./common.js"
import { normalizeText } from "./normalize.js"
import type { FetchedDoc, SourceTarget } from "../types.js"

export interface RedditCreds {
  clientId: string
  clientSecret: string
  /** Reddit requires a descriptive agent and rate-limits generic ones harder. */
  userAgent: string
}

/** Fixed: the candidate selector already caps how much of one document reaches the model. */
const SEARCH_LIMIT = 25

async function accessToken(creds: RedditCreds): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": creds.userAgent,
    },
    body: "grant_type=client_credentials",
  })
  if (res.status === 401 || res.status === 403) {
    throw new FetchError("auth_required", `reddit: token refused (${res.status})`)
  }
  // Reddit rate-limits the token endpoint too, and this call runs first on
  // every Reddit fetch. Letting it fall through to `http_error` would report a
  // refusal as "this source could not be reached" -- the same misattribution
  // this codebase has now corrected five times.
  if (res.status === 429) {
    throw new FetchError("blocked", "reddit: token request rate-limited (429)")
  }
  if (!res.ok) {
    throw new FetchError("http_error", `reddit: token request failed (${res.status})`)
  }
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new FetchError("auth_required", "reddit: no token in response")
  return body.access_token
}

/**
 * Read one Reddit search target through the API.
 *
 * `doc.url` stays the target's own reddit.com URL: the API endpoint is an
 * implementation detail, and a citation a reader cannot click is worse than no
 * citation.
 */
export async function fetchRedditDocViaOAuth(
  target: SourceTarget,
  creds: RedditCreds,
): Promise<FetchedDoc> {
  const { subreddit, query } = parseRedditSearchUrl(target.url)
  const token = await accessToken(creds)
  const endpoint = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}&raw_json=1`

  const res = await fetch(endpoint, {
    headers: { authorization: `Bearer ${token}`, "user-agent": creds.userAgent },
  })
  if (res.status === 401 || res.status === 403) {
    throw new FetchError("auth_required", `${target.label}: reddit refused the token (${res.status})`)
  }
  if (res.status === 429) {
    throw new FetchError("blocked", `${target.label}: reddit rate-limited us (429)`)
  }
  if (!res.ok) {
    throw new FetchError("http_error", `${target.label}: reddit returned ${res.status}`)
  }

  const text = normalizeText(redditDocText((await res.json()) as RedditListing))
  // No useful-length floor here, unlike the browser path. That floor exists to
  // reject pages whose entire content is navigation chrome; a JSON listing has
  // no chrome, so a short result is a genuinely short result.
  if (text.length === 0) {
    throw new FetchError("empty", `${target.label}: reddit search matched no posts`)
  }

  return {
    docId: docIdFor(target),
    url: target.url,
    label: target.label,
    role: target.role,
    kind: target.kind,
    fetchedAt: new Date().toISOString(),
    title: target.label,
    text,
    via: "api",
  }
}

/** Sent whenever no application is configured, so Reddit sees a real identifier either way. */
const DEFAULT_USER_AGENT = "receipts/0.1 (unauthenticated; +https://github.com/KristianKrattiger/receipts)"

/**
 * Read one Reddit search target through the public, unauthenticated endpoint.
 *
 * The failure handling here is deliberately more defensive than the OAuth
 * function's. `www.reddit.com` has already refused this project twice -- a
 * browser challenge, then rate limiting under pressure -- and whether this
 * older, historically more permissive interface on the same host is gated the
 * same way is unmeasured. A 403 or a non-JSON response is treated as a refusal
 * rather than assumed to be an application error, because that is exactly the
 * shape a challenge interstitial takes when JSON was expected -- the same
 * failure mode G2's DataDome page and Reddit's own browser challenge produced.
 */
export async function fetchRedditDocViaJson(target: SourceTarget): Promise<FetchedDoc> {
  const userAgent = process.env["REDDIT_USER_AGENT"] ?? DEFAULT_USER_AGENT
  const res = await fetch(redditJsonUrl(target), { headers: { "user-agent": userAgent } })

  if (res.status === 429) {
    throw new FetchError("blocked", `${target.label}: reddit rate-limited us (429)`)
  }
  if (res.status === 403) {
    // No login route to name here, unlike the browser's auth-wall page --
    // this request carries no credentials to begin with.
    throw new FetchError("blocked", `${target.label}: reddit refused the request (403)`)
  }
  if (!res.ok) {
    throw new FetchError("http_error", `${target.label}: reddit returned ${res.status}`)
  }

  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim()
    throw new FetchError(
      "blocked",
      `${target.label}: reddit answered with ${contentType || "no content-type"} instead of JSON — ${body || "(empty)"}`,
    )
  }

  let listing: RedditListing
  try {
    listing = (await res.json()) as RedditListing
  } catch (err) {
    throw new FetchError(
      "blocked",
      `${target.label}: reddit's response could not be parsed as JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  const text = normalizeText(redditDocText(listing))
  if (text.length === 0) {
    throw new FetchError("empty", `${target.label}: reddit search matched no posts`)
  }

  return {
    docId: docIdFor(target),
    url: target.url,
    label: target.label,
    role: target.role,
    kind: target.kind,
    fetchedAt: new Date().toISOString(),
    title: target.label,
    text,
    via: "api",
  }
}

/**
 * OAuth when credentials exist -- Reddit's sanctioned path, with the higher
 * rate-limit ceiling. The public `.json` endpoint otherwise, so Reddit is
 * readable with zero configuration rather than staying `not read` while no
 * script app can be registered.
 */
export async function fetchRedditDoc(
  target: SourceTarget,
  creds: RedditCreds | undefined,
): Promise<FetchedDoc> {
  return creds ? fetchRedditDocViaOAuth(target, creds) : fetchRedditDocViaJson(target)
}

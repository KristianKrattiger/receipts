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
export async function fetchRedditDoc(
  target: SourceTarget,
  creds: RedditCreds,
): Promise<FetchedDoc> {
  const { subreddit, query } = parseRedditSearchUrl(target.url)
  const token = await accessToken(creds)
  const endpoint = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}`

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

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

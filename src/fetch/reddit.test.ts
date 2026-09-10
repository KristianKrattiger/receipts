import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchRedditDocViaJson, fetchRedditDocViaOAuth, isRedditTarget, parseRedditSearchUrl, redditDocText, redditJsonUrl,
} from "./reddit.js"

describe("isRedditTarget — route on the host, not on the string", () => {
  it("matches a reddit search URL", () => {
    expect(isRedditTarget("https://www.reddit.com/r/nextjs/search/?q=vercel")).toBe(true)
  })

  it("matches reddit without the www", () => {
    expect(isRedditTarget("https://reddit.com/r/nextjs/search/?q=vercel")).toBe(true)
  })

  // A host check, not a substring check: an article about Reddit is not Reddit.
  it("does not match another site that merely mentions reddit", () => {
    expect(isRedditTarget("https://news.example.com/2026/reddit-api-changes")).toBe(false)
  })

  it("does not match a lookalike domain", () => {
    expect(isRedditTarget("https://reddit.com.evil.example/r/x/search/?q=a")).toBe(false)
  })

  it("returns false for a malformed URL rather than throwing", () => {
    expect(isRedditTarget("not a url")).toBe(false)
  })
})

describe("parseRedditSearchUrl", () => {
  it("pulls the subreddit and query out of a plan URL", () => {
    expect(parseRedditSearchUrl("https://www.reddit.com/r/nextjs/search/?q=vercel"))
      .toEqual({ subreddit: "nextjs", query: "vercel" })
  })

  it("handles a query with spaces and punctuation", () => {
    expect(parseRedditSearchUrl("https://www.reddit.com/r/aws/search/?q=s3%20outage"))
      .toEqual({ subreddit: "aws", query: "s3 outage" })
  })

  it("refuses a reddit URL that is not a subreddit search", () => {
    expect(() => parseRedditSearchUrl("https://www.reddit.com/r/nextjs/"))
      .toThrow(/not a subreddit search/)
  })

  it("refuses a site-wide search, which names no subreddit", () => {
    expect(() => parseRedditSearchUrl("https://www.reddit.com/search/?q=vercel"))
      .toThrow(/not a subreddit search/)
  })
})

import type { SourceTarget } from "../types.js"

const target = (url: string): SourceTarget => ({
  kind: "forum", role: "independent", url, label: "Reddit",
})

describe("redditJsonUrl — the public search endpoint, built correctly", () => {
  it("builds the .json search URL for a plan target", () => {
    const url = redditJsonUrl(target("https://www.reddit.com/r/nextjs/search/?q=vercel"))
    expect(url).toBe(
      "https://www.reddit.com/r/nextjs/search.json?q=vercel&restrict_sr=1&limit=25&raw_json=1",
    )
  })

  // The parameter most likely to be dropped by a future edit with no test to
  // catch it: its absence produces no error, only silently wrong quotes weeks
  // later, once an admitted span happens to contain an escaped character.
  it("always includes raw_json=1", () => {
    expect(redditJsonUrl(target("https://www.reddit.com/r/aws/search/?q=s3%20outage")))
      .toContain("raw_json=1")
  })

  it("encodes a query with spaces and punctuation", () => {
    const url = redditJsonUrl(target("https://www.reddit.com/r/aws/search/?q=s3%20outage"))
    expect(url).toContain("q=s3%20outage")
  })

  it("rejects a reddit URL that is not a subreddit search, same as parseRedditSearchUrl", () => {
    expect(() => redditJsonUrl(target("https://www.reddit.com/r/nextjs/")))
      .toThrow(/not a subreddit search/)
  })
})

const listing = {
  data: {
    children: [
      { data: { title: "Vercel pricing changed overnight", selftext: "We saw a 4x increase." } },
      { data: { title: "Build times regressed after the update", selftext: "" } },
    ],
  },
}

describe("redditDocText — posts must not run together", () => {
  it("keeps every post's title", () => {
    const text = redditDocText(listing)
    expect(text).toContain("Vercel pricing changed overnight")
    expect(text).toContain("Build times regressed after the update")
  })

  it("keeps selftext where a post has it", () => {
    expect(redditDocText(listing)).toContain("We saw a 4x increase.")
  })

  // Load-bearing. anchor.ts rejects any quote containing a newline, which is
  // what stops a quote stitching two separate posts into one apparent
  // statement. Joining with anything else would silently defeat that gate.
  it("separates posts with a newline", () => {
    const text = redditDocText(listing)
    const between = text.slice(
      text.indexOf("We saw a 4x increase."),
      text.indexOf("Build times regressed"),
    )
    expect(between).toContain("\n")
  })

  it("separates a title from its own selftext with a newline", () => {
    const text = redditDocText(listing)
    const between = text.slice(
      text.indexOf("Vercel pricing changed overnight"),
      text.indexOf("We saw a 4x increase."),
    )
    expect(between).toContain("\n")
  })

  it("returns an empty string for a listing with no posts", () => {
    expect(redditDocText({ data: { children: [] } })).toBe("")
  })
})

/**
 * `stability` reaching both Reddit fetch paths.
 *
 * Neither path has an existing test exercising it end-to-end -- everything
 * above this point drives only the pure helpers -- so these stub the HTTP
 * layer themselves, the same way any Node-fetch caller is stubbed under
 * vitest: `vi.stubGlobal("fetch", ...)`, undone in `afterEach` so a stub
 * never leaks into an unrelated test. No real network call is made.
 */
function jsonResponse(status: number, body: unknown, contentType = "application/json"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const REDDIT_URL = "https://www.reddit.com/r/nextjs/search/?q=vercel"

const listingWithOnePost = {
  data: { children: [{ data: { title: "Vercel pricing changed overnight", selftext: "" } }] },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("fetchRedditDocViaJson — stability travels from target to doc", () => {
  it("carries a declared stability onto the doc", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, listingWithOnePost)))
    const doc = await fetchRedditDocViaJson({ ...target(REDDIT_URL), stability: "stable" })
    expect(doc.stability).toBe("stable")
  })

  // toBeUndefined() passes whether the key is missing or present-as-undefined.
  // The bug this guards against is the key surviving as `stability: undefined`.
  it("leaves stability absent as a key when the target never declared it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, listingWithOnePost)))
    const doc = await fetchRedditDocViaJson(target(REDDIT_URL))
    expect("stability" in doc).toBe(false)
  })
})

describe("fetchRedditDocViaOAuth — stability travels from target to doc", () => {
  const creds = { clientId: "id", clientSecret: "secret", userAgent: "test-agent (test)" }

  // Two calls happen in sequence on this path: a POST for the access token,
  // then a GET to the OAuth search endpoint. Routed by URL so both legs of
  // the same fetch are stubbed without depending on call order.
  function stubOAuthRoundTrip() {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const href = input.toString()
      if (href.includes("access_token")) return jsonResponse(200, { access_token: "tok" })
      return jsonResponse(200, listingWithOnePost)
    }))
  }

  it("carries a declared stability onto the doc", async () => {
    stubOAuthRoundTrip()
    const doc = await fetchRedditDocViaOAuth({ ...target(REDDIT_URL), stability: "stable" }, creds)
    expect(doc.stability).toBe("stable")
  })

  it("leaves stability absent as a key when the target never declared it", async () => {
    stubOAuthRoundTrip()
    const doc = await fetchRedditDocViaOAuth(target(REDDIT_URL), creds)
    expect("stability" in doc).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { isRedditTarget, parseRedditSearchUrl, redditDocText } from "./reddit.js"

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

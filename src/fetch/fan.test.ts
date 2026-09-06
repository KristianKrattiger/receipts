import { describe, expect, it } from "vitest"
import {
  classifyFailure, describeFailure, docIdFor, hasSettled, parseProxy, readEgress,
} from "./fan.js"
import type { SourceTarget } from "../types.js"

const LONG = "Acme guarantees 99.99% uptime across all plans. ".repeat(20)

describe("classifyFailure", () => {
  it("returns null for a healthy page", () => {
    expect(classifyFailure("Acme — Pricing", LONG)).toBeNull()
  })

  it("flags short pages as empty", () => {
    expect(classifyFailure("Acme", "too short")).toBe("empty")
  })

  it("flags challenge pages as captcha", () => {
    expect(classifyFailure("Just a moment", "Checking your browser before access")).toBe("captcha")
  })

  it("does not flag a long article that merely mentions captcha", () => {
    expect(classifyFailure("Captcha solving guide", LONG)).toBeNull()
  })
})

// Captured verbatim from a real free-plan run against reddit.com. It cleared
// the useful-length floor and carried no captcha wording, so it was admitted
// as a genuine independent source until this case existed.
const REDDIT_BLOCK = [
  "You've been blocked by network security.",
  "To continue, log in to your Reddit account or use your developer token",
  "",
  "If you think you've been blocked by mistake, file a ticket below and we'll look into it.",
  "Log in",
  "File a ticket",
].join("\n")

// Captured verbatim from reports/egress-2026-09-05.json, the us:static row.
// Behind a working proxy Reddit answers 200 and serves this -- 240 characters,
// which clears MIN_USEFUL_CHARS, carrying none of the existing captcha wording
// and two curly apostrophes. It classified as `ok` and would have entered a
// ledger as a genuine independent Reddit source.
const REDDIT_CHALLENGE = [
  "Prove your humanity",
  "We’re committed to safety and security. But not for bots.",
  "Complete the challenge below and let us know you’re a real person.",
  "Reddit, Inc. © \"2026\". All rights reserved.",
  "User Agreement Privacy Policy Content Policy Help",
].join(" ")

describe("classifyFailure — a challenge that clears the length floor", () => {
  it("flags Reddit's real challenge page as captcha, not as a document", () => {
    expect(classifyFailure("Reddit - Prove your humanity", REDDIT_CHALLENGE)).toBe("captcha")
  })

  // The page carries "We’re" and "you’re" with U+2019. A marker written with a
  // straight apostrophe would silently never match.
  it("matches challenge wording through a curly apostrophe", () => {
    expect(classifyFailure("x", "Please let us know you’re a real person.")).toBe("captcha")
  })

  // CHALLENGE_MAX_CHARS is what keeps a real article safe, so the article has
  // to actually clear it -- LONG alone is 940 characters and would, correctly,
  // still be read as a challenge.
  it("does not flag a genuinely long article that discusses proving humanity", () => {
    const article = `Prove your humanity. ${LONG.repeat(3)}`
    expect(article.length).toBeGreaterThan(2000)
    expect(classifyFailure("On CAPTCHAs", article)).toBeNull()
  })
})

describe("classifyFailure — refusals are not documents", () => {
  // Reddit's page carries block wording AND names two ways in. It is the
  // second that is true: this is an auth wall, not a refusal of automation,
  // and captcha solving does nothing for it.
  it("flags Reddit's real block page as auth_required, not blocked", () => {
    expect(classifyFailure("Reddit", REDDIT_BLOCK)).toBe("auth_required")
  })

  it("still flags a bare refusal with no way in as blocked", () => {
    expect(classifyFailure("Denied", "Access denied. Your request was refused."))
      .toBe("blocked")
  })

  it("prefers auth_required over blocked when a page carries both", () => {
    expect(classifyFailure("Reddit", "You've been blocked. Please log in to continue."))
      .toBe("auth_required")
  })

  it("clears the length floor it used to hide behind", () => {
    expect(REDDIT_BLOCK.trim().length).toBeGreaterThan(200)
  })

  it("prefers blocked over captcha when a page says both", () => {
    expect(classifyFailure("x", "Access denied. Please verify you are human.")).toBe("blocked")
  })

  it("does not flag a long article discussing blocking", () => {
    expect(classifyFailure("Why sites block bots", LONG)).toBeNull()
  })
})

// Captured verbatim from a real run. 248 characters of navigation plus a
// statement that the search matched nothing -- over the useful-length floor,
// so it was admitted as an independent source with no content in it.
const HN_NO_RESULTS = [
  "Search", "Hacker News", "Search by", "Search", "Stories", "by",
  "Popularity", "for", "All time", "",
  "0 results (0.009 seconds)", "",
  "We found no stories matching getsolari.com",
  "Search for comments", "About", "Setting", "Help", "API Documentation",
  "Hacker News", "Fork/Contribute", "Cool Apps",
].join("\n")

describe("classifyFailure — a page about its own emptiness is not content", () => {
  it("flags a search page that matched nothing as empty", () => {
    expect(classifyFailure("Search", HN_NO_RESULTS)).toBe("empty")
  })

  it("clears the length floor it used to hide behind", () => {
    expect(HN_NO_RESULTS.trim().length).toBeGreaterThan(200)
  })

  it("does not flag a long article that mentions no results", () => {
    expect(classifyFailure("Benchmarks", LONG + " no results were observed")).toBeNull()
  })
})

// Captured verbatim from a real run on 2026-09-05, after the proxy was fixed
// and captcha solving turned on. 575 characters, which clears the floor, and
// it entered the corpus as a readable Reddit document. BLOCK_MARKERS carried
// "rate limit"; this page says "too many requests", so nothing matched.
const REDDIT_RATE_LIMIT = [
  "whoa there, pardner!",
  "Reddit's awesome and all, but you may have a bit of a problem.",
  "We've seen far too many requests come from your IP address recently.",
  "Please wait a few minutes and try again.",
  "If you're still getting this error after a few minutes and think that we've",
  "incorrectly blocked you or you would like to discuss easier ways to get the",
  "data you want, please contact us at this email address.",
].join(" ")

describe("classifyFailure — a rate-limit notice is not a document", () => {
  it("flags Reddit's real rate-limit page as blocked", () => {
    expect(classifyFailure("Too Many Requests", REDDIT_RATE_LIMIT)).toBe("blocked")
  })

  it("clears the length floor it hid behind", () => {
    expect(REDDIT_RATE_LIMIT.trim().length).toBeGreaterThan(200)
  })

  it("catches the plain phrasing too", () => {
    expect(classifyFailure("429", "Too many requests. Slow down.")).toBe("blocked")
  })
})

describe("hasSettled — when to stop polling a page", () => {
  it("keeps waiting while the text is still growing", () => {
    expect(hasSettled("abc", "abcdef", false)).toBe(false)
  })

  it("keeps waiting on an empty page", () => {
    expect(hasSettled("", "", false)).toBe(false)
  })

  it("stops once two reads agree", () => {
    expect(hasSettled("abcdef", "abcdef", false)).toBe(true)
  })

  // The measurement that forced this: G2 serves a challenge that renders into
  // the real page once solved, but the challenge itself is short and STABLE, so
  // the agree-twice test fires in about 1.4s and the fetch records `empty`.
  // With a solver running, a stable challenge is the one thing worth waiting
  // through -- reports/egress-2026-09-05-captcha.json turned 0 characters into
  // 3,856 by doing nothing but waiting longer.
  it("does not stop on a stable challenge when a solver is running", () => {
    const challenge = "Prove your humanity. Complete the challenge below."
    expect(hasSettled(challenge, challenge, true)).toBe(false)
  })

  it("stops on a stable challenge when no solver is running", () => {
    const challenge = "Prove your humanity. Complete the challenge below."
    expect(hasSettled(challenge, challenge, false)).toBe(true)
  })

  it("stops once a solved page is no longer a challenge", () => {
    expect(hasSettled(LONG, LONG, true)).toBe(true)
  })
})

describe("docIdFor", () => {
  const target: SourceTarget = {
    kind: "vendor_pricing", role: "claimant",
    url: "https://acme.com/pricing", label: "Acme pricing",
  }

  it("is stable for the same url", () => {
    expect(docIdFor(target)).toBe(docIdFor({ ...target, label: "different label" }))
  })

  it("differs for a different url", () => {
    expect(docIdFor(target)).not.toBe(docIdFor({ ...target, url: "https://acme.com/docs" }))
  })

  it("is 12 hex characters", () => {
    expect(docIdFor(target)).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe("parseProxy", () => {
  it("passes a bare country code through unchanged", () => {
    expect(parseProxy("us")).toBe("us")
    expect(parseProxy("gb")).toBe("gb")
  })

  it("passes Solari's own keywords through unchanged", () => {
    expect(parseProxy("smart")).toBe("smart")
    expect(parseProxy("off")).toBe("off")
  })

  // The whole point of the syntax: the object form is the only way to reach a
  // tier, and the bare string silently meant "residential".
  it("splits country:tier into the object form launch expects", () => {
    expect(parseProxy("us:static")).toEqual({ country: "us", tier: "static" })
    expect(parseProxy("gb:mobile")).toEqual({ country: "gb", tier: "mobile" })
  })

  it("attaches a session label to the object form", () => {
    expect(parseProxy("us:static", "warm-1"))
      .toEqual({ country: "us", tier: "static", session: "warm-1" })
  })

  // A bare country with a label must become the object form -- the string
  // form has nowhere to put it.
  it("promotes a bare country to the object form when a label is given", () => {
    expect(parseProxy("us", "warm-1")).toEqual({ country: "us", session: "warm-1" })
  })

  it("still returns the bare string when no label is given", () => {
    expect(parseProxy("us")).toBe("us")
  })

  // "smart" and "off" select the pool themselves, so there is no IP to pin.
  // Silently dropping the label would leave the caller believing sessions
  // share an IP when they do not.
  it("refuses a label that cannot be honoured", () => {
    expect(() => parseProxy("smart", "warm-1")).toThrow(/needs a country/)
    expect(() => parseProxy("off", "warm-1")).toThrow(/needs a country/)
  })

  // A typo here would otherwise reach the API and come back as a tunnel
  // failure on every source — the least diagnosable shape this can take.
  it("refuses an unknown tier by name", () => {
    expect(() => parseProxy("us:resedential")).toThrow(/unknown proxy tier "resedential"/)
  })
})

describe("readEgress — a page that loads proves nothing about the route", () => {
  it("reports no proxy when the gateway attached none", () => {
    expect(readEgress({ proxy: undefined }, "smart", true)).toEqual({
      requested: "smart", stealth: true,
    })
  })

  it("reports no proxy when the session says null", () => {
    expect(readEgress({ proxy: null }, "smart", true)).toEqual({
      requested: "smart", stealth: true,
    })
  })

  it("carries country, tier and timezone when a proxy was attached", () => {
    const session = { proxy: { country: "us", tier: "static", timezoneId: "America/Los_Angeles" } }
    expect(readEgress(session, "us:static", true)).toEqual({
      requested: "us:static",
      stealth: true,
      proxy: { country: "us", tier: "static", timezoneId: "America/Los_Angeles" },
    })
  })

  // Telemetry that can break a fetch is worse than no telemetry.
  it("survives a session whose accessor throws", () => {
    const session = { get proxy(): never { throw new Error("session released") } }
    expect(readEgress(session, "smart", true)).toEqual({ requested: "smart", stealth: true })
  })

  // An object of undefineds would read in the record as "we got something".
  it("reports no proxy when the confirmation carries no country", () => {
    expect(readEgress({ proxy: { tier: "static" } }, "us:static", true)).toEqual({
      requested: "us:static", stealth: true,
    })
  })
})

// Captured verbatim from fixtures/probe-source-classes.json, the "BBB search —
// Vercel" doc. 1,841 characters of navigation chrome around a statement of its
// own emptiness -- well past the old 600-character NO_RESULT_MAX_CHARS, so it
// cleared the no-results gate on length alone and entered a corpus as a
// readable independent source.
const BBB_NO_RESULTS = "Skip to main content\nCookies on BBB.org\n\nWe use cookies to give users the best content and online experience. By clicking “Accept All Cookies”, you agree to allow us to use all cookies. Visit our Privacy Policy to learn more.\n\nAccept All Cookies\nManage Cookies\nHomepage\nConsumers\nBusinesses\nScam Tracker\nAbout\nLanguage\nSign in\nFind\nNear\nCountry\nUS\nCA\nUS\nUnited States\nSearch\nHomeSearchNo Results\n(current page)\nNo results for\n\"Vercel\"\nSearch tips:\nChange or clear your search filters to expand your search results\nCheck your spelling\nUse more general search terms\n\nBBB provides Business Profiles for as many businesses as we can, but we don't have every business in our directory. If the specific business you are searching for is not in our directory, you can submit a request to add it!\n\nLatest News and Events\n\nBBB releases, tips, and news.\n\nView News and Events\nSearch Scam Reports\n\nLooking to research a scam or report suspicious activity? Use BBB Scam Tracker℠\n\nSearch Scams\nJoin Trusted Businesses\nBecome BBB Accredited\nAd\nWhy are there ads on BBB.org?\nadvertisement:\nDidn't find the business you were looking for?\n\nIf the business you're looking for isn't in our directory, submit a request to have it added.\n\nRequest a Business\nTM\nFor Consumers\nGet a Quote\nStart a Review\nFile a Complaint\nFor Businesses\nGet Your Business Listed\nBBB Accreditation\nApply for BBB Accreditation\nNewsroom and Resources\nAffiliated Programs\nBBB Institute for Marketplace Trust\nBBB Wise Giving Alliance (Give.org)\nBBB National Programs\nour Twitter (opens in a new tab)\nour LinkedIn (opens in a new tab)\nour Facebook (opens in a new tab)\nour Instagram (opens in a new tab)\nAbout BBB®\nTerms of Use\nPrivacy Policy\nContact Us\n\n© 2026 International Association of Better Business Bureaus, Inc. (IABBB).\nAll rights reserved. All trademarks are property of IABBB."

describe("classifyFailure — a search page that matched nothing, at any length", () => {
  it("flags BBB's real no-results page as empty", () => {
    expect(classifyFailure("BBB Search", BBB_NO_RESULTS)).toBe("empty")
  })

  it("is a page long enough to clear the old 600-character bound", () => {
    expect(BBB_NO_RESULTS.length).toBeGreaterThan(600)
  })

  // The bound exists so an article that happens to say "no results" in passing
  // is not thrown away. That protection must survive the fix.
  it("still does not flag a long article that mentions no results in passing", () => {
    expect(classifyFailure("Benchmarks", `${LONG.repeat(3)} no results were observed`))
      .toBeNull()
  })
})

describe("describeFailure — one number cannot diagnose an empty page", () => {
  it("separates an extraction defect from a refusal by html length", () => {
    const extraction = describeFailure("G2 reviews", "empty", "G2 Reviews", "", 84_000)
    expect(extraction).toContain("0 chars text")
    expect(extraction).toContain("84000 chars html")

    const refusal = describeFailure("G2 reviews", "empty", "", "", 0)
    expect(refusal).toContain("0 chars text")
    expect(refusal).toContain("0 chars html")
  })

  // A block page's title is often the most diagnostic thing on it.
  it("carries the title, which is frequently the whole diagnosis", () => {
    expect(describeFailure("G2 reviews", "captcha", "Just a moment...", "", 1200))
      .toContain("Just a moment...")
  })

  it("carries a long excerpt, not the old 200 characters", () => {
    const body = "x".repeat(1500)
    expect(describeFailure("Some source", "empty", "T", body, 1500)).toContain("x".repeat(1000))
  })

  it("collapses whitespace so one failure stays one line", () => {
    expect(describeFailure("S", "blocked", "T", "a\n\n  b", 10)).toContain("a b")
  })

  it("says so explicitly when there was no text at all", () => {
    expect(describeFailure("S", "empty", "T", "", 0)).toContain("(no text)")
  })
})

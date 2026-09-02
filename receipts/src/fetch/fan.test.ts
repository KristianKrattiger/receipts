import { describe, expect, it } from "vitest"
import { classifyFailure, docIdFor } from "./fan.js"
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

describe("classifyFailure — refusals are not documents", () => {
  it("flags Reddit's real block page as blocked, not as a readable source", () => {
    expect(classifyFailure("Reddit", REDDIT_BLOCK)).toBe("blocked")
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

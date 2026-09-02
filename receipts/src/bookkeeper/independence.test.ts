import { describe, expect, it } from "vitest"
import { citesClaimant, claimantDomains, registrableDomain } from "./independence.js"
import type { Corpus, FetchedDoc } from "../types.js"

function doc(docId: string, role: FetchedDoc["role"], url: string): FetchedDoc {
  return {
    docId, url, label: docId, role, kind: "forum",
    fetchedAt: "2026-09-01T00:00:00.000Z", title: docId, text: "", sessionId: "s",
  }
}

const CORPUS: Corpus = {
  subject: "claude",
  docs: [
    doc("product", "claimant", "https://www.anthropic.com/claude"),
    doc("docs", "claimant", "https://docs.claude.com/en/docs/about-claude/models/overview"),
    doc("hn", "independent", "https://hn.algolia.com/?q=anthropic.com"),
  ],
  failures: [],
}

describe("registrableDomain", () => {
  it("strips www and subdomains", () => {
    expect(registrableDomain("www.anthropic.com")).toBe("anthropic.com")
    expect(registrableDomain("docs.claude.com")).toBe("claude.com")
    expect(registrableDomain("anthropic.com")).toBe("anthropic.com")
  })
})

describe("claimantDomains", () => {
  it("collects domains from claimant documents only", () => {
    expect(claimantDomains(CORPUS)).toEqual(new Set(["anthropic.com", "claude.com"]))
  })

  it("ignores an unparseable url rather than failing the run", () => {
    const broken: Corpus = { ...CORPUS, docs: [doc("x", "claimant", "not a url")] }
    expect(claimantDomains(broken)).toEqual(new Set())
  })
})

describe("citesClaimant", () => {
  const domains = claimantDomains(CORPUS)

  // These three were admitted as independent corroboration in a real run
  // against fixtures/claude.json. Every one is Anthropic's own announcement
  // surfaced on Hacker News.
  const LAUNDERED = [
    "Claude Fable 5.1 and Claude Mythos 5.1(https://www.anthropic.com/claude-fable-and-mythos-5-1)",
    "https://www.anthropic.com/claude-opus-5-system-card",
    "Claude Haiku 4.5(https://www.anthropic.com/news/claude-haiku-4-5)",
  ]

  for (const text of LAUNDERED) {
    it(`catches ${text.slice(0, 40)}...`, () => {
      expect(citesClaimant(text, domains)).toBe(true)
    })
  }

  // This one was genuinely third-party in the same run and must survive.
  it("leaves a genuine third-party benchmark alone", () => {
    const real = "Claude Sonnet 5 – benchmark results(https://artificialanalysis.ai/models/claude-sonnet-5)"
    expect(citesClaimant(real, domains)).toBe(false)
  })

  // A link check, not a mention check: independent testimony often names the
  // vendor's domain, and discarding that would throw away real evidence.
  it("does not flag an independent commenter merely naming the domain", () => {
    expect(citesClaimant("anthropic.com was down for an hour this morning", domains)).toBe(false)
  })

  it("matches a subdomain of a claimant domain", () => {
    expect(citesClaimant("see https://status.anthropic.com/incidents/1", domains)).toBe(true)
  })

  it("is inert when no claimant domain is known", () => {
    expect(citesClaimant("https://www.anthropic.com/x", new Set())).toBe(false)
  })
})

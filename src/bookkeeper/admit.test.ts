import { describe, expect, it } from "vitest"
import { admit } from "./admit.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
import type { Corpus, FetchedDoc, RelationProposal } from "../types.js"

function doc(docId: string, role: FetchedDoc["role"], text: string): FetchedDoc {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "claimant" ? "vendor_site" : "status_page",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: docId, text, sessionId: "s1",
  }
}

const VENDOR = doc("vendor", "claimant",
  "Acme guarantees 99.99% uptime for every workspace on a paid plan.")
const STATUS = doc("status", "independent",
  "Acme reported four separate uptime incidents in the last ninety days.")

const CORPUS: Corpus = { subject: "acme", docs: [VENDOR, STATUS], failures: [] }
const TERMS = tokenize("acme uptime")
const IDF = buildIdf(CORPUS.docs)

function proposal(over: Partial<RelationProposal> = {}): RelationProposal {
  return {
    proposalId: "p0", type: "contradicts", topic: "uptime",
    statement: "uptime guarantee",
    from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    to: { docId: "status", quote: "four separate uptime incidents" },
    rationale: "the status page contradicts the guarantee",
    confidence: 0.9,
    ...over,
  }
}

describe("admit — accepts sound proposals", () => {
  it("admits a well-anchored contradiction and keeps both sides in order", () => {
    const r = admit(CORPUS, [proposal()], TERMS, IDF)
    expect(r.denied).toEqual([])
    expect(r.admitted).toHaveLength(1)
    expect(r.admitted[0]!.sides.map((s) => s.docId)).toEqual(["vendor", "status"])
  })

  it("re-derives offsets that round-trip against the source", () => {
    const a = admit(CORPUS, [proposal()], TERMS, IDF).admitted[0]!
    const byId = new Map(CORPUS.docs.map((d) => [d.docId, d]))
    for (const span of a.sides) {
      expect(byId.get(span.docId)!.text.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it("admits a one-sided unsupported claim", () => {
    const r = admit(CORPUS, [proposal({ type: "unsupported", to: null })], TERMS, IDF)
    expect(r.admitted).toHaveLength(1)
    expect(r.admitted[0]!.sides).toHaveLength(1)
  })

  // Both sides share role "claimant" here. Role-keyed slots would drop one
  // validated span and still count the row as admitted.
  it("keeps both spans when a vendor contradicts itself", () => {
    const selfContradiction: Corpus = {
      subject: "acme",
      docs: [
        doc("pricing", "claimant", "Acme guarantees 99.99% uptime on every acme plan."),
        doc("docs", "claimant", "Acme targets 99.5% uptime for acme workspaces."),
      ],
      failures: [],
    }
    const r = admit(
      selfContradiction,
      [proposal({
        from: { docId: "pricing", quote: "guarantees 99.99% uptime" },
        to: { docId: "docs", quote: "targets 99.5% uptime" },
      })],
      TERMS,
      buildIdf(selfContradiction.docs),
    )
    expect(r.denied).toEqual([])
    expect(r.admitted[0]!.sides.map((s) => s.docId)).toEqual(["pricing", "docs"])
  })

  // Neither quote contains "acme" or "uptime"; only the surrounding passage
  // does. Scoring the quote alone would reject both.
  it("admits a quote that omits the subject when the passage around it supplies it", () => {
    const spread: Corpus = {
      subject: "acme",
      docs: [
        doc("vendor", "claimant",
          "Acme is a hosting company. Uptime matters to acme customers. The number is 99.99 percent."),
        doc("status", "independent",
          "Acme had outages. Four incidents were recorded for acme last quarter."),
      ],
      failures: [],
    }
    const r = admit(
      spread,
      [proposal({
        from: { docId: "vendor", quote: "The number is 99.99 percent" },
        to: { docId: "status", quote: "Four incidents were recorded" },
      })],
      TERMS,
      buildIdf(spread.docs),
    )
    expect(r.denied).toEqual([])
    expect(r.admitted).toHaveLength(1)
  })
})

describe("admit — denies unsound proposals", () => {
  const cases: [string, Partial<RelationProposal>, string][] = [
    ["a fabricated quote", { from: { docId: "vendor", quote: "Acme promises perfect uptime" } }, "ANCHOR_NOT_FOUND"],
    ["an unknown document", { from: { docId: "ghost", quote: "anything" } }, "DOC_UNKNOWN"],
    ["a pair whose sides are the same document", { to: { docId: "vendor", quote: "every workspace" } }, "SELF_PAIR"],
    ["a low-confidence proposal", { confidence: 0.2 }, "LOW_CONFIDENCE"],
  ]

  for (const [name, over, code] of cases) {
    it(`denies ${name} with ${code}`, () => {
      const r = admit(CORPUS, [proposal(over)], TERMS, IDF)
      expect(r.admitted).toEqual([])
      expect(r.denied[0]!.code).toBe(code)
    })
  }

  it("denies a repeat of an already-admitted pair", () => {
    const r = admit(CORPUS, [proposal(), proposal({ proposalId: "p1" })], TERMS, IDF)
    expect(r.admitted).toHaveLength(1)
    expect(r.denied[0]!.code).toBe("DUPLICATE")
  })

  // Same two spans, opposite direction. A direction-sensitive key would admit
  // both and render the one finding twice.
  it("denies the same pair proposed in the opposite direction", () => {
    const reversed = proposal({
      proposalId: "p1",
      from: { docId: "status", quote: "four separate uptime incidents" },
      to: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    })
    const r = admit(CORPUS, [proposal(), reversed], TERMS, IDF)
    expect(r.admitted).toHaveLength(1)
    expect(r.denied[0]!.code).toBe("DUPLICATE")
  })

  // One vendor sentence confirmed by two independent documents is one
  // corroborated claim evidenced twice, not two findings. Tesla's report
  // carried this verbatim: the same "requires active driver supervision" span
  // rendered as two rows, once against Wikipedia and once against IIHS.
  it("denies a second corroboration of a claim already corroborated elsewhere", () => {
    const twoWitnesses: Corpus = {
      subject: "acme",
      docs: [
        VENDOR,
        doc("status", "independent", "Acme met its 99.99% uptime target for acme every month."),
        doc("review", "independent", "Independent monitoring confirms acme uptime above 99.99%."),
      ],
      failures: [],
    }
    const idf = buildIdf(twoWitnesses.docs)
    const r = admit(
      twoWitnesses,
      [
        proposal({ type: "corroborates", to: { docId: "status", quote: "met its 99.99% uptime target" } }),
        proposal({ proposalId: "p1", type: "corroborates", to: { docId: "review", quote: "confirms acme uptime above 99.99%" } }),
      ],
      TERMS,
      idf,
    )
    expect(r.admitted).toHaveLength(1)
    expect(r.admitted[0]!.sides[1]!.docId).toBe("status")
    expect(r.denied[0]!.code).toBe("DUPLICATE")
  })

  // The claim key must not collapse distinct findings about one claim. A span
  // that is corroborated by one source and contradicted by another is the most
  // informative row pair a ledger can carry, so the relation type is part of
  // the key.
  it("keeps a claim that is both corroborated and contradicted", () => {
    const mixed: Corpus = {
      subject: "acme",
      docs: [
        VENDOR,
        doc("status", "independent", "Acme met its 99.99% uptime target for acme every month."),
        doc("review", "independent", "Acme missed acme uptime commitments in four separate months."),
      ],
      failures: [],
    }
    const r = admit(
      mixed,
      [
        proposal({ type: "corroborates", to: { docId: "status", quote: "met its 99.99% uptime target" } }),
        proposal({ proposalId: "p1", type: "contradicts", to: { docId: "review", quote: "missed acme uptime commitments" } }),
      ],
      TERMS,
      buildIdf(mixed.docs),
    )
    expect(r.denied).toEqual([])
    expect(r.admitted).toHaveLength(2)
  })

  // NaN < 0.5 is false, so an unguarded comparison fails open here.
  it("denies a proposal whose confidence is not a finite number", () => {
    const r = admit(CORPUS, [proposal({ confidence: Number.NaN })], TERMS, IDF)
    expect(r.admitted).toEqual([])
    expect(r.denied[0]!.code).toBe("LOW_CONFIDENCE")
  })

  it("denies an off-topic pair", () => {
    const offTopic: Corpus = {
      subject: "acme",
      docs: [
        doc("vendor", "claimant", "Our office kitchen restocks oat milk every Tuesday."),
        doc("status", "independent", "The oat milk ran out on a Wednesday last quarter."),
      ],
      failures: [],
    }
    const r = admit(
      offTopic,
      [proposal({
        from: { docId: "vendor", quote: "restocks oat milk every Tuesday" },
        to: { docId: "status", quote: "oat milk ran out on a Wednesday" },
      })],
      TERMS,
      buildIdf(offTopic.docs),
    )
    expect(r.denied[0]!.code).toBe("NOT_QUERY_RELEVANT")
  })
})

describe("admit — the standing invariant", () => {
  // Genuine quotes are varied so the run produces several distinct admitted
  // rows. With one quote pair for every real proposal they all collapse to a
  // single dedup key, and the assertion below runs over one row while looking
  // like it covers two hundred.
  const REAL_VENDOR = [
    "Acme guarantees 99.99% uptime",
    "for every workspace",
    "on a paid plan",
  ]
  const REAL_STATUS = [
    "four separate uptime incidents",
    "in the last ninety days",
    "Acme reported four",
  ]

  it("never admits a span absent from the source text", () => {
    const proposals: RelationProposal[] = Array.from({ length: 200 }, (_, i) => {
      const fabricate = i % 2 === 0
      return proposal({
        proposalId: `p${i}`,
        confidence: 0.5 + (i % 5) / 10,
        from: {
          docId: i % 7 === 0 ? "ghost" : "vendor",
          quote: fabricate ? `invented phrase ${i}` : REAL_VENDOR[i % REAL_VENDOR.length]!,
        },
        to: {
          docId: "status",
          quote: fabricate ? `also invented ${i}` : REAL_STATUS[(i + 1) % REAL_STATUS.length]!,
        },
      })
    })

    const { admitted } = admit(CORPUS, proposals, TERMS, IDF)

    // Without this the invariant below passes vacuously on zero rows.
    expect(admitted.length).toBeGreaterThanOrEqual(3)

    const byId = new Map(CORPUS.docs.map((d) => [d.docId, d]))
    for (const a of admitted) {
      for (const span of a.sides) {
        expect(byId.get(span.docId)!.text.slice(span.start, span.end)).toBe(span.text)
      }
    }
  })
})

describe("admit — an aggregator is a conduit, not a source", () => {
  // Reproduces a real admission from fixtures/claude.json: a Hacker News
  // result whose link points back at the vendor was admitted as independent
  // corroboration of the vendor's own claim.
  const LAUNDERED: Corpus = {
    subject: "claude",
    docs: [
      {
        docId: "docs", url: "https://docs.claude.com/models", label: "Model docs",
        role: "claimant", kind: "vendor_docs", fetchedAt: "2026-09-01T00:00:00.000Z",
        title: "docs", sessionId: "s",
        text: "Claude Haiku 4.5 is the fastest model with near-frontier intelligence for claude users.",
      },
      {
        docId: "product", url: "https://www.anthropic.com/claude", label: "Product page",
        role: "claimant", kind: "vendor_site", fetchedAt: "2026-09-01T00:00:00.000Z",
        title: "product", sessionId: "s",
        text: "Meet Claude, a thinking partner for claude users everywhere.",
      },
      {
        docId: "hn", url: "https://hn.algolia.com/?q=anthropic.com", label: "Hacker News",
        role: "independent", kind: "forum", fetchedAt: "2026-09-01T00:00:00.000Z",
        title: "hn", sessionId: "s",
        text: "Claude Haiku 4.5(https://www.anthropic.com/news/claude-haiku-4-5) 210 points | claude discussion",
      },
    ],
    failures: [],
  }

  const TERMS_C = tokenize("claude")
  const IDF_C = buildIdf(LAUNDERED.docs)

  function pair(quote: string) {
    return {
      proposalId: "p0", type: "corroborates" as const, topic: "model lineup",
      statement: "Claude Haiku 4.5 is a released model",
      from: { docId: "docs", quote: "the fastest model with near-frontier intelligence" },
      to: { docId: "hn", quote },
      rationale: "", confidence: 0.9,
    }
  }

  it("denies corroboration whose independent side links to the claimant", () => {
    const r = admit(LAUNDERED, [pair("Claude Haiku 4.5(https://www.anthropic.com/news/claude-haiku-4-5)")], TERMS_C, IDF_C)
    expect(r.admitted).toEqual([])
    expect(r.denied[0]!.code).toBe("SELF_SOURCED")
  })

  it("still admits corroboration from a genuinely third-party link", () => {
    const hn = LAUNDERED.docs.find((d) => d.docId === "hn")!
    const thirdParty: Corpus = {
      ...LAUNDERED,
      docs: [
        ...LAUNDERED.docs.filter((d) => d.docId !== "hn"),
        {
          ...hn,
          text: "Claude benchmark results(https://artificialanalysis.ai/models/claude) 210 points | claude",
        },
      ],
    }
    const r = admit(
      thirdParty,
      [pair("Claude benchmark results(https://artificialanalysis.ai/models/claude)")],
      TERMS_C,
      buildIdf(thirdParty.docs),
    )
    expect(r.denied).toEqual([])
    expect(r.admitted).toHaveLength(1)
  })

  // The check knows only the domains the plan actually named. A claimant that
  // publishes on a domain absent from its own source plan is invisible to it —
  // worth knowing when writing a plan, and the reason claimant coverage should
  // include every domain the subject speaks from.
  it("cannot catch a domain the source plan never named", () => {
    const narrow: Corpus = {
      ...LAUNDERED,
      docs: LAUNDERED.docs.filter((d) => d.docId !== "product"),
    }
    const r = admit(
      narrow,
      [pair("Claude Haiku 4.5(https://www.anthropic.com/news/claude-haiku-4-5)")],
      TERMS_C,
      buildIdf(narrow.docs),
    )
    // anthropic.com is not among the claimant urls here, so it passes.
    expect(r.admitted).toHaveLength(1)
  })
})

describe("admit — an unsupported claim must survive the whole corpus", () => {
  // Proposal passes are fanned one independent source at a time, so an
  // unsupported proposal is made without sight of the source that answers it.
  // Tesla's ledger showed the consequence: the subscription price rendered as
  // `unverified` from one pass and `corroborated` from another, in one report.
  it("denies an unsupported claim whose span already carries a relation", () => {
    const r = admit(
      CORPUS,
      [
        proposal({ proposalId: "rel", type: "corroborates" }),
        proposal({
          proposalId: "unsup", type: "unsupported", to: null,
          from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
        }),
      ],
      TERMS,
      IDF,
    )
    expect(r.admitted).toHaveLength(1)
    expect(r.admitted[0]!.proposal.type).toBe("corroborates")
    expect(r.denied[0]).toMatchObject({ proposalId: "unsup", code: "DUPLICATE" })
  })

  // Order of proposals must not decide the outcome: the relation wins whether
  // or not its pass happened to return first.
  it("prefers the relation even when the unsupported claim was proposed first", () => {
    const r = admit(
      CORPUS,
      [
        proposal({
          proposalId: "unsup", type: "unsupported", to: null,
          from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
        }),
        proposal({ proposalId: "rel", type: "corroborates" }),
      ],
      TERMS,
      IDF,
    )
    expect(r.admitted.map((a) => a.proposal.proposalId)).toEqual(["rel"])
  })

  it("still admits an unsupported claim that no relation touches", () => {
    const r = admit(
      CORPUS,
      [proposal({
        proposalId: "unsup", type: "unsupported", to: null,
        from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
      })],
      TERMS,
      IDF,
    )
    expect(r.admitted).toHaveLength(1)
  })
})

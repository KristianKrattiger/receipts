import { describe, expect, it } from "vitest"
import { assay } from "./index.js"
import type { ProposalClient } from "./cartographer/propose.js"
import type { AssayResult, PinnedCorpus, PinnedDoc } from "./types.js"

function doc(over: Partial<PinnedDoc> = {}): PinnedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text: "The service is always available.",
    stability: "volatile", pin: { kind: "hash", sha256: "00" }, driftHash: "00",
    ...over,
  }
}

function client(proposals: object[] = []): ProposalClient {
  return { propose: async () => ({ proposals: proposals as never, stopReason: "end_turn" }) }
}

/** A client that returns no proposals at all. */
const silent: ProposalClient = client()

describe("assay", () => {
  it("refuses CORPUS_INSUFFICIENT before calling the model when one role is present", async () => {
    let called = false
    const client: ProposalClient = {
      propose: async () => { called = true; return { proposals: [] } },
    }
    const corpus: PinnedCorpus = { subject: "X", docs: [doc()], failures: [] }
    const r = await assay(corpus, { subject: "X" }, { client })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
    expect(called).toBe(false)
  })

  it("refuses NO_GROUNDING when the model proposes nothing", async () => {
    const corpus: PinnedCorpus = {
      subject: "X",
      docs: [doc({ docId: "a", role: "claimant" }), doc({ docId: "b", role: "independent" })],
      failures: [],
    }
    const r = await assay(corpus, { subject: "X" }, { client: silent })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("NO_GROUNDING")
  })

  // Finding 2: the previous version of this test used the zero-proposal
  // `silent` client, so `assemble` refused on NO_GROUNDING before `admit`'s
  // threshold comparison could ever run — it passed identically whether or
  // not `opts.threshold` reached `admit` at all. This version anchors one
  // real proposal and checks both directions of the threshold comparison, so
  // a broken (or hard-coded) threshold forwarding fails it.
  it("passes the caller's threshold through to admit", async () => {
    const corpus: PinnedCorpus = {
      subject: "Acme",
      docs: [
        doc({
          docId: "a", role: "claimant",
          text: "Acme guarantees 99.99% uptime for every account.",
        }),
        doc({
          docId: "b", role: "independent",
          text: "Acme has run without incident for the past year.",
        }),
      ],
      failures: [],
    }
    const proposal = {
      type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
      from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
      to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
    }
    const client: ProposalClient = {
      propose: async () => ({ proposals: [proposal] as never, stopReason: "end_turn" }),
    }

    const admitted = await assay(corpus, { subject: "Acme" }, { client, threshold: 0.5 })
    expect(admitted.outcome).toBe("ledger")
    if (admitted.outcome === "ledger") expect(admitted.rows.length).toBeGreaterThan(0)

    // Final review, Fix 1: this proposal's only denial is LOW_CONFIDENCE, which
    // fires before anchoring ever runs — so the truthful reason is NO_GROUNDING,
    // not BELOW_THRESHOLD (which would claim a span was located and only the
    // confidence check failed it). The threshold is still exercised: at 0.5 it
    // ledgers, at 0.7 it refuses.
    const refused = await assay(corpus, { subject: "Acme" }, { client, threshold: 0.7 })
    expect(refused.outcome).toBe("refusal")
    if (refused.outcome === "refusal") expect(refused.reason).toBe("NO_GROUNDING")
  })
})

// Finding 1 (final review): `anchoredCount` counted denial codes that are not
// evidence anchoring ran (LOW_CONFIDENCE fires before `findAnchor` is called)
// or succeeded (QUOTE_TOO_LONG, INCOHERENT_QUOTE are `findAnchor` failures) as
// though they were. Both produced a `BELOW_THRESHOLD` refusal whose detail
// claims "spans were found" when no span was ever located.
describe("assay — a refusal must not claim a span was found when none was", () => {
  const corpus: PinnedCorpus = {
    subject: "Acme",
    docs: [
      doc({ docId: "a", role: "claimant", text: "Acme guarantees perfect uptime for every workspace." }),
      doc({ docId: "b", role: "independent", text: "Acme has run without incident for the past year." }),
    ],
    failures: [],
  }

  it("refuses NO_GROUNDING, not BELOW_THRESHOLD, when every proposal is denied LOW_CONFIDENCE", async () => {
    const proposal = {
      type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
      from: { docId: "a", quote: "Acme guarantees perfect uptime for every workspace." },
      to: null, rationale: "below the confidence floor", confidence: 0.2,
    }
    const client: ProposalClient = {
      propose: async () => ({ proposals: [proposal] as never, stopReason: "end_turn" }),
    }
    const r = await assay(corpus, { subject: "Acme" }, { client })
    expect(r.outcome).toBe("refusal")
    if (r.outcome !== "refusal") return
    expect(r.reason).toBe("NO_GROUNDING")
    expect(r.detail).not.toContain("spans were found")
  })

  it("refuses NO_GROUNDING, not BELOW_THRESHOLD, when every proposal is denied QUOTE_TOO_LONG", async () => {
    // 45 words, verbatim in the doc, past MAX_QUOTE_WORDS (40) — a findAnchor
    // failure, not a success.
    const words = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ")
    const longCorpus: PinnedCorpus = {
      subject: "Acme",
      docs: [
        doc({ docId: "a", role: "claimant", text: `Acme states: ${words}.` }),
        doc({ docId: "b", role: "independent", text: "Acme has run without incident for the past year." }),
      ],
      failures: [],
    }
    const proposal = {
      type: "unsupported", topic: "uptime", statement: "an unverifiable long claim",
      from: { docId: "a", quote: words },
      to: null, rationale: "quote is long but verbatim", confidence: 0.9,
    }
    const client: ProposalClient = {
      propose: async () => ({ proposals: [proposal] as never, stopReason: "end_turn" }),
    }
    const r = await assay(longCorpus, { subject: "Acme" }, { client })
    expect(r.outcome).toBe("refusal")
    if (r.outcome !== "refusal") return
    expect(r.reason).toBe("NO_GROUNDING")
    expect(r.detail).not.toContain("spans were found")
  })
})

// Amendment 1: `via` on a PinnedDoc reaches the final DocSummary in an assembled ledger.
describe("assay — via provenance reaches the ledger", () => {
  const contradiction = {
    type: "contradicts", topic: "uptime", statement: "uptime guarantee",
    from: { docId: "a", quote: "Zenith guarantees 99.99% uptime" },
    to: { docId: "b", quote: "four outages" },
    rationale: "the vendor claim and the report disagree", confidence: 0.9,
  }
  const client: ProposalClient = {
    propose: async () => ({ proposals: [contradiction] as never, stopReason: "end_turn" }),
  }
  const corpus: PinnedCorpus = {
    subject: "Zenith",
    docs: [
      doc({
        docId: "a", role: "claimant", label: "Zenith site",
        text: "Zenith guarantees 99.99% uptime for every Zenith account.",
      }),
      doc({
        docId: "b", role: "independent", kind: "status_page", label: "Zenith status",
        text: "Zenith logged four outages across the last quarter.", via: "api",
      }),
    ],
    failures: [],
  }

  it("carries via:\"api\" from a pinned document onto its DocSummary in the ledger", async () => {
    const r = await assay(corpus, { subject: "Zenith" }, { client })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const summary = r.docs.find((d) => d.docId === "b")!
    expect(summary.via).toBe("api")
  })

  it("leaves the via key ABSENT on a DocSummary whose doc had no via", async () => {
    const r = await assay(corpus, { subject: "Zenith" }, { client })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const summary = r.docs.find((d) => d.docId === "a")!
    expect("via" in summary).toBe(false)
  })
})

// Phase 3a: exact replay is only possible if the assay is a pure function of
// its corpus and its client's responses. This pins that with the same stub
// answering every pass identically across two runs. If it ever fails, the
// proposal cache cannot deliver identical reports and --replay is a lie.
describe("assay is deterministic given identical responses", () => {
  it("returns strictly equal results on two runs, generatedAt aside", async () => {
    const corpus: PinnedCorpus = {
      subject: "Acme",
      docs: [
        doc({ docId: "a", role: "claimant", text: "Acme guarantees 99.99% uptime for every account." }),
        doc({ docId: "b", role: "independent", text: "Acme has run without incident for the past year." }),
      ],
      failures: [],
    }
    const proposal = {
      type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
      from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
      to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
    }
    const client: ProposalClient = {
      propose: async () => ({ proposals: [proposal] as never, stopReason: "end_turn" }),
    }
    const strip = (r: AssayResult) => { const { generatedAt: _g, ...rest } = r; return rest }
    const first = await assay(corpus, { subject: "Acme" }, { client })
    const second = await assay(corpus, { subject: "Acme" }, { client })
    expect(first.outcome).toBe("ledger")
    expect(strip(second)).toStrictEqual(strip(first))
  })
})

describe("assay runs", () => {
  const corpus: PinnedCorpus = {
    subject: "Acme",
    docs: [
      doc({
        docId: "a", role: "claimant", stability: "stable",
        text: "Acme guarantees 99.99% uptime for every account. Acme vehicles are five times safer.",
      }),
      doc({
        docId: "b", role: "independent", stability: "stable",
        text: "Acme has run without incident for the past year.",
      }),
    ],
    failures: [],
  }
  const uptime = {
    type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
    from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
    to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
  }
  const safety = {
    type: "unsupported", topic: "safety", statement: "Acme's safety claim",
    from: { docId: "a", quote: "Acme vehicles are five times safer." },
    to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
  }
  function stub(proposals: object[]): ProposalClient {
    return client(proposals)
  }

  it("adds no provenance on runs: 1, the default", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client: stub([uptime]) })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows.length).toBeGreaterThan(0)
    for (const row of r.rows) expect(row.provenance).toBeUndefined()
  })

  it("stamps a row both samples admitted as stable, and a one-sample row as provisional", async () => {
    const r = await assay(corpus, { subject: "Acme" }, {
      runs: 2,
      clientForSample: (s) => s === 0 ? stub([uptime, safety]) : stub([uptime]),
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const uptimeRow = r.rows.find((x) => x.topic === "uptime")!
    const safetyRow = r.rows.find((x) => x.topic === "safety")!
    expect(uptimeRow.provenance).toEqual({ class: "stable", reasons: [] })
    expect(safetyRow.provenance).toEqual({ class: "provisional", reasons: ["single-proposer-run"] })
  })
})

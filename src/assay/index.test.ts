import { describe, expect, it } from "vitest"
import { toPinnedCorpus } from "./adapt.js"
import { assay } from "./index.js"
import type { ProposalClient } from "./cartographer/propose.js"
import type { Corpus, FetchedDoc } from "../types.js"

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text: "The service is always available.", ...over,
  }
}

/** A client that returns no proposals at all. */
const silent: ProposalClient = {
  beta: { messages: { parse: async () => ({ parsed_output: { proposals: [] } }) } },
}

describe("assay", () => {
  it("refuses CORPUS_INSUFFICIENT before calling the model when one role is present", async () => {
    let called = false
    const client: ProposalClient = {
      beta: { messages: { parse: async () => { called = true; return { parsed_output: { proposals: [] } } } } },
    }
    const corpus: Corpus = { subject: "X", docs: [doc()], failures: [] }
    const r = await assay(toPinnedCorpus(corpus), { subject: "X" }, { client })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
    expect(called).toBe(false)
  })

  it("refuses NO_GROUNDING when the model proposes nothing", async () => {
    const corpus: Corpus = {
      subject: "X",
      docs: [doc({ docId: "a", role: "claimant" }), doc({ docId: "b", role: "independent" })],
      failures: [],
    }
    const r = await assay(toPinnedCorpus(corpus), { subject: "X" }, { client: silent })
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
    const corpus: Corpus = {
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
      beta: {
        messages: {
          parse: async () =>
            ({ stop_reason: "end_turn", parsed_output: { proposals: [proposal] } }) as never,
        },
      },
    }

    const admitted = await assay(toPinnedCorpus(corpus), { subject: "Acme" }, { client, threshold: 0.5 })
    expect(admitted.outcome).toBe("ledger")
    if (admitted.outcome === "ledger") expect(admitted.rows.length).toBeGreaterThan(0)

    const refused = await assay(toPinnedCorpus(corpus), { subject: "Acme" }, { client, threshold: 0.7 })
    expect(refused.outcome).toBe("refusal")
    if (refused.outcome === "refusal") expect(refused.reason).toBe("BELOW_THRESHOLD")
  })
})

// --- Amendment 1: `via` provenance survives the toPinnedCorpus round-trip and
// reaches the final DocSummary in an assembled ledger. See task-5 brief.
describe("assay — via provenance reaches the ledger", () => {
  const contradiction = {
    type: "contradicts", topic: "uptime", statement: "uptime guarantee",
    from: { docId: "a", quote: "Zenith guarantees 99.99% uptime" },
    to: { docId: "b", quote: "four outages" },
    rationale: "the vendor claim and the report disagree", confidence: 0.9,
  }
  const client: ProposalClient = {
    beta: {
      messages: {
        parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [contradiction] } }) as never,
      },
    },
  }
  const corpus: Corpus = {
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

  it("carries via:\"api\" from a FetchedDoc onto its DocSummary in the ledger", async () => {
    const r = await assay(toPinnedCorpus(corpus), { subject: "Zenith" }, { client })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const summary = r.docs.find((d) => d.docId === "b")!
    expect(summary.via).toBe("api")
  })

  it("leaves the via key ABSENT on a DocSummary whose doc had no via", async () => {
    const r = await assay(toPinnedCorpus(corpus), { subject: "Zenith" }, { client })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const summary = r.docs.find((d) => d.docId === "a")!
    expect("via" in summary).toBe(false)
  })
})

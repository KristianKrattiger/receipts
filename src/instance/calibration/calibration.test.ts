import { describe, expect, it } from "vitest"
import { assemble, NOT_ANCHORING_EVIDENCE } from "../../assay/assemble.js"
import { admit } from "../../assay/bookkeeper/admit.js"
import { buildIdf, tokenize } from "../../assay/retrieve/idf.js"
import type { PinnedDoc, RelationProposal } from "../../assay/types.js"
import { receipts } from "../profile.js"
import { AGGREGATOR, FORUM, goldCorpus, REGULATOR, REVIEWER, SUBJECT, TESTER } from "./corpus.js"

function proposal(over: Partial<RelationProposal> & Pick<RelationProposal, "proposalId" | "type" | "from" | "to">): RelationProposal {
  return { topic: "uptime", statement: over.statement ?? "uptime", rationale: "calibration", confidence: 0.9, ...over }
}

function run(independents: PinnedDoc[], proposals: RelationProposal[]) {
  const corpus = goldCorpus(independents)
  const result = admit(corpus, proposals, tokenize(SUBJECT), buildIdf(corpus.docs), undefined, receipts("frontier").lexicon)
  const anchoredCount = result.admitted.length
    + result.denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code)).length
  const assembled = assemble(corpus, proposals.length, result, { conflictMode: "report", anchoredCount })
  return { result, assembled }
}

const TRUE_TWIN = proposal({
  proposalId: "true", type: "corroborates",
  from: { docId: "vendor", quote: "Acme uptime is 99.99% across every region" },
  to: { docId: "reviewer", quote: "We measured Acme uptime at 99.99% over ninety days" },
})
const FALSE_TWIN = proposal({
  proposalId: "false", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "reviewer", quote: "In our tests Acme uptime failover took eleven seconds" },
})
const RESIDUAL = proposal({
  proposalId: "residual", type: "corroborates",
  from: { docId: "vendor", quote: "Acme uptime is 99.99% across every region" },
  to: { docId: "forum", quote: "Acme uptime has been fine for me, basically 99.99%" },
})
const HEARSAY = proposal({
  proposalId: "hearsay", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "aggregator", quote: "Critics say Acme uptime failover is much slower than advertised" },
})
const ACCORDING_TO_TESTING_TWIN = proposal({
  proposalId: "according-to-testing", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "tester", quote: "According to our testing, Acme uptime failover took eleven seconds" },
})
const REGULATOR_TWIN = proposal({
  proposalId: "regulator", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "regulator", quote: "The safety regulator's testing confirmed Acme uptime failover exceeded ten seconds" },
})

describe("Receipts calibration — a web lexicon can fire", () => {
  it("corroborates a true claim against a reviewer's own measurement", () => {
    const { assembled } = run([REVIEWER], [TRUE_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("corroborated")
  })
  it("marks a false claim divergent against a reviewer's own test", () => {
    const { assembled } = run([REVIEWER], [FALSE_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("divergent")
  })
  it("labels an unmarked forum corroboration context_unverified when nothing competes", () => {
    const { assembled } = run([FORUM], [RESIDUAL])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("context_unverified")
  })
  it("denies the same forum corroboration when a reviewer's measurement competes", () => {
    const { result, assembled } = run([FORUM, REVIEWER], [RESIDUAL])
    expect(result.denied[0]!.code).toBe("HOLDING_COMPETITOR")
    expect(assembled.audit.holdingCompetitorDenied).toBe(1)
  })
  it("denies attributed hearsay as argument", () => {
    const { result } = run([AGGREGATOR], [HEARSAY])
    expect(result.denied[0]!.code).toBe("ISSUE_STATEMENT")
  })
  it("marks a false claim divergent against an independent doc's own testing, phrased \"according to our testing\"", () => {
    const { assembled } = run([TESTER], [ACCORDING_TO_TESTING_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("divergent")
  })
  it("marks a false claim divergent against a named authority's third-person finding", () => {
    const { assembled } = run([REGULATOR], [REGULATOR_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("divergent")
  })
})

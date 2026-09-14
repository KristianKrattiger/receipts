import { describe, expect, it } from "vitest"
import type { AdmitResult } from "./bookkeeper/admit.js"
import { assemble } from "./assemble.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"

function pdoc(over: Partial<PinnedDoc> = {}): PinnedDoc {
  const text = over.text ?? "hello"
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text, stability: "volatile", pin: { kind: "hash", sha256: "ab" },
    driftHash: "drift", ...over,
  }
}

function corpus(docs: PinnedDoc[]): PinnedCorpus {
  return { subject: "X", docs, failures: [] }
}

const empty: AdmitResult = { admitted: [], denied: [] }

const bothRoles = [pdoc({ docId: "a", role: "claimant" }), pdoc({ docId: "b", role: "independent" })]

describe("assemble outcome decision", () => {
  it("refuses CORPUS_INSUFFICIENT on an empty corpus", () => {
    const r = assemble(corpus([]), 0, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
  })

  it("refuses CORPUS_INSUFFICIENT when only one role is present", () => {
    const r = assemble(corpus([pdoc({ role: "claimant" })]), 5, empty, {
      conflictMode: "report", anchoredCount: 3,
    })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
  })

  it("refuses NO_GROUNDING when nothing anchored", () => {
    const r = assemble(corpus(bothRoles), 4, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("NO_GROUNDING")
  })

  it("refuses BELOW_THRESHOLD when things anchored but none was admitted", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [{ proposalId: "p1", code: "LOW_CONFIDENCE", detail: "0.42 — a claim" }],
    }
    const r = assemble(corpus(bothRoles), 4, denied, { conflictMode: "report", anchoredCount: 4 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("BELOW_THRESHOLD")
  })

  // Finding 1: a corpus where every proposal anchored but was denied for a
  // non-confidence reason must not have its refusal blame the confidence
  // threshold — that would be a refusal stating a reason that is not the
  // reason. See the `belowThresholdDetail` doc comment in assemble.ts.
  it("names the actual denial codes, not confidence, when nothing was LOW_CONFIDENCE", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [
        { proposalId: "p1", code: "SELF_SOURCED", detail: "d1" },
        { proposalId: "p2", code: "SELF_SOURCED", detail: "d2" },
        { proposalId: "p3", code: "DUPLICATE", detail: "d3" },
        { proposalId: "p4", code: "SELF_SOURCED", detail: "d4" },
        { proposalId: "p5", code: "DUPLICATE", detail: "d5" },
      ],
    }
    const r = assemble(corpus(bothRoles), 5, denied, { conflictMode: "report", anchoredCount: 5 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome !== "refusal") return
    expect(r.reason).toBe("BELOW_THRESHOLD")
    expect(r.detail).not.toContain("confidence")
    expect(r.detail).toBe("spans were found, but none was admitted (3 SELF_SOURCED, 2 DUPLICATE)")
  })

  // Finding D, second final review: SELF_SOURCED is anchoring evidence (it
  // fires in admit.ts only after findAnchor already succeeded), so this denial
  // set is not "all LOW_CONFIDENCE" at all -- it is the mixed case below. The
  // wording this test pinned in the previous round was itself the bug: it
  // told the reader the located SELF_SOURCED span failed on confidence, which
  // is false. Corrected to describe both disjoint groups.
  it("does not blame confidence for a located span denied SELF_SOURCED, when LOW_CONFIDENCE also fired", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [
        { proposalId: "p1", code: "SELF_SOURCED", detail: "d1" },
        { proposalId: "p2", code: "LOW_CONFIDENCE", confidence: 0.3, detail: "0.3 — low" },
      ],
    }
    const r = assemble(corpus(bothRoles), 2, denied, { conflictMode: "report", anchoredCount: 1 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome !== "refusal") return
    expect(r.reason).toBe("BELOW_THRESHOLD")
    expect(r.detail).toBe(
      "1 proposal fell below the confidence threshold before a span was located; " +
        "the spans that were located were denied for other reasons (1 SELF_SOURCED)",
    )
  })

  // Finding D, second final review: a mixed run must not describe the located
  // spans as having failed on confidence (they didn't -- they were denied
  // NOT_QUERY_RELEVANT, after already clearing the threshold) nor describe the
  // LOW_CONFIDENCE proposals as having been located (they weren't -- LOW_CONFIDENCE
  // fires before findAnchor is ever called). The two groups are disjoint and
  // the detail string must name both correctly.
  it("names both disjoint groups in a mixed LOW_CONFIDENCE / anchored-and-denied run", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [
        { proposalId: "p1", code: "NOT_QUERY_RELEVANT" },
        { proposalId: "p2", code: "LOW_CONFIDENCE", confidence: 0.2, detail: "0.2 — low" },
        { proposalId: "p3", code: "NOT_QUERY_RELEVANT" },
        { proposalId: "p4", code: "LOW_CONFIDENCE", confidence: 0.4, detail: "0.4 — low" },
      ],
    }
    const r = assemble(corpus(bothRoles), 4, denied, { conflictMode: "report", anchoredCount: 2 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome !== "refusal") return
    expect(r.reason).toBe("BELOW_THRESHOLD")
    expect(r.detail).not.toBe("spans were found, but none cleared the confidence threshold")
    expect(r.detail).toBe(
      "2 proposals fell below the confidence threshold before a span was located; " +
        "the spans that were located were denied for other reasons (2 NOT_QUERY_RELEVANT)",
    )
  })

  // An all-LOW_CONFIDENCE denial set is NOT a reachable BELOW_THRESHOLD case:
  // every LOW_CONFIDENCE code is in NOT_ANCHORING_EVIDENCE, so anchoredCount
  // (computed in index.ts as admitted.length + denials outside that set)
  // would be 0, and assemble() refuses NO_GROUNDING before BELOW_THRESHOLD is
  // ever considered (see the `opts.anchoredCount === 0` branch above the
  // BELOW_THRESHOLD one). That path is exercised directly below.
  it("refuses NO_GROUNDING, not BELOW_THRESHOLD, when every denial was LOW_CONFIDENCE", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [
        { proposalId: "p1", code: "LOW_CONFIDENCE", confidence: 0.3, detail: "0.3 — low" },
        { proposalId: "p2", code: "LOW_CONFIDENCE", confidence: 0.1, detail: "0.1 — low" },
      ],
    }
    const r = assemble(corpus(bothRoles), 2, denied, { conflictMode: "report", anchoredCount: 0 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome !== "refusal") return
    expect(r.reason).toBe("NO_GROUNDING")
  })

  it("carries the audit line onto a refusal", () => {
    const r = assemble(corpus(bothRoles), 4, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.audit.proposed).toBe(4)
    expect(r.audit.admitted).toBe(0)
  })

  it("names the docs and failures on a refusal", () => {
    const c: PinnedCorpus = {
      subject: "X", docs: bothRoles,
      failures: [{ url: "u", label: "G2", reason: "blocked", detail: "no" }],
    }
    const r = assemble(c, 0, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.docs).toHaveLength(2)
    expect(r.failures).toHaveLength(1)
  })

  // Positive-path guard: the brief's six cases are refusal-only. A corpus with
  // both roles and at least one admitted row must produce a ledger, not a
  // refusal — without this an implementation that always refused would pass.
  it("yields a ledger when both roles are present and a row was admitted", () => {
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "corroborates", topic: "uptime",
          statement: "99.9% uptime", from: { docId: "a", quote: "99.9%" },
          to: { docId: "b", quote: "99.9%" }, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
          { docId: "b", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
        ],
      }],
      denied: [],
    }
    const r = assemble(corpus(bothRoles), 4, admitted, { conflictMode: "report", anchoredCount: 4 })
    expect(r.outcome).toBe("ledger")
    if (r.outcome === "ledger") {
      expect(r.rows).toHaveLength(1)
      expect(r.audit.admitted).toBe(1)
    }
  })

  // Converge-mode branch of the decision table, otherwise untested: an admitted
  // divergent row under conflictMode "converge" is a refusal, and specifically
  // CONFLICTING_UNRESOLVABLE — not the same as any threshold or grounding miss.
  it("refuses CONFLICTING_UNRESOLVABLE on a divergent row in converge mode", () => {
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "contradicts", topic: "uptime",
          statement: "uptime disputed", from: { docId: "a", quote: "99.9%" },
          to: { docId: "b", quote: "95%" }, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
          { docId: "b", start: 0, end: 3, text: "95%", tag: "EXACT" },
        ],
      }],
      denied: [],
    }
    const r = assemble(corpus(bothRoles), 4, admitted, { conflictMode: "converge", anchoredCount: 4 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CONFLICTING_UNRESOLVABLE")
  })

  // Near-miss construction was completely untested: all 8 existing tests
  // produced empty nearMiss arrays. This test verifies the filter, map, and sort
  // that builds the nearMiss array when BELOW_THRESHOLD triggers. It tests:
  // 1. Descending sort by confidence
  // 2. Filter excluding LOW_CONFIDENCE without confidence, and non-LOW_CONFIDENCE codes
  // 3. Detail → statement mapping
  it("populates nearMiss with LOW_CONFIDENCE denials sorted by descending confidence", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [
        // Deliberately out of order: 0.31, 0.45, 0.38
        { proposalId: "p1", code: "LOW_CONFIDENCE", confidence: 0.31, detail: "confidence too low: 0.31" },
        { proposalId: "p2", code: "LOW_CONFIDENCE", confidence: 0.45, detail: "confidence too low: 0.45" },
        { proposalId: "p3", code: "LOW_CONFIDENCE", confidence: 0.38, detail: "confidence too low: 0.38" },
        // This LOW_CONFIDENCE lacks confidence field — should be filtered out
        { proposalId: "p4", code: "LOW_CONFIDENCE", detail: "some reason, no confidence value" },
        // This DUPLICATE has confidence but wrong code — should be filtered out
        { proposalId: "p5", code: "DUPLICATE", confidence: 0.99, detail: "exact duplicate" },
      ],
    }
    const r = assemble(corpus(bothRoles), 5, denied, { conflictMode: "report", anchoredCount: 5 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") {
      expect(r.reason).toBe("BELOW_THRESHOLD")
      // Assert the nearMiss array has exactly 3 items in descending confidence order
      expect(r.nearMiss).toHaveLength(3)
      expect(r.nearMiss[0]!.confidence).toBe(0.45)
      expect(r.nearMiss[1]!.confidence).toBe(0.38)
      expect(r.nearMiss[2]!.confidence).toBe(0.31)
      // Assert statement carries the detail string
      expect(r.nearMiss[0]!.statement).toBe("confidence too low: 0.45")
      expect(r.nearMiss[1]!.statement).toBe("confidence too low: 0.38")
      expect(r.nearMiss[2]!.statement).toBe("confidence too low: 0.31")
    }
  })
})

describe("assemble — claimant coverage", () => {
  it("reports coverage on a refusal as well as a ledger", () => {
    const claimant = pdoc({
      docId: "a", role: "claimant",
      text: "First claim paragraph.\n\nSecond claim paragraph.",
    })
    const independent = pdoc({ docId: "b", role: "independent", text: "record" })
    const r = assemble(
      corpus([claimant, independent]),
      0,
      empty,
      { conflictMode: "report", anchoredCount: 0 },
    )
    expect(r.audit.claimantChunks).toBe(2)
    expect(r.audit.claimantCovered).toBe(0)
    expect(r.audit.claimantOmitted).toBe(2)
    expect(r.audit.claimantOmittedPreviews).toEqual([
      "First claim paragraph.",
      "Second claim paragraph.",
    ])
    expect(r.audit.independentDocsTotal).toBe(1)
  })

  it("counts a claimant chunk covered when an admitted from-span overlaps it", () => {
    const claimant = pdoc({
      docId: "a", role: "claimant",
      text: "First claim paragraph.\n\nSecond claim paragraph.",
    })
    const independent = pdoc({ docId: "b", role: "independent", text: "record text" })
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "unsupported", topic: "first",
          statement: "first claim", from: { docId: "a", quote: "First claim paragraph." },
          to: null, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: "First claim paragraph.".length, text: "First claim paragraph.", tag: "EXACT" },
        ],
      }],
      denied: [],
    }
    const r = assemble(
      corpus([claimant, independent]),
      1,
      admitted,
      { conflictMode: "report", anchoredCount: 1 },
    )
    expect(r.outcome).toBe("ledger")
    expect(r.audit.claimantChunks).toBe(2)
    expect(r.audit.claimantCovered).toBe(1)
    expect(r.audit.claimantOmitted).toBe(1)
    expect(r.audit.claimantOmittedPreviews).toEqual(["Second claim paragraph."])
    expect(r.audit.independentDocsTotal).toBe(1)
  })

  it("reports zeros on an empty corpus", () => {
    const r = assemble(corpus([]), 0, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.audit.claimantChunks).toBe(0)
    expect(r.audit.claimantCovered).toBe(0)
    expect(r.audit.claimantOmitted).toBe(0)
    expect(r.audit.claimantOmittedPreviews).toEqual([])
    expect(r.audit.independentDocsTotal).toBe(0)
  })

  it("previews the first line of an omitted chunk, capped at 120 characters", () => {
    const long = "A".repeat(140)
    const claimant = pdoc({
      docId: "a", role: "claimant",
      text: `${long}\nSecond line of the same paragraph.\n\nCovered paragraph.`,
    })
    const independent = pdoc({ docId: "b", role: "independent", text: "record" })
    const covered = "Covered paragraph."
    const coveredStart = claimant.text.indexOf(covered)
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "unsupported", topic: "covered",
          statement: "covered", from: { docId: "a", quote: covered },
          to: null, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: coveredStart, end: coveredStart + covered.length, text: covered, tag: "EXACT" },
        ],
      }],
      denied: [],
    }
    const r = assemble(
      corpus([claimant, independent]),
      1,
      admitted,
      { conflictMode: "report", anchoredCount: 1 },
    )
    expect(r.audit.claimantOmitted).toBe(1)
    expect(r.audit.claimantOmittedPreviews).toEqual(["A".repeat(120)])
    expect(claimant.text.includes(r.audit.claimantOmittedPreviews[0]!)).toBe(true)
  })
})

describe("assemble — context_unverified and trap counts", () => {
  it("labels an unmarked corroboration context_unverified, not corroborated", () => {
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "corroborates", topic: "uptime",
          statement: "commentators", from: { docId: "a", quote: "99.9%" },
          to: { docId: "b", quote: "commentators" }, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
          { docId: "b", start: 0, end: 12, text: "commentators", tag: "EXACT" },
        ],
        contextUnverified: true,
      }],
      denied: [],
    }
    const r = assemble(corpus(bothRoles), 1, admitted, { conflictMode: "report", anchoredCount: 1 })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows[0]!.status).toBe("context_unverified")
    expect(r.rows[0]!.relation).toBe("corroborates")
    expect(r.audit.contextUnverified).toBe(1)
    expect(r.audit.issueStatementDenied).toBe(0)
  })

  it("keeps a holding corroboration corroborated", () => {
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "corroborates", topic: "uptime",
          statement: "holding", from: { docId: "a", quote: "99.9%" },
          to: { docId: "b", quote: "we hold" }, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
          { docId: "b", start: 0, end: 7, text: "we hold", tag: "EXACT" },
        ],
      }],
      denied: [],
    }
    const r = assemble(corpus(bothRoles), 1, admitted, { conflictMode: "report", anchoredCount: 1 })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows[0]!.status).toBe("corroborated")
    expect(r.audit.contextUnverified).toBe(0)
  })

  it("counts ISSUE_STATEMENT denials on the audit", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [{ proposalId: "p1", code: "ISSUE_STATEMENT", detail: "granted certiorari" }],
    }
    const r = assemble(corpus(bothRoles), 1, denied, { conflictMode: "report", anchoredCount: 1 })
    expect(r.audit.issueStatementDenied).toBe(1)
    expect(r.audit.contextUnverified).toBe(0)
  })

  it("does not treat context_unverified as divergent under converge", () => {
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "corroborates", topic: "uptime",
          statement: "commentators", from: { docId: "a", quote: "99.9%" },
          to: { docId: "b", quote: "commentators" }, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
          { docId: "b", start: 0, end: 12, text: "commentators", tag: "EXACT" },
        ],
        contextUnverified: true,
      }],
      denied: [],
    }
    const r = assemble(corpus(bothRoles), 1, admitted, { conflictMode: "converge", anchoredCount: 1 })
    expect(r.outcome).toBe("ledger")
  })
})

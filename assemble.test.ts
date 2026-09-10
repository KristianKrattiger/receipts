import { describe, expect, it } from "vitest"
import type { AdmitResult } from "./bookkeeper/admit.js"
import { assemble } from "./assemble.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"

function pdoc(over: Partial<PinnedDoc> = {}): PinnedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text: "hello", stability: "volatile", pin: { kind: "hash", sha256: "ab" }, ...over,
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

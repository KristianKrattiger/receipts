import { describe, expect, it } from "vitest"
import { assemble, NOT_ANCHORING_EVIDENCE } from "../assemble.js"
import { admit } from "../bookkeeper/admit.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
import { TEST_PROFILE } from "../test-profile.js"
import type { RelationProposal } from "../types.js"
import {
  ARGUMENT, CENTRAL_BANK, CLAIM, COMMENTATORS, goldCorpus, HOCHFELDER, SUBJECT, TELLABS,
} from "./corpus.js"

function proposal(over: Partial<RelationProposal> & Pick<RelationProposal, "proposalId" | "type">): RelationProposal {
  return {
    topic: "10b",
    statement: over.statement ?? "a 10(b) claim",
    from: over.from ?? { docId: "claim", quote: "unused" },
    to: over.to ?? null,
    rationale: "calibration",
    confidence: 0.9,
    ...over,
  }
}

function run(independents: Parameters<typeof goldCorpus>[0], proposals: RelationProposal[]) {
  const corpus = goldCorpus(independents)
  const terms = tokenize(SUBJECT)
  const result = admit(corpus, proposals, terms, buildIdf(corpus.docs), undefined, TEST_PROFILE.lexicon)
  const anchoredCount = result.admitted.length
    + result.denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code)).length
  const assembled = assemble(corpus, proposals.length, result, { conflictMode: "report", anchoredCount })
  return { corpus, result, assembled }
}

const FALSE_ABET = proposal({
  proposalId: "false-abet",
  type: "contradicts",
  statement: "false aiding and abetting",
  from: { docId: "claim", quote: "Section 10(b) creates a private right of action against those who aid and abet a primary violation." },
  to: { docId: "central_bank", quote: "we hold that a private plaintiff may not maintain an aiding and abetting suit under Section 10(b)" },
})

const TRUE_ABET = proposal({
  proposalId: "true-abet",
  type: "corroborates",
  statement: "true no aiding and abetting",
  from: { docId: "claim", quote: "A private plaintiff may not maintain an aiding and abetting suit under Section 10(b)." },
  to: { docId: "central_bank", quote: "we hold that a private plaintiff may not maintain an aiding and abetting suit under Section 10(b)" },
})

const NEGLIGENCE_HOLDING = proposal({
  proposalId: "neg",
  type: "contradicts",
  statement: "negligence is enough",
  from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
  to: { docId: "tellabs", quote: "We hold that plaintiffs in a Section 10(b) action must plead facts evidencing scienter" },
})

const CERT_MINE = proposal({
  proposalId: "cert",
  type: "corroborates",
  statement: "cert grant as corroboration",
  from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
  to: { docId: "hochfelder", quote: "We granted certiorari to resolve the question whether a private cause of action for damages will lie" },
})

const ARG_MINE = proposal({
  proposalId: "arg",
  type: "corroborates",
  statement: "petitioner argues",
  from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
  to: { docId: "argument", quote: "Petitioner argues that a private damages action under Section 10(b) may rest on negligent bookkeeping without scienter" },
})

const RESIDUAL = proposal({
  proposalId: "residual",
  type: "corroborates",
  statement: "residual commentators",
  from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
  to: { docId: "commentators", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter, as commentators have written" },
})

describe("calibration — required twins", () => {
  it("marks false aiding-and-abetting divergent against Central Bank", () => {
    const { assembled } = run([CENTRAL_BANK], [FALSE_ABET])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("divergent")
  })

  it("marks the true aiding-and-abetting twin corroborated against Central Bank", () => {
    const { assembled } = run([CENTRAL_BANK], [TRUE_ABET])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("corroborated")
  })

  it("marks negligence divergent against a holding sentence", () => {
    const { result } = run([TELLABS], [NEGLIGENCE_HOLDING])
    expect(result.denied).toEqual([])
    expect(result.admitted[0]!.proposal.type).toBe("contradicts")
  })
})

describe("calibration — quote-mining gates", () => {
  it("denies cert-grant corroboration of the negligence claim", () => {
    const { result, assembled } = run([HOCHFELDER], [CERT_MINE])
    expect(result.admitted).toEqual([])
    expect(result.denied[0]!.code).toBe("ISSUE_STATEMENT")
    expect(assembled.audit.issueStatementDenied).toBe(1)
  })

  it("denies argument-sentence corroboration of the negligence claim", () => {
    const { result } = run([ARGUMENT], [ARG_MINE])
    expect(result.admitted).toEqual([])
    expect(result.denied[0]!.code).toBe("ISSUE_STATEMENT")
  })

  it("labels the residual unmarked trap context_unverified, not corroborated", () => {
    const { result, assembled } = run([COMMENTATORS], [RESIDUAL])
    expect(result.denied).toEqual([])
    expect(result.admitted).toHaveLength(1)
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("context_unverified")
    expect(assembled.audit.contextUnverified).toBe(1)
  })

  it("denies manufactured-doubt: unmarked brief plus a holding in another Record file", () => {
    const { result, assembled } = run([COMMENTATORS, TELLABS], [RESIDUAL])
    expect(result.admitted).toEqual([])
    expect(result.denied[0]!.code).toBe("HOLDING_COMPETITOR")
    expect(assembled.audit.holdingCompetitorDenied).toBe(1)
    expect(assembled.audit.issueStatementDenied).toBe(0)
  })

  it("denies an unmarked contradiction of a true twin when another Record document holds", () => {
    const doubt = proposal({
      proposalId: "doubt",
      type: "contradicts",
      statement: "commentators contradict scienter",
      from: { docId: "claim", quote: "Scienter, intent to deceive, manipulate, or defraud, is required in a private action under Section 10(b)." },
      to: { docId: "commentators", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter, as commentators have written" },
    })
    const holding = proposal({
      proposalId: "hold",
      type: "corroborates",
      statement: "scienter holding",
      from: { docId: "claim", quote: "Scienter, intent to deceive, manipulate, or defraud, is required in a private action under Section 10(b)." },
      to: { docId: "tellabs", quote: "We hold that plaintiffs in a Section 10(b) action must plead facts evidencing scienter" },
    })
    const { result, assembled } = run([COMMENTATORS, TELLABS], [doubt, holding])
    expect(result.denied.find((d) => d.proposalId === "doubt")!.code).toBe("HOLDING_COMPETITOR")
    expect(result.admitted).toHaveLength(1)
    expect(result.admitted[0]!.proposal.proposalId).toBe("hold")
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("corroborated")
  })
})

describe("calibration — four-class rates", () => {
  it("reports answer / deny / labeled counts for the canned classes", () => {
    const classes = [
      { name: "true-twin", independents: [CENTRAL_BANK], proposals: [TRUE_ABET], expect: "corroborated" as const },
      { name: "false-twin", independents: [CENTRAL_BANK], proposals: [FALSE_ABET], expect: "divergent" as const },
      { name: "quote-mine", independents: [HOCHFELDER], proposals: [CERT_MINE], expect: "ISSUE_STATEMENT" as const },
      { name: "residual", independents: [COMMENTATORS], proposals: [RESIDUAL], expect: "context_unverified" as const },
      { name: "manufactured-doubt", independents: [COMMENTATORS, TELLABS], proposals: [RESIDUAL], expect: "HOLDING_COMPETITOR" as const },
    ]
    const rates = { corroborated: 0, divergent: 0, issueStatement: 0, holdingCompetitor: 0, contextUnverified: 0 }
    for (const c of classes) {
      const { assembled, result } = run(c.independents, c.proposals)
      if (c.expect === "ISSUE_STATEMENT" || c.expect === "HOLDING_COMPETITOR") {
        expect(result.denied[0]!.code, c.name).toBe(c.expect)
        if (c.expect === "ISSUE_STATEMENT") rates.issueStatement++
        else rates.holdingCompetitor++
        continue
      }
      expect(assembled.outcome, c.name).toBe("ledger")
      if (assembled.outcome !== "ledger") continue
      expect(assembled.rows[0]!.status, c.name).toBe(c.expect)
      if (c.expect === "corroborated") rates.corroborated++
      if (c.expect === "divergent") rates.divergent++
      if (c.expect === "context_unverified") rates.contextUnverified++
    }
    expect(rates).toEqual({ corroborated: 1, divergent: 1, issueStatement: 1, holdingCompetitor: 1, contextUnverified: 1 })
  })
})

describe("calibration — coverage is reported", () => {
  it("populates claimantChunks / covered / omitted consistently", () => {
    const { assembled } = run([CENTRAL_BANK], [TRUE_ABET])
    expect(assembled.audit.claimantChunks).toBeGreaterThan(0)
    expect(assembled.audit.claimantCovered + assembled.audit.claimantOmitted)
      .toBe(assembled.audit.claimantChunks)
    expect(assembled.audit.independentDocsAdmitted).toBe(1)
    expect(assembled.audit.independentDocsTotal).toBe(1)
    expect(assembled.audit.claimantOmittedPreviews.length)
      .toBeLessThanOrEqual(Math.min(12, assembled.audit.claimantOmitted))
    expect(assembled.audit.claimantOmittedPreviews.length)
      .toBe(Math.min(12, assembled.audit.claimantOmitted))
  })
})

import { describe, expect, it } from "vitest"
import { assemble, NOT_ANCHORING_EVIDENCE } from "../assemble.js"
import { admit } from "../bookkeeper/admit.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
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
  const result = admit(corpus, proposals, terms, buildIdf(corpus.docs))
  const anchoredCount = result.admitted.length
    + result.denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code)).length
  const assembled = assemble(corpus, proposals.length, result, { conflictMode: "report", anchoredCount })
  return { corpus, result, assembled }
}

describe("calibration — required twins", () => {
  it("marks false aiding-and-abetting divergent against Central Bank", () => {
    const { result } = run([CENTRAL_BANK], [proposal({
      proposalId: "false-abet",
      type: "contradicts",
      statement: "false aiding and abetting",
      from: { docId: "claim", quote: "Section 10(b) creates a private right of action against those who aid and abet a primary violation." },
      to: { docId: "central_bank", quote: "we hold that a private plaintiff may not maintain an aiding and abetting suit under Section 10(b)" },
    })])
    expect(result.denied).toEqual([])
    expect(result.admitted[0]!.proposal.type).toBe("contradicts")
  })

  it("marks the true aiding-and-abetting twin corroborated against Central Bank", () => {
    const { result } = run([CENTRAL_BANK], [proposal({
      proposalId: "true-abet",
      type: "corroborates",
      statement: "true no aiding and abetting",
      from: { docId: "claim", quote: "A private plaintiff may not maintain an aiding and abetting suit under Section 10(b)." },
      to: { docId: "central_bank", quote: "we hold that a private plaintiff may not maintain an aiding and abetting suit under Section 10(b)" },
    })])
    expect(result.denied).toEqual([])
    expect(result.admitted[0]!.proposal.type).toBe("corroborates")
  })

  it("marks negligence divergent against a holding sentence", () => {
    const { result } = run([TELLABS], [proposal({
      proposalId: "neg",
      type: "contradicts",
      statement: "negligence is enough",
      from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
      to: { docId: "tellabs", quote: "We hold that plaintiffs in a Section 10(b) action must plead facts evidencing scienter" },
    })])
    expect(result.denied).toEqual([])
    expect(result.admitted[0]!.proposal.type).toBe("contradicts")
  })
})

describe("calibration — quote-mining gates", () => {
  it("denies cert-grant corroboration of the negligence claim", () => {
    const { result } = run([HOCHFELDER], [proposal({
      proposalId: "cert",
      type: "corroborates",
      statement: "cert grant as corroboration",
      from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
      to: { docId: "hochfelder", quote: "We granted certiorari to resolve the question whether a private cause of action for damages will lie" },
    })])
    expect(result.admitted).toEqual([])
    expect(result.denied[0]!.code).toBe("ISSUE_STATEMENT")
  })

  it("denies argument-sentence corroboration of the negligence claim", () => {
    const { result } = run([ARGUMENT], [proposal({
      proposalId: "arg",
      type: "corroborates",
      statement: "petitioner argues",
      from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
      to: { docId: "argument", quote: "Petitioner argues that a private damages action under Section 10(b) may rest on negligent bookkeeping without scienter" },
    })])
    expect(result.admitted).toEqual([])
    expect(result.denied[0]!.code).toBe("ISSUE_STATEMENT")
  })

  it("still admits the residual unmarked trap with no holding competitor", () => {
    const { result } = run([COMMENTATORS], [proposal({
      proposalId: "residual",
      type: "corroborates",
      statement: "residual commentators",
      from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
      to: { docId: "commentators", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter, as commentators have written" },
    })])
    expect(result.denied).toEqual([])
    expect(result.admitted).toHaveLength(1)
  })
})

describe("calibration — coverage is reported", () => {
  it("populates claimantChunks / covered / omitted consistently", () => {
    const { assembled } = run([CENTRAL_BANK], [proposal({
      proposalId: "true-abet",
      type: "corroborates",
      from: { docId: "claim", quote: "A private plaintiff may not maintain an aiding and abetting suit under Section 10(b)." },
      to: { docId: "central_bank", quote: "we hold that a private plaintiff may not maintain an aiding and abetting suit under Section 10(b)" },
    })])
    expect(assembled.audit.claimantChunks).toBeGreaterThan(0)
    expect(assembled.audit.claimantCovered + assembled.audit.claimantOmitted)
      .toBe(assembled.audit.claimantChunks)
    expect(assembled.audit.independentDocsAdmitted).toBe(1)
  })
})

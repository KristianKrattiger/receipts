import { findAnchor } from "./anchor.js"
import { citesClaimant, claimantDomains } from "./independence.js"
import { DIVERGENCE_IDF_FLOOR, idfRelevance } from "../retrieve/idf.js"
import type {
  Admission, AdmittedSpan, Corpus, FetchedDoc, RelationProposal,
} from "../types.js"

export const CONFIDENCE_FLOOR = 0.5

/** Characters of surrounding text used for the relevance check. */
const RELEVANCE_WINDOW = 300

export interface AdmittedRelation {
  proposal: RelationProposal
  /**
   * One span for an unsupported claim, two for a relation between sources, in
   * `from`-then-`to` order. Deliberately not split into vendor/independent
   * slots: both sides of a pair can share a role — a vendor's pricing page
   * contradicting its own docs is one of the more damning findings available —
   * and role-keyed slots silently discard the second span when that happens.
   * Consumers label each side from its own document's role.
   */
  sides: AdmittedSpan[]
}

export interface AdmitResult {
  admitted: AdmittedRelation[]
  denied: Admission[]
}

function windowAround(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - RELEVANCE_WINDOW), Math.min(text.length, end + RELEVANCE_WINDOW))
}

/**
 * The sole writer of report content.
 *
 * The model proposes; this decides. Every quote's offsets are re-derived from
 * the bytes we fetched, so a proposal the model invented cannot reach the
 * report regardless of how confident or plausible it is. Denials are retained
 * and reported rather than discarded — publishing the denial count is what
 * makes the guarantee checkable.
 */
export function admit(
  corpus: Corpus,
  proposals: RelationProposal[],
  queryTerms: string[],
  idf: Map<string, number>,
): AdmitResult {
  const byId = new Map(corpus.docs.map((d) => [d.docId, d]))
  const ownDomains = claimantDomains(corpus)
  const admitted: AdmittedRelation[] = []
  const denied: Admission[] = []
  const seen = new Set<string>()

  // Relations before unsupported claims, whatever order they were proposed in.
  //
  // "Nothing corroborates this" is only true if nothing does, and the proposal
  // passes are fanned one independent source at a time, so an unsupported
  // proposal is made without sight of the source that may answer it. Judging
  // relations first means a claimant span already carrying a relation is on the
  // record by the time its unsupported twin is considered, and the check below
  // can retire it. Without this the same claim rendered twice in one ledger,
  // once as `unverified` and once as `corroborated`.
  const ordered = [...proposals].sort(
    (a, b) => Number(a.type === "unsupported") - Number(b.type === "unsupported"),
  )
  const relatedSpans = new Set<string>()

  for (const p of ordered) {
    // Finiteness first: NaN and undefined both make `< FLOOR` false, so an
    // unchecked comparison fails open on exactly the malformed input this gate
    // exists to distrust.
    if (!Number.isFinite(p.confidence) || p.confidence < CONFIDENCE_FLOOR) {
      // Name what was nearly found. A bare confidence number says six things
      // were rejected without saying what, which is exactly the information
      // needed to judge whether the floor is set right. The statement is the
      // model's own label, never rendered as an assertion, so surfacing it
      // does not put an unverified claim in the report.
      denied.push({
        proposalId: p.proposalId,
        code: "LOW_CONFIDENCE",
        detail: `${p.confidence} — ${p.topic}: ${p.statement}`,
      })
      continue
    }

    const fromDoc = byId.get(p.from.docId)
    if (!fromDoc) {
      denied.push({ proposalId: p.proposalId, code: "DOC_UNKNOWN", detail: p.from.docId })
      continue
    }
    const fromAnchor = findAnchor(fromDoc.text, p.from.quote)
    if (!fromAnchor.ok) {
      denied.push({ proposalId: p.proposalId, code: fromAnchor.code, detail: p.from.quote.slice(0, 60) })
      continue
    }
    const fromSpan: AdmittedSpan = {
      docId: fromDoc.docId, start: fromAnchor.start, end: fromAnchor.end,
      text: p.from.quote, tag: fromAnchor.tag,
    }

    let toDoc: FetchedDoc | null = null
    let toSpan: AdmittedSpan | null = null

    if (p.to) {
      toDoc = byId.get(p.to.docId) ?? null
      if (!toDoc) {
        denied.push({ proposalId: p.proposalId, code: "DOC_UNKNOWN", detail: p.to.docId })
        continue
      }
      if (toDoc.docId === fromDoc.docId) {
        denied.push({ proposalId: p.proposalId, code: "SELF_PAIR", detail: toDoc.docId })
        continue
      }
      const toAnchor = findAnchor(toDoc.text, p.to.quote)
      if (!toAnchor.ok) {
        denied.push({ proposalId: p.proposalId, code: toAnchor.code, detail: p.to.quote.slice(0, 60) })
        continue
      }
      toSpan = {
        docId: toDoc.docId, start: toAnchor.start, end: toAnchor.end,
        text: p.to.quote, tag: toAnchor.tag,
      }
    }

    // Relevance is judged on the surrounding passage, not the 40-word quote —
    // a genuine claim often does not repeat the subject's name inside itself.
    const sides: [FetchedDoc, AdmittedSpan][] = [[fromDoc, fromSpan]]
    if (toDoc && toSpan) sides.push([toDoc, toSpan])

    // A span from an independent document that links to the claimant's own
    // domain is the claimant's words on someone else's page. Admitting it as
    // corroboration would present a press release as third-party confirmation.
    // Checked here rather than trusted to the prompt: the model is told the
    // same rule, but a gate that only holds when the model complies is not a
    // gate.
    const launderedSide = sides.find(
      ([d, s]) => d.role === "independent" && citesClaimant(s.text, ownDomains),
    )
    if (launderedSide) {
      denied.push({
        proposalId: p.proposalId,
        code: "SELF_SOURCED",
        detail: `${launderedSide[0].label} cites the claimant's own domain`,
      })
      continue
    }
    const offTopic = sides.some(
      ([d, s]) => idfRelevance(windowAround(d.text, s.start, s.end), queryTerms, idf) < DIVERGENCE_IDF_FLOOR,
    )
    if (offTopic) {
      denied.push({ proposalId: p.proposalId, code: "NOT_QUERY_RELEVANT" })
      continue
    }

    // Two ways the same finding arrives twice.
    //
    // Endpoints are sorted so the pair key is direction-insensitive: the same
    // span pair proposed as A-contradicts-B and B-contradicts-A is one finding,
    // and would otherwise produce two identical report rows.
    //
    // The claim key catches the subtler one. A ledger row is "a claim, and what
    // happened to it" — not "a pairing of two sources". When three independent
    // documents each confirm one vendor sentence, that is one corroborated
    // claim evidenced three ways, and emitting a row per pairing pads the
    // ledger with what looks like three findings. Tesla's own report showed it:
    // "Currently enabled features require active driver supervision" appeared
    // twice, same vendor span, once against Wikipedia and once against IIHS.
    // First pairing admitted, rest denied as DUPLICATE, so the count stays
    // visible in the audit rather than vanishing.
    const spanKey = `${fromSpan.docId}@${fromSpan.start}`
    const pairKey = `pair:${sides.map(([, s]) => `${s.docId}@${s.start}`).sort().join("|")}`
    const claimKey = `claim:${p.type}:${spanKey}`
    const dupe = [pairKey, claimKey].find((k) => seen.has(k))
    if (dupe) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: dupe })
      continue
    }

    // A claim an independent source already speaks to is not unsupported,
    // however confidently a pass that could not see that source says otherwise.
    if (p.type === "unsupported" && relatedSpans.has(spanKey)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: `related:${spanKey}` })
      continue
    }

    seen.add(pairKey)
    seen.add(claimKey)
    if (p.type !== "unsupported") relatedSpans.add(spanKey)

    admitted.push({ proposal: p, sides: sides.map(([, span]) => span) })
  }

  return { admitted, denied }
}

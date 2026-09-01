import { findAnchor } from "./anchor.js"
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
  const admitted: AdmittedRelation[] = []
  const denied: Admission[] = []
  const seen = new Set<string>()

  for (const p of proposals) {
    // Finiteness first: NaN and undefined both make `< FLOOR` false, so an
    // unchecked comparison fails open on exactly the malformed input this gate
    // exists to distrust.
    if (!Number.isFinite(p.confidence) || p.confidence < CONFIDENCE_FLOOR) {
      denied.push({ proposalId: p.proposalId, code: "LOW_CONFIDENCE", detail: String(p.confidence) })
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
    const offTopic = sides.some(
      ([d, s]) => idfRelevance(windowAround(d.text, s.start, s.end), queryTerms, idf) < DIVERGENCE_IDF_FLOOR,
    )
    if (offTopic) {
      denied.push({ proposalId: p.proposalId, code: "NOT_QUERY_RELEVANT" })
      continue
    }

    // Endpoints are sorted so the key is direction-insensitive: the same span
    // pair proposed as A-contradicts-B and B-contradicts-A is one finding, and
    // would otherwise produce two identical report rows.
    const key = sides
      .map(([, s]) => `${s.docId}@${s.start}`)
      .sort()
      .join("|")
    if (seen.has(key)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: key })
      continue
    }
    seen.add(key)

    admitted.push({ proposal: p, sides: sides.map(([, span]) => span) })
  }

  return { admitted, denied }
}

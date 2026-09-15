import { findAnchor } from "./anchor.js"
import { discourseRole, enclosingSentence, sentences } from "./discourse.js"
import { citesClaimant, claimantDomains } from "./independence.js"
import { DIVERGENCE_IDF_FLOOR, idfRelevance, tokenize } from "../retrieve/idf.js"
import type {
  Admission, AdmittedSpan, PinnedCorpus, PinnedDoc, RelationProposal, RelationType,
  SourceStanding,
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
  /**
   * Unmarked independent corroboration with no holding competitor in the pile.
   * Still admitted — the span exists — but not painted as confirmed.
   */
  contextUnverified?: true
}

export interface AdmitResult {
  admitted: AdmittedRelation[]
  denied: Admission[]
}

/**
 * A quote reduced to what it says, for comparing two copies of one sentence.
 *
 * Deliberately blunt — case, punctuation, whitespace and leading footnote
 * markers all go — because it is only ever compared against another quote from
 * the same document under the same relation, where a match after this much
 * stripping means the page printed the line twice.
 */
function normalizeQuote(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function windowAround(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - RELEVANCE_WINDOW), Math.min(text.length, end + RELEVANCE_WINDOW))
}

function distinctiveOverlap(a: string, b: string): number {
  const stop = new Set([
    "that", "with", "from", "this", "they", "them", "than", "then", "when", "what",
    "have", "been", "were", "will", "shall", "into", "upon", "also", "such", "only",
    "more", "some", "over", "under", "even", "must", "does",
  ])
  const left = new Set(tokenize(a).filter((t) => t.length >= 4 && !stop.has(t)))
  const right = new Set(tokenize(b).filter((t) => t.length >= 4 && !stop.has(t)))
  let n = 0
  for (const t of left) if (right.has(t)) n++
  return n
}

/**
 * A holding competes with a claimant quote when IDF says so, or when two
 * content tokens overlap. Claim-quote IDF mass is often unmatched words
 * (negligent, bookkeeping) while the holding still names the same nouns.
 */
function holdingCompetesWithClaim(
  holding: string,
  fromSpanText: string,
  terms: string[],
  idf: Map<string, number>,
): boolean {
  if (idfRelevance(holding, terms, idf) >= DIVERGENCE_IDF_FLOOR) return true
  return distinctiveOverlap(fromSpanText, holding) >= 2
}

/**
 * A relation may not rest on an issue or argument sentence
 * (`ISSUE_STATEMENT`), or on a non-holding sentence when this document — or
 * another independent document — already contains an IDF-relevant holding
 * (`HOLDING_COMPETITOR`). Applies to every relation that asserts something
 * about the claim: an unmarked commentators sentence must not paint a true
 * claim red when another Record document already holds on that span. The
 * model proposes; this only denies. Unmarked spans with no holding competitor
 * in the pile still admit — residual curator work, labeled not solved.
 *
 * Returns the denial code, or null when the relation may stand.
 */
function blocksNonHolding(
  toDoc: PinnedDoc,
  toSpan: AdmittedSpan,
  fromSpan: AdmittedSpan,
  idf: Map<string, number>,
  independents: PinnedDoc[],
): "ISSUE_STATEMENT" | "HOLDING_COMPETITOR" | null {
  const envelope = enclosingSentence(toDoc.text, toSpan.start, toSpan.end)
  const role = discourseRole(envelope.text)
  if (role === "issue" || role === "argument") return "ISSUE_STATEMENT"
  if (role === "holding") return null
  const sameDocTerms = [...new Set([...tokenize(fromSpan.text), ...tokenize(envelope.text)])]
  for (const sentence of sentences(toDoc.text)) {
    if (sentence.start < envelope.end && envelope.start < sentence.end) continue
    if (discourseRole(sentence.text) !== "holding") continue
    if (holdingCompetesWithClaim(sentence.text, fromSpan.text, sameDocTerms, idf)) return "HOLDING_COMPETITOR"
  }
  const fromTerms = tokenize(fromSpan.text)
  for (const other of independents) {
    if (other.docId === toDoc.docId) continue
    for (const sentence of sentences(other.text)) {
      if (discourseRole(sentence.text) !== "holding") continue
      if (holdingCompetesWithClaim(sentence.text, fromSpan.text, fromTerms, idf)) return "HOLDING_COMPETITOR"
    }
  }
  return null
}

function unmarkedCorroboration(toDoc: PinnedDoc, toSpan: AdmittedSpan): boolean {
  const envelope = enclosingSentence(toDoc.text, toSpan.start, toSpan.end)
  return discourseRole(envelope.text) === "unmarked"
}

/** Contradictions first, then updates, then corroboration, then unsupported. */
function typeRank(type: RelationType): number {
  if (type === "contradicts") return 0
  if (type === "updates") return 1
  if (type === "corroborates") return 2
  return 3
}

function standingOf(doc: PinnedDoc | null): SourceStanding {
  return doc?.standing ?? "unrated"
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
  corpus: PinnedCorpus,
  proposals: RelationProposal[],
  queryTerms: string[],
  idf: Map<string, number>,
  threshold: number = CONFIDENCE_FLOOR,
): AdmitResult {
  const byId = new Map(corpus.docs.map((d) => [d.docId, d]))
  const independents = corpus.docs.filter((d) => d.role === "independent")
  const ownDomains = claimantDomains(corpus.docs)
  const admitted: AdmittedRelation[] = []
  const denied: Admission[] = []
  const seen = new Set<string>()

  // Contradictions before corroborations before unsupported claims, whatever
  // order they were proposed in.
  //
  // "Nothing corroborates this" is only true if nothing does, and the proposal
  // passes are fanned one independent source at a time, so an unsupported
  // proposal is made without sight of the source that may answer it. Judging
  // relations first means a claimant span already carrying a relation is on the
  // record by the time its unsupported twin is considered, and the check below
  // can retire it. Without this the same claim rendered twice in one ledger,
  // once as `unverified` and once as `corroborated`.
  //
  // The same span proposed as both contradicted and corroborated is one claim
  // in conflict, not two findings. Judging contradictions first lets the
  // related-span check below retire the confirmation.
  const ordered = [...proposals].sort((a, b) => typeRank(a.type) - typeRank(b.type))

  /**
   * Claimant spans already on the record, as intervals rather than points.
   *
   * Exact-offset keys treat two quotes of one sentence as two findings, and
   * fanning the passes made that the common case: separate passes anchor
   * slightly different windows on the same claim, so Tesla's ledger carried
   * "...helping make the roads safer for you and others" and "Tesla uses
   * billions of miles ... helping make the roads safer for you and others" as
   * two divergent rows, the second wholly containing the first. Two spans that
   * share source text are quoting the same claim, whatever their offsets.
   */
  const admittedRanges = new Map<string, [number, number][]>()
  const overlaps = (key: string, start: number, end: number) =>
    (admittedRanges.get(key) ?? []).some(([s, e]) => start < e && s < end)
  const remember = (key: string, start: number, end: number) => {
    const list = admittedRanges.get(key)
    if (list) list.push([start, end])
    else admittedRanges.set(key, [[start, end]])
  }

  for (const p of ordered) {
    // Finiteness first: NaN and undefined both make `< threshold` false, so an
    // unchecked comparison fails open on exactly the malformed input this gate
    // exists to distrust.
    if (!Number.isFinite(p.confidence) || p.confidence < threshold) {
      // Name what was nearly found. A bare confidence number says six things
      // were rejected without saying what, which is exactly the information
      // needed to judge whether the floor is set right. The statement is the
      // model's own label, never rendered as an assertion, so surfacing it
      // does not put an unverified claim in the report.
      denied.push({
        proposalId: p.proposalId,
        code: "LOW_CONFIDENCE",
        detail: `${p.confidence} — ${p.topic}: ${p.statement}`,
        confidence: p.confidence,
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

    let toDoc: PinnedDoc | null = null
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
    const sides: [PinnedDoc, AdmittedSpan][] = [[fromDoc, fromSpan]]
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

    // A question presented is not a holding. Admitting it as corroboration
    // treats "we granted certiorari to resolve whether X" as confirmation of
    // X (or of not-X), which is how a negligence claim sat next to Tellabs
    // as both corroborated and divergent. Checked here rather than trusted
    // to the prompt: the model is told the same rule, but a gate that only
    // holds when the model complies is not a gate.
    // The same unmarked commentators sentence must not contradict or update
    // a true claim while another Record document already holds on that span
    // — divergence is judged first, so either pairing would eat the holding
    // as DUPLICATE. Every relation that asserts something about the claim
    // goes through the gate; only "unsupported" does not.
    if (p.type !== "unsupported" && toDoc && toSpan) {
      const blocked = blocksNonHolding(toDoc, toSpan, fromSpan, idf, independents)
      if (blocked) {
        denied.push({ proposalId: p.proposalId, code: blocked, detail: toSpan.text.slice(0, 80) })
        continue
      }
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
    const pairKey = `pair:${sides.map(([, s]) => `${s.docId}@${s.start}`).sort().join("|")}`
    if (seen.has(pairKey)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: pairKey })
      continue
    }

    // The same sentence in two places is still one claim. A page that prints a
    // line twice — once carrying a footnote marker — produced two identical
    // corroborated rows in Tesla's ledger, at different offsets, so no overlap
    // rule could see them. Compared on letters and digits alone, since the
    // difference between the copies was "3 " and a full stop.
    const textKey = `text:${p.type}:${fromSpan.docId}:${normalizeQuote(fromSpan.text)}`
    if (seen.has(textKey)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: textKey.slice(0, 80) })
      continue
    }
    seen.add(textKey)

    // One claim, one row, however many independent sources reach it and however
    // the passes happened to window the quote.
    const claimKey = `claim:${p.type}:${fromSpan.docId}`
    if (overlaps(claimKey, fromSpan.start, fromSpan.end)) {
      denied.push({
        proposalId: p.proposalId,
        code: "DUPLICATE",
        detail: `${claimKey}@${fromSpan.start}-${fromSpan.end}`,
      })
      continue
    }

    // A claim an independent source already speaks to is not unsupported,
    // however confidently a pass that could not see that source says otherwise.
    // The same is true of a corroboration once a contradiction (or update) of
    // that span is already on the record: the conflict is the finding.
    const relatedKey = `related:${fromSpan.docId}`
    const bindingKey = `binding-contradict:${fromSpan.docId}`
    if (
      p.type === "corroborates"
      && standingOf(toDoc) === "interested"
      && overlaps(bindingKey, fromSpan.start, fromSpan.end)
    ) {
      denied.push({
        proposalId: p.proposalId,
        code: "DUPLICATE",
        detail: "interested corroboration cannot override binding contradiction",
      })
      continue
    }
    if (
      (p.type === "unsupported" || p.type === "corroborates")
      && overlaps(relatedKey, fromSpan.start, fromSpan.end)
    ) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: relatedKey })
      continue
    }

    seen.add(pairKey)
    remember(claimKey, fromSpan.start, fromSpan.end)
    if (p.type !== "unsupported") remember(relatedKey, fromSpan.start, fromSpan.end)
    if (p.type === "contradicts" && standingOf(toDoc) === "binding") {
      remember(bindingKey, fromSpan.start, fromSpan.end)
    }

    admitted.push({
      proposal: p,
      sides: sides.map(([, span]) => span),
      ...(p.type === "corroborates" && toDoc && toSpan && unmarkedCorroboration(toDoc, toSpan)
        ? { contextUnverified: true as const }
        : {}),
    })
  }

  return { admitted, denied }
}

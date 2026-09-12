import type { AdmitResult } from "./bookkeeper/admit.js"
import { buildReport } from "../report/build.js"
import type { AssayResult, PinnedCorpus, Refusal, RefusalReason } from "./types.js"

interface AssembleOpts {
  passes?: number
  conflictMode: "report" | "converge"
  /** How many proposals produced at least one span the gate could locate. */
  anchoredCount: number
}

/**
 * Denial codes that, on their own, do not establish that a span survived to
 * admission — a reader must not add one back without re-checking that claim:
 *   - ANCHOR_NOT_FOUND / QUOTE_TOO_LONG / INCOHERENT_QUOTE: all three are
 *     `findAnchor` FAILURES (see bookkeeper/anchor.ts). Counting one as
 *     "anchored" says a span was located when it was not.
 *   - DOC_UNKNOWN: the proposal named a document outside the corpus, so
 *     that document's own quote was never checked. This does not mean
 *     `findAnchor` was never called for the proposal at all — a `to`-doc
 *     DOC_UNKNOWN (admit.ts's second such check) is only reached after the
 *     `from` anchor already succeeded; it is that proposal's other half
 *     that never got that far.
 *   - LOW_CONFIDENCE: fires in admit.ts before `findAnchor` is called at
 *     all, so it cannot be evidence anchoring ran, let alone succeeded.
 *
 * Known imprecision: a `to`-doc `DOC_UNKNOWN` means a span WAS located (the
 * `from` side anchored before this code could fire), so treating it as
 * "not anchoring evidence" makes `anchoredCount` undercount in that case.
 * The error direction is conservative — it refuses a proposal rather than
 * overclaiming one as grounded.
 *
 * Single source of truth: `index.ts`'s `anchoredCount` and
 * `belowThresholdDetail` below both delegate to this set, so a code cannot
 * end up on the wrong side of one without the other noticing.
 */
export const NOT_ANCHORING_EVIDENCE = new Set([
  "ANCHOR_NOT_FOUND", "QUOTE_TOO_LONG", "INCOHERENT_QUOTE", "DOC_UNKNOWN", "LOW_CONFIDENCE",
])

function breakdown(denied: AdmitResult["denied"]): string {
  const counts = new Map<string, number>()
  for (const d of denied) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  return [...counts.entries()]
    // Dominant reason first; ties broken alphabetically so the string is
    // deterministic regardless of denial order.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => `${count} ${code}`)
    .join(", ")
}

/**
 * The `BELOW_THRESHOLD` detail must say why *this* corpus produced zero
 * admitted rows, not recite a fixed sentence about confidence. Confidence is
 * only the reason when a `LOW_CONFIDENCE` denial actually fired — a corpus
 * where every proposal was denied `SELF_SOURCED` (say) never touched the
 * threshold at all, and the wording must not claim otherwise.
 *
 * The reverse conflation is just as wrong: a run can deny some proposals
 * `LOW_CONFIDENCE` (never anchored — see `NOT_ANCHORING_EVIDENCE`) while
 * *other*, disjoint proposals DID get a span located and were denied for
 * something else entirely (`NOT_QUERY_RELEVANT`, `SELF_SOURCED`, ...). In
 * that mixed case the located spans did not fail on confidence, and the
 * LOW_CONFIDENCE proposals never had a span to fail on anything else — the
 * detail must name both groups instead of picking one sentence for both.
 */
// Precondition (enforced by assemble()'s callers, not re-checked here):
// `belowThresholdDetail` only runs when `result.admitted.length === 0` and
// `opts.anchoredCount > 0`, i.e. at least one denial has a code outside
// `NOT_ANCHORING_EVIDENCE` — some proposal's span really was located. So
// "spans were found" is true at every branch this function can reach.
function belowThresholdDetail(denied: AdmitResult["denied"]): string {
  const lowConfidence = denied.filter((d) => d.code === "LOW_CONFIDENCE")
  const anchored = denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code))

  if (lowConfidence.length > 0 && anchored.length > 0) {
    const plural = lowConfidence.length === 1 ? "proposal fell" : "proposals fell"
    return `${lowConfidence.length} ${plural} below the confidence threshold before a span ` +
      `was located; the spans that were located were denied for other reasons (${breakdown(anchored)})`
  }
  return `spans were found, but none was admitted (${breakdown(denied)})`
}

function refuse(
  corpus: PinnedCorpus,
  reason: RefusalReason,
  detail: string,
  proposed: number,
  result: AdmitResult,
  opts: AssembleOpts,
): Refusal {
  // A refusal that shows its work is worth more than a bare no: what fell under
  // the bar stays attached, with the score each earned. No span — see the
  // `nearMiss` doc comment in types.ts.
  const nearMiss = result.denied
    .filter((d) => d.code === "LOW_CONFIDENCE" && d.confidence !== undefined)
    .map((d) => ({ confidence: d.confidence!, statement: d.detail ?? "" }))
    .sort((a, b) => b.confidence - a.confidence)

  return {
    outcome: "refusal",
    subject: corpus.subject,
    generatedAt: new Date().toISOString(),
    ...(corpus.labels ? { labels: corpus.labels } : {}),
    reason,
    detail,
    docs: corpus.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.stability !== undefined ? { stability: d.stability } : {}),
      ...(d.pin !== undefined ? { pin: d.pin } : {}),
      ...(d.driftHash !== undefined ? { driftHash: d.driftHash } : {}),
    })),
    failures: corpus.failures,
    nearMiss,
    audit: {
      proposed,
      admitted: result.admitted.length,
      denied: result.denied,
      ...(opts.passes === undefined ? {} : { passes: opts.passes }),
    },
  }
}

export function assemble(
  corpus: PinnedCorpus,
  proposed: number,
  result: AdmitResult,
  opts: AssembleOpts,
): AssayResult {
  const roles = new Set(corpus.docs.map((d) => d.role))

  // Structural refusals first: they are decided before any model output matters,
  // and a run that reaches the model with one role present has already wasted
  // the money this guard exists to save.
  if (corpus.docs.length === 0) {
    return refuse(corpus, "CORPUS_INSUFFICIENT", "no sources could be read", proposed, result, opts)
  }
  if (roles.size < 2) {
    const only = [...roles][0]
    return refuse(
      corpus, "CORPUS_INSUFFICIENT",
      `only ${only} sources were read; nothing was present that could contradict anything`,
      proposed, result, opts,
    )
  }
  if (proposed === 0 || opts.anchoredCount === 0) {
    return refuse(
      corpus, "NO_GROUNDING",
      "no proposal produced a span that could be located in the corpus",
      proposed, result, opts,
    )
  }
  if (result.admitted.length === 0) {
    return refuse(
      corpus, "BELOW_THRESHOLD",
      belowThresholdDetail(result.denied),
      proposed, result, opts,
    )
  }

  // A PinnedCorpus is structurally a Corpus (every PinnedDoc field a FetchedDoc
  // has optional, it has required), so buildReport takes it as it is.
  const report = buildReport(corpus, proposed, result, opts.passes === undefined ? {} : { passes: opts.passes })

  if (opts.conflictMode === "converge" && report.rows.some((r) => r.status === "divergent")) {
    return refuse(
      corpus, "CONFLICTING_UNRESOLVABLE",
      "the corpus contradicts itself and the caller asked for a single answer",
      proposed, result, opts,
    )
  }

  return { outcome: "ledger", ...report }
}

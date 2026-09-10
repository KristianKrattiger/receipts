import type { AdmitResult } from "./bookkeeper/admit.js"
import { buildReport } from "../report/build.js"
import type { AssayResult, PinnedCorpus, Refusal, RefusalReason } from "./types.js"
import type { Corpus } from "../types.js"

interface AssembleOpts {
  passes?: number
  conflictMode: "report" | "converge"
  /** How many proposals produced at least one span the gate could locate. */
  anchoredCount: number
}

/** `buildReport` still takes the legacy shape; a PinnedDoc is a superset of a FetchedDoc. */
function asCorpus(corpus: PinnedCorpus): Corpus {
  return {
    subject: corpus.subject,
    docs: corpus.docs,
    failures: corpus.failures,
    ...(corpus.labels ? { labels: corpus.labels } : {}),
  }
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
      "spans were found, but none cleared the confidence threshold",
      proposed, result, opts,
    )
  }

  const report = buildReport(asCorpus(corpus), proposed, result, opts.passes === undefined ? {} : { passes: opts.passes })

  if (opts.conflictMode === "converge" && report.rows.some((r) => r.status === "divergent")) {
    return refuse(
      corpus, "CONFLICTING_UNRESOLVABLE",
      "the corpus contradicts itself and the caller asked for a single answer",
      proposed, result, opts,
    )
  }

  return { outcome: "ledger", ...report }
}

import type { AdmitResult } from "../bookkeeper/admit.js"
import type { Corpus, LedgerRow, RelationType, Report, RowStatus } from "../types.js"

export function rowStatus(type: RelationType): RowStatus {
  if (type === "contradicts" || type === "updates") return "divergent"
  if (type === "corroborates") return "corroborated"
  return "unverified"
}

// Divergence first — it is what the reader came for. Unverified next, because
// an unsupported claim is a finding. Corroboration last.
const STATUS_ORDER: Record<RowStatus, number> = {
  divergent: 0,
  unverified: 1,
  corroborated: 2,
}

export function buildReport(
  corpus: Corpus,
  proposed: number,
  result: AdmitResult,
  opts: { passes?: number } = {},
): Report {
  const rows: LedgerRow[] = result.admitted.map((a) => ({
    topic: a.proposal.topic,
    statement: a.proposal.statement,
    status: rowStatus(a.proposal.type),
    relation: a.proposal.type,
    sides: a.sides,
  }))

  rows.sort(
    (x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || x.topic.localeCompare(y.topic),
  )

  return {
    subject: corpus.subject,
    generatedAt: new Date().toISOString(),
    ...(corpus.labels ? { labels: corpus.labels } : {}),
    docs: corpus.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
      // Spread rather than always-set: an absent `via` must stay absent, so
      // reports built from pre-existing fixtures do not sprout a field.
      ...(d.via !== undefined ? { via: d.via } : {}),
    })),
    failures: corpus.failures,
    rows,
    audit: {
      proposed,
      admitted: result.admitted.length,
      denied: result.denied,
      ...(opts.passes === undefined ? {} : { passes: opts.passes }),
    },
  }
}

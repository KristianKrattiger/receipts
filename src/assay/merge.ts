import type { AssayResult, LedgerRow, PinnedDoc, ProvenanceReason, RowProvenance, RowStatus } from "./types.js"
import { claimantCoverage } from "./assemble.js"

export interface MergeMeta {
  rowKey: string
  passId: string
}

export interface MergeOpts {
  admittedA: MergeMeta[]
  admittedB: MergeMeta[]
  failuresA: { passId: string }[]
  failuresB: { passId: string }[]
  docs: PinnedDoc[]
  stabilityViolated?: Set<string>
}

const STATUS_ORDER: Record<RowStatus, number> = {
  divergent: 0,
  unverified: 1,
  context_unverified: 2,
  corroborated: 3,
}

/** Identity of an admitted row: topic plus cited spans, not the model's wording. */
export function rowKey(row: Pick<LedgerRow, "topic" | "sides">): string {
  const sides = [...row.sides]
    .map((s) => ({ docId: s.docId, start: s.start }))
    .sort((a, b) => a.docId.localeCompare(b.docId) || a.start - b.start)
  return JSON.stringify({ topic: row.topic, sides })
}

/** Today's proposal ids are `${passId}:p${i}`. A bare id is pass `all`. */
export function passIdOf(proposalId: string): string {
  const i = proposalId.indexOf(":")
  return i === -1 ? "all" : proposalId.slice(0, i)
}

function byKey(rows: LedgerRow[]): Map<string, LedgerRow> {
  return new Map(rows.map((r) => [rowKey(r), r]))
}

function passMap(meta: MergeMeta[]): Map<string, string> {
  return new Map(meta.map((m) => [m.rowKey, m.passId]))
}

/**
 * Audit fields that must follow the unioned rows, not sample 0's snapshot.
 * `denied` / `issueStatementDenied` / `holdingCompetitorDenied` stay on sample 0 —
 * those lists are not on rows.
 */
function auditFromUnion(
  base: Extract<AssayResult, { outcome: "ledger" }>["audit"],
  rows: LedgerRow[],
  docs: PinnedDoc[],
): Extract<AssayResult, { outcome: "ledger" }>["audit"] {
  const fromSpans = rows
    .map((r) => r.sides[0])
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
  const independentIds = new Set(docs.filter((d) => d.role === "independent").map((d) => d.docId))
  const independentDocsAdmitted = new Set<string>()
  for (const row of rows) {
    for (const s of row.sides) {
      if (independentIds.has(s.docId)) independentDocsAdmitted.add(s.docId)
    }
  }
  return {
    ...base,
    admitted: rows.length,
    contextUnverified: rows.filter((r) => r.status === "context_unverified").length,
    independentDocsTotal: independentIds.size,
    independentDocsAdmitted: independentDocsAdmitted.size,
    ...claimantCoverage(
      { subject: "", docs, failures: [] },
      fromSpans,
    ),
  }
}

function stamp(
  row: LedgerRow,
  key: string,
  inA: boolean,
  inB: boolean,
  opts: MergeOpts,
): LedgerRow {
  const failed = new Set([
    ...opts.failuresA.map((f) => f.passId),
    ...opts.failuresB.map((f) => f.passId),
  ])
  const passId = passMap(opts.admittedA).get(key)
    ?? passMap(opts.admittedB).get(key)
    ?? "all"
  const reasons: ProvenanceReason[] = []
  let klass: RowProvenance["class"]
  if (failed.has(passId)) {
    klass = "provisional"
    reasons.push("pass-failed")
  } else if (inA && inB) {
    klass = "stable"
  } else {
    klass = "provisional"
    reasons.push("single-proposer-run")
  }

  const stability = new Map(opts.docs.map((d) => [d.docId, d.stability]))
  const violated = opts.stabilityViolated ?? new Set<string>()
  let volatile = false
  let stabilityHit = false
  for (const side of row.sides) {
    if (stability.get(side.docId) === "volatile") volatile = true
    if (violated.has(side.docId)) stabilityHit = true
  }
  if (volatile) {
    klass = "provisional"
    reasons.push("volatile-source")
  }
  if (stabilityHit) {
    klass = "provisional"
    reasons.push("stability-violated")
  }

  return { ...row, provenance: { class: klass, reasons } }
}

function allProvisional(result: Extract<AssayResult, { outcome: "ledger" }>, opts: MergeOpts): AssayResult {
  const compared: MergeOpts = {
    ...opts,
    admittedB: opts.admittedA,
    failuresA: [],
    failuresB: [],
  }
  const rows = result.rows.map((r) => {
    const stamped = stamp(r, rowKey(r), true, true, compared)
    return {
      ...stamped,
      provenance: {
        class: "provisional" as const,
        reasons: (stamped.provenance?.reasons ?? []).filter((x) => x !== "single-proposer-run"),
      },
    }
  })
  return {
    ...result,
    rows,
    audit: {
      ...auditFromUnion(result.audit, rows, opts.docs),
      runDisagreement: true,
    },
  }
}

/**
 * Combine two sample results into one ledger (or one refusal).
 *
 * Sample 0's row body wins when both admitted the same key. Class follows
 * the parent spec: all-runs / some-runs / pass-failed, then volatile and
 * stability-violated downgrades.
 */
export function mergeRuns(a: AssayResult, b: AssayResult, opts: MergeOpts): AssayResult {
  if (a.outcome === "refusal" && b.outcome === "refusal") return a
  if (a.outcome === "ledger" && b.outcome === "refusal") return allProvisional(a, opts)
  if (a.outcome === "refusal" && b.outcome === "ledger") return allProvisional(b, opts)

  const left = a as Extract<AssayResult, { outcome: "ledger" }>
  const right = b as Extract<AssayResult, { outcome: "ledger" }>
  const fromA = byKey(left.rows)
  const fromB = byKey(right.rows)
  const keys = [...new Set([...fromA.keys(), ...fromB.keys()])].sort()
  const rows = keys.map((key) => {
    const inA = fromA.has(key)
    const inB = fromB.has(key)
    const body = fromA.get(key) ?? fromB.get(key)!
    return stamp(body, key, inA, inB, opts)
  })
  rows.sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || x.topic.localeCompare(y.topic))
  return {
    ...left,
    rows,
    audit: {
      ...auditFromUnion(left.audit, rows, opts.docs),
      proposed: left.audit.proposed + right.audit.proposed,
      denied: left.audit.denied,
      ...(left.audit.passes !== undefined ? { passes: left.audit.passes } : {}),
    },
  }
}

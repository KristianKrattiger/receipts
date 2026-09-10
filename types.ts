import type {
  Admission, DocSummary, LedgerRow, RoleLabels,
  SourceFailure, SourceKind, SourceRole,
} from "../types.js"

/**
 * How a document's bytes can be got again.
 *
 * `permalink` is a URL that returns the same bytes forever (an SEC accession,
 * a wiki oldid, a verified archive snapshot). `snapshot` is a committed
 * content-addressed blob. `hash` records only what the bytes were, which is
 * enough to detect drift and not enough to replay. Phase 1 emits `hash` for
 * everything; Phase 2 resolves the other two.
 */
export type Pin =
  | { kind: "permalink"; url: string; sha256: string }
  | { kind: "snapshot"; sha256: string }
  | { kind: "hash"; sha256: string }

/**
 * Whether this document is expected to return the same bytes on a later fetch.
 *
 * Everything defaults to `volatile`; stability is earned by explicit
 * declaration or by a verified permalink. See the design spec: no `SourceKind`
 * predicts it, because `vendor_docs` holds both an immutable 10-K and a
 * continuously edited docs page.
 */
export type Stability = "stable" | "volatile"

export interface PinnedDoc {
  docId: string
  url: string
  label: string
  role: SourceRole
  kind: SourceKind
  fetchedAt: string
  title: string
  text: string
  stability: Stability
  pin: Pin
}

export interface PinnedCorpus {
  subject: string
  docs: PinnedDoc[]
  failures: SourceFailure[]
  labels?: RoleLabels
}

export interface AssayQuery {
  subject: string
}

export interface AssayOptions {
  /** Confidence floor a proposal must clear to be admitted. */
  threshold?: number
  /** `report` surfaces contradictions; `converge` refuses on them. */
  conflictMode?: "report" | "converge"
  candidates?: number
  concurrency?: number
}

export const DEFAULT_THRESHOLD = 0.5

export type RefusalReason =
  | "CORPUS_INSUFFICIENT"
  | "NO_GROUNDING"
  | "BELOW_THRESHOLD"
  | "CONFLICTING_UNRESOLVABLE"
  /** Retained for GIN_14 contract fidelity. Unused in Receipts: the query is subject-derived. */
  | "QUERY_UNGROUNDABLE"

export type ProvenanceReason =
  | "volatile-source" | "single-proposer-run" | "pass-failed" | "stability-violated"

export interface RowProvenance {
  class: "stable" | "provisional"
  reasons: ProvenanceReason[]
}

export interface Audit {
  proposed: number
  admitted: number
  denied: Admission[]
  passes?: number
}

export interface Ledger {
  outcome: "ledger"
  subject: string
  generatedAt: string
  labels?: RoleLabels
  docs: DocSummary[]
  failures: SourceFailure[]
  rows: LedgerRow[]
  audit: Audit
}

export interface Refusal {
  outcome: "refusal"
  subject: string
  generatedAt: string
  labels?: RoleLabels
  reason: RefusalReason
  detail: string
  docs: DocSummary[]
  failures: SourceFailure[]
  /**
   * What came closest, with the score each earned.
   *
   * Deliberately carries no span. A `LOW_CONFIDENCE` denial fires independently
   * of anchoring, so at this point there is no located span to cite — and
   * emitting a span with an empty docId and zero offsets, into a committed
   * report, in a tool whose whole claim is "no claim without a span", would be
   * the exact failure this project exists to catch.
   */
  nearMiss: { confidence: number; statement: string }[]
  audit: Audit
}

export type AssayResult = Ledger | Refusal

/** Committed reports predate `outcome`; absent means a ledger. */
export function isRefusal(r: { outcome?: string }): boolean {
  return r.outcome === "refusal"
}

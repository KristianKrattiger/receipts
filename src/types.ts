export {
  DEFAULT_LABELS,
  isRefusal,
  DEFAULT_THRESHOLD,
} from "./assay/types.js"
export type {
  SourceRole, SourceKind, Pin, Stability, RoleLabels, FetchVia, FailureReason,
  Chunk, RelationType, SpanProposal, RelationProposal, AdmissionCode, AnchorTag,
  AdmittedSpan, Admission, RowStatus, ProvenanceReason, RowProvenance, LedgerRow,
  DocSummary, ReplayManifest, PinnedDoc, PinnedCorpus, AssayQuery, AssayOptions,
  RefusalReason, Audit, Ledger, Refusal, AssayResult,
} from "./assay/types.js"

import type {
  SourceKind, SourceRole, Stability, RoleLabels, FetchVia, Pin, FailureReason,
  LedgerRow, DocSummary, Admission, ReplayManifest,
} from "./assay/types.js"

export interface SourceTarget {
  kind: SourceKind
  role: SourceRole
  url: string
  label: string
  /**
   * Whether this source is expected to return the same bytes on a later fetch.
   *
   * Optional and defaulting to `volatile`: no `SourceKind` predicts stability
   * (`vendor_docs` holds both an immutable SEC filing and a continuously edited
   * docs page), so stability is declared by a plan author or earned by a
   * permanent-by-construction URL — never assumed from the kind.
   */
  stability?: Stability
}

export interface SourcePlan {
  subject: string
  targets: SourceTarget[]
  labels?: RoleLabels
}

/**
 * What the gateway actually gave us, read back from the session.
 *
 * `proxy` absent means no proxy was attached. Solari's docs name this as the
 * confirmation to make -- check that `session.proxy` is present rather than
 * checking for a 201 -- and it is the distinction this project could not
 * previously draw. A page that loads proves the page loaded, and nothing about
 * the route it took: the measurement that set the current default read 3924
 * characters from tesla.com under both `smart` and `us:static`, because
 * tesla.com blocks nothing and would have returned them with no proxy at all.
 */
export interface Egress {
  /** What we asked for: "smart", "us:static", "off". */
  requested: string
  stealth: boolean
  proxy?: { country: string; tier?: string; timezoneId?: string }
}

export interface FetchedDoc {
  docId: string
  url: string
  label: string
  role: SourceRole
  kind: SourceKind
  /** Carried from the target that produced this document. Absent means undeclared. */
  stability?: Stability
  fetchedAt: string
  title: string
  text: string
  /** Absent for documents not fetched through a browser. Written by the fan, read nowhere. */
  sessionId?: string
  via?: FetchVia
  egress?: Egress
  /**
   * Present once `toPinnedCorpus` has pinned this document (see `PinnedDoc`).
   * Absent on a document as freshly fetched -- declared here, optional, only
   * so `Corpus`-typed code can read them off a corpus that is, at runtime,
   * actually a `PinnedCorpus` narrowed down to this shape.
   */
  pin?: Pin
  driftHash?: string
}

export interface SourceFailure {
  url: string
  label: string
  reason: FailureReason
  detail: string
  egress?: Egress
}

export interface Corpus {
  subject: string
  docs: FetchedDoc[]
  failures: SourceFailure[]
  labels?: RoleLabels
  /** The egress requested for this run, so a report can state what produced it. */
  egress?: Egress
}

/**
 * On-disk ledger shape. Committed reports may omit `outcome`; treat absence
 * as a ledger. Fresh analysis returns `Ledger` from Assay instead.
 */
export interface Report {
  subject: string
  generatedAt: string
  labels?: RoleLabels
  docs: DocSummary[]
  failures: SourceFailure[]
  rows: LedgerRow[]
  audit: {
    proposed: number
    admitted: number
    denied: Admission[]
    passes?: number
    runDisagreement?: true
  }
  replay?: ReplayManifest
}

export type DocDriftOutcome =
  | "from-store" | "unchanged" | "drifted" | "stability-violated" | "unreadable"

export interface DocDrift {
  docId: string
  label: string
  url: string
  stability: Stability
  outcome: DocDriftOutcome
  priorDriftHash: string
  /** Absent for `from-store` (never recomputed) and `unreadable` (nothing to hash). */
  freshDriftHash?: string
  /** For `unreadable`: what the fetch said. */
  reason?: string
  /** For `unreadable` after a failed re-fetch: the failure's `detail`, when it had one. */
  detail?: string
}

/** A quoted span that is no longer an exact substring of the re-fetched page. */
export interface QuoteVanished {
  topic: string
  statement: string
  docId: string
  label: string
  text: string
}

export interface DriftReport {
  subject: string
  priorGeneratedAt: string
  checkedAt: string
  docs: DocDrift[]
  vanished: QuoteVanished[]
  summary: {
    fromStore: number
    unchanged: number
    drifted: number
    stabilityViolated: number
    unreadable: number
    vanished: number
  }
}

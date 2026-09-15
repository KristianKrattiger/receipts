import type { ProposalClient } from "./cartographer/propose.js"

export type SourceRole = "claimant" | "independent"

export type SourceKind =
  | "vendor_site" | "vendor_docs" | "vendor_pricing"
  | "status_page" | "review_site" | "forum" | "changelog"

/**
 * Caller-supplied standing. Assay never infers this. Absent means unrated
 * and today's equality among independent sources.
 */
export type SourceStanding = "binding" | "persuasive" | "interested" | "unrated"

/**
 * How a document's bytes can be got again.
 *
 * `permalink` is a URL that returns the same bytes forever. `snapshot` is a
 * content-addressed blob the caller committed. `hash` records what the bytes
 * were when this result was produced, enough to detect drift, not enough to
 * replay. Precedence is `permalink` > `snapshot` > `hash`.
 */
export type Pin =
  | { kind: "permalink"; url: string; sha256: string }
  | { kind: "snapshot"; sha256: string }
  | { kind: "hash"; sha256: string }

/** Whether this document is expected to return the same bytes on a later fetch. */
export type Stability = "stable" | "volatile"

/**
 * What to call each role in the output. The engine does not branch on the
 * words — only the reader-facing labels change between domains.
 */
export interface RoleLabels {
  claimant: string
  independent: string
}

export const DEFAULT_LABELS: RoleLabels = { claimant: "Vendor", independent: "Independent" }

/** How a document was read. Absent means the default fetch path. */
export type FetchVia = "browser" | "api"

export type FailureReason =
  | "timeout" | "blocked" | "captcha" | "empty" | "http_error"
  | "plan_required" | "proxy_error" | "auth_required"

export interface SourceFailure {
  url: string
  label: string
  reason: FailureReason
  detail: string
}

export interface Chunk {
  chunkId: string
  docId: string
  start: number
  end: number
  text: string
}

export type RelationType =
  | "contradicts" | "corroborates" | "updates" | "unsupported"

export interface SpanProposal {
  docId: string
  quote: string
}

export interface RelationProposal {
  proposalId: string
  type: RelationType
  topic: string
  statement: string
  from: SpanProposal
  to: SpanProposal | null
  rationale: string
  confidence: number
}

export type AdmissionCode =
  | "ADMITTED" | "ANCHOR_NOT_FOUND" | "DOC_UNKNOWN" | "QUOTE_TOO_LONG"
  | "NOT_QUERY_RELEVANT" | "LOW_CONFIDENCE" | "DUPLICATE" | "SELF_PAIR"
  | "SELF_SOURCED" | "INCOHERENT_QUOTE" | "ISSUE_STATEMENT" | "HOLDING_COMPETITOR"

export type AnchorTag = "EXACT" | "AMBIGUOUS"

export interface AdmittedSpan {
  docId: string
  start: number
  end: number
  text: string
  tag: AnchorTag
}

export interface Admission {
  proposalId: string
  code: AdmissionCode
  detail?: string
  /** Present when a score is what decided this denial. */
  confidence?: number
}

export type RowStatus = "divergent" | "corroborated" | "unverified" | "context_unverified"

export type ProvenanceReason =
  | "volatile-source" | "single-proposer-run" | "pass-failed" | "stability-violated"

export interface RowProvenance {
  class: "stable" | "provisional"
  reasons: ProvenanceReason[]
}

export interface LedgerRow {
  topic: string
  statement: string
  status: RowStatus
  relation: RelationType
  sides: AdmittedSpan[]
  /** Present after a two-sample merge. Absence is "not recorded", never `stable`. */
  provenance?: RowProvenance
}

export interface DocSummary {
  docId: string
  url: string
  label: string
  role: SourceRole
  kind?: SourceKind
  standing?: SourceStanding
  fetchedAt: string
  via?: FetchVia
  stability?: Stability
  pin?: Pin
  driftHash?: string
}

/**
 * What replays this result: cache keys in call order, and the settings that
 * shape the assay without appearing in any request body. Stamped by the
 * caller after analysis.
 */
export interface ReplayManifest {
  sample: number
  keys: string[]
  samples?: { sample: number; keys: string[] }[]
  model: string
  candidates: number
  threshold: number
  conflictMode: "report" | "converge"
  runs?: 1 | 2
}

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
  /**
   * sha256 of the normalized text. Distinct from `pin.sha256` (exact cited
   * bytes). Offsets and the exact-substring guarantee depend on raw bytes.
   */
  driftHash: string
  via?: FetchVia
  /** Caller-supplied. Assay never writes or infers this field. */
  standing?: SourceStanding
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

/**
 * Everything the engine is told about the field it works in. The engine
 * has no lexicon, prompt, or retrieval policy of its own: a field instance
 * (Receipts, Claim/Record) owns one of these and passes it on every call.
 * Every field is required so that no domain choice is ever a silent default.
 */
export interface FieldProfile {
  /** Names this field in the replay manifest and error messages: "receipts", "claim-record". */
  name: string
  /** Proposer system prompt, sent verbatim on every pass. */
  system: string
  /**
   * Closed cue lists, one RegExp per role, tested against a trimmed sentence.
   * holding: the source itself commits to a finding. issue: poses one.
   * argument: reports someone else's position. A sentence ending in "?" is
   * `issue` in every field; that rule lives in discourseRole, not here.
   */
  lexicon: { holding: RegExp; issue: RegExp; argument: RegExp }
  retrieval: {
    /** "subject": the query subject alone ranks chunks. "subject+claimant": every claimant token joins the query. */
    queryTerms: "subject" | "subject+claimant"
    /** Keep each document's first and last chunk regardless of rank. */
    pinEnds: boolean
  }
}

export interface AssayOptions {
  threshold?: number
  conflictMode?: "report" | "converge"
  candidates?: number
  concurrency?: number
  runs?: 1 | 2
  client?: ProposalClient
  clientForSample?: (sample: number) => ProposalClient
  stabilityViolated?: Set<string>
  onPassFailure?: (failure: { passId: string; message: string }) => void
  /** Required. See FieldProfile. assay() throws without it. */
  profile: FieldProfile
}

export const DEFAULT_THRESHOLD = 0.5

export type RefusalReason =
  | "CORPUS_INSUFFICIENT"
  | "NO_GROUNDING"
  | "BELOW_THRESHOLD"
  | "CONFLICTING_UNRESOLVABLE"
  /** Retained for GIN_14 contract fidelity. Unused in Receipts: the query is subject-derived. */
  | "QUERY_UNGROUNDABLE"

export interface Audit {
  proposed: number
  admitted: number
  denied: Admission[]
  passes?: number
  runDisagreement?: true
  /** Claimant chunks in the corpus. Fabrication rate is uninformative without this. */
  claimantChunks: number
  /** Unique claimant chunks overlapping an admitted from-span. */
  claimantCovered: number
  /** claimantChunks - claimantCovered. */
  claimantOmitted: number
  /**
   * First line of each uncovered claimant chunk, in chunk order, capped at 12.
   * Each entry is a prefix of that chunk's text (trimmed, capped). The full
   * omitted count is `claimantOmitted`.
   */
  claimantOmittedPreviews: string[]
  /** Independent documents in the corpus, whether or not they appear on a row. */
  independentDocsTotal: number
  /** Distinct independent documents appearing on an admitted side. */
  independentDocsAdmitted: number
  /** Denials whose independent quote was an issue statement or argument. */
  issueStatementDenied: number
  /** Denials whose non-holding quote lost to an IDF-relevant holding in this or another Record document. */
  holdingCompetitorDenied: number
  /** Admitted corroborations labeled context_unverified (unmarked, no holding competitor). */
  contextUnverified: number
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
  replay?: ReplayManifest
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
  nearMiss: { confidence: number; statement: string }[]
  audit: Audit
  replay?: ReplayManifest
}

export type AssayResult = Ledger | Refusal

/**
 * Committed reports predate `outcome`; absent means a ledger.
 * Structural so Assay does not import Receipts' on-disk `Report` type.
 */
export function isRefusal(r: object): r is Refusal {
  return "outcome" in r && (r as { outcome?: unknown }).outcome === "refusal"
}

export type SourceRole = "vendor_claim" | "independent"

export type SourceKind =
  | "vendor_site" | "vendor_docs" | "vendor_pricing"
  | "status_page" | "review_site" | "forum" | "changelog"

export interface SourceTarget {
  kind: SourceKind
  role: SourceRole
  url: string
  label: string
}

export interface SourcePlan {
  subject: string
  targets: SourceTarget[]
}

export interface FetchedDoc {
  docId: string
  url: string
  label: string
  role: SourceRole
  kind: SourceKind
  fetchedAt: string
  title: string
  text: string
  sessionId: string
}

export type FailureReason =
  | "timeout" | "blocked" | "captcha" | "empty" | "http_error"

export interface SourceFailure {
  url: string
  label: string
  reason: FailureReason
  detail: string
}

export interface Corpus {
  subject: string
  docs: FetchedDoc[]
  failures: SourceFailure[]
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
}

export type RowStatus = "divergent" | "corroborated" | "unverified"

export interface LedgerRow {
  topic: string
  statement: string
  status: RowStatus
  relation: RelationType
  vendorSide: AdmittedSpan | null
  independentSide: AdmittedSpan | null
}

export interface DocSummary {
  docId: string
  url: string
  label: string
  role: SourceRole
  fetchedAt: string
}

export interface Report {
  subject: string
  generatedAt: string
  docs: DocSummary[]
  failures: SourceFailure[]
  rows: LedgerRow[]
  audit: {
    proposed: number
    admitted: number
    denied: Admission[]
  }
}

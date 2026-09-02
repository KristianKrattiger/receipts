export type SourceRole = "claimant" | "independent"

export type SourceKind =
  | "vendor_site" | "vendor_docs" | "vendor_pricing"
  | "status_page" | "review_site" | "forum" | "changelog"

export interface SourceTarget {
  kind: SourceKind
  role: SourceRole
  url: string
  label: string
}

/**
 * What to call each role in the output.
 *
 * The engine is not vendor-specific: `claimant` is whoever is making the
 * claims, and nothing downstream branches on it. Only the words shown to a
 * reader change between domains — "Vendor" against a SaaS company, "Model
 * card" against an AI lab, "Employer" against a careers page.
 */
export interface RoleLabels {
  claimant: string
  independent: string
}

export const DEFAULT_LABELS: RoleLabels = { claimant: "Vendor", independent: "Independent" }

export interface SourcePlan {
  subject: string
  targets: SourceTarget[]
  labels?: RoleLabels
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

/**
 * `plan_required` is not a fault of the source: the Solari plan in use does not
 * include a feature the fan asked for (stealth is paid-only). It fails every
 * source identically, so telling it apart from a blocked page is the difference
 * between "this vendor is unreadable" and "turn a flag off".
 */
export type FailureReason =
  | "timeout" | "blocked" | "captcha" | "empty" | "http_error"
  | "plan_required" | "proxy_error"

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
  labels?: RoleLabels
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
  /**
   * One span for an unsupported claim, two for a relation between sources.
   * Renderers label each side from its own document's role — both sides can
   * share one (a vendor's pricing page contradicting its own docs).
   */
  sides: AdmittedSpan[]
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
  labels?: RoleLabels
  docs: DocSummary[]
  failures: SourceFailure[]
  rows: LedgerRow[]
  audit: {
    proposed: number
    admitted: number
    denied: Admission[]
  }
}

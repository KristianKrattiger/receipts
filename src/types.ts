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
  fetchedAt: string
  title: string
  text: string
  sessionId: string
  egress?: Egress
}

/**
 * `plan_required` is not a fault of the source: the Solari plan in use does not
 * include a feature the fan asked for (stealth is paid-only). It fails every
 * source identically, so telling it apart from a blocked page is the difference
 * between "this vendor is unreadable" and "turn a flag off".
 *
 * `auth_required` is the same distinction one step further out: the source did
 * not refuse us, it named a way in we did not take. Reporting it as `blocked`
 * overstates the refusal, and this ledger's whole claim is that it describes
 * its own coverage gaps accurately.
 */
export type FailureReason =
  | "timeout" | "blocked" | "captcha" | "empty" | "http_error"
  | "plan_required" | "proxy_error" | "auth_required"

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
  | "SELF_SOURCED" | "INCOHERENT_QUOTE"

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
    /**
     * Model calls the proposals came from — one per independent source, plus
     * one for the claimant against itself. Optional because reports generated
     * before the pass was fanned carry a single call and no field.
     */
    passes?: number
  }
}

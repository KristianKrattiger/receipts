export type SourceRole = "claimant" | "independent"

export type SourceKind =
  | "vendor_site" | "vendor_docs" | "vendor_pricing"
  | "status_page" | "review_site" | "forum" | "changelog"

/**
 * How a document's bytes can be got again.
 *
 * `permalink` is a URL that returns the same bytes forever. Today that means
 * an SEC accession or a wiki oldid, both permanent by construction — no
 * verification fetch needed, because the shape of the URL and the issuer's
 * contract already guarantee it (see `provenance/pin.ts`). A submission to an
 * archive could earn this same kind in a later phase, once the submission
 * step exists, but until then it is a possibility, not a third recognizer.
 * `snapshot` is a committed content-addressed blob: the bytes are sitting in
 * `snapshots/`, so the document can be handed to anyone who asks for it. All
 * three kinds are emitted today, and precedence is `permalink` > `snapshot` >
 * `hash`. `permalink` and `snapshot` are both replayable — the bytes can be
 * got again, from the permanent URL or from the store. `hash` is what a
 * document gets when nobody has committed its bytes anywhere: it records only
 * what they were, enough to detect drift and not enough to replay.
 */
export type Pin =
  | { kind: "permalink"; url: string; sha256: string }
  | { kind: "snapshot"; sha256: string }
  | { kind: "hash"; sha256: string }

/**
 * Whether this document is expected to return the same bytes on a later fetch.
 *
 * Everything defaults to `volatile`; stability is earned by explicit
 * declaration or by a permalink that is permanent by construction — no
 * verification fetch needed, since the document in hand was already fetched
 * at that exact URL (see `provenance/pin.ts`). See the design spec: no
 * `SourceKind` predicts it, because `vendor_docs` holds both an immutable
 * 10-K and a continuously edited docs page.
 */
export type Stability = "stable" | "volatile"

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

/**
 * How a document was read.
 *
 * Absent means the browser fan, which is the default path and the one every
 * committed fixture predates. Recorded because this tool's claim is that it
 * says how it read each source, and an API-read row is precisely a case where
 * the answer differs from every other row on the page.
 */
export type FetchVia = "browser" | "api"

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
   * so `Corpus`-typed code (the report builder) can read them off a corpus
   * that is, at runtime, actually a `PinnedCorpus` narrowed down to this shape.
   */
  pin?: Pin
  driftHash?: string
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
  /**
   * The score this proposal was judged at, when a score was what decided it.
   *
   * Optional because the four committed reports predate it and because most
   * codes are not confidence decisions. Present so a refusal can report what
   * came closest without parsing a number back out of an English sentence.
   */
  confidence?: number
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
  via?: FetchVia
  /**
   * Per-document provenance. All three are optional: three of the four
   * committed reports carry them after the backfill (`run(provenance):
   * backfill snapshots and pins from the committed fixtures`); only
   * `chime.json` still predates them, because no `fixtures/chime.json`
   * exists to backfill it from. A reader must treat absence as "not
   * recorded", never as a claim.
   */
  stability?: Stability
  pin?: Pin
  driftHash?: string
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

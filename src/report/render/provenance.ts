import type { LedgerRow, ProvenanceReason, Report } from "../../types.js"

const REASON_ORDER: readonly ProvenanceReason[] = [
  "volatile-source", "single-proposer-run", "pass-failed", "stability-violated",
]

/** Class mark on the claim line, only when the row was stamped. */
export function classMark(row: LedgerRow): string {
  return row.provenance ? row.provenance.class : ""
}

/**
 * Footer after the audit line. Absent when no row carries provenance, so a
 * Tesla-shaped 3a report renders exactly as it did.
 */
export function provenanceFooter(report: Pick<Report, "rows" | "audit">): string | undefined {
  if (!report.rows.some((row) => row.provenance)) return undefined
  const stable = report.rows.filter((row) => row.provenance?.class === "stable").length
  const provisional = report.rows.filter((row) => row.provenance?.class === "provisional").length
  const reasonBits = REASON_ORDER
    .map((reason) => {
      const n = report.rows.filter((row) => row.provenance?.reasons.includes(reason)).length
      return n > 0 ? `${n} ${reason}` : ""
    })
    .filter(Boolean)
  const reasons = reasonBits.length > 0 ? ` (${reasonBits.join(", ")})` : ""
  const disagreement = report.audit.runDisagreement ? " · run disagreement" : ""
  return `provenance: ${stable} stable · ${provisional} provisional${reasons}${disagreement}`
}

/** Present when a ledger shows relations no verifier checked. */
export function relationCheckNote(report: Pick<Report, "rows" | "audit">): string | undefined {
  if (report.audit.relationCheck === true) return undefined
  return report.rows.some((row) => row.relation !== "unsupported") ? "relations not verified" : undefined
}

/**
 * Whether a document appears on no row. A source that was read and said
 * nothing about any claim is a finding about coverage, and the sources list
 * is where a reader looks for it.
 */
export function isUncited(report: Pick<Report, "rows">, docId: string): boolean {
  return !report.rows.some((row) => row.sides.some((side) => side.docId === docId))
}

/** "3 of 8 independent sources read are on no row", or nothing when every one is cited. */
export function uncitedNote(report: Pick<Report, "rows" | "docs">): string | undefined {
  const independent = report.docs.filter((d) => d.role === "independent")
  const uncited = independent.filter((d) => isUncited(report, d.docId)).length
  if (independent.length === 0 || uncited === 0) return undefined
  return `${uncited} of ${independent.length} independent sources read are on no row`
}

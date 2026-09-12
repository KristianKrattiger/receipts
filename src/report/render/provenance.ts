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

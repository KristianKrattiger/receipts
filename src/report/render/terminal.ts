import { DEFAULT_LABELS } from "../../types.js"
import type { AdmittedSpan, DocSummary, Report, RowStatus } from "../../types.js"

const HEADINGS: Record<RowStatus, string> = {
  divergent: "DIVERGENT — the vendor's claim is contradicted",
  unverified: "UNVERIFIED — no independent source either way",
  corroborated: "CORROBORATED — independently confirmed",
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.map((l) => `${indent}${l}`).join("\n")
}

function sourceLabel(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  const suffix = span.tag === "AMBIGUOUS" ? " (appears more than once)" : ""
  return `${doc?.label ?? span.docId}${suffix}`
}

/**
 * Both sides of a pair can share a role, so label each side from its own doc.
 *
 * A span whose document is missing is NOT independent — it is unattributed.
 * Falling through to "independent" would present unknown provenance as
 * corroboration, which is the one thing this report must never do.
 */
function roleOf(report: Report, span: AdmittedSpan): string {
  const docs = report.docs
  const doc = docs.find((d) => d.docId === span.docId)
  if (!doc) return "unattributed"
  const labels = report.labels ?? DEFAULT_LABELS
  return (doc.role === "claimant" ? labels.claimant : labels.independent).toLowerCase()
}

export function renderTerminal(report: Report): string {
  const out: string[] = ["", `  ${report.subject} — claim ledger`, `  generated ${report.generatedAt}`, ""]

  if (report.rows.length === 0) {
    out.push("  Nothing could be verified from the sources read.", "")
  }

  for (const status of ["divergent", "unverified", "corroborated"] as RowStatus[]) {
    const rows = report.rows.filter((r) => r.status === status)
    if (rows.length === 0) continue
    out.push(`  ${HEADINGS[status]}`, `  ${"-".repeat(HEADINGS[status].length)}`, "")
    for (const row of rows) {
      out.push(`  ${row.statement}  [${row.topic}]`)
      for (const span of row.sides) {
        out.push(`    ${roleOf(report, span).padEnd(11)} ${sourceLabel(report.docs, span)}`)
        out.push(wrap(`"${span.text}"`, 72, "      "))
      }
      out.push("")
    }
  }

  out.push("  sources")
  for (const doc of report.docs) {
    out.push(`    ${(report.labels ?? DEFAULT_LABELS)[doc.role === "claimant" ? "claimant" : "independent"].toLowerCase().padEnd(11)} ${doc.label}  ${doc.url}`)
  }
  for (const f of report.failures) out.push(`    not read    ${f.label}  (${f.reason})`)
  out.push("")

  const counts = new Map<string, number>()
  for (const d of report.audit.denied) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  const breakdown = [...counts].map(([code, n]) => `${n} ${code}`).join(", ")
  // Shown only when the proposals came from more than one call, so a reader can
  // tell a thin ledger apart from a thin corpus.
  const passes = report.audit.passes !== undefined && report.audit.passes > 1
    ? ` over ${report.audit.passes} passes`
    : ""
  out.push(
    `  audit: proposed ${report.audit.proposed}${passes} · admitted ${report.audit.admitted} · denied ${report.audit.denied.length}${breakdown ? ` (${breakdown})` : ""}`,
    "",
    // The numbers alone do not say what they guarantee. The markdown renderer
    // states it; the CLI is the primary surface and should not say less.
    "  Every quote above is an exact substring of the page text fetched at the",
    "  time shown. Proposals whose quotes could not be found were denied.",
    "",
  )
  return out.join("\n")
}

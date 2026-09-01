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

/** Both sides of a pair can share a role, so label each side from its own doc. */
function roleOf(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  return doc?.role === "vendor_claim" ? "vendor" : "independent"
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
        out.push(`    ${roleOf(report.docs, span).padEnd(11)} ${sourceLabel(report.docs, span)}`)
        out.push(wrap(`"${span.text}"`, 72, "      "))
      }
      out.push("")
    }
  }

  out.push("  sources")
  for (const doc of report.docs) {
    out.push(`    ${doc.role === "vendor_claim" ? "vendor     " : "independent"} ${doc.label}  ${doc.url}`)
  }
  for (const f of report.failures) out.push(`    not read    ${f.label}  (${f.reason})`)
  out.push("")

  const counts = new Map<string, number>()
  for (const d of report.audit.denied) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  const breakdown = [...counts].map(([code, n]) => `${n} ${code}`).join(", ")
  out.push(
    `  audit: proposed ${report.audit.proposed} · admitted ${report.audit.admitted} · denied ${report.audit.denied.length}${breakdown ? ` (${breakdown})` : ""}`,
    "",
  )
  return out.join("\n")
}

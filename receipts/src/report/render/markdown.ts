import type { AdmittedSpan, DocSummary, Report, RowStatus } from "../../types.js"

const HEADINGS: Record<RowStatus, string> = {
  divergent: "Divergent — the vendor's claim is contradicted",
  unverified: "Unverified — no independent source either way",
  corroborated: "Corroborated — independently confirmed",
}

function label(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  if (!doc) return span.docId
  const ambiguous = span.tag === "AMBIGUOUS" ? " _(appears more than once)_" : ""
  return `[${doc.label}](${doc.url})${ambiguous}`
}

/** Both sides of a pair can share a role, so label each side from its own doc. */
function roleOf(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  return doc?.role === "vendor_claim" ? "Vendor" : "Independent"
}

export function renderMarkdown(report: Report): string {
  const out: string[] = [`# ${report.subject} — claim ledger`, "", `_Generated ${report.generatedAt}_`, ""]

  if (report.rows.length === 0) {
    out.push("**Nothing could be verified from the sources read.**", "")
  }

  for (const status of ["divergent", "unverified", "corroborated"] as RowStatus[]) {
    const rows = report.rows.filter((r) => r.status === status)
    if (rows.length === 0) continue
    out.push(`## ${HEADINGS[status]}`, "")
    for (const row of rows) {
      out.push(`### ${row.statement}  \n_topic: ${row.topic}_`, "")
      for (const span of row.sides) {
        out.push(`**${roleOf(report.docs, span)}** — ${label(report.docs, span)}`, "", `> ${span.text}`, "")
      }
    }
  }

  out.push("## Sources", "")
  for (const doc of report.docs) out.push(`- ${doc.role === "vendor_claim" ? "vendor" : "independent"} — [${doc.label}](${doc.url})`)
  for (const f of report.failures) out.push(`- **not read** — ${f.label} (${f.reason})`)
  out.push("")

  const counts = new Map<string, number>()
  for (const d of report.audit.denied) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  const breakdown = [...counts].map(([code, n]) => `${n} ${code}`).join(", ")
  out.push(
    "## Audit",
    "",
    `proposed ${report.audit.proposed} · admitted ${report.audit.admitted} · denied ${report.audit.denied.length}${breakdown ? ` (${breakdown})` : ""}`,
    "",
    "Every quote above was verified to be an exact substring of the page text fetched at the time shown. Proposals whose quotes could not be found were denied, not rendered.",
    "",
  )
  return out.join("\n")
}

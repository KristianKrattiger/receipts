import type { AdmittedSpan, DocSummary, Report, RowStatus } from "../../types.js"

const HEADINGS: Record<RowStatus, string> = {
  divergent: "Divergent — the vendor's claim is contradicted",
  unverified: "Unverified — no independent source either way",
  corroborated: "Corroborated — independently confirmed",
}

/** Every quote originates from a scraped page. Escape without exception. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const STYLE = `
:root { --bg:#fff; --fg:#16161d; --muted:#6b6b76; --line:#e4e4e9;
        --divergent:#b4243c; --unverified:#8a6100; --corroborated:#1f6f43; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16161d; --fg:#e8e8ee; --muted:#9a9aa6; --line:#2c2c36;
          --divergent:#ff8095; --unverified:#e0b050; --corroborated:#6fd39b; }
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); margin: 0;
       font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
.meta { color: var(--muted); font-size: .875rem; margin-bottom: 2.5rem; }
h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em;
     margin: 2.5rem 0 1rem; padding-bottom: .5rem; border-bottom: 1px solid var(--line); }
h2.divergent { color: var(--divergent); }
h2.unverified { color: var(--unverified); }
h2.corroborated { color: var(--corroborated); }
.row { margin: 0 0 2rem; }
.claim { font-weight: 600; }
.topic { color: var(--muted); font-size: .8125rem; }
blockquote { margin: .5rem 0 .25rem; padding-left: 1rem;
             border-left: 3px solid var(--line); }
.src { color: var(--muted); font-size: .8125rem; }
.audit { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line);
         color: var(--muted); font-size: .875rem; }
a { color: inherit; }
`

/** Both sides of a pair can share a role, so label each side from its own doc. */
function roleOf(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  // An unknown document is NOT independent -- it is unattributed.
  // Falling through would present unknown provenance as corroboration,
  // which is the one thing this report must never do.
  if (!doc) return "Unattributed"
  return doc.role === "vendor_claim" ? "Vendor" : "Independent"
}

function sourceFor(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  const ambiguous = span.tag === "AMBIGUOUS" ? " · appears more than once" : ""
  if (!doc) return esc(span.docId)
  return `<a href="${esc(doc.url)}">${esc(doc.label)}</a>${esc(ambiguous)}`
}

export function renderHtml(report: Report): string {
  const sections = (["divergent", "unverified", "corroborated"] as RowStatus[])
    .map((status) => {
      const rows = report.rows.filter((r) => r.status === status)
      if (rows.length === 0) return ""
      const body = rows
        .map((row) => {
          const sides = [
            ...row.sides.map((span) => ({ who: roleOf(report.docs, span), span })),
          ]
          const quotes = sides
            .map(
              (s) =>
                `<div class="src">${s.who} — ${sourceFor(report.docs, s.span)}</div>` +
                `<blockquote>${esc(s.span.text)}</blockquote>`,
            )
            .join("")
          return `<div class="row"><div class="claim">${esc(row.statement)}</div>` +
                 `<div class="topic">${esc(row.topic)}</div>${quotes}</div>`
        })
        .join("")
      return `<h2 class="${status}">${esc(HEADINGS[status])}</h2>${body}`
    })
    .join("")

  const empty = report.rows.length === 0
    ? "<p>Nothing could be verified from the sources read.</p>"
    : ""

  const counts = new Map<string, number>()
  for (const d of report.audit.denied) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  const breakdown = [...counts].map(([code, n]) => `${n} ${code}`).join(", ")

  const sources = [
    ...report.docs.map((d) => `<li><a href="${esc(d.url)}">${esc(d.label)}</a> — ${esc(d.role)}</li>`),
    ...report.failures.map((f) => `<li>${esc(f.label)} — not read (${esc(f.reason)})</li>`),
  ].join("")

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.subject)} — claim ledger</title>
<style>${STYLE}</style></head>
<body><main>
<h1>${esc(report.subject)} — claim ledger</h1>
<p class="meta">Generated ${esc(report.generatedAt)}</p>
${empty}${sections}
<h2>Sources</h2><ul>${sources}</ul>
<p class="audit">proposed ${report.audit.proposed} · admitted ${report.audit.admitted} · denied ${report.audit.denied.length}${breakdown ? ` (${esc(breakdown)})` : ""}<br>
Every quote above was verified to be an exact substring of the page text fetched at the time shown. Proposals whose quotes could not be found were denied, not rendered.</p>
</main></body></html>
`
}

/**
 * The index page listing every published report.
 *
 * Lives here rather than in the build script so it shares `esc` with the page
 * renderer. Inlined in the build script it interpolated `report.subject` raw,
 * while renderHtml escaped the same value correctly two files away — the kind
 * of split that leaves one sink unescaped indefinitely.
 */
export function renderIndex(entries: { name: string; report: Report }[]): string {
  const links = entries
    .map(({ name, report }) => {
      const count = (status: RowStatus): number =>
        report.rows.filter((row) => row.status === status).length
      return (
        `<li><a href="${esc(name)}.html">${esc(report.subject)}</a> — ` +
        `${count("divergent")} divergent, ${count("unverified")} unverified</li>`
      )
    })
    .join("")

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipts</title>
<style>${STYLE}</style></head>
<body><main>
<h1>Receipts</h1>
<p>What a vendor claims, what independent sources report, and which claims nothing corroborates. Every quote is verified to be an exact substring of the page it was fetched from.</p>
<ul>${links}</ul>
</main></body></html>
`
}

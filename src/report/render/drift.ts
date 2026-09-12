import type { DocDrift, DriftReport } from "../../types.js"

/**
 * The drift report for a terminal, loudest finding first.
 *
 * A declared-stable source that changed broke a promise; that goes at the top.
 * A vanished quote means the ledger's guarantee no longer holds for that row;
 * that goes next. Unreadable sources and ordinary drift follow. The unchanged
 * and from-store lists come last, because they are the quiet majority and the
 * reader came for what moved.
 */
export function renderDriftReport(r: DriftReport): string {
  const s = r.summary
  const lines: string[] = [
    "",
    `  ${r.subject} — drift since ${r.priorGeneratedAt}`,
    `  checked ${r.checkedAt}`,
    "",
    `  ${s.stabilityViolated} stability violated · ${s.vanished} quote vanished · ` +
      `${s.unreadable} unreadable · ${s.drifted} drifted · ${s.unchanged} unchanged · ${s.fromStore} from store`,
    "",
  ]

  // `line` returns the document's line, or that line followed by indented
  // continuation lines (an unreadable document's failure detail).
  const section = (title: string, rule: string, docs: DocDrift[], line: (d: DocDrift) => string | string[]) => {
    if (docs.length === 0) return
    lines.push(`  ${title}`, `  ${rule}`, "")
    for (const d of docs) {
      const [first, ...rest] = [line(d)].flat()
      lines.push(`    ${first}`, ...rest.map((l) => `      ${l}`))
    }
    lines.push("")
  }
  const of = (o: DocDrift["outcome"]) => r.docs.filter((d) => d.outcome === o)

  section(
    "STABILITY VIOLATED — declared stable, and it changed",
    "-".repeat(50),
    of("stability-violated"),
    (d) => `${d.label}  ${d.url}`,
  )

  if (r.vanished.length > 0) {
    lines.push("  QUOTE VANISHED — cited verbatim, no longer on the page", "  " + "-".repeat(54), "")
    for (const v of r.vanished) {
      lines.push(`    ${v.topic}  [${v.label}]`, `      "${v.text}"`, "")
    }
  }

  section("UNREADABLE — read when the ledger was made, could not be read now", "-".repeat(65), of("unreadable"),
    (d) => d.detail !== undefined
      ? [`${d.label}  (${d.reason ?? "unknown"})`, d.detail]
      : `${d.label}  (${d.reason ?? "unknown"})`)
  section("DRIFTED — volatile, and it changed", "-".repeat(35), of("drifted"),
    (d) => `${d.label}  ${d.url}`)

  const quiet = [...of("unchanged"), ...of("from-store")]
  if (s.stabilityViolated + s.vanished + s.unreadable + s.drifted === 0) {
    lines.push("  nothing drifted", "")
  }
  if (quiet.length > 0) {
    lines.push("  unchanged", "")
    for (const d of quiet) {
      lines.push(`    ${d.outcome === "from-store" ? "from store " : "re-fetched "} ${d.label}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

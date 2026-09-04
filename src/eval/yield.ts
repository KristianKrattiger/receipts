import { readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import type { AdmissionCode, Corpus, Report, RowStatus } from "../types.js"

/**
 * What a run actually yielded, so tuning is measured rather than argued.
 *
 * Every lever in the density plan — fanning the proposal pass, defining what
 * `confidence` means, reserving candidate slots for the claimant — claims to
 * produce more rows. None of them are worth doing blind, and "the ledger looks
 * thicker" is not a measurement. This reads committed reports only: no network,
 * no key, no model call, so the baseline can be recomputed at any time and a
 * change can be attributed to the engine rather than to a different corpus.
 */
export interface CorpusShape {
  claimantDocs: number
  claimantChars: number
  independentDocs: number
  independentChars: number
  /** independent chars per claimant char. Tesla's is 88. */
  ratio: number
}

export interface YieldStats {
  subject: string
  proposed: number
  admitted: number
  /** admitted / proposed, 0 when nothing was proposed. */
  admitRate: number
  denialMix: [AdmissionCode, number][]
  rowsByStatus: Record<RowStatus, number>
  /**
   * Distinct claimant documents appearing in admitted rows, against how many
   * were read. Every relation needs a claimant side, so a corpus whose rows all
   * trace back to one page is one page away from an empty ledger however many
   * independent sources were fetched.
   */
  claimantDocsCited: number
  claimantDocsRead: number
  /**
   * Confidence values of LOW_CONFIDENCE denials. A flat distribution is the
   * floor doing its job; a spike just under it is the model hedging on a scale
   * nothing defined for it.
   */
  lowConfidence: [string, number][]
  corpus?: CorpusShape
}

const STATUSES: RowStatus[] = ["divergent", "corroborated", "unverified"]

/** Leading number of a LOW_CONFIDENCE detail, which reads "0.45 — topic: statement". */
function confidenceOf(detail: string | undefined): string | null {
  const m = /^\s*([0-9]*\.?[0-9]+)/.exec(detail ?? "")
  return m ? m[1]! : null
}

function byCountDesc<T>(counts: Map<T, number>): [T, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

export function corpusShape(corpus: Corpus): CorpusShape {
  const chars = (role: string) =>
    corpus.docs.filter((d) => d.role === role).reduce((n, d) => n + d.text.length, 0)
  const claimantChars = chars("claimant")
  const independentChars = chars("independent")
  return {
    claimantDocs: corpus.docs.filter((d) => d.role === "claimant").length,
    claimantChars,
    independentDocs: corpus.docs.filter((d) => d.role === "independent").length,
    independentChars,
    ratio: claimantChars === 0 ? 0 : independentChars / claimantChars,
  }
}

export function yieldStats(report: Report, corpus?: Corpus): YieldStats {
  const claimantIds = new Set(report.docs.filter((d) => d.role === "claimant").map((d) => d.docId))

  const cited = new Set<string>()
  const rowsByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<RowStatus, number>
  for (const row of report.rows) {
    rowsByStatus[row.status] += 1
    for (const side of row.sides) if (claimantIds.has(side.docId)) cited.add(side.docId)
  }

  const denialMix = new Map<AdmissionCode, number>()
  const lowConfidence = new Map<string, number>()
  for (const d of report.audit.denied) {
    denialMix.set(d.code, (denialMix.get(d.code) ?? 0) + 1)
    if (d.code === "LOW_CONFIDENCE") {
      const c = confidenceOf(d.detail)
      if (c !== null) lowConfidence.set(c, (lowConfidence.get(c) ?? 0) + 1)
    }
  }

  const { proposed, admitted } = report.audit
  return {
    subject: report.subject,
    proposed,
    admitted,
    admitRate: proposed === 0 ? 0 : admitted / proposed,
    denialMix: byCountDesc(denialMix),
    rowsByStatus,
    claimantDocsCited: cited.size,
    claimantDocsRead: claimantIds.size,
    lowConfidence: [...lowConfidence.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
    ...(corpus ? { corpus: corpusShape(corpus) } : {}),
  }
}

/** Totals across every report examined, which is the number the plan moves. */
export function totals(all: YieldStats[]): { proposed: number; admitted: number; rows: number } {
  return {
    proposed: all.reduce((n, s) => n + s.proposed, 0),
    admitted: all.reduce((n, s) => n + s.admitted, 0),
    rows: all.reduce((n, s) => n + STATUSES.reduce((m, k) => m + s.rowsByStatus[k], 0), 0),
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function formatStats(s: YieldStats): string {
  const lines = [
    `${s.subject}`,
    `  proposed ${s.proposed} · admitted ${s.admitted} (${pct(s.admitRate)})`,
    `  rows      ${STATUSES.map((k) => `${s.rowsByStatus[k]} ${k}`).join(" · ")}`,
    `  claimant  ${s.claimantDocsCited}/${s.claimantDocsRead} docs cited in rows`,
  ]
  if (s.denialMix.length > 0) {
    lines.push(`  denied    ${s.denialMix.map(([c, n]) => `${n} ${c}`).join(" · ")}`)
  }
  if (s.lowConfidence.length > 0) {
    lines.push(`  low conf  ${s.lowConfidence.map(([v, n]) => `${v}×${n}`).join(" ")}`)
  }
  if (s.corpus) {
    const c = s.corpus
    lines.push(
      `  corpus    claimant ${c.claimantDocs} docs / ${c.claimantChars} chars · ` +
        `independent ${c.independentDocs} docs / ${c.independentChars} chars · 1:${c.ratio.toFixed(0)}`,
    )
  }
  return lines.join("\n")
}

export function formatReport(all: YieldStats[]): string {
  const t = totals(all)
  return [
    ...all.map(formatStats),
    "",
    `total     proposed ${t.proposed} · admitted ${t.admitted} · ${t.rows} rows across ${all.length} report(s)`,
  ].join("\n\n")
}

/**
 * The corpus a report came from, when it is sitting next to it.
 *
 * Reports carry `DocSummary`, which has no text, so the claimant/independent
 * character split has to come from the fixture. Missing is not an error: a
 * report is still worth measuring without one.
 */
export function corpusFor(reportPath: string): Corpus | undefined {
  const guess = join(dirname(dirname(reportPath)), "fixtures", basename(reportPath))
  try {
    return JSON.parse(readFileSync(guess, "utf8")) as Corpus
  } catch {
    return undefined
  }
}

export function main(paths: string[]): number {
  if (paths.length === 0) {
    console.error("usage: tsx src/eval/yield.ts <report.json...>")
    return 1
  }
  const all = paths.map((p) => {
    const report = JSON.parse(readFileSync(p, "utf8")) as Report
    return yieldStats(report, corpusFor(p))
  })
  console.log(formatReport(all))
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) process.exit(main(process.argv.slice(2)))

import type { DocDrift, DocSummary, DriftReport, LedgerRow, QuoteVanished } from "../types.js"
import { driftHashOf } from "./normalize.js"

export type FreshDoc =
  | { docId: string; text: string }
  | { docId: string; failure: string; detail?: string }

/**
 * One outcome per document the prior ledger read, in the prior ledger's order.
 *
 * Pure: it is handed the prior manifest, whatever was re-fetched, and the set
 * of documents that were read from the snapshot store instead. Everything that
 * touches the network or the disk happens in the caller.
 *
 * Drift is judged on `driftHash`, the hash over normalized text, so a page
 * whose only change is a clock does not count. See `normalize.ts` for what
 * that normalization does and, honestly, does not catch.
 *
 * A declared-stable document that changed is `stability-violated` rather than
 * merely `drifted`: the declaration was a promise about the source, and this
 * is the evidence it was wrong. The ledger it came from is not rewritten here
 * -- the caller decides what to do with the finding.
 */
export function compareDrift(
  prior: DocSummary[],
  fresh: FreshDoc[],
  fromStore: Set<string>,
): DocDrift[] {
  const byId = new Map(fresh.map((f) => [f.docId, f]))
  return prior.map((p) => {
    const base = {
      docId: p.docId, label: p.label, url: p.url,
      stability: p.stability ?? "volatile",
      priorDriftHash: p.driftHash ?? "",
    }
    if (fromStore.has(p.docId)) {
      return { ...base, outcome: "from-store" as const }
    }
    if (p.driftHash === undefined) {
      return { ...base, outcome: "unreadable" as const, reason: "no drift hash recorded for this document; nothing to compare against" }
    }
    const f = byId.get(p.docId)
    if (f === undefined) {
      return { ...base, outcome: "unreadable" as const, reason: "not re-fetched and not in the store" }
    }
    if ("failure" in f) {
      return {
        ...base, outcome: "unreadable" as const, reason: f.failure,
        ...(f.detail !== undefined ? { detail: f.detail } : {}),
      }
    }
    const freshDriftHash = driftHashOf(f.text)
    if (freshDriftHash === base.priorDriftHash) {
      return { ...base, outcome: "unchanged" as const, freshDriftHash }
    }
    const outcome = base.stability === "stable" ? "stability-violated" : "drifted"
    return { ...base, outcome: outcome as "stability-violated" | "drifted", freshDriftHash }
  })
}

/**
 * Every cited span in the prior ledger that is no longer an exact substring of
 * the document it was cut from.
 *
 * This is the single most valuable thing the tool can say -- a claim we quoted
 * verbatim is no longer on the page -- and it costs no model call, because it
 * is the same exact-substring check the admission gate already makes, run in
 * reverse against fresh bytes.
 *
 * It is deliberately exact. A quote that now differs by one character has
 * vanished as far as the guarantee is concerned: the ledger's offsets no longer
 * slice out what it says they do.
 *
 * A side whose document has no fresh text is skipped, not reported: "we could
 * not check" is a different fact from "it is gone", and `compareDrift` already
 * says which documents were unreadable.
 */
export function findVanishedQuotes(
  rows: LedgerRow[],
  freshText: Map<string, string>,
  docs: DocSummary[],
): QuoteVanished[] {
  const label = new Map(docs.map((d) => [d.docId, d.label]))
  const out: QuoteVanished[] = []
  for (const row of rows) {
    for (const side of row.sides) {
      const text = freshText.get(side.docId)
      if (text === undefined) continue
      if (text.includes(side.text)) continue
      out.push({
        topic: row.topic, statement: row.statement,
        docId: side.docId, label: label.get(side.docId) ?? side.docId, text: side.text,
      })
    }
  }
  return out
}

export function buildDriftReport(
  subject: string,
  priorGeneratedAt: string,
  docs: DocDrift[],
  vanished: QuoteVanished[],
  checkedAt: string,
): DriftReport {
  const count = (o: DocDrift["outcome"]) => docs.filter((d) => d.outcome === o).length
  return {
    subject,
    priorGeneratedAt,
    checkedAt,
    docs,
    vanished,
    summary: {
      fromStore: count("from-store"),
      unchanged: count("unchanged"),
      drifted: count("drifted"),
      stabilityViolated: count("stability-violated"),
      unreadable: count("unreadable"),
      vanished: vanished.length,
    },
  }
}

import type { Stability } from "../types.js"
import { stabilityFor } from "./classify.js"
import { driftHashOf } from "./normalize.js"
import { resolvePin } from "./pin.js"
import { putSnapshot, SNAPSHOT_DIR } from "./snapshots.js"

interface FixtureDoc { docId: string; url: string; fetchedAt: string; text: string; stability?: Stability }

/**
 * Give an already-committed report the provenance it predates.
 *
 * The four committed reports carry no pins, but `fixtures/` holds the corpora
 * they were generated from — so content integrity and a drift baseline are
 * available without re-running anything or spending a cent.
 *
 * Fixture and report are matched by `docId`, which both carry. A report
 * document with no fixture match is returned exactly as it came in: this
 * function records what the bytes actually were, and has nothing to say about a
 * document whose bytes it does not have.
 */
export function backfillFromCorpus(
  corpusJson: string,
  reportJson: string,
  snapshotDir: string = SNAPSHOT_DIR,
): { report: unknown; snapshots: number; unmatched: number } {
  const corpus = JSON.parse(corpusJson) as { docs: FixtureDoc[] }
  const report = JSON.parse(reportJson) as { docs: Record<string, unknown>[] }

  const byId = new Map(corpus.docs.map((d) => [d.docId, d]))
  let snapshots = 0
  let unmatched = 0

  const docs = report.docs.map((summary) => {
    const fixture = byId.get(summary["docId"] as string)
    if (!fixture) {
      unmatched++
      return summary
    }
    const raw = putSnapshot({ url: fixture.url, fetchedAt: fixture.fetchedAt, content: fixture.text }, snapshotDir)
    snapshots++
    const pin = resolvePin(fixture.url, raw)
    const stability = stabilityFor(fixture.stability, pin)
    return { ...summary, stability, pin, driftHash: driftHashOf(fixture.text) }
  })

  return { report: { ...report, docs }, snapshots, unmatched }
}

import type { SourceKind, Stability } from "../types.js"
import { stabilityFor } from "./classify.js"
import { driftHashOf } from "./normalize.js"
import { resolvePin } from "./pin.js"
import { putSnapshot, SNAPSHOT_DIR } from "./snapshots.js"

interface FixtureDoc {
  docId: string; url: string; fetchedAt: string; text: string; kind: SourceKind; stability?: Stability
}

/**
 * Give an already-committed report the provenance it predates.
 *
 * The committed reports predate pins, but `fixtures/` holds the corpora three
 * of them were generated from — so content integrity and a drift baseline are
 * available without re-running anything or spending a cent. (chime has no
 * fixture and stays unpinned.)
 *
 * Fixture and report are matched by `docId`, which both carry. A report
 * document with no fixture match is returned exactly as it came in: this
 * function records what the bytes actually were, and has nothing to say about a
 * document whose bytes it does not have. A matched document is checked before
 * it is pinned: every span the ledger cites from it must be in the fixture's
 * text, or the call throws — see the loop below for why.
 */
export function backfillFromCorpus(
  corpusJson: string,
  reportJson: string,
  snapshotDir: string = SNAPSHOT_DIR,
): { report: unknown; snapshots: number; unmatched: number } {
  const corpus = JSON.parse(corpusJson) as { docs: FixtureDoc[] }
  const report = JSON.parse(reportJson) as {
    docs: Record<string, unknown>[]
    rows?: Array<{ topic: string; sides: Array<{ docId: string; text: string }> }>
  }

  const byId = new Map(corpus.docs.map((d) => [d.docId, d]))
  let snapshots = 0
  let unmatched = 0

  const docs = report.docs.map((summary) => {
    const fixture = byId.get(summary["docId"] as string)
    if (!fixture) {
      unmatched++
      return summary
    }
    // A pin is a claim that these are the bytes the ledger was cut from. A
    // fixture for the same subject can still be a different capture, and the
    // one check that tells them apart is the admission gate's own: every span
    // the ledger cites from this document must be an exact substring of the
    // fixture's text. If one is not, these bytes are not that ledger's, and
    // pinning them would put a false baseline under the next --refresh.
    for (const row of report.rows ?? []) {
      for (const side of row.sides) {
        if (side.docId === fixture.docId && !fixture.text.includes(side.text)) {
          throw new Error(
            `receipts: refusing to backfill "${summary["label"]}" (${fixture.docId}): the span cited under ` +
              `"${row.topic}" is not in the fixture's text, so these are not the bytes the ledger was cut from`,
          )
        }
      }
    }
    const raw = putSnapshot({ url: fixture.url, fetchedAt: fixture.fetchedAt, content: fixture.text }, snapshotDir)
    snapshots++
    // `raw` is putSnapshot's return: the blob is committed by the time we pin,
    // so this document is replayable and the pin should say so.
    const pin = resolvePin(fixture.url, raw, true)
    const stability = stabilityFor(fixture.stability, pin)

    // Insert `kind` right after `role` (matching DocSummary's declared field
    // order) instead of spreading it in, which would only ever append it as a
    // new trailing key -- landing it after `driftHash` and rewriting that
    // line's trailing comma on every report doc that already carries
    // provenance from an earlier backfill. Existing keys (including a prior
    // `stability`/`pin`/`driftHash`) keep their original position; assigning
    // to them below only updates their value in place.
    const withKind: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(summary)) {
      withKind[key] = value
      if (key === "role") withKind["kind"] = fixture.kind
    }
    withKind["stability"] = stability
    withKind["pin"] = pin
    withKind["driftHash"] = driftHashOf(fixture.text)
    return withKind
  })

  return { report: { ...report, docs }, snapshots, unmatched }
}

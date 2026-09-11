import { createHash } from "node:crypto"
import type { Corpus } from "../types.js"
import { stabilityFor } from "../provenance/classify.js"
import { driftHashOf } from "../provenance/normalize.js"
import { resolvePin } from "../provenance/pin.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Lift a fetched corpus into the Assay's input type.
 *
 * Composes the provenance units: a document's pin comes from `resolvePin`
 * (permalink when the url is permanent by construction, else a hash of the
 * raw bytes), its `driftHash` from `driftHashOf` over the normalized text,
 * and its stability from an explicit declaration if the plan author gave
 * one, or -- only in that absence -- a recognized permalink promoting it to
 * `stable`. A permalink never overrules an explicit `volatile`: the author
 * knows something the url's shape does not, and silently overriding them
 * would launder an assumption into the ledger.
 */
export function toPinnedCorpus(
  corpus: Corpus,
  opts: { isStored?: (sha256: string) => boolean } = {},
): PinnedCorpus {
  const docs: PinnedDoc[] = corpus.docs.map((d) => {
    const raw = sha256(d.text)
    const pin = resolvePin(d.url, raw, opts.isStored?.(raw) ?? false)
    const stability = stabilityFor(d.stability, pin)
    return {
      docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind,
      fetchedAt: d.fetchedAt, title: d.title, text: d.text,
      stability,
      pin,
      driftHash: driftHashOf(d.text),
      // `via` is the one FetchedDoc provenance field anything downstream reads;
      // `sessionId` and `egress` are deliberately dropped. Conditional spread so
      // an absent `via` stays absent.
      ...(d.via !== undefined ? { via: d.via } : {}),
    }
  })
  return {
    subject: corpus.subject,
    docs,
    failures: corpus.failures,
    ...(corpus.labels ? { labels: corpus.labels } : {}),
  }
}

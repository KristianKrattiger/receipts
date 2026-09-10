import { createHash } from "node:crypto"
import type { Corpus } from "../types.js"
import { driftHashOf } from "../provenance/normalize.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Lift a fetched corpus into the Assay's input type.
 *
 * Phase 1 pins everything by content hash and calls everything volatile: a
 * hash is enough to notice that bytes changed and not enough to get them back,
 * which is exactly the honest description of what this phase can promise.
 * Phase 2 replaces this with real pin resolution.
 */
export function toPinnedCorpus(corpus: Corpus): PinnedCorpus {
  const docs: PinnedDoc[] = corpus.docs.map((d) => ({
    docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind,
    fetchedAt: d.fetchedAt, title: d.title, text: d.text,
    stability: "volatile",
    pin: { kind: "hash", sha256: sha256(d.text) },
    driftHash: driftHashOf(d.text),
    // `via` is the one FetchedDoc provenance field anything downstream reads;
    // `sessionId` and `egress` are deliberately dropped. Conditional spread so
    // an absent `via` stays absent.
    ...(d.via !== undefined ? { via: d.via } : {}),
  }))
  return {
    subject: corpus.subject,
    docs,
    failures: corpus.failures,
    ...(corpus.labels ? { labels: corpus.labels } : {}),
  }
}

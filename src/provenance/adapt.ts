import { createHash } from "node:crypto"
import type { PinnedCorpus, PinnedDoc } from "../assay/types.js"
import type { Corpus } from "../types.js"
import { stabilityFor } from "./classify.js"
import { driftHashOf } from "./normalize.js"
import { resolvePin } from "./pin.js"

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Lift a fetched corpus into the Assay's input type.
 *
 * Composes the provenance units: a document's pin comes from `resolvePin`,
 * which picks one of three kinds in order -- `permalink` when the url is
 * permanent by construction, else `snapshot` when `opts.isStored` says this
 * document's bytes are already committed to the content-addressed store,
 * else a plain `hash` of the raw bytes. `opts.isStored` is how the caller
 * tells this pure function what it has committed, without this function ever
 * touching a filesystem itself; omitting it means nothing is known to be
 * stored, so every document that is not a permalink pins `hash`. `driftHash`
 * comes from `driftHashOf` over the normalized text, and stability from an
 * explicit declaration if the plan author gave one, or -- only in that
 * absence -- a recognized permalink promoting it to `stable`. A permalink
 * never overrules an explicit `volatile`: the author knows something the
 * url's shape does not, and silently overriding them would launder an
 * assumption into the ledger.
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

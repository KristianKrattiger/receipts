import type { Corpus } from "../types.js"
import { putSnapshot, SNAPSHOT_DIR } from "./snapshots.js"

/**
 * Commit every fetched document's bytes to the content-addressed store.
 *
 * This is the step that was missing: before it, the store's only writer was the
 * backfill, so a live run produced a report whose pins resolved to nothing and
 * orphaned whatever the backfill had put there.
 *
 * It runs in the machinery, not inside `toPinnedCorpus`, because that adapter is
 * a pure function and is worth keeping that way — it is the piece the Assay's
 * input type is built by, and it is tested without a filesystem.
 *
 * Returns the blob ids in `corpus.docs` order, so the caller can tell which
 * content is committed without rehashing anything `putSnapshot` already hashed.
 */
export function storeCorpus(corpus: Corpus, dir: string = SNAPSHOT_DIR): string[] {
  return corpus.docs.map((d) =>
    putSnapshot({ url: d.url, fetchedAt: d.fetchedAt, content: d.text }, dir),
  )
}

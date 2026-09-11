import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const SNAPSHOT_DIR = "snapshots"

export interface SnapshotEntry {
  url: string
  fetchedAt: string
  content: string
}

function pathFor(sha256: string, dir: string): string {
  return join(dir, `${sha256}.json`)
}

/**
 * Write a document's bytes into the content-addressed store, and return the id.
 *
 * The id is the sha256 of `content` ALONE, not of the whole entry: two
 * documents with identical text are the same bytes however they were
 * captured, so they share one blob — capturing the same bytes a second time
 * adds nothing to the store.
 *
 * An existing blob is never rewritten. The first capture's url and fetchedAt
 * are the ones kept, and a blob's bytes can never disagree with its own id.
 *
 * Called from two places: `provenance/backfill.ts` backfills a saved report
 * against a fixture, and `src/cli/index.ts` calls it, via `storeCorpus`, on
 * every live run -- before `analyzeCorpus`, so the pins a report emits always
 * resolve to a blob that exists. `toPinnedCorpus` stays pure and never reaches
 * this function itself; committing bytes is the caller's job, not the
 * adapter's.
 */
export function putSnapshot(entry: SnapshotEntry, dir: string = SNAPSHOT_DIR): string {
  const id = createHash("sha256").update(entry.content, "utf8").digest("hex")
  const file = pathFor(id, dir)
  if (existsSync(file)) return id
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, "utf8")
  return id
}

export function hasSnapshot(sha256: string, dir: string = SNAPSHOT_DIR): boolean {
  return existsSync(pathFor(sha256, dir))
}

export function getSnapshot(sha256: string, dir: string = SNAPSHOT_DIR): SnapshotEntry {
  const file = pathFor(sha256, dir)
  if (!existsSync(file)) {
    throw new Error(`receipts: snapshot ${sha256} is not in ${dir}`)
  }
  return JSON.parse(readFileSync(file, "utf8")) as SnapshotEntry
}

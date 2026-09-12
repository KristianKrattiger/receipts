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

/** The id of a blob is the sha256 of its content alone. */
export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
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
 * Called from three places: `provenance/backfill.ts` backfills a saved report
 * against a fixture; `src/cli/index.ts` calls it, via `storeCorpus`, on
 * every live CLI run -- before `analyzeCorpus`, so the pins a CLI report
 * emits always resolve to a blob that exists; and `src/cli/refresh.ts` calls
 * it, also via `storeCorpus`, on the corpus it just re-fetched for
 * `--refresh`. `toPinnedCorpus` stays pure and never reaches this function
 * itself; committing bytes is the caller's job, not the adapter's. The MCP
 * and web entry points call `analyzeCorpus` directly and never reach this
 * function either, so they store nothing and their reports pin `hash`, not
 * `snapshot`.
 */
export function putSnapshot(entry: SnapshotEntry, dir: string = SNAPSHOT_DIR): string {
  const id = sha256Of(entry.content)
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

#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { runReplay, type ReplayOutcome } from "./replay.js"

export interface ReplayAllResult {
  replayed: string[]
  /** Reports with no replay block -- every committed one, today. */
  skipped: string[]
  differed: Map<string, string[]>
  failed: Map<string, string>
}

/**
 * Replay every report in a directory that carries a replay block. The
 * count of those that do not is printed, not hidden: on the day this ships
 * it is all of them, and CI saying "0 replayed" is the honest state.
 */
export async function replayAll(
  dir: string,
  run: (path: string) => Promise<ReplayOutcome> = (path) => runReplay(path),
): Promise<ReplayAllResult> {
  const out: ReplayAllResult = { replayed: [], skipped: [], differed: new Map(), failed: new Map() }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  for (const file of files) {
    const path = join(dir, file)
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay?: unknown }
    if (saved.replay === undefined) {
      out.skipped.push(file)
      continue
    }
    try {
      const r = await run(path)
      if (r.identical) out.replayed.push(file)
      else out.differed.set(file, r.diff)
    } catch (err) {
      out.failed.set(file, err instanceof Error ? err.message : String(err))
    }
  }
  return out
}

// Guarded like src/provenance/backfill-cli.ts: importable by a test without running.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const r = await replayAll(process.argv[2] ?? "reports")
  console.log(`${r.replayed.length} replayed, ${r.skipped.length} not replayable`)
  for (const [file, diff] of r.differed) {
    console.log(`${file} differs from its reproduction in ${diff.length} place(s):`)
    for (const line of diff) console.log(`  ${line}`)
  }
  for (const [file, message] of r.failed) console.error(`${file}: ${message}`)
  process.exitCode = r.differed.size + r.failed.size > 0 ? 1 : 0
}

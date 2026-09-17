import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { replayAll } from "./replay-all.js"
import type { ReplayOutcome } from "./replay.js"

const REPO = fileURLToPath(new URL("../../", import.meta.url))

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "replay-all-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const outcome = (identical: boolean, diff: string[] = []): ReplayOutcome =>
  ({ identical, diff, replayed: 1, result: {} as never })

describe("replayAll", () => {
  it("replays Tesla and skips the three reports that predate the cache", async () => {
    let calls = 0
    const r = await replayAll(join(REPO, "reports"), async () => { calls++; return outcome(true) })
    expect(calls).toBe(1)
    expect(r.replayed).toEqual(["tesla-fsd.json"])
    expect(r.skipped).toEqual(["chime.json", "claude.json", "vercel.json"])
    expect(r.differed.size).toBe(0)
    expect(r.failed.size).toBe(0)
  })

  it("runs only reports with a replay block, and sorts them into replayed, differed and failed", async () => {
    writeFileSync(join(dir, "same.json"), JSON.stringify({ replay: { keys: [], profile: "receipts" } }))
    writeFileSync(join(dir, "changed.json"), JSON.stringify({ replay: { keys: [], profile: "receipts" } }))
    writeFileSync(join(dir, "broken.json"), JSON.stringify({ replay: { keys: [], profile: "receipts" } }))
    writeFileSync(join(dir, "old.json"), JSON.stringify({ rows: [] }))
    writeFileSync(join(dir, "unprofiled.json"), JSON.stringify({ replay: { keys: [] } }))
    writeFileSync(join(dir, "notes.txt"), "ignored")
    mkdirSync(join(dir, "measurements"))
    const r = await replayAll(dir, async (path) => {
      if (path.endsWith("same.json")) return outcome(true)
      if (path.endsWith("changed.json")) return outcome(false, ['rows[0].status: "divergent" → "unverified"'])
      throw new Error("replay: no cached response for abc")
    })
    expect(r.replayed).toEqual(["same.json"])
    expect(r.skipped).toEqual(["old.json", "unprofiled.json"])
    expect([...r.differed.entries()]).toEqual([["changed.json", ['rows[0].status: "divergent" → "unverified"']]])
    expect([...r.failed.entries()]).toEqual([["broken.json", "replay: no cached response for abc"]])
  })

  it("fails, rather than skips, a report stamped under another instance's profile", async () => {
    // Through the real runReplay: the name check comes before any snapshot or
    // cache read, so an empty docs list is enough and nothing touches the store.
    const path = join(dir, "foreign.json")
    writeFileSync(path, JSON.stringify({ docs: [], replay: { keys: [], profile: "claim-record" } }))
    const r = await replayAll(dir)
    expect(r.skipped).toEqual([])
    expect(r.replayed).toEqual([])
    expect([...r.failed.entries()]).toEqual([[
      "foreign.json",
      `receipts: ${path} is not replayable: stamped under profile "claim-record", replaying under "receipts"`,
    ]])
  })
})

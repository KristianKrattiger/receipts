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
    it("skips every committed report until Tesla is restamped under a profile", async () => {
    let calls = 0
    const r = await replayAll(join(REPO, "reports"), async () => { calls++; return outcome(true) })
    expect(calls).toBe(0)
    expect(r.replayed).toEqual([])
    expect(r.skipped).toEqual(["chime.json", "claude.json", "tesla-fsd.json", "vercel.json"])
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
})

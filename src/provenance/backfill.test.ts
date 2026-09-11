import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { backfillFromCorpus } from "./backfill.js"
import { getSnapshot } from "./snapshots.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "backfill-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const corpus = JSON.stringify({
  subject: "X",
  docs: [{ docId: "d1", url: "https://a.example", label: "A", role: "claimant",
           kind: "vendor_site", fetchedAt: "2026-09-01T00:00:00.000Z", title: "A", text: "hello world" }],
  failures: [],
})

const report = JSON.stringify({
  subject: "X", generatedAt: "2026-09-01T00:00:00.000Z",
  docs: [{ docId: "d1", url: "https://a.example", label: "A", role: "claimant", fetchedAt: "2026-09-01T00:00:00.000Z" }],
  failures: [], rows: [], audit: { proposed: 0, admitted: 0, denied: [] },
})

describe("backfillFromCorpus", () => {
  it("writes one snapshot per fixture document", () => {
    const { snapshots } = backfillFromCorpus(corpus, report, dir)
    expect(snapshots).toBe(1)
    expect(getSnapshot("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", dir).content)
      .toBe("hello world")
  })

  it("stamps the matching report doc with pin, stability and driftHash", () => {
    const { report: out } = backfillFromCorpus(corpus, report, dir) as { report: { docs: Record<string, unknown>[] } }
    expect(out.docs[0]!["pin"]).toEqual({
      kind: "snapshot", sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    })
    expect(out.docs[0]!["stability"]).toBe("volatile")
    expect(typeof out.docs[0]!["driftHash"]).toBe("string")
  })

  it("matches fixture to report by docId, not by position", () => {
    const twoDocs = JSON.stringify({ ...JSON.parse(corpus), docs: [
      { docId: "zzz", url: "https://z", label: "Z", role: "independent", kind: "forum",
        fetchedAt: "2026-09-01T00:00:00.000Z", title: "Z", text: "other" },
      JSON.parse(corpus).docs[0],
    ] })
    const { report: out } = backfillFromCorpus(twoDocs, report, dir) as { report: { docs: Record<string, unknown>[] } }
    expect((out.docs[0]!["pin"] as { sha256: string }).sha256)
      .toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
  })

  it("leaves a report doc with no fixture match completely untouched", () => {
    const orphan = JSON.stringify({ ...JSON.parse(report), docs: [
      { docId: "missing", url: "https://m", label: "M", role: "claimant", fetchedAt: "2026-09-01T00:00:00.000Z" },
    ] })
    const { report: out } = backfillFromCorpus(corpus, orphan, dir) as { report: { docs: Record<string, unknown>[] } }
    expect("pin" in out.docs[0]!).toBe(false)
    expect("stability" in out.docs[0]!).toBe(false)
  })

  it("leaves rows and audit exactly as they were", () => {
    const { report: out } = backfillFromCorpus(corpus, report, dir) as { report: Record<string, unknown> }
    expect(out["rows"]).toEqual([])
    expect(out["audit"]).toEqual({ proposed: 0, admitted: 0, denied: [] })
  })
})

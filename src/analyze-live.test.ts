import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SdkProposalClient } from "./cartographer/anthropic.js"
import type { Corpus, FetchedDoc } from "./types.js"
import { analyzeLive } from "./analyze-live.js"

let cwd: string
let snapDir: string
let cacheDir: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "analyze-live-"))
  snapDir = join(cwd, "snapshots")
  cacheDir = join(cwd, "cache", "proposals")
})
afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text: "The service is always available.", ...over,
  }
}

const CORPUS: Corpus = {
  subject: "Acme",
  labels: { claimant: "acme", independent: "independent" },
  docs: [
    doc({ docId: "a", url: "https://acme.example/", label: "Acme site", role: "claimant",
      text: "Acme guarantees 99.99% uptime for every account." }),
    doc({ docId: "b", url: "https://forum.example/t/1", label: "Forum", role: "independent",
      text: "Acme has run without incident for the past year." }),
  ],
  failures: [],
}

const PROPOSAL = {
  type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
  to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
}

const stub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [PROPOSAL] } }) as never } },
}

describe("analyzeLive", () => {
  it("pins snapshot, not hash, and stamps a two-sample replay block", async () => {
    const out = await analyzeLive(CORPUS, { client: stub, snapshotDir: snapDir, cacheDir })
    expect(out.result.outcome).toBe("ledger")
    if (out.result.outcome !== "ledger") return
    for (const d of out.result.docs) {
      expect(d.pin?.kind).toBe("snapshot")
    }
    expect(out.result.replay?.runs).toBe(2)
    expect(out.result.replay?.samples).toHaveLength(2)
    expect(out.result.replay?.samples![0]!.keys.length).toBeGreaterThan(0)
    expect(out.result.replay?.samples![1]!.keys.length).toBeGreaterThan(0)
    expect(out.blobs).toBe(CORPUS.docs.length)
  })

  it("stamps the model it was told to use, and keys the cache on it", async () => {
    const out = await analyzeLive(CORPUS, { client: stub, model: "qwen2.5:7b", runs: 1, snapshotDir: snapDir, cacheDir })
    expect(out.result.replay?.model).toBe("qwen2.5:7b")
    const opus = await analyzeLive(CORPUS, { client: stub, runs: 1, snapshotDir: snapDir, cacheDir })
    expect(opus.result.replay?.model).toBe("claude-opus-5")
    expect(opus.result.replay?.keys).not.toEqual(out.result.replay?.keys)
  })

  it("stamps the 3a shape when runs is 1: keys, no samples, no runs field", async () => {
    const out = await analyzeLive(CORPUS, { client: stub, runs: 1, snapshotDir: snapDir, cacheDir })
    expect(out.result.replay?.keys.length).toBeGreaterThan(0)
    expect(out.result.replay?.samples).toBeUndefined()
    expect(out.result.replay?.runs).toBeUndefined()
  })

  it("leaves replay absent when noCache is set", async () => {
    const out = await analyzeLive(CORPUS, { client: stub, noCache: true, snapshotDir: snapDir, cacheDir })
    expect(out.result.replay).toBeUndefined()
    expect(out.result.outcome).toBe("ledger")
  })

  it("survives a store that cannot be created: hash pins, no throw", async () => {
    writeFileSync(snapDir, "not a directory")
    const out = await analyzeLive(CORPUS, { client: stub, snapshotDir: snapDir, cacheDir })
    expect(out.result.outcome).toBe("ledger")
    if (out.result.outcome !== "ledger") return
    expect(out.blobs).toBe(0)
    for (const d of out.result.docs) {
      expect(d.pin?.kind).toBe("hash")
    }
    expect(out.result.replay?.runs).toBe(2)
  })
})

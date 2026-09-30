import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MODEL, type SdkProposalClient } from "./cartographer/anthropic.js"
import type { Corpus, FetchedDoc, ReceiptsManifest } from "./types.js"
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

  it("stamps the prompt tier it was told to use, defaulting to frontier, and keys the cache per tier", async () => {
    const small = await analyzeLive(CORPUS, { client: stub, tier: "small", runs: 1, snapshotDir: snapDir, cacheDir })
    const frontier = await analyzeLive(CORPUS, { client: stub, runs: 1, snapshotDir: snapDir, cacheDir })
    expect((small.result.replay as ReceiptsManifest | undefined)?.tier).toBe("small")
    expect((frontier.result.replay as ReceiptsManifest | undefined)?.tier).toBe("frontier")
    expect(small.result.replay?.keys).not.toEqual(frontier.result.replay?.keys)
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

const RELATION = {
  type: "corroborates", topic: "uptime", statement: "s",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
  to: { docId: "b", quote: "Acme has run without incident for the past year." },
  rationale: "r", confidence: 0.9,
}
// planPasses fans a relational pass and an "unsupported" pass; this stub
// answers both with the same relational proposal.
const relationStub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [RELATION] } }) as never } },
}
const VERDICT = {
  claim_property: "uptime", claim_scope: "every account", evidence_property: "incidents",
  evidence_scope: "one year", same_property: true, comparable_scope: true,
}
function verdictStub(): SdkProposalClient & { calls: number } {
  const s = {
    calls: 0,
    beta: { messages: { parse: async () => { s.calls++; return ({ stop_reason: "end_turn", parsed_output: VERDICT }) as never } } },
  }
  return s
}

describe("analyzeLive with the relation check", () => {
  it("stamps relationCheck with the frontier model and the verifier's cache keys", async () => {
    const verifierClient = verdictStub()
    const out = await analyzeLive(CORPUS, {
      client: relationStub, verifierClient, relationCheck: true, runs: 1, snapshotDir: snapDir, cacheDir,
    })
    expect(verifierClient.calls).toBeGreaterThan(0)
    expect(out.callFailures).toBe(0)
    const stamp = (out.result.replay as ReceiptsManifest | undefined)?.relationCheck
    expect(stamp?.model).toBe(MODEL)
    expect(stamp?.keys.length).toBeGreaterThan(0)
    expect(out.result.audit.relationCheck).toBe(true)
  })

  it("carries no replay stamp when a verifier call throws", async () => {
    let n = 0
    const flaky: SdkProposalClient = {
      beta: { messages: { parse: async () => {
        if (n++ === 0) throw new Error("503")
        return ({ stop_reason: "end_turn", parsed_output: VERDICT }) as never
      } } },
    }
    const out = await analyzeLive(CORPUS, {
      client: relationStub, verifierClient: flaky, relationCheck: true, runs: 1, snapshotDir: snapDir, cacheDir,
    })
    expect(out.callFailures).toBeGreaterThan(0)
    expect(out.result.replay).toBeUndefined()
  })

  it("stamps no relationCheck key when the check is off", async () => {
    const verifierClient = verdictStub()
    const out = await analyzeLive(CORPUS, {
      client: relationStub, verifierClient, relationCheck: false, runs: 1, snapshotDir: snapDir, cacheDir,
    })
    expect(out.result.replay).toBeDefined()
    expect(out.result.replay).not.toHaveProperty("relationCheck")
    expect(verifierClient.calls).toBe(0)
  })
})

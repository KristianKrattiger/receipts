import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { toPinnedCorpus } from "../provenance/adapt.js"
import { toAssayClient, type SdkProposalClient } from "../cartographer/anthropic.js"
import { assay } from "../assay/index.js"
import type { AssayResult } from "../assay/types.js"
import { cacheOnlyClient, withProposalCache } from "../provenance/proposal-cache.js"
import { getSnapshot } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
import type { Corpus, FetchedDoc, ReplayManifest } from "../types.js"
import { RECEIPTS } from "../instance/profile.js"
import { diffJson, runReplay, type ReplayDeps } from "./replay.js"

let cwd: string
let snapDir: string
let cacheDir: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "replay-"))
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

// The same corpus and proposal the assay's own determinism test uses: one
// claimant, one independent, one anchorable unsupported claim.
const CORPUS: Corpus = {
  subject: "Acme",
  labels: { claimant: "acme", independent: "independent" },
  docs: [
    doc({ docId: "a", url: "https://acme.example/", label: "Acme site", role: "claimant", text: "Acme guarantees 99.99% uptime for every account." }),
    doc({ docId: "b", url: "https://forum.example/t/1", label: "Forum", role: "independent", text: "Acme has run without incident for the past year." }),
  ],
  failures: [{ url: "https://g2.example/acme", label: "G2", reason: "blocked", detail: "G2: DataDome" }],
}
const PROPOSAL = {
  type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
  to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
}
const stub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [PROPOSAL] } }) as never } },
}

/**
 * Do what the CLI does on a fresh run, in-process: commit the bytes, analyse
 * through the write-through cache, stamp the manifest, write the report.
 * Returns the path and the deps a replay of it needs.
 */
async function makeReplayable(corpus: Corpus = CORPUS, model = "claude-opus-5"): Promise<{ path: string; deps: ReplayDeps; saved: AssayResult }> {
  const stored = new Set(storeCorpus(corpus, snapDir))
  const cached = withProposalCache(stub, { dir: cacheDir })
  const result = await assay(toPinnedCorpus(corpus, { isStored: (sha) => stored.has(sha) }), { subject: corpus.subject }, { client: toAssayClient(cached, model), candidates: 40, profile: RECEIPTS })
  const replay: ReplayManifest = { sample: 0, keys: cached.keys, model, candidates: 40, threshold: 0.5, conflictMode: "report", profile: "receipts" }
  const saved: AssayResult = { ...result, replay }
  const path = join(cwd, "acme.json")
  writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`)
  return { path, saved, deps: { snapshot: (sha) => getSnapshot(sha, snapDir), client: cacheOnlyClient({ dir: cacheDir }) } }
}

describe("diffJson", () => {
  it("names every differing leaf by path, and array length changes once", () => {
    expect(diffJson({ a: 1, rows: [{ s: "x" }, { s: "y" }] }, { a: 1, rows: [{ s: "x" }, { s: "z" }] }))
      .toEqual(['rows[1].s: "y" → "z"'])
    expect(diffJson({ rows: [1, 2, 3] }, { rows: [1] })).toEqual(["rows.length: 3 → 1"])
    expect(diffJson({ a: { b: 1 } }, { a: { b: 1, c: 2 } })).toEqual(["a.c: undefined → 2"])
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([])
  })
})

describe("runReplay", () => {
  it("reproduces a ledger from snapshots and the cache, identically", async () => {
    const { path, saved, deps } = await makeReplayable()
    expect(saved.outcome).toBe("ledger")
    const r = await runReplay(path, RECEIPTS, deps)
    expect(r.diff).toEqual([])
    expect(r.identical).toBe(true)
    expect(r.replayed).toBe(saved.replay!.keys.length)
    expect(r.replayed).toBeGreaterThan(0)
  })

  it("reports a mutated row by path", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { rows: Array<{ status: string }> }
    saved.rows[0]!.status = "corroborated"
    writeFileSync(path, JSON.stringify(saved))
    const r = await runReplay(path, RECEIPTS, deps)
    expect(r.identical).toBe(false)
    expect(r.diff.some((line) => line.startsWith("rows[0].status: \"corroborated\" → "))).toBe(true)
  })

  it("refuses a report with no replay block", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    delete saved["replay"]
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: no proposal cache recorded — generated before the cache existed, or with --no-cache`,
    )
  })

  it("refuses a report with a hash-pinned document, naming it", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { docs: Array<{ pin: { kind: string } }> }
    saved.docs[1]!.pin.kind = "hash"
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: 1 document's bytes were never committed (Forum)`,
    )
  })

  it("refuses when a snapshot is missing, naming the document", async () => {
    const { path, saved, deps } = await makeReplayable()
    const sha = saved.docs[0]!.pin!.sha256
    unlinkSync(join(snapDir, `${sha}.json`))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(`"Acme site" snapshot ${sha} is not in the store`)
  })

  it("refuses when a stored blob does not match its own id", async () => {
    const { path, saved, deps } = await makeReplayable()
    const sha = saved.docs[0]!.pin!.sha256
    const file = join(snapDir, `${sha}.json`)
    const entry = JSON.parse(readFileSync(file, "utf8")) as { content: string }
    entry.content = "tampered"
    writeFileSync(file, JSON.stringify(entry))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(`snapshot ${sha} does not match its own id`)
  })

  it("throws naming the key when a cached response is gone", async () => {
    const { path, saved, deps } = await makeReplayable()
    const key = saved.replay!.keys[0]!
    unlinkSync(join(cacheDir, `${key}.json`))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toSatisfy((err: unknown) =>
      err instanceof Error &&
      err.message === `replay: no cached response for ${key}`,
    )
  })

  it("still names the key when every cached response is gone", async () => {
    const { path, saved, deps } = await makeReplayable()
    for (const key of saved.replay!.keys) unlinkSync(join(cacheDir, `${key}.json`))
    const first = saved.replay!.keys[0]!
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toSatisfy((err: unknown) =>
      err instanceof Error &&
      err.message === `replay: no cached response for ${first}`,
    )
  })

  it("refuses an unparseable blob as corrupt, not as missing", async () => {
    const { path, saved, deps } = await makeReplayable()
    const sha = saved.docs[0]!.pin!.sha256
    writeFileSync(join(snapDir, `${sha}.json`), "not-json")
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `snapshot ${sha} does not match its own id — the store is corrupt`,
    )
  })

  it("replays a structural refusal with zero cache reads", async () => {
    const oneRole: Corpus = { ...CORPUS, docs: [CORPUS.docs[0]!] }
    const { path, saved, deps } = await makeReplayable(oneRole)
    expect(saved.outcome).toBe("refusal")
    expect(saved.replay!.keys).toEqual([])
    const r = await runReplay(path, RECEIPTS, deps)
    expect(r.identical).toBe(true)
    expect(r.replayed).toBe(0)
  })

  it("replays under the model the manifest names, not a constant", async () => {
    // The cache key includes the model id. A ledger stamped by another proposer
    // can only hit its own entries if replay asks for the same model.
    const { path, deps } = await makeReplayable(CORPUS, "qwen2.5:7b")
    const r = await runReplay(path, RECEIPTS, deps)
    expect(r.identical).toBe(true)
    expect(r.replayed).toBeGreaterThan(0)
  })

  it("refuses a report whose manifest names no profile", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay: Record<string, unknown> }
    delete saved.replay["profile"]
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: no field profile recorded — generated before the profile existed`,
    )
  })

  it("refuses a report stamped under a different profile, naming both", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay: { profile: string } }
    saved.replay.profile = "claim-record"
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: stamped under profile "claim-record", replaying under "receipts"`,
    )
  })
})

const REPO = fileURLToPath(new URL("../../", import.meta.url))
const CLI_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url))
const TSX_CLI = join(REPO, "node_modules", "tsx", "dist", "cli.mjs")

// reports/chime.json predates both pins and the cache; it is the committed
// report that can never be replayed, and --replay must say so before it
// looks for any key.
describe("--replay from the CLI", () => {
  it("refuses a report with no replay block, needs no key, exits 1", () => {
    const r = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, "chime", "--replay", join(REPO, "reports", "chime.json")], {
      cwd,
      env: {
        PATH: process.env["PATH"] ?? "",
        SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
      },
      encoding: "utf8",
      timeout: 60_000,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("is not replayable: no proposal cache recorded")
    expect(r.stderr).not.toContain("API_KEY")
  })

  it("replays the committed Tesla ledger identically from two samples", () => {
    const r = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, "tesla", "--replay", join(REPO, "reports", "tesla-fsd.json")], {
      cwd: REPO,
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "" },
      encoding: "utf8",
      timeout: 60_000,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("replay: identical (16 responses from cache)")
    const tesla = JSON.parse(readFileSync(join(REPO, "reports", "tesla-fsd.json"), "utf8")) as {
      replay?: { runs?: number; profile?: string; model?: string }
    }
    expect(tesla.replay?.runs).toBe(2)
    expect(tesla.replay?.profile).toBe("receipts")
    expect(tesla.replay?.model).toBe("qwen2.5:7b")
  })
})

describe("runReplay of a two-sample stamp", () => {
  it("rebuilds identically when both samples are cached", async () => {
    const stored = new Set(storeCorpus(CORPUS, snapDir))
    const c0 = withProposalCache(stub, { dir: cacheDir, sample: 0 })
    const c1 = withProposalCache(stub, { dir: cacheDir, sample: 1 })
    const result = await assay(
      toPinnedCorpus(CORPUS, { isStored: (sha) => stored.has(sha) }),
      { subject: CORPUS.subject },
      { runs: 2, clientForSample: (s) => toAssayClient(s === 0 ? c0 : c1), candidates: 40, profile: RECEIPTS },
    )
    const replay: ReplayManifest = {
      sample: 0, keys: c0.keys,
      samples: [{ sample: 0, keys: c0.keys }, { sample: 1, keys: c1.keys }],
      model: "claude-opus-5", candidates: 40, threshold: 0.5, conflictMode: "report", runs: 2, profile: "receipts",
    }
    const saved: AssayResult = { ...result, replay }
    const path = join(cwd, "acme-2.json")
    writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`)
    const r = await runReplay(path, RECEIPTS, {
      snapshot: (sha) => getSnapshot(sha, snapDir),
      client: cacheOnlyClient({ dir: cacheDir, sample: 0 }),
      clientForSample: (sample) => cacheOnlyClient({ dir: cacheDir, sample }),
    })
    expect(r.diff).toEqual([])
    expect(r.identical).toBe(true)
    expect(r.replayed).toBe(c0.keys.length + c1.keys.length)
    if (r.result.outcome === "ledger") {
      expect(r.result.rows.every((row) => row.provenance !== undefined)).toBe(true)
    }
  })
})

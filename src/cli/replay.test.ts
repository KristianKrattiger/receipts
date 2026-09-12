import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { toPinnedCorpus } from "../assay/adapt.js"
import type { ProposalClient } from "../assay/cartographer/propose.js"
import { assay } from "../assay/index.js"
import type { AssayResult } from "../assay/types.js"
import { cacheOnlyClient, withProposalCache } from "../provenance/proposal-cache.js"
import { getSnapshot } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
import type { Corpus, FetchedDoc, ReplayManifest } from "../types.js"
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
const stub: ProposalClient = {
  beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [PROPOSAL] } }) as never } },
}

/**
 * Do what the CLI does on a fresh run, in-process: commit the bytes, analyse
 * through the write-through cache, stamp the manifest, write the report.
 * Returns the path and the deps a replay of it needs.
 */
async function makeReplayable(corpus: Corpus = CORPUS): Promise<{ path: string; deps: ReplayDeps; saved: AssayResult }> {
  const stored = new Set(storeCorpus(corpus, snapDir))
  const cached = withProposalCache(stub, { dir: cacheDir })
  const result = await assay(toPinnedCorpus(corpus, { isStored: (sha) => stored.has(sha) }), { subject: corpus.subject }, { client: cached, candidates: 40 })
  const replay: ReplayManifest = { sample: 0, keys: cached.keys, model: "claude-opus-5", candidates: 40, threshold: 0.5, conflictMode: "report" }
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
    const r = await runReplay(path, deps)
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
    const r = await runReplay(path, deps)
    expect(r.identical).toBe(false)
    expect(r.diff.some((line) => line.startsWith("rows[0].status: \"corroborated\" → "))).toBe(true)
  })

  it("refuses a report with no replay block", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    delete saved["replay"]
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: no proposal cache recorded — generated before the cache existed, or with --no-cache`,
    )
  })

  it("refuses a report with a hash-pinned document, naming it", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { docs: Array<{ pin: { kind: string } }> }
    saved.docs[1]!.pin.kind = "hash"
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: 1 document's bytes were never committed (Forum)`,
    )
  })

  it("refuses when a snapshot is missing, naming the document", async () => {
    const { path, saved, deps } = await makeReplayable()
    const sha = saved.docs[0]!.pin!.sha256
    unlinkSync(join(snapDir, `${sha}.json`))
    await expect(runReplay(path, deps)).rejects.toThrow(`"Acme site" snapshot ${sha} is not in the store`)
  })

  it("refuses when a stored blob does not match its own id", async () => {
    const { path, saved, deps } = await makeReplayable()
    const sha = saved.docs[0]!.pin!.sha256
    const file = join(snapDir, `${sha}.json`)
    const entry = JSON.parse(readFileSync(file, "utf8")) as { content: string }
    entry.content = "tampered"
    writeFileSync(file, JSON.stringify(entry))
    await expect(runReplay(path, deps)).rejects.toThrow(`snapshot ${sha} does not match its own id`)
  })

  it("throws naming the key when a cached response is gone", async () => {
    const { path, saved, deps } = await makeReplayable()
    const key = saved.replay!.keys[0]!
    unlinkSync(join(cacheDir, `${key}.json`))
    await expect(runReplay(path, deps)).rejects.toThrow(`replay: no cached response for ${key}`)
  })

  it("replays a structural refusal with zero cache reads", async () => {
    const oneRole: Corpus = { ...CORPUS, docs: [CORPUS.docs[0]!] }
    const { path, saved, deps } = await makeReplayable(oneRole)
    expect(saved.outcome).toBe("refusal")
    expect(saved.replay!.keys).toEqual([])
    const r = await runReplay(path, deps)
    expect(r.identical).toBe(true)
    expect(r.replayed).toBe(0)
  })
})

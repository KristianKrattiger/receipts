import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runRefresh, type RefreshDeps } from "./refresh.js"
import { driftHashOf } from "../provenance/normalize.js"
import type { Corpus, DocSummary, Report, SourceTarget } from "../types.js"

// Same locating pattern as src/cli/index.test.ts -- do not use import.meta.dirname,
// which the repo's tsconfig target does not expose.
const REPO = fileURLToPath(new URL("../../", import.meta.url))
const CLI_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url))
const TSX_CLI = join(REPO, "node_modules", "tsx", "dist", "cli.mjs")

let cwd: string
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "refresh-")) })
afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

function run(args: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    cwd,
    env: {
      PATH: process.env["PATH"] ?? "",
      SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
      SOLARI_API_KEY: "slr_deliberately_invalid",
      ANTHROPIC_API_KEY: "sk-ant-deliberately-invalid",
    },
    encoding: "utf8",
    timeout: 60_000,
  })
}

// These three cases are all refused before runRefresh ever reaches a fetch, so
// they stay hermetic with no network access -- unlike the "--refresh needs no
// Anthropic key" case in src/cli/index.test.ts (targeting reports/tesla-fsd.json),
// which does reach a real fetch attempt against Solari. A fourth case covering
// that same reachable-fetch path would just duplicate that live-network test
// with a different assertion; it is deliberately not repeated here.
describe("--refresh", () => {
  it("refuses a report with no provenance, naming it, and exits 1", () => {
    const path = join(cwd, "bare.json")
    writeFileSync(path, JSON.stringify({
      subject: "X", generatedAt: "2026-09-01T00:00:00.000Z",
      docs: [{ docId: "d", url: "https://a.example", label: "A", role: "claimant", fetchedAt: "t" }],
      failures: [], rows: [], audit: { proposed: 0, admitted: 0, denied: [] },
    }))
    const r = run(["x", "--refresh", path])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/carries no provenance/)
    expect(r.stderr).toContain("bare.json")
  })

  it("refuses a saved refusal -- there are no rows to check", () => {
    const path = join(cwd, "refusal.json")
    writeFileSync(path, JSON.stringify({
      outcome: "refusal", subject: "X", generatedAt: "t", reason: "NO_GROUNDING", detail: "d",
      docs: [], failures: [], nearMiss: [], audit: { proposed: 0, admitted: 0, denied: [] },
    }))
    const r = run(["x", "--refresh", path])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/refusal, not a ledger/)
  })

  it("refuses --rerun without --refresh", () => {
    const r = run(["x", "--rerun"])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/--rerun requires --refresh/)
  })
})

/**
 * reports/tesla-fsd.json's 10-K row -- permalink-pinned, so runRefresh reads
 * it from the local snapshot store instead of fetching, and the sole role
 * (`claimant`) present in a one-document corpus is what forces the structural
 * CORPUS_INSUFFICIENT refusal below.
 */
const TESLA_REPORT = join(REPO, "reports", "tesla-fsd.json")
const TEN_K = (
  JSON.parse(readFileSync(TESLA_REPORT, "utf8")) as {
    docs: Array<Record<string, unknown> & { pin?: { kind: string; sha256: string } }>
  }
).docs.find((d) => d.pin?.kind === "permalink")!
const TEN_K_SHA256 = TEN_K.pin!.sha256

function seedTenKSnapshot(dir: string): void {
  mkdirSync(join(dir, "snapshots"), { recursive: true })
  writeFileSync(
    join(dir, "snapshots", `${TEN_K_SHA256}.json`),
    readFileSync(join(REPO, "snapshots", `${TEN_K_SHA256}.json`)),
  )
}

/**
 * `--rerun` must not let a refused fresh analysis clobber the prior ledger.
 *
 * A corpus of the 10-K alone has one role (`claimant`), so `assay()` refuses
 * `CORPUS_INSUFFICIENT` structurally, in src/assay/index.ts before
 * `proposeAcrossPasses` -- the model call -- ever runs (confirmed by reading
 * that file: the role check at ~30 returns before `chunkAll`/`propose` are
 * reached). Because the 10-K is permalink-pinned, runRefresh reads it from
 * the snapshot store instead of the network, so this is hermetic: no fetch,
 * no model call, both API keys can be fake.
 */
describe("--rerun and a refused fresh analysis", () => {
  it("does not overwrite the ledger, and says so on stderr", () => {
    seedTenKSnapshot(cwd)

    const report = {
      subject: "tesla", generatedAt: "2026-09-01T00:00:00.000Z",
      docs: [TEN_K], failures: [], rows: [],
      audit: { proposed: 0, admitted: 0, denied: [] },
    }
    const reportPath = join(cwd, "tesla-one-doc.json")
    const original = `${JSON.stringify(report, null, 2)}\n`
    writeFileSync(reportPath, original)

    const r = run(["tesla", "--refresh", reportPath, "--rerun"])

    // Proves the run reached runRefresh's fetch step (nothing to re-fetch --
    // the one doc is from the store) rather than dying earlier for an
    // unrelated reason.
    expect(r.stderr).toContain("refreshing 1 sources: 0 to re-fetch, 1 from the store")
    expect(r.status).toBe(3)
    expect(r.stderr).toContain("not written")
    expect(readFileSync(reportPath, "utf8")).toBe(original)
  })
})

/**
 * `--refresh --rerun` must check ANTHROPIC_API_KEY before the paid fan runs,
 * not after. With no ANTHROPIC_API_KEY at all, the run must die before
 * runRefresh ever prints its "refreshing N sources" progress line -- proof
 * the browser fan against reports/tesla-fsd.json's 9 non-permalink sources
 * never started.
 */
describe("--refresh --rerun requires ANTHROPIC_API_KEY before fetching", () => {
  it("dies on the missing key before the fan runs", () => {
    // The key check dies before runRefresh runs, so the store is never read on
    // the current ordering. Seeded anyway so that, should the check ever move
    // back below the dispatch, the run reaches the fan and this test fails on
    // the "refreshing" line -- the regression under test -- rather than on an
    // unrelated missing-blob error.
    seedTenKSnapshot(cwd)

    const r = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, "tesla", "--refresh", TESLA_REPORT, "--rerun"], {
      cwd,
      env: {
        PATH: process.env["PATH"] ?? "",
        SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
        SOLARI_API_KEY: "slr_deliberately_invalid",
      },
      encoding: "utf8",
      timeout: 60_000,
    })

    expect(r.status).toBe(1)
    expect(r.stderr).toContain("ANTHROPIC_API_KEY is not set")
    expect(r.stderr).not.toContain("refreshing")
  })
})

// ---------------------------------------------------------------------------
// runRefresh itself, with the fetch, the store and the snapshot lookup
// injected. Everything above spawns the CLI and can only reach the paths that
// need no fetch; these reach the partition, the matching and the corpus that
// --rerun analyses, with no network and no disk store.
// ---------------------------------------------------------------------------

const PERMA_SHA = "a".repeat(64)
const permalinkDoc: DocSummary = {
  docId: "tenk", url: "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm",
  label: "10-K", role: "claimant", kind: "vendor_docs", fetchedAt: "2026-09-01T00:00:00.000Z",
  stability: "stable", pin: { kind: "permalink", url: "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm", sha256: PERMA_SHA },
  driftHash: driftHashOf("filing text"),
}
// A hand-chosen docId that is NOT derived from the url -- the point of the
// url-matching test below.
const statusDoc: DocSummary = {
  docId: "status-page", url: "https://status.example/", label: "Status page", role: "independent",
  kind: "status_page", fetchedAt: "2026-09-01T00:00:00.000Z", stability: "volatile",
  pin: { kind: "hash", sha256: "b".repeat(64) },
  driftHash: driftHashOf("all systems operational"),
}
const forumDoc: DocSummary = {
  docId: "forum", url: "https://forum.example/t/1", label: "Forum thread", role: "independent",
  kind: "forum", fetchedAt: "2026-09-01T00:00:00.000Z",
  pin: { kind: "hash", sha256: "c".repeat(64) },
  driftHash: driftHashOf("it broke for me"),
}

function priorReport(over: Partial<Report> = {}): Report {
  return {
    subject: "Acme", generatedAt: "2026-09-01T00:00:00.000Z",
    labels: { claimant: "acme", independent: "independent" },
    docs: [permalinkDoc, statusDoc, forumDoc], failures: [],
    rows: [{
      topic: "uptime", statement: "claims all systems operational", status: "corroborated", relation: "corroborates",
      sides: [
        { docId: "status-page", start: 0, end: 23, text: "all systems operational", tag: "EXACT" },
        { docId: "forum", start: 0, end: 15, text: "it broke for me", tag: "EXACT" },
      ],
    }],
    audit: { proposed: 1, admitted: 1, denied: [] },
    ...over,
  }
}

interface Calls { fetch: Array<{ subject: string; targets: SourceTarget[] }>; stored: Corpus[]; snapshots: string[] }
const calls = (): Calls => ({ fetch: [], stored: [], snapshots: [] })

function deps(refetched: Corpus, c: Calls): RefreshDeps {
  return {
    fetch: async (subject, targets) => { c.fetch.push({ subject, targets }); return refetched },
    store: (corpus) => { c.stored.push(corpus); return [] },
    snapshot: (sha) => { c.snapshots.push(sha); return { url: permalinkDoc.url, fetchedAt: "2026-09-01T00:00:00.000Z", content: "filing text" } },
  }
}

function fetched(docId: string, url: string, text: string) {
  return { docId, url, label: "L", role: "independent" as const, kind: "status_page" as const, fetchedAt: "2026-09-11T00:00:00.000Z", title: "T", text }
}

describe("runRefresh (injected)", () => {
  let reportPath: string
  beforeEach(() => {
    reportPath = join(cwd, "acme.json")
    writeFileSync(reportPath, JSON.stringify(priorReport()))
  })

  it("reads permalink-pinned documents from the store and re-fetches everything else, as the prior report's targets", async () => {
    const c = calls()
    const refetched: Corpus = {
      subject: "Acme", failures: [],
      docs: [fetched("x1", statusDoc.url, "all systems operational"), fetched("x2", forumDoc.url, "it broke for me")],
    }
    const { drift } = await runRefresh(reportPath, { apiKey: "k" }, deps(refetched, c))

    expect(c.snapshots).toEqual([PERMA_SHA])
    expect(c.fetch).toHaveLength(1)
    expect(c.fetch[0]!.subject).toBe("Acme")
    // The targets are rebuilt from the prior report, stability carried only where it was recorded.
    expect(c.fetch[0]!.targets).toStrictEqual([
      { kind: "status_page", role: "independent", url: statusDoc.url, label: "Status page", stability: "volatile" },
      { kind: "forum", role: "independent", url: forumDoc.url, label: "Forum thread" },
    ])
    expect(drift.summary).toEqual({ fromStore: 1, unchanged: 2, drifted: 0, stabilityViolated: 0, unreadable: 0, vanished: 0 })
  })

  it("matches re-fetched documents to the prior ledger by url, so a hand-chosen docId is still compared and its quotes still checked", async () => {
    const c = calls()
    const refetched: Corpus = {
      subject: "Acme", failures: [],
      // fetchCorpus gives its own ids; neither matches the prior report's.
      docs: [fetched("x1", statusDoc.url, "degraded performance"), fetched("x2", forumDoc.url, "it broke for me")],
    }
    const { drift } = await runRefresh(reportPath, { apiKey: "k" }, deps(refetched, c))

    const status = drift.docs.find((d) => d.docId === "status-page")!
    expect(status.outcome).toBe("drifted")
    expect(drift.vanished).toEqual([
      { topic: "uptime", statement: "claims all systems operational", docId: "status-page", label: "Status page", text: "all systems operational" },
    ])
  })

  it("matches a failure by url and carries its reason and detail", async () => {
    const c = calls()
    const refetched: Corpus = {
      subject: "Acme",
      docs: [fetched("x2", forumDoc.url, "it broke for me")],
      failures: [{ url: statusDoc.url, label: "Status page", reason: "blocked", detail: "Status page: DataDome challenge served" }],
    }
    const { drift } = await runRefresh(reportPath, { apiKey: "k" }, deps(refetched, c))

    const status = drift.docs.find((d) => d.docId === "status-page")!
    expect(status.outcome).toBe("unreadable")
    expect(status.reason).toBe("blocked")
    expect(status.detail).toBe("Status page: DataDome challenge served")
    // A side whose document could not be read is skipped, not reported vanished.
    expect(drift.vanished).toEqual([])
    expect(drift.summary.unreadable).toBe(1)
  })

  it("commits the re-fetched bytes to the store, and survives the store refusing", async () => {
    const c = calls()
    const refetched: Corpus = { subject: "Acme", failures: [], docs: [fetched("x1", statusDoc.url, "all systems operational")] }
    await runRefresh(reportPath, { apiKey: "k" }, deps(refetched, c))
    expect(c.stored).toEqual([refetched])

    const refusing: RefreshDeps = { ...deps(refetched, c), store: () => { throw new Error("EROFS: read-only file system") } }
    await expect(runRefresh(reportPath, { apiKey: "k" }, refusing)).resolves.toBeDefined()
  })

  it("returns the corpus --rerun analyses in a fresh run's order, with the store's documents and the fetch's failures", async () => {
    const c = calls()
    const refetched: Corpus = {
      subject: "Acme",
      docs: [fetched("aa", forumDoc.url, "it broke for me")],
      failures: [{ url: statusDoc.url, label: "Status page", reason: "blocked", detail: "d" }],
    }
    const { fresh } = await runRefresh(reportPath, { apiKey: "k" }, deps(refetched, c))

    // fetchCorpus sorts by docId; the store's document must not be pinned to the front.
    expect(fresh.docs.map((d) => d.docId)).toEqual(["aa", "tenk"])
    expect(fresh.docs[1]).toMatchObject({ docId: "tenk", text: "filing text", stability: "stable", role: "claimant" })
    expect(fresh.failures).toEqual(refetched.failures)
    expect(fresh.labels).toEqual({ claimant: "acme", independent: "independent" })
    expect(fresh.subject).toBe("Acme")
  })

  it("refuses a saved refusal and a report lacking provenance before fetching anything", async () => {
    const c = calls()
    const d = deps({ subject: "Acme", docs: [], failures: [] }, c)

    writeFileSync(reportPath, JSON.stringify({ subject: "Acme", outcome: "refusal", reason: "NO_GROUNDING", detail: "", nearMiss: [], docs: [], failures: [], audit: { proposed: 0, admitted: 0, denied: [] } }))
    await expect(runRefresh(reportPath, { apiKey: "k" }, d)).rejects.toThrow(/is a refusal, not a ledger/)

    const { driftHash: _dropped, ...bare } = forumDoc
    writeFileSync(reportPath, JSON.stringify(priorReport({ docs: [permalinkDoc, statusDoc, bare] })))
    await expect(runRefresh(reportPath, { apiKey: "k" }, d)).rejects.toThrow(/carries no provenance for 1 of 3 documents \(Forum thread\)/)

    expect(c.fetch).toEqual([])
    expect(c.snapshots).toEqual([])
  })
})

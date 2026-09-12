import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

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

import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

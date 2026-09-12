import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// Resolved from this file's own location, not the runner's cwd, so the test
// works whether vitest is invoked from the repo root or anywhere else.
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const CLI_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url))
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const FIXTURE = join(REPO_ROOT, "fixtures", "probe-source-classes.json")

/**
 * Drives the real CLI as a child process with `--from-fixture`, which needs no
 * browser and no SOLARI_API_KEY -- `fetchCorpus` is never called. The thing
 * every run still does before any model call is `storeCorpus` (src/cli/
 * index.ts), which commits every document's bytes to `snapshots/` under the
 * child's own cwd. That commit is what this branch added: before it, the
 * store's only writer was the backfill, and a live run emitted pins resolving
 * to no blob.
 *
 * The child gets a deliberately invalid ANTHROPIC_API_KEY so the one model
 * call this run would otherwise make fails fast on a 401, and this test
 * asserts nothing about that failure or about the run's exit code -- only
 * that the blobs already exist in the child's own `snapshots/` by the time it
 * happens. Nothing here spreads the parent's `process.env`: the child's env is
 * built from scratch below, and this bare `node cli.mjs <script>` invocation
 * (no `--env-file-if-exists` flag anywhere in the chain) never reads the
 * repo's own `.env`, so no real key can reach it regardless of what that file
 * holds.
 */
function runCliFromFixture(cwd: string): void {
  spawnSync(
    process.execPath,
    [TSX_CLI, CLI_ENTRY, "acme", "--from-fixture", FIXTURE],
    {
      cwd,
      env: {
        // Windows needs these two just to spawn node/tsx and resolve modules;
        // neither carries anything secret.
        PATH: process.env["PATH"] ?? "",
        SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
        ANTHROPIC_API_KEY: "sk-ant-deliberately-invalid-for-testing",
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  )
}

describe("the live CLI path (src/cli/index.ts)", () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cli-snapshots-"))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it("commits a blob for every fetched document before the model call, even one that then fails", () => {
    runCliFromFixture(cwd)

    const fixtureDocCount = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { docs: unknown[] }).docs.length

    const files = readdirSync(join(cwd, "snapshots"))
    expect(files).toHaveLength(fixtureDocCount)

    // Every blob's filename is the sha256 hex of its own content -- the same
    // property snapshots.test.ts checks directly on putSnapshot, now shown to
    // hold end-to-end through a real CLI invocation instead of a function call.
    for (const file of files) {
      const id = file.replace(/\.json$/, "")
      const entry = JSON.parse(readFileSync(join(cwd, "snapshots", file), "utf8")) as { content: string }
      expect(createHash("sha256").update(entry.content, "utf8").digest("hex")).toBe(id)
    }
  })
})

/**
 * Same invocation as runCliFromFixture, but captures stdout/stderr/status
 * instead of discarding them -- this test needs to read what the run printed,
 * not just what it left on disk.
 */
function runCliFromFixtureCapturing(cwd: string) {
  return spawnSync(
    process.execPath,
    [TSX_CLI, CLI_ENTRY, "acme", "--from-fixture", FIXTURE],
    {
      cwd,
      env: {
        PATH: process.env["PATH"] ?? "",
        SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
        ANTHROPIC_API_KEY: "sk-ant-deliberately-invalid-for-testing",
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  )
}

/**
 * `--refresh` (without `--rerun`) makes no model call by design -- it only
 * re-fetches a saved ledger's sources and diffs them. It still needs
 * SOLARI_API_KEY (the re-fetch is real), but ANTHROPIC_API_KEY must not be
 * required: that check runs before the --refresh dispatch and exempts a plain
 * --refresh, and if it fires unconditionally it defeats the entire point of
 * --refresh being free to run.
 *
 * This targets a report with full provenance -- reports/tesla-fsd.json, where
 * all 10 documents carry a pin, a driftHash and a kind -- rather than
 * reports/chime.json, which runRefresh refuses outright ("carries no
 * provenance"). A chime.json run would also prove the key check exempted it,
 * but on a run that dies before doing anything; tesla-fsd.json proves the
 * exemption on a run that actually enters runRefresh and completes.
 *
 * tesla-fsd.json's provenance lets runRefresh proceed: 1 of its 10 documents
 * is permalink-pinned (the 10-K, read from the snapshot store) and the other 9
 * are re-fetched for real. With a fake SOLARI_API_KEY every one of those 9
 * re-fetches fails per-source -- fetchCorpus records failures rather than
 * throwing -- so runRefresh still completes, prints the drift report (9
 * unreadable, 1 from-store), and exits 0. The
 * "refreshing 10 sources: 9 to re-fetch, 1 from the store" line on stderr is
 * runRefresh's own progress message; asserting on it proves this run reached
 * runRefresh's fetch step rather than passing for some unrelated reason (e.g.
 * a typo in the report path making the whole invocation a no-op).
 *
 * The 10-K is permalink-pinned, so runRefresh reads it back from the local
 * snapshot store (getSnapshot) instead of the network -- and that store is
 * resolved against the child's own cwd (SNAPSHOT_DIR is the relative path
 * "snapshots"), not the repo root. beforeEach seeds exactly that one blob
 * into the temp cwd before the run, copied from the repo's own snapshots/
 * (never written to). Without it, runRefresh throws "snapshot ... is not in
 * snapshots" before it ever reaches the "refreshing N sources" progress line,
 * which would make this test fail for a reason that has nothing to do with
 * the ANTHROPIC_API_KEY gate under test.
 */
describe("--refresh needs no Anthropic key (src/cli/index.ts)", () => {
  const TESLA_REPORT = join(REPO_ROOT, "reports", "tesla-fsd.json")
  const TEN_K_SHA256 = (
    JSON.parse(readFileSync(TESLA_REPORT, "utf8")) as {
      docs: Array<{ pin?: { kind: string; sha256: string } }>
    }
  ).docs.find((d) => d.pin?.kind === "permalink")!.pin!.sha256

  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cli-refresh-nokey-"))
    mkdirSync(join(cwd, "snapshots"), { recursive: true })
    writeFileSync(
      join(cwd, "snapshots", `${TEN_K_SHA256}.json`),
      readFileSync(join(REPO_ROOT, "snapshots", `${TEN_K_SHA256}.json`)),
    )
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it("does not die on a missing ANTHROPIC_API_KEY for a plain --refresh", () => {
    const result = spawnSync(
      process.execPath,
      [TSX_CLI, CLI_ENTRY, "tesla", "--refresh", TESLA_REPORT],
      {
        cwd,
        env: {
          // Built from scratch, deliberately with no ANTHROPIC_API_KEY at all --
          // this is the exact condition the fix carves out. A fake
          // SOLARI_API_KEY gets the run past the *other* key check and into the
          // 9 real (and fast-failing) re-fetch attempts, so the ANTHROPIC_API_KEY
          // gate is the only thing left to observe.
          PATH: process.env["PATH"] ?? "",
          SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
          SOLARI_API_KEY: "fake-solari-key-for-testing",
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    )

    const stderr = result.stderr ?? ""
    // Proves the run got past the provenance check and into runRefresh's own
    // fetch step, so the assertion below is exercising the fall-through path
    // rather than passing for an unrelated reason.
    expect(stderr).toContain("refreshing 10 sources: 9 to re-fetch, 1 from the store")
    expect(stderr).not.toContain("ANTHROPIC_API_KEY is not set")
    // A plain --refresh exits 0 whether or not anything drifted -- "nothing
    // changed" is a finding too.
    expect(result.status).toBe(0)
  }, 65_000)
})

describe("a failed store write does not throw the run away (src/cli/index.ts)", () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cli-store-fail-"))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it("warns on stderr and continues with nothing committed when snapshots/ cannot be created", () => {
    // storeCorpus -> putSnapshot calls mkdirSync(dir, { recursive: true }).
    // mkdirSync throws EEXIST, on both Windows and POSIX, when the path
    // already exists as a plain file rather than a directory -- a
    // deterministic, portable way to make the write fail without touching
    // permissions or the real filesystem's disk space, and entirely inside
    // this test's own throwaway cwd, never the repo's snapshots/.
    writeFileSync(join(cwd, "snapshots"), "not a directory")

    const result = runCliFromFixtureCapturing(cwd)
    const stderr = result.stderr ?? ""

    // Guarded: the run names the error and says what it is doing about it,
    // instead of dying to an unhandled mkdirSync exception.
    expect(stderr).toMatch(/could not commit to snapshots\/:.*EEXIST/)
    expect(stderr).toMatch(/continuing with nothing committed/)

    // It got past the guard and reported honestly: every document read, zero
    // blobs committed -- not silently dropped, and not claimed as stored.
    const fixtureDocCount = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { docs: unknown[] }).docs.length
    expect(stderr).toContain(`snapshots  ${fixtureDocCount} doc(s), 0 blob(s) in snapshots/`)

    // Not a crash: Node's uncaught-exception output includes stack frame
    // lines ("    at name (file:line:col)"); the guard's own console.error
    // calls never print one, since they log only err.message.
    expect(stderr).not.toMatch(/\n\s+at .+\(.*:\d+:\d+\)/)

    // Nothing was written -- the blocking file is exactly as it was.
    expect(readFileSync(join(cwd, "snapshots"), "utf8")).toBe("not a directory")
  })
})

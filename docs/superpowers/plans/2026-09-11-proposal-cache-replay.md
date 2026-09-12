# Proposal Cache and `--replay` (Phase 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model response a CLI run makes is committed under `cache/proposals/`, content-addressed by the request that produced it, and `--replay <report>` rebuilds that report from `snapshots/` and the cache with no network, no model call and no key — exiting 0 iff the reproduction is identical.

**Architecture:** The cache is a `ProposalClient` decorator (`src/provenance/proposal-cache.ts`), keyed by `sha256(canonicalJSON({ ...request, sample }))`; `src/assay/` stays pure given its client. The CLI constructs the decorated client, passes it through `analyzeCorpus`, and stamps `report.replay` after analysis. `--replay` (`src/cli/replay.ts`) rebuilds the corpus from the report's pins, runs `assay` with a cache-only client and the recorded settings, and diffs. A CI workflow replays every replayable committed report — today none, and it says so.

**Tech Stack:** TypeScript, Node ESM (`.js` specifiers), vitest, tsx. `node:crypto` for sha256. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-proposal-cache-replay-design.md`. Read it first.

## Global Constraints

- Node ESM: every relative import specifier ends in `.js`, never `.ts`. `npm run typecheck` (`tsc --noEmit`, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`-style conditional spreads `...(x !== undefined ? { x } : {})`) must stay clean after every task.
- No new runtime dependencies. `package.json` changes only to add the `replay` script (Task 6).
- `src/assay/` learns nothing about disks. The cache is a client.
- Nothing under `reports/`, `snapshots/`, `fixtures/`, `plans/` changes. `snapshots/` stays at 26 blobs. No committed report becomes replayable on this branch.
- `cache/proposals/` is committed, never gitignored. This branch creates the directory only in tests (temp cwd) — the repo's `cache/` does not exist until the first run through the CLI.
- Every error is one sentence on stderr, exit 1, no stack trace. Copy message text from this plan verbatim.
- Every test is hermetic: no network, no model, temp cwd, fake or absent keys. Never write into the repo's `snapshots/` or `reports/`; never leave scratch files in the repo.
- Prose must not outrun code. This project has shipped that defect on nine consecutive branches. Every comment and README sentence you write must be traceable to a line that makes it true. Do not say `--replay` has been run on a real ledger; it has not.
- Run `npm test` and `npm run typecheck` before every commit. Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `src/provenance/proposal-cache.ts` (new) | `canonicalJson`, `cacheKeyFor`, `withProposalCache`, `cacheOnlyClient`, `CACHE_DIR` |
| `src/provenance/proposal-cache.test.ts` (new) | key stability; decorator hit/miss/corrupt/write-failure; cache-only miss/corrupt |
| `src/provenance/snapshots.ts` | export `sha256Of`; `putSnapshot` uses it |
| `src/provenance/backfill.ts` | use the exported `sha256Of` (drop its private copy) |
| `src/types.ts` | `ReplayManifest`; `Report.replay?` |
| `src/assay/types.ts` | `Ledger.replay?`, `Refusal.replay?` |
| `src/assay/cartographer/propose.ts` | export `defaultClient()`; `proposeRelations` falls back to it |
| `src/assay/index.test.ts` | determinism test |
| `src/cli/args.ts` / `args.test.ts` | `--replay`, `--no-cache`, exclusions |
| `src/cli/replay.ts` (new) | `diffJson`, `runReplay`, `ReplayDeps` |
| `src/cli/replay.test.ts` (new) | unit tests with injected deps; child-process refusal test |
| `src/cli/index.ts` | cached client on the fresh-run path; the stamp; `--replay` dispatch; key exemption |
| `src/cli/replay-all.ts` (new) + `.test.ts` | loop `reports/*.json`; CI entry |
| `package.json` | `"replay": "tsx src/cli/replay-all.ts"` |
| `.github/workflows/ci.yml` (new) | typecheck, test, replay |
| `README.md` | the cache, `--replay`, `--no-cache`, the caveat rewrite, Development |

---

### Task 1: the cache decorator

**Files:**
- Create: `src/provenance/proposal-cache.ts`
- Create: `src/provenance/proposal-cache.test.ts`

**Interfaces:**
- Consumes: `ProposalClient` from `src/assay/cartographer/propose.ts` — `{ beta: { messages: { parse(body): Promise<ParseResponse> } } }`. `ParseRequest` is not exported; use `Parameters<ProposalClient["beta"]["messages"]["parse"]>[0]`.
- Produces (Tasks 4, 5, 6 rely on these exact names):
  ```ts
  export const CACHE_DIR = "cache/proposals"
  export interface CachedResponse { parsed_output?: unknown; stop_reason?: string | null; stop_details?: { category?: string | null } | null; usage?: unknown }
  export interface CacheEntry { key: string; createdAt: string; sample: number; request: unknown; response: CachedResponse }
  export interface CachedProposalClient extends ProposalClient { keys: string[]; writeFailures: string[] }
  export function canonicalJson(value: unknown): string
  export function cacheKeyFor(body: object, sample: number): string
  export function withProposalCache(inner: ProposalClient, opts?: { dir?: string; sample?: number }): CachedProposalClient
  export function cacheOnlyClient(opts?: { dir?: string }): CachedProposalClient
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/provenance/proposal-cache.test.ts
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ProposalClient } from "../assay/cartographer/propose.js"
import { cacheKeyFor, cacheOnlyClient, canonicalJson, withProposalCache, type CacheEntry } from "./proposal-cache.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "proposal-cache-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// The shape proposeRelations builds: model, max_tokens, system, one user
// message, and an output_format whose `parse` is a function (dropped by JSON).
const body = {
  model: "claude-opus-5", max_tokens: 16000, system: "S",
  messages: [{ role: "user" as const, content: "Subject: Acme\n\nExcerpts:\n\n[a] hello" }],
  output_format: { type: "json_schema", schema: { type: "object", properties: {} }, parse: () => null },
}

describe("canonicalJson", () => {
  it("sorts object keys at every depth and drops functions and undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined, f: () => 1 } }))
      .toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}')
  })
})

describe("cacheKeyFor", () => {
  it("is 64 hex characters", () => {
    expect(cacheKeyFor(body, 0)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("ignores key order at every depth", () => {
    const a = { model: "m", messages: [{ role: "user", content: "x" }], system: "S" }
    const b = { system: "S", messages: [{ content: "x", role: "user" }], model: "m" }
    expect(cacheKeyFor(a, 0)).toBe(cacheKeyFor(b, 0))
  })

  it("changes with every field of the request, and with the sample", () => {
    const base = cacheKeyFor(body, 0)
    expect(cacheKeyFor({ ...body, system: "S2" }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, model: "other" }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, max_tokens: 16001 }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, messages: [{ role: "user", content: "Subject: Acme\n\nExcerpts:\n\n[a] hello!" }] }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, output_format: { ...body.output_format, schema: { type: "array" } } }, 0)).not.toBe(base)
    expect(cacheKeyFor(body, 1)).not.toBe(base)
  })

  it("is blind to a function-valued property", () => {
    expect(cacheKeyFor({ ...body, output_format: { ...body.output_format, parse: () => 42 } }, 0)).toBe(cacheKeyFor(body, 0))
  })
})

function counting(response: object): { client: ProposalClient; calls: () => number } {
  let n = 0
  return {
    calls: () => n,
    client: { beta: { messages: { parse: async () => { n++; return response as never } } } },
  }
}
const RESPONSE = { stop_reason: "end_turn", parsed_output: { proposals: [] }, usage: { input_tokens: 5, output_tokens: 2 } }
const parse = (c: ProposalClient) => c.beta.messages.parse(body as never)

describe("withProposalCache", () => {
  it("calls through on a miss, writes the entry with request and response, and records the key", async () => {
    const { client, calls } = counting(RESPONSE)
    const cached = withProposalCache(client, { dir })
    const r = await parse(cached)
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    const key = cacheKeyFor(body, 0)
    expect(cached.keys).toEqual([key])
    expect(cached.writeFailures).toEqual([])
    const entry = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as CacheEntry
    expect(entry.key).toBe(key)
    expect(entry.sample).toBe(0)
    expect(entry.request).toEqual(JSON.parse(JSON.stringify(body)))
    expect(entry.response).toEqual(RESPONSE)
    expect(typeof entry.createdAt).toBe("string")
  })

  it("serves a hit from disk without calling through", async () => {
    const { client, calls } = counting(RESPONSE)
    const cached = withProposalCache(client, { dir })
    await parse(cached)
    const r = await parse(cached)
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    expect(cached.keys).toHaveLength(2)
  })

  it("keys the sample: sample 1 misses what sample 0 wrote", async () => {
    const { client, calls } = counting(RESPONSE)
    await parse(withProposalCache(client, { dir, sample: 0 }))
    await parse(withProposalCache(client, { dir, sample: 1 }))
    expect(calls()).toBe(2)
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it("treats an unparseable entry as a miss and overwrites it", async () => {
    const { client, calls } = counting(RESPONSE)
    const key = cacheKeyFor(body, 0)
    writeFileSync(join(dir, `${key}.json`), "{not json")
    const r = await parse(withProposalCache(client, { dir }))
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    expect(() => JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8"))).not.toThrow()
  })

  it("survives a write failure: returns the live response and records the key as unwritten", async () => {
    const { client, calls } = counting(RESPONSE)
    // A regular file where the cache directory should be: mkdir fails on every platform.
    const blocked = join(dir, "not-a-dir")
    writeFileSync(blocked, "x")
    const cached = withProposalCache(client, { dir: join(blocked, "proposals") })
    const r = await parse(cached)
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    expect(cached.keys).toEqual([cacheKeyFor(body, 0)])
    expect(cached.writeFailures).toEqual([cacheKeyFor(body, 0)])
  })

  it("stores no usage key when the client returned none", async () => {
    const { client } = counting({ stop_reason: "end_turn", parsed_output: { proposals: [] } })
    await parse(withProposalCache(client, { dir }))
    const entry = JSON.parse(readFileSync(join(dir, `${cacheKeyFor(body, 0)}.json`), "utf8")) as CacheEntry
    expect("usage" in entry.response).toBe(false)
  })
})

describe("cacheOnlyClient", () => {
  it("serves a hit and records the key", async () => {
    const { client } = counting(RESPONSE)
    await parse(withProposalCache(client, { dir }))
    const only = cacheOnlyClient({ dir })
    expect(await parse(only)).toEqual(RESPONSE)
    expect(only.keys).toEqual([cacheKeyFor(body, 0)])
  })

  it("throws on a miss, naming the key", async () => {
    const key = cacheKeyFor(body, 0)
    await expect(parse(cacheOnlyClient({ dir }))).rejects.toThrow(`replay: no cached response for ${key}`)
  })

  it("throws on an unparseable entry, naming the file", async () => {
    const key = cacheKeyFor(body, 0)
    writeFileSync(join(dir, `${key}.json`), "{not json")
    await expect(parse(cacheOnlyClient({ dir }))).rejects.toThrow(`${key}.json`)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/provenance/proposal-cache.test.ts`
Expected: FAIL — cannot resolve `./proposal-cache.js`.

- [ ] **Step 3: Write the module**

```ts
// src/provenance/proposal-cache.ts
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ProposalClient } from "../assay/cartographer/propose.js"

/** Where model responses live. Relative to the working directory, like SNAPSHOT_DIR. */
export const CACHE_DIR = "cache/proposals"

type ParseBody = Parameters<ProposalClient["beta"]["messages"]["parse"]>[0]
type ParseResult = Awaited<ReturnType<ProposalClient["beta"]["messages"]["parse"]>>

/** The part of a response the proposer reads, plus what the SDK said it cost. */
export interface CachedResponse {
  parsed_output?: unknown
  stop_reason?: string | null
  stop_details?: { category?: string | null } | null
  /** Recorded when the SDK returned it. Read by nothing yet. */
  usage?: unknown
}

/**
 * One file per model response, named by the key of the request that produced
 * it. The request is stored too: a cache you can read is a receipt, a bare
 * response is not.
 */
export interface CacheEntry {
  key: string
  createdAt: string
  sample: number
  request: unknown
  response: CachedResponse
}

export interface CachedProposalClient extends ProposalClient {
  /** Every key served, in call order -- hits and misses alike. */
  keys: string[]
  /** Keys whose entry could not be written. A run with any is not replayable. */
  writeFailures: string[]
}

/**
 * JSON with object keys sorted at every depth, so equal values serialise
 * equal whatever order their keys were built in. Functions and undefined
 * vanish, as they do in JSON.stringify -- which is what lets an
 * `output_format` carry its `parse` function without touching the key.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const v = record[key]
      if (v !== undefined && typeof v !== "function") out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/**
 * The key is the request itself: model, system prompt, the user message with
 * every excerpt, max_tokens, the JSON schema. Any change to any of them is a
 * miss, with no version constant to forget to bump. `sample` distinguishes
 * deliberate re-samples of one request (Phase 3b's second run); it is 0 for
 * every ordinary call.
 */
export function cacheKeyFor(body: object, sample: number): string {
  return createHash("sha256").update(canonicalJson({ ...body, sample }), "utf8").digest("hex")
}

function pathFor(dir: string, key: string): string {
  return join(dir, `${key}.json`)
}

function readEntry(file: string): CacheEntry | undefined {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CacheEntry
  } catch {
    return undefined
  }
}

/**
 * The subset the proposer reads. The SDK's parsed message also carries content
 * blocks, ids and headers that nothing reads; they are not kept.
 */
function toCached(response: ParseResult): CachedResponse {
  const r = response as CachedResponse
  return {
    parsed_output: r.parsed_output,
    ...(r.stop_reason !== undefined ? { stop_reason: r.stop_reason } : {}),
    ...(r.stop_details !== undefined ? { stop_details: r.stop_details } : {}),
    ...(r.usage !== undefined ? { usage: r.usage } : {}),
  }
}

/**
 * Read-through cache around a real client. A hit returns the stored response
 * with no call; a miss calls through, writes the entry, and returns. An entry
 * that cannot be parsed is a miss and is overwritten. A write that fails is
 * reported on stderr and in `writeFailures`, and the response still comes
 * back -- the run continues, it just cannot be stamped replayable.
 */
export function withProposalCache(
  inner: ProposalClient,
  opts: { dir?: string; sample?: number } = {},
): CachedProposalClient {
  const dir = opts.dir ?? CACHE_DIR
  const sample = opts.sample ?? 0
  const keys: string[] = []
  const writeFailures: string[] = []
  return {
    keys,
    writeFailures,
    beta: {
      messages: {
        parse: async (body: ParseBody) => {
          const key = cacheKeyFor(body, sample)
          keys.push(key)
          const hit = readEntry(pathFor(dir, key))
          if (hit !== undefined) return hit.response as ParseResult
          const response = await inner.beta.messages.parse(body)
          const entry: CacheEntry = {
            key, createdAt: new Date().toISOString(), sample,
            request: JSON.parse(JSON.stringify(body)) as unknown,
            response: toCached(response),
          }
          try {
            mkdirSync(dir, { recursive: true })
            writeFileSync(pathFor(dir, key), `${JSON.stringify(entry, null, 2)}\n`, "utf8")
          } catch (err) {
            writeFailures.push(key)
            console.error(`could not write ${pathFor(dir, key)}: ${err instanceof Error ? err.message : String(err)}`)
          }
          return response
        },
      },
    },
  }
}

/**
 * A client that never calls anything: a hit is served, a miss is an error
 * naming the key, and an entry that cannot be parsed is an error naming the
 * file -- a miss is already fatal here, so nothing is silently a miss.
 */
export function cacheOnlyClient(opts: { dir?: string } = {}): CachedProposalClient {
  const dir = opts.dir ?? CACHE_DIR
  const keys: string[] = []
  return {
    keys,
    writeFailures: [],
    beta: {
      messages: {
        parse: async (body: ParseBody) => {
          const key = cacheKeyFor(body, 0)
          keys.push(key)
          const file = pathFor(dir, key)
          if (!existsSync(file)) throw new Error(`replay: no cached response for ${key}`)
          let entry: CacheEntry
          try {
            entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry
          } catch (err) {
            throw new Error(`replay: ${file} is not a cache entry: ${err instanceof Error ? err.message : String(err)}`)
          }
          return entry.response as ParseResult
        },
      },
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/provenance/proposal-cache.test.ts`
Expected: 13 passed. Then `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/provenance/proposal-cache.ts src/provenance/proposal-cache.test.ts
git commit -m "feat(provenance): a content-addressed cache around the proposer, keyed by the request itself

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: the manifest type, the default client, and the determinism gate

**Files:**
- Modify: `src/types.ts` (add `ReplayManifest`; `Report.replay?`)
- Modify: `src/assay/types.ts` (`Ledger.replay?`, `Refusal.replay?`)
- Modify: `src/assay/cartographer/propose.ts` (export `defaultClient()`)
- Modify: `src/provenance/snapshots.ts` (export `sha256Of`), `src/provenance/backfill.ts` (use it)
- Modify: `src/assay/index.test.ts` (determinism test)

**Interfaces:**
- Produces: `ReplayManifest` in `src/types.ts`:
  ```ts
  export interface ReplayManifest { sample: number; keys: string[]; model: string; candidates: number; threshold: number; conflictMode: "report" | "converge" }
  ```
  `defaultClient(): ProposalClient` from `propose.ts`. `sha256Of(text: string): string` from `snapshots.ts`.

- [ ] **Step 1: Write the failing determinism test**

Append to `src/assay/index.test.ts`, after the last `describe`:

```ts
// Phase 3a: exact replay is only possible if the assay is a pure function of
// its corpus and its client's responses. This pins that with the same stub
// answering every pass identically across two runs. If it ever fails, the
// proposal cache cannot deliver identical reports and --replay is a lie.
describe("assay is deterministic given identical responses", () => {
  it("returns strictly equal results on two runs, generatedAt aside", async () => {
    const corpus: Corpus = {
      subject: "Acme",
      docs: [
        doc({ docId: "a", role: "claimant", text: "Acme guarantees 99.99% uptime for every account." }),
        doc({ docId: "b", role: "independent", text: "Acme has run without incident for the past year." }),
      ],
      failures: [],
    }
    const proposal = {
      type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
      from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
      to: null, rationale: "no independent source confirms this figure", confidence: 0.6,
    }
    const client: ProposalClient = {
      beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [proposal] } }) as never } },
    }
    const strip = (r: AssayResult) => { const { generatedAt: _g, ...rest } = r; return rest }
    const first = await assay(toPinnedCorpus(corpus), { subject: "Acme" }, { client })
    const second = await assay(toPinnedCorpus(corpus), { subject: "Acme" }, { client })
    expect(first.outcome).toBe("ledger")
    expect(strip(second)).toStrictEqual(strip(first))
  })
})
```

Check the file's existing imports: it needs `AssayResult` from `./types.js` and `ProposalClient` from `./cartographer/propose.js`; add whichever is missing.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/assay/index.test.ts -t "deterministic"`
Expected: PASS already — this is a gate, not a feature. If it FAILS, stop the plan and report which field differs; nothing after this task is worth building until it passes.

- [ ] **Step 3: Add the manifest type**

In `src/types.ts`, immediately before `export interface Report {`:

```ts
/**
 * What replays this report: the keys of every cached model response in call
 * order, and the settings that shape the assay without appearing in any
 * request body. Stamped by the CLI after analysis; absent on reports that
 * predate the cache or were made with --no-cache.
 */
export interface ReplayManifest {
  sample: number
  keys: string[]
  model: string
  candidates: number
  threshold: number
  conflictMode: "report" | "converge"
}
```

Add `replay?: ReplayManifest` as the last field of `Report`. In `src/assay/types.ts`, import `ReplayManifest` from `../types.js` (there is already an import from there) and add `replay?: ReplayManifest` as the last field of both `Ledger` and `Refusal`.

- [ ] **Step 4: Export `defaultClient` from the proposer**

In `src/assay/cartographer/propose.ts`, replace the inline client construction inside `proposeRelations`:

```ts
  const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"]
  const client =
    opts.client ??
    (new Anthropic(
      workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
    ) as unknown as ProposalClient)
```

with `const client = opts.client ?? defaultClient()`, and add above `proposeRelations` (keep the existing comment about the identity-linked key with it):

```ts
/**
 * The real client. An identity-linked API key is scoped to a workspace and
 * the API rejects it with a 400 unless the request names one. The header is
 * only sent when the variable is set, so an ordinary key is unaffected.
 */
export function defaultClient(): ProposalClient {
  const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"]
  return new Anthropic(
    workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
  ) as unknown as ProposalClient
}
```

- [ ] **Step 5: One sha256 helper**

In `src/provenance/snapshots.ts`, add and use:

```ts
/** The id of a blob is the sha256 of its content alone. */
export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}
```

and in `putSnapshot` replace `const id = createHash("sha256").update(entry.content, "utf8").digest("hex")` with `const id = sha256Of(entry.content)`. In `src/provenance/backfill.ts`, delete the private `sha256Of` at the bottom and the `createHash` import, and import `sha256Of` from `./snapshots.js` (that import line already brings `putSnapshot, SNAPSHOT_DIR`).

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: clean; 599 tests (598 + the determinism test).

```bash
git add src/types.ts src/assay/types.ts src/assay/cartographer/propose.ts src/provenance/snapshots.ts src/provenance/backfill.ts src/assay/index.test.ts
git commit -m "feat(types): ReplayManifest; the proposer's default client is constructible from outside

Also pins that assay() is deterministic given identical responses, which is
the precondition for exact replay, and shares one sha256Of.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `--replay` and `--no-cache` flags

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli/args.test.ts`

**Interfaces:**
- Produces: `CliOptions.replay?: string`, `CliOptions.noCache: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/cli/args.test.ts`, next to the existing `--refresh` exclusion tests:

```ts
describe("--replay and --no-cache", () => {
  it("parses --replay as a path and --no-cache as a switch", () => {
    expect(parseArgs(["x", "--replay", "r.json"]).replay).toBe("r.json")
    expect(parseArgs(["x", "--replay", "r.json"]).noCache).toBe(false)
    expect(parseArgs(["x", "--no-cache"]).noCache).toBe(true)
    expect(parseArgs(["x"]).replay).toBeUndefined()
  })

  it("refuses --replay with every other mode and with --no-cache", () => {
    expect(() => parseArgs(["x", "--replay", "r.json", "--from-fixture", "f.json"]))
      .toThrow("receipts: --replay rebuilds the report's corpus from snapshots/; it cannot take --from-fixture")
    expect(() => parseArgs(["x", "--replay", "r.json", "--refresh", "s.json"]))
      .toThrow("receipts: --replay and --refresh are different modes; pass one")
    expect(() => parseArgs(["x", "--replay", "r.json", "--render", "s.json"]))
      .toThrow("receipts: --replay and --render are different modes; pass one")
    expect(() => parseArgs(["x", "--replay", "r.json", "--fetch-only", "--snapshot", "s.json"]))
      .toThrow("receipts: --replay and --fetch-only are different modes; pass one")
    expect(() => parseArgs(["x", "--replay", "r.json", "--snapshot", "s.json"]))
      .toThrow("receipts: --snapshot saves a fresh fetch; --replay fetches nothing")
    expect(() => parseArgs(["x", "--replay", "r.json", "--no-cache"]))
      .toThrow("receipts: --replay reads the proposal cache; it means nothing with --no-cache")
  })

  it("refuses --no-cache on a run that makes no model call", () => {
    const msg = "receipts: --no-cache skips the proposal cache on a model call; this run makes none"
    expect(() => parseArgs(["x", "--no-cache", "--render", "r.json"])).toThrow(msg)
    expect(() => parseArgs(["x", "--no-cache", "--fetch-only", "--snapshot", "s.json"])).toThrow(msg)
    expect(() => parseArgs(["x", "--no-cache", "--refresh", "r.json"])).toThrow(msg)
    expect(parseArgs(["x", "--no-cache", "--refresh", "r.json", "--rerun"]).noCache).toBe(true)
  })
})
```

Also: every existing full-object `toEqual` assertion on `parseArgs` output in this file gains `noCache: false` (a required boolean was added, as `rerun: false` was in 2b-ii). Add it; do not loosen any assertion.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/cli/args.test.ts`
Expected: FAIL — `--replay` is not a known flag.

- [ ] **Step 3: Implement**

In `src/cli/args.ts`:
- `CliOptions`: after `rerun: boolean` add
  ```ts
  /** Rebuild a saved report from snapshots/ and cache/proposals/ and compare. No fetch, no model, no key. */
  replay?: string
  /** Neither read nor write the proposal cache; the report is not replayable. */
  noCache: boolean
  ```
- `VALUE_FLAGS`: append `"--replay"`. `BOOL_FLAGS`: append `"--no-cache"`.
- After the `--refresh`/`--snapshot` exclusion (the last one before `return`):
  ```ts
  const replay = values.get("--replay")
  const noCache = seen.has("--no-cache")
  if (replay !== undefined) {
    if (fromFixture !== undefined) {
      throw new Error("receipts: --replay rebuilds the report's corpus from snapshots/; it cannot take --from-fixture")
    }
    if (refresh !== undefined) throw new Error("receipts: --replay and --refresh are different modes; pass one")
    if (render !== undefined) throw new Error("receipts: --replay and --render are different modes; pass one")
    if (fetchOnly) throw new Error("receipts: --replay and --fetch-only are different modes; pass one")
    if (snapshot !== undefined) throw new Error("receipts: --snapshot saves a fresh fetch; --replay fetches nothing")
    if (noCache) throw new Error("receipts: --replay reads the proposal cache; it means nothing with --no-cache")
  }
  // --render, --fetch-only and a plain --refresh never call the model, so
  // there is no cache read to skip; saying so beats accepting a flag that
  // silently does nothing.
  if (noCache && (render !== undefined || fetchOnly || (refresh !== undefined && !rerun))) {
    throw new Error("receipts: --no-cache skips the proposal cache on a model call; this run makes none")
  }
  ```
- In the returned object, after `rerun,`: `...(replay !== undefined ? { replay } : {}),` and `noCache,`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/cli/args.test.ts && npm run typecheck`
Expected: all pass, clean. (`src/cli/index.ts` reads `opts.noCache` nowhere yet; that is Task 5.)

```bash
git add src/cli/args.ts src/cli/args.test.ts
git commit -m "feat(cli): --replay and --no-cache flags

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `runReplay`

**Files:**
- Create: `src/cli/replay.ts`
- Create: `src/cli/replay.test.ts`

**Interfaces:**
- Consumes: `cacheOnlyClient`, `withProposalCache`, `canonicalJson`, `CachedProposalClient` (Task 1); `ReplayManifest` (Task 2); `sha256Of`, `getSnapshot` from `snapshots.ts`; `storeCorpus`; `toPinnedCorpus`; `assay`; `isRefusal`.
- Produces (Tasks 5 and 6 rely on these):
  ```ts
  export interface ReplayDeps { snapshot: typeof getSnapshot; client: CachedProposalClient }
  export interface ReplayOutcome { identical: boolean; diff: string[]; result: AssayResult; replayed: number }
  export function diffJson(before: unknown, after: unknown, path?: string): string[]
  export async function runReplay(reportPath: string, deps?: ReplayDeps): Promise<ReplayOutcome>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/cli/replay.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/cli/replay.test.ts`
Expected: FAIL — cannot resolve `./replay.js`.

- [ ] **Step 3: Write the module**

```ts
// src/cli/replay.ts
import { readFileSync } from "node:fs"
import { toPinnedCorpus } from "../assay/adapt.js"
import { assay } from "../assay/index.js"
import type { AssayResult, Refusal } from "../assay/types.js"
import { cacheOnlyClient, canonicalJson, type CachedProposalClient } from "../provenance/proposal-cache.js"
import { getSnapshot, sha256Of } from "../provenance/snapshots.js"
import type { Corpus, FetchedDoc, Report } from "../types.js"

/** The disk and the model, injected: the CLI passes the real store and a cache-only client. */
export interface ReplayDeps {
  snapshot: typeof getSnapshot
  client: CachedProposalClient
}

export interface ReplayOutcome {
  identical: boolean
  /** One line per differing leaf, `path: before → after`. Empty when identical. */
  diff: string[]
  result: AssayResult
  /** Responses served from the cache. */
  replayed: number
}

/**
 * Rebuild a saved report from committed bytes alone and say whether the
 * reproduction is the report. No network, no model call, no key.
 *
 * The report is the manifest: its documents' pins name the blobs, its
 * `replay` block names the settings, and the cache holds the responses. The
 * four refusals below are the four ways a report can fail to be that
 * manifest, checked before any other work.
 */
export async function runReplay(
  reportPath: string,
  deps: ReplayDeps = { snapshot: getSnapshot, client: cacheOnlyClient() },
): Promise<ReplayOutcome> {
  const saved = JSON.parse(readFileSync(reportPath, "utf8")) as Report | Refusal
  if (saved.replay === undefined) {
    throw new Error(
      `receipts: ${reportPath} is not replayable: no proposal cache recorded — ` +
        `generated before the cache existed, or with --no-cache`,
    )
  }
  const uncommitted = saved.docs.filter((d) => d.pin === undefined || d.pin.kind === "hash" || d.kind === undefined)
  if (uncommitted.length > 0) {
    const n = uncommitted.length
    throw new Error(
      `receipts: ${reportPath} is not replayable: ${n} document${n === 1 ? "'s" : "s'"} bytes were never committed ` +
        `(${uncommitted.map((d) => d.label).join(", ")})`,
    )
  }

  // Every field of the rebuilt document comes from the report, not the blob:
  // a blob's own fetchedAt is its first capture's, which can predate the run
  // that produced this report if an earlier run committed the same bytes.
  const docs: FetchedDoc[] = saved.docs.map((d) => {
    const sha = d.pin!.sha256
    let entry
    try {
      entry = deps.snapshot(sha)
    } catch {
      throw new Error(`receipts: ${reportPath} is not replayable: "${d.label}" snapshot ${sha} is not in the store`)
    }
    const actual = sha256Of(entry.content)
    if (actual !== sha) {
      throw new Error(`receipts: snapshot ${sha} does not match its own id (${actual}) — the store is corrupt`)
    }
    return {
      docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind!,
      fetchedAt: d.fetchedAt, title: d.label, text: entry.content,
      ...(d.stability !== undefined ? { stability: d.stability } : {}),
      ...(d.via !== undefined ? { via: d.via } : {}),
    }
  })
  const corpus: Corpus = {
    subject: saved.subject, docs, failures: saved.failures,
    ...(saved.labels ? { labels: saved.labels } : {}),
  }

  const { candidates, threshold, conflictMode } = saved.replay
  const result = await assay(
    toPinnedCorpus(corpus, { isStored: () => true }),
    { subject: saved.subject },
    { client: deps.client, candidates, threshold, conflictMode },
  )

  const diff = diffJson(comparable(saved), comparable(result))
  return { identical: diff.length === 0, diff, result, replayed: deps.client.keys.length }
}

/** The report minus the two fields a reproduction cannot share: when it ran, and what replays it. */
function comparable(r: Report | Refusal | AssayResult): unknown {
  const { generatedAt: _when, replay: _how, ...rest } = r as Record<string, unknown>
  return JSON.parse(canonicalJson(rest))
}

/**
 * Every leaf that differs, as `path: before → after`. Arrays are compared
 * index by index after one line for a length change, so a dropped row reads
 * as `rows.length: 26 → 25` and not as twenty-five shifted rows.
 */
export function diffJson(before: unknown, after: unknown, path = ""): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: string[] = []
    if (before.length !== after.length) out.push(`${path}.length: ${before.length} → ${after.length}`)
    const n = Math.min(before.length, after.length)
    for (let i = 0; i < n; i++) out.push(...diffJson(before[i], after[i], `${path}[${i}]`))
    return out
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((k) => diffJson(before[k], after[k], path === "" ? k : `${path}.${k}`))
  }
  if (canonicalJson(before) === canonicalJson(after)) return []
  return [`${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}
```

Note `JSON.stringify(undefined)` is `undefined`, which the template renders as the text `undefined` — that is what the `a.c: undefined → 2` test expects.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli/replay.test.ts && npm run typecheck`
Expected: 9 passed; clean. If `replayed` is 0 on the first test, `selectCandidates` gave the independent document no candidates and `planPasses` made one pass — read `src/assay/index.ts` ~lines 36–44 and `propose.ts` `planPasses` before changing anything; the test asserts `> 0`, and one pass is still > 0.

- [ ] **Step 5: Commit**

```bash
git add src/cli/replay.ts src/cli/replay.test.ts
git commit -m "feat(cli): runReplay rebuilds a report from snapshots and the cache, and diffs it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: wire the CLI

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/replay.test.ts` (one child-process test appended)

**Interfaces:**
- Consumes: `withProposalCache`, `CACHE_DIR` (Task 1); `defaultClient`, `MODEL` from `propose.ts`; `DEFAULT_THRESHOLD` from `src/assay/types.ts`; `runReplay` (Task 4); `opts.replay`, `opts.noCache` (Task 3).

- [ ] **Step 1: Write the failing child-process test**

Append to `src/cli/replay.test.ts`:

```ts
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

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
})
```

Move the three `node:` imports to the top of the file with the others.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/cli/replay.test.ts -t "from the CLI"`
Expected: FAIL — today the run dies on `SOLARI_API_KEY is not set` (the flag parses, nothing dispatches on it, the fetch path is reached).

- [ ] **Step 3: Wire it**

In `src/cli/index.ts`:

1. Imports: `import { defaultClient, MODEL } from "../assay/cartographer/propose.js"`, `import { DEFAULT_THRESHOLD } from "../assay/types.js"` (merge with the existing import from that module), `import { CACHE_DIR, withProposalCache } from "../provenance/proposal-cache.js"`, `import { runReplay } from "./replay.js"`.

2. USAGE, after the `--rerun` lines:
   ```
     --replay <report.json>  rebuild that report from snapshots/ and cache/proposals/
                             and say whether the result is identical. No fetch, no
                             model, no key. Exit 0 identical, 1 different or not replayable.
     --no-cache              neither read nor write the proposal cache; fresh samples,
                             and a report that cannot be replayed.
   ```
   and change the key lines to `SOLARI_API_KEY     required unless --from-fixture, --render or --replay` and `ANTHROPIC_API_KEY  required unless --fetch-only, --render, --replay, or --refresh without --rerun`.

3. The `--replay` dispatch, immediately after the `--render` block's closing `}` and before the ANTHROPIC key check:
   ```ts
   // Rebuild a saved report from committed bytes alone. No fetch, no model,
   // no key. Output is one line or a diff, small enough to fall off the end
   // of the module and let stdout flush; the fresh-run body below is guarded
   // on !opts.replay.
   if (opts.replay) {
     try {
       const { identical, diff, replayed } = await runReplay(opts.replay)
       if (identical) {
         console.log(`replay: identical (${replayed} response${replayed === 1 ? "" : "s"} from cache)`)
         process.exitCode = 0
       } else {
         console.error(`replay: ${opts.replay} differs from its reproduction in ${diff.length} place(s) -- a finding, not a failure`)
         for (const line of diff) console.log(line)
         process.exitCode = 1
       }
     } catch (err) {
       die(err instanceof Error ? err.message : String(err))
     }
   }
   ```

4. The ANTHROPIC key check: condition becomes `if (!opts.replay && !opts.fetchOnly && !(opts.refresh && !opts.rerun) && !process.env.ANTHROPIC_API_KEY)`; its comment gains "and --replay, which reads the cache instead of the model"; the die text becomes `"ANTHROPIC_API_KEY is not set. Every run calls the model, unless --fetch-only, --replay, or --refresh without --rerun."`.

5. The fresh-run guard `if (!opts.refresh || opts.rerun) {` becomes `if (!opts.replay && (!opts.refresh || opts.rerun)) {`.

6. Inside the fresh-run body, immediately before `let report` / the `analyzeCorpus` try:
   ```ts
   // Every model call goes through the content-addressed cache unless told
   // not to: a second run over identical bytes and settings is free and
   // identical, and the report records what replays it.
   const proposer = opts.noCache ? defaultClient() : withProposalCache(defaultClient(), { sample: 0 })
   ```
   and pass `client: proposer,` in the `analyzeCorpus` options.

7. After the `analyzeCorpus` try/catch and before `console.log(opts.asJson ? …)`:
   ```ts
   // The stamp makes the report replayable, so it is only written when every
   // response is on disk. A --no-cache run and a run with a failed cache write
   // both say why they carry none.
   if (opts.noCache) {
     console.error("not replayable: --no-cache")
   } else if ("writeFailures" in proposer && proposer.writeFailures.length > 0) {
     console.error(`not replayable: ${proposer.writeFailures.length} response(s) could not be written to ${CACHE_DIR}/`)
   } else if ("keys" in proposer) {
     report.replay = {
       sample: 0, keys: proposer.keys, model: MODEL, candidates: opts.candidates,
       threshold: DEFAULT_THRESHOLD, conflictMode: "report",
     }
     console.error(`  cache      ${proposer.keys.length} response(s) in ${CACHE_DIR}/`)
   }
   ```
   `threshold` and `conflictMode` are the values `analyzeCorpus` defaults to today (the CLI passes neither); if a later flag ever sets them, this stamp must read the same source. Say so in the comment.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/cli && npm run typecheck`
Expected: all pass (the new test now sees the refusal sentence), clean. Then, by reading: trace `--refresh --rerun` — it enters the same body, so it gets the cached proposer and the stamp, and the write-back at the end persists the stamp. Trace `--no-cache --refresh --rerun` — raw client, no stamp, the stderr line. Trace `--json`: the stamp is set before the `console.log`, so it is in the JSON. Trace plain `--replay`: the key check and the fresh-run body are both skipped, nothing after the dispatch runs.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/replay.test.ts
git commit -m "feat(cli): every model call through the cache; the report records what replays it; --replay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `replay-all` and CI

**Files:**
- Create: `src/cli/replay-all.ts`
- Create: `src/cli/replay-all.test.ts`
- Modify: `package.json` (one script)
- Create: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-09-11-proposal-cache-replay-design.md` (two path mentions)

**Interfaces:**
- Consumes: `runReplay`, `ReplayOutcome` (Task 4).
- Produces:
  ```ts
  export interface ReplayAllResult { replayed: string[]; skipped: string[]; differed: Map<string, string[]>; failed: Map<string, string> }
  export async function replayAll(dir: string, run?: (path: string) => Promise<ReplayOutcome>): Promise<ReplayAllResult>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/cli/replay-all.test.ts
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
  it("skips every committed report: none carries a replay block yet", async () => {
    let calls = 0
    const r = await replayAll(join(REPO, "reports"), async () => { calls++; return outcome(true) })
    expect(calls).toBe(0)
    expect(r.replayed).toEqual([])
    expect(r.skipped).toEqual(["chime.json", "claude.json", "tesla-fsd.json", "vercel.json"])
    expect(r.differed.size).toBe(0)
    expect(r.failed.size).toBe(0)
  })

  it("runs only reports with a replay block, and sorts them into replayed, differed and failed", async () => {
    writeFileSync(join(dir, "same.json"), JSON.stringify({ replay: { keys: [] } }))
    writeFileSync(join(dir, "changed.json"), JSON.stringify({ replay: { keys: [] } }))
    writeFileSync(join(dir, "broken.json"), JSON.stringify({ replay: { keys: [] } }))
    writeFileSync(join(dir, "old.json"), JSON.stringify({ rows: [] }))
    writeFileSync(join(dir, "notes.txt"), "ignored")
    mkdirSync(join(dir, "measurements"))
    const r = await replayAll(dir, async (path) => {
      if (path.endsWith("same.json")) return outcome(true)
      if (path.endsWith("changed.json")) return outcome(false, ['rows[0].status: "divergent" → "unverified"'])
      throw new Error("replay: no cached response for abc")
    })
    expect(r.replayed).toEqual(["same.json"])
    expect(r.skipped).toEqual(["old.json"])
    expect([...r.differed.entries()]).toEqual([["changed.json", ['rows[0].status: "divergent" → "unverified"']]])
    expect([...r.failed.entries()]).toEqual([["broken.json", "replay: no cached response for abc"]])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/cli/replay-all.test.ts`
Expected: FAIL — cannot resolve `./replay-all.js`.

- [ ] **Step 3: Write the script**

```ts
// src/cli/replay-all.ts
#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { runReplay, type ReplayOutcome } from "./replay.js"

export interface ReplayAllResult {
  replayed: string[]
  /** Reports with no replay block -- every committed one, today. */
  skipped: string[]
  differed: Map<string, string[]>
  failed: Map<string, string>
}

/**
 * Replay every report in a directory that carries a replay block. The
 * count of those that do not is printed, not hidden: on the day this ships
 * it is all of them, and CI saying "0 replayed" is the honest state.
 */
export async function replayAll(
  dir: string,
  run: (path: string) => Promise<ReplayOutcome> = (path) => runReplay(path),
): Promise<ReplayAllResult> {
  const out: ReplayAllResult = { replayed: [], skipped: [], differed: new Map(), failed: new Map() }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  for (const file of files) {
    const path = join(dir, file)
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay?: unknown }
    if (saved.replay === undefined) {
      out.skipped.push(file)
      continue
    }
    try {
      const r = await run(path)
      if (r.identical) out.replayed.push(file)
      else out.differed.set(file, r.diff)
    } catch (err) {
      out.failed.set(file, err instanceof Error ? err.message : String(err))
    }
  }
  return out
}

// Guarded like src/provenance/backfill-cli.ts: importable by a test without running.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const r = await replayAll(process.argv[2] ?? "reports")
  console.log(`${r.replayed.length} replayed, ${r.skipped.length} not replayable`)
  for (const [file, diff] of r.differed) {
    console.log(`${file} differs from its reproduction in ${diff.length} place(s):`)
    for (const line of diff) console.log(`  ${line}`)
  }
  for (const [file, message] of r.failed) console.error(`${file}: ${message}`)
  process.exitCode = r.differed.size + r.failed.size > 0 ? 1 : 0
}
```

- [ ] **Step 4: The script entry and the workflow**

`package.json` scripts, after `"backfill"`: `"replay": "tsx src/cli/replay-all.ts"`.

`.github/workflows/ci.yml`:
```yaml
# Typecheck, the suite, and a replay of every committed report that can be
# replayed. No browsers, no model call, no API keys: everything here runs
# from the repo alone. The replay step prints "N replayed, M not replayable"
# -- on the day this landed, N was 0, because every committed report predates
# the proposal cache. That number is the point of the job, not a failure.
name: ci

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run replay
```

In the spec, replace the two mentions of `scripts/replay-all.ts` with `src/cli/replay-all.ts` and note `npm run replay` — it lives under `src/` so `tsconfig`'s `include` typechecks it, like `backfill-cli.ts`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/cli/replay-all.test.ts && npm run typecheck && npm run replay`
Expected: 2 passed; clean; the script prints `0 replayed, 4 not replayable` and exits 0 (`echo $?` in bash).

- [ ] **Step 6: Commit**

```bash
git add src/cli/replay-all.ts src/cli/replay-all.test.ts package.json .github/workflows/ci.yml docs/superpowers/specs/2026-09-11-proposal-cache-replay-design.md
git commit -m "ci: typecheck, test, and replay every replayable report -- today, none

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: document it

**Files:**
- Modify: `README.md`

- [ ] **Step 1: The section**

Under "What a pin is, and what is actually stable", after the `### Refreshing a ledger` section and before the `toPinnedCorpus` paragraph, add `### Replaying a ledger`, in this order, each claim traceable to code you have read:

1. What the cache is: every model response a CLI run makes is written to `cache/proposals/<sha256>.json`, keyed by the request that produced it — model, system prompt, the excerpts, `max_tokens`, the output schema — so any change to any of them is a miss with no version number to bump. The entry stores the request too. Committed, like `snapshots/`.
2. What a hit means: a second run over byte-identical bytes with the same settings makes no model call and produces an identical ledger; `--no-cache` forces fresh samples and neither reads nor writes.
3. What a report records: `replay: { sample, keys, model, candidates, threshold, conflictMode }`, stamped after analysis only when every response was written.
4. `--replay <report.json>`: rebuilds the corpus from `snapshots/` by the report's pins, verifies every blob against its id, runs the assay with the cached responses and the recorded settings, compares everything but `generatedAt` and `replay`. Exit `0` identical; `1` with a path-per-line diff when not (`rows[3].status: "divergent" → "unverified"`) — a finding, not a failure; `1` with one sentence when the report is not replayable: no `replay` block, a `hash`-pinned document, a missing blob, a blob that does not match its id, a missing cached response.
5. CI: `.github/workflows/ci.yml` runs typecheck, the suite, and `npm run replay` on every push, printing `N replayed, M not replayable`.
6. The honest limit, plainly: **no committed report is replayable.** All four predate the cache and the model's past responses were not recorded, so `--replay` refuses each with the sentence above and CI prints `0 replayed, 4 not replayable`. The path is proven end to end on a stub-driven corpus (`src/cli/replay.test.ts`): a ledger and a refusal, both reproduced identically; a mutated row, a missing blob, a tampered blob, a pruned cache entry, each caught. The first run through the CLI after this — planned: one paid `--refresh --rerun` — produces the first replayable report.

- [ ] **Step 2: The caveat and the rest**

- "What it costs": the paragraph beginning **One caveat worth stating plainly:** currently says results vary between runs. Rewrite: they vary when the corpus or the settings differ, or with `--no-cache`; over a byte-identical corpus with the same settings a run is served from the cache and is identical. Keep the "treat it as a lead, not a verdict" sentence — the first sample is still one sample.
- "Refreshing a ledger", the `--rerun` paragraph: add that a rerun goes through the cache and its ledger is replayable.
- Development: `cache/proposals/` beside `snapshots/` (does not exist in the repo until the first run; created by the CLI); `npm run replay`; the CI workflow. Test count: the number `npm test` prints.
- USAGE in `src/cli/index.ts` was updated in Task 5; confirm the README's flag descriptions agree with it.

- [ ] **Step 3: Verify every sentence**

Re-read the section against `src/provenance/proposal-cache.ts`, `src/cli/replay.ts`, `src/cli/index.ts`'s dispatch and stamp, and `src/cli/replay-all.ts`. Nothing may say a real report was replayed. Run `npm test` and put its count in the Development section.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): the proposal cache, --replay, and why no committed report replays yet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| `canonicalJson`, `cacheKeyFor` with `sample` | 1 |
| `withProposalCache`: hit, miss, corrupt→miss, write failure→warn+continue, `keys`, request stored, `usage` stored | 1 |
| `cacheOnlyClient`: miss throws naming key, corrupt throws naming file | 1 |
| `ReplayManifest` on `Report`, `Ledger`, `Refusal` | 2 |
| Assay determinism asserted | 2 |
| `--replay`, `--no-cache`, all exclusions | 3 |
| `runReplay`: four refusals in order, rebuild from report+blobs, `isStored: () => true`, recorded settings, equality minus two fields, path diff, refusals replay | 4 |
| CLI: cached client on the fresh path (and therefore `--refresh --rerun`), the stamp, the not-replayable stderr lines, `--replay` dispatch and exit codes, key exemption | 5 |
| `replay-all`, `npm run replay`, `ci.yml` | 6 |
| README section, caveat rewrite, Development | 7 |
| MCP/web untouched | — (no task touches them) |
| No committed report replayable; `snapshots/` 26 | Global constraints |

**Deliberately not done.** The spec's `scripts/replay-all.ts` path became `src/cli/replay-all.ts` so `tsconfig` typechecks it (Task 6 amends the spec). `--replay` does not compare `client.keys` to `replay.keys` — the result diff already catches any difference that matters. `usage` is written, never read.

**Placeholder scan.** None. Every step with code shows the code; every message is spelled out.

**Type consistency.** `CachedProposalClient { keys; writeFailures }` is declared in Task 1 and read by name in Tasks 4 (`deps.client.keys.length`), 5 (`proposer.keys`, `proposer.writeFailures`). `ReplayManifest` fields `{ sample, keys, model, candidates, threshold, conflictMode }` are declared in Task 2, stamped in Task 5 and the Task 4 test, read in Task 4 (`saved.replay`). `runReplay(reportPath, deps?) → ReplayOutcome { identical, diff, result, replayed }` is declared in Task 4 and consumed in Tasks 5 and 6 with those names. `replayAll(dir, run?)` in Task 6 matches its test. `sha256Of` from `snapshots.ts` (Task 2) is used in Task 4. `defaultClient`, `MODEL` (Task 2) are used in Task 5.

**Three risks worth naming.**
1. **The determinism gate (Task 2 Step 2).** If `assay` is not a pure function of its responses — a `Date`, a `Math.random`, a `Set` iteration that depends on insertion order across runs — replay can never be exact. The test is placed before anything depends on it.
2. **The stamp's `threshold`/`conflictMode` come from constants, not from `analyzeCorpus`'s options** (Task 5 Step 3.7), because the CLI passes neither today. A future `--threshold` flag must update both or replay will silently use the wrong floor. The comment says so.
3. **`fetchedAt` on the rebuilt document comes from the report, not the blob** (Task 4). The blob's `fetchedAt` is its first capture's and can predate the run. Getting this wrong makes every replay of a re-fetched-identical-bytes report differ on `docs[i].fetchedAt`, which would look like a real finding.

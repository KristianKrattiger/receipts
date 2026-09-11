# Live Snapshots (Phase 2b-i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every live run write its documents' bytes into the content-addressed store, and make a pin say `snapshot` once its blob is committed — so a report's pins resolve to something, and Phase 3's replay can tell which documents are actually reconstructable.

**Architecture:** `toPinnedCorpus` stays pure; the store write happens in the CLI before analysis, which is where the spec's architecture diagram puts the provenance layer. `resolvePin` gains a `stored` flag and a third outcome. `toPinnedCorpus` accepts an injected `isStored` predicate, so the pure function learns what is on disk without touching disk.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, tsx, `node:crypto`, `node:fs`. No new dependencies.

## Global Constraints

- Node ESM: every relative import ends in `.js`, never `.ts`.
- Tests live beside sources as `*.test.ts`. Runner: `npm test` (`vitest run`). Typecheck: `npm run typecheck`.
- `npm test` must pass at the end of every task. It is **527 tests in 33 files** before this plan starts.
- No new runtime dependencies.
- **The four committed `reports/*.json` must render byte-identically and exit 0 throughout.** Tesla's audit line must keep reading:
  `audit: proposed 59 over 9 passes · admitted 26 · denied 33 (5 NOT_QUERY_RELEVANT, 15 LOW_CONFIDENCE, 13 DUPLICATE)`
- `npm run site -- reports/*.json` must keep succeeding.
- **Every one of the 26 committed blobs must keep resolving.** No task may change a `pin.sha256`, delete a blob, or rewrite one. Verify after every task that changes a report.
- Use the codebase's conditional-spread convention (`...(x !== undefined ? { x } : {})`) for optional fields so an absent field stays absent in JSON.
- `toPinnedCorpus` must remain a **pure function** — no filesystem access inside it. That is a load-bearing decision from Phase 2a, not an accident.

### The bug this phase fixes

Nothing writes to the snapshot store on a live run. `putSnapshot` has exactly one non-test caller — `src/provenance/backfill.ts`. So `npm run cli -- tesla` today produces a report whose `pin.sha256` values resolve to no blob, orphaning the ten committed Tesla blobs. The store exists only because the backfill filled it once.

### The understatement this phase corrects

`src/types.ts` defines the three pin kinds: `permalink` is a URL permanent by construction; **`snapshot` is a committed content-addressed blob**; `hash` "records only what the bytes were, which is enough to detect drift and **not enough to replay**."

Measured against the committed reports: **1 permalink, 0 snapshot, 25 hash — and all 25 of those hash pins have a committed blob.** Every one is replayable, and every one claims not to be. `snapshot` is emitted nowhere in the codebase. Phase 3's replay check needs this distinction to mean something.

### Precedence, decided before planning

`permalink` > `snapshot` > `hash`. A permanent URL is the stronger claim and wins even when the blob is also stored; replay looks documents up by `pin.sha256` regardless of kind, so nothing is lost.

**A `snapshot` pin must NOT promote a document to `stable`.** A committed blob makes a document *replayable*; it says nothing about whether the source will still serve those bytes tomorrow. Stability and replayability are different properties and this plan keeps them apart. `stabilityFor` is unchanged — but its `snapshot` cell is currently untested, which a prior review flagged, and Task 1 closes that.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/provenance/store.ts` | `storeCorpus(corpus, dir?) → string[]` — write every fetched document's bytes into the store, returning the blob ids |
| `src/provenance/store.test.ts` | tests |

**Modified:**

| File | Change |
|---|---|
| `src/provenance/pin.ts` | `resolvePin` gains a `stored` flag and can return `{kind:"snapshot"}` |
| `src/provenance/pin.test.ts` | cover the new outcome and the precedence |
| `src/provenance/classify.test.ts` | cover the `snapshot` pin cell of `stabilityFor` |
| `src/assay/adapt.ts` | `toPinnedCorpus` accepts an injected `isStored` predicate |
| `src/assay/adapt.test.ts` | cover the predicate |
| `src/pipeline.ts` | thread the predicate through `analyzeCorpus` |
| `src/cli/index.ts` | write the store before analysing |
| `src/provenance/backfill.ts` | pass `stored: true` — it has just written the blob |
| `src/provenance/backfill.test.ts` | assert the pin is now `snapshot` |
| `reports/{tesla-fsd,claude,vercel}.json` | re-pinned by re-running the backfill (Task 5) |
| `README.md` | correct what the store and the pin kinds now mean |

**Deleted:** none.

---

### Task 1: a pin can say its blob is committed

**Files:**
- Modify: `src/provenance/pin.ts`, `src/provenance/pin.test.ts`, `src/provenance/classify.test.ts`

**Interfaces:**
- Consumes: `Pin` from `src/types.js` (re-exported by `src/assay/types.js`).
- Produces: `resolvePin(url: string, sha256: string, stored?: boolean): Pin`. Default `stored = false`, so every existing caller keeps its current behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `src/provenance/pin.test.ts`:

```ts
describe("a stored blob earns a snapshot pin", () => {
  it("pins an ordinary url as snapshot when its blob is committed", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H, true))
      .toEqual({ kind: "snapshot", sha256: H })
  })

  it("still pins an ordinary url as hash when the blob is not committed", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H, false))
      .toEqual({ kind: "hash", sha256: H })
  })

  it("defaults to hash when the caller says nothing about storage", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H))
      .toEqual({ kind: "hash", sha256: H })
  })

  it("keeps permalink ahead of snapshot when a permanent url is also stored", () => {
    expect(resolvePin(TESLA_10K, H, true))
      .toEqual({ kind: "permalink", url: TESLA_10K, sha256: H })
  })
})
```

Append to `src/provenance/classify.test.ts`:

```ts
describe("stabilityFor — a snapshot pin does not confer stability", () => {
  const snapshotPin = { kind: "snapshot", sha256: "ab" } as const

  it("leaves an undeclared document volatile when its blob is committed", () => {
    expect(stabilityFor(undefined, snapshotPin)).toBe("volatile")
  })

  it("honours an explicit stable declaration alongside a snapshot pin", () => {
    expect(stabilityFor("stable", snapshotPin)).toBe("stable")
  })

  it("honours an explicit volatile declaration alongside a snapshot pin", () => {
    expect(stabilityFor("volatile", snapshotPin)).toBe("volatile")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/pin.test.ts src/provenance/classify.test.ts
```
Expected: the four `pin.test.ts` cases fail (the third argument is ignored, so the `snapshot` case returns `hash`). The three `classify.test.ts` cases should PASS already — `stabilityFor` promotes only on `permalink`, so a `snapshot` pin already leaves a document volatile. They are a regression guard for a cell nothing previously exercised, not a change; say so in your report.

- [ ] **Step 3: Add the parameter**

In `src/provenance/pin.ts`, replace `resolvePin`:

```ts
/**
 * The pin for a document we already hold.
 *
 * `sha256` is the raw content hash the caller already computed — this function
 * never rehashes, so a pin cannot disagree with the bytes it describes.
 *
 * A recognized permalink needs no verification fetch: the document in hand WAS
 * fetched at this exact URL, so the bytes at the permalink are the bytes we
 * have, established by the fetch that already happened.
 *
 * `stored` says the caller has committed this content to the snapshot store.
 * Precedence is `permalink` > `snapshot` > `hash`: a permanent URL is the
 * stronger claim and wins even when the blob is also stored, and nothing is
 * lost by that, because replay looks a document up by `pin.sha256` whatever
 * the kind says.
 *
 * It defaults to `false` so a caller that has not stored anything cannot
 * accidentally claim it has.
 */
export function resolvePin(url: string, sha256: string, stored = false): Pin {
  if (isPermanentUrl(url)) return { kind: "permalink", url, sha256 }
  return stored ? { kind: "snapshot", sha256 } : { kind: "hash", sha256 }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/ && npm run typecheck
```
Expected: all pass.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -3
```
Expected: 534 passing (527 + 7).

- [ ] **Step 6: Commit**

```bash
git add src/provenance/pin.ts src/provenance/pin.test.ts src/provenance/classify.test.ts
git commit -m "feat(provenance): a pin can say its blob is committed

snapshot was declared and emitted nowhere, while 25 of 26 committed pins said
hash -- "not enough to replay" -- about documents whose bytes are in the store.
Precedence is permalink > snapshot > hash; a stored blob makes a document
replayable, which is a different property from its source being stable, so a
snapshot pin still confers no stability.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `storeCorpus`

**Files:**
- Create: `src/provenance/store.ts`, `src/provenance/store.test.ts`

**Interfaces:**
- Consumes: `putSnapshot`, `SNAPSHOT_DIR` from `src/provenance/snapshots.js`; `Corpus` from `src/types.js`.
- Produces: `storeCorpus(corpus: Corpus, dir?: string): string[]` — returns the blob ids written or already present, in `corpus.docs` order.

**Why a separate file.** `snapshots.ts` is deliberately domain-agnostic: it knows about `SnapshotEntry`, not about corpora. Keeping the domain-shaped loop out of it preserves that.

**Why it returns ids rather than a count.** The caller needs to know which blobs exist to build the `isStored` predicate, and returning the ids means the caller never recomputes a hash that `putSnapshot` already computed — the same defect a prior review found in the backfill.

- [ ] **Step 1: Write the failing test**

Create `src/provenance/store.test.ts`:

```ts
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getSnapshot } from "./snapshots.js"
import { storeCorpus } from "./store.js"
import type { Corpus, FetchedDoc } from "../types.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "store-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://a.example", label: "A", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-11T00:00:00.000Z", title: "A",
    text: "hello world", ...over,
  }
}

const corpus = (docs: FetchedDoc[]): Corpus => ({ subject: "X", docs, failures: [] })

describe("storeCorpus", () => {
  it("writes one blob per document and returns the ids in order", () => {
    const ids = storeCorpus(corpus([doc({ docId: "a" }), doc({ docId: "b", text: "second" })]), dir)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it("stores each document's own url and fetchedAt with its bytes", () => {
    const ids = storeCorpus(corpus([doc({ url: "https://z.example", fetchedAt: "2027-01-01T00:00:00.000Z" })]), dir)
    expect(getSnapshot(ids[0]!, dir)).toEqual({
      url: "https://z.example", fetchedAt: "2027-01-01T00:00:00.000Z", content: "hello world",
    })
  })

  it("deduplicates two documents with identical text into one blob", () => {
    const ids = storeCorpus(corpus([doc({ docId: "a" }), doc({ docId: "b" })]), dir)
    expect(ids[0]).toBe(ids[1])
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it("returns an empty list and writes nothing for an empty corpus", () => {
    expect(storeCorpus(corpus([]), dir)).toEqual([])
    expect(readdirSync(dir)).toHaveLength(0)
  })

  it("returns ids that are the sha256 of each document's own text", () => {
    const ids = storeCorpus(corpus([doc({ text: "hello world" })]), dir)
    expect(getSnapshot(ids[0]!, dir).content).toBe("hello world")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/store.test.ts
```
Expected: FAIL — `Failed to resolve import "./store.js"`.

- [ ] **Step 3: Write `src/provenance/store.ts`**

```ts
import type { Corpus } from "../types.js"
import { putSnapshot, SNAPSHOT_DIR } from "./snapshots.js"

/**
 * Commit every fetched document's bytes to the content-addressed store.
 *
 * This is the step that was missing: before it, the store's only writer was the
 * backfill, so a live run produced a report whose pins resolved to nothing and
 * orphaned whatever the backfill had put there.
 *
 * It runs in the machinery, not inside `toPinnedCorpus`, because that adapter is
 * a pure function and is worth keeping that way — it is the piece the Assay's
 * input type is built by, and it is tested without a filesystem.
 *
 * Returns the blob ids in `corpus.docs` order, so the caller can tell which
 * content is committed without rehashing anything `putSnapshot` already hashed.
 */
export function storeCorpus(corpus: Corpus, dir: string = SNAPSHOT_DIR): string[] {
  return corpus.docs.map((d) =>
    putSnapshot({ url: d.url, fetchedAt: d.fetchedAt, content: d.text }, dir),
  )
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/store.test.ts && npm run typecheck
```
Expected: 5 passed.

- [ ] **Step 5: Confirm no stray store was created**

```bash
git status --porcelain
```
Expected: only the two new source files. If a `snapshots/` change appears, a test ran against the default path — find it.

- [ ] **Step 6: Commit**

```bash
git add src/provenance/store.ts src/provenance/store.test.ts
git commit -m "feat(provenance): commit a fetched corpus's bytes to the store

The missing writer. Before this the store's only caller was the backfill, so a
live run emitted pins that resolved to nothing. Lives in the machinery rather
than in toPinnedCorpus, which stays pure.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `toPinnedCorpus` learns what is stored, without touching disk

**Files:**
- Modify: `src/assay/adapt.ts`, `src/assay/adapt.test.ts`

**Interfaces:**
- Consumes: `resolvePin(url, sha256, stored?)` from Task 1.
- Produces: `toPinnedCorpus(corpus: Corpus, opts?: { isStored?: (sha256: string) => boolean }): PinnedCorpus`.

**The shape and why.** The predicate is injected rather than read from disk, so `toPinnedCorpus` stays pure and every existing test keeps working with no filesystem. Omitting it means "nothing is known to be stored", which reproduces today's behaviour exactly.

- [ ] **Step 1: Write the failing tests**

Append to `src/assay/adapt.test.ts`:

```ts
describe("toPinnedCorpus — what the caller says is stored", () => {
  it("pins a document as snapshot when the predicate says its blob is committed", () => {
    const pinned = toPinnedCorpus(
      { subject: "X", docs: [doc()], failures: [] },
      { isStored: () => true },
    )
    expect(pinned.docs[0]!.pin.kind).toBe("snapshot")
  })

  it("pins as hash when the predicate says the blob is not committed", () => {
    const pinned = toPinnedCorpus(
      { subject: "X", docs: [doc()], failures: [] },
      { isStored: () => false },
    )
    expect(pinned.docs[0]!.pin.kind).toBe("hash")
  })

  it("pins as hash when no predicate is given at all", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc()], failures: [] })
    expect(pinned.docs[0]!.pin.kind).toBe("hash")
  })

  it("asks the predicate about the document's own raw hash", () => {
    const asked: string[] = []
    toPinnedCorpus(
      { subject: "X", docs: [doc({ text: "hello world" })], failures: [] },
      { isStored: (sha) => { asked.push(sha); return false } },
    )
    expect(asked).toEqual(["b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"])
  })

  it("still leaves a stored document volatile — a blob is not stability", () => {
    const pinned = toPinnedCorpus(
      { subject: "X", docs: [doc()], failures: [] },
      { isStored: () => true },
    )
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/assay/adapt.test.ts -t "what the caller says is stored"
```
Expected: FAIL — `toPinnedCorpus` takes one argument and always pins `hash`.

- [ ] **Step 3: Add the parameter**

In `src/assay/adapt.ts`, change the signature and the `resolvePin` call:

```ts
export function toPinnedCorpus(
  corpus: Corpus,
  opts: { isStored?: (sha256: string) => boolean } = {},
): PinnedCorpus {
```

and inside the `.map()`:

```ts
    const raw = sha256(d.text)
    const pin = resolvePin(d.url, raw, opts.isStored?.(raw) ?? false)
```

Leave everything else in the mapping exactly as it is.

- [ ] **Step 4: Run the full suite**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: 544 passing (539 + 5).

- [ ] **Step 5: Commit**

```bash
git add src/assay/adapt.ts src/assay/adapt.test.ts
git commit -m "feat(assay): let the caller tell toPinnedCorpus what is stored

An injected predicate rather than a filesystem read, so the adapter stays a
pure function and its tests stay filesystem-free. Omitting it means "nothing
is known to be stored", which is exactly today's behaviour.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: the live run writes the store

**Files:**
- Modify: `src/pipeline.ts`, `src/cli/index.ts`

**Interfaces:**
- Consumes: `storeCorpus` (Task 2), `hasSnapshot` from `src/provenance/snapshots.js`, `toPinnedCorpus`'s new `opts` (Task 3).
- Produces: `analyzeCorpus(corpus, opts)` where `opts` gains `isStored?: (sha256: string) => boolean`, threaded through to `toPinnedCorpus`.

**The ordering that makes this work.** The CLI stores the corpus *before* analysing it, so by the time `toPinnedCorpus` asks whether a blob is committed, it is. Doing it the other way round would pin everything `hash` and then write the blobs, which is the current bug with extra steps.

- [ ] **Step 1: Thread the predicate through `src/pipeline.ts`**

Add to the options type and pass it on:

```ts
export async function analyzeCorpus(
  corpus: Corpus,
  opts: {
    client?: ProposalClient
    candidates?: number
    concurrency?: number
    threshold?: number
    conflictMode?: "report" | "converge"
    /** Whether a content hash is already committed to the snapshot store. */
    isStored?: (sha256: string) => boolean
  } = {},
): Promise<AssayResult> {
  return assay(
    toPinnedCorpus(corpus, opts.isStored ? { isStored: opts.isStored } : {}),
    { subject: corpus.subject },
    opts,
  )
}
```

- [ ] **Step 2: Store the corpus in the CLI, before analysing**

In `src/cli/index.ts`, immediately after the read/failure listing loops and **before** the `if (opts.fetchOnly)` block, add:

```ts
// Commit the bytes before analysing, so the pins the report carries resolve to
// blobs that exist. This is the machinery's job, not the adapter's: it is what
// makes a published ledger checkable by anyone with the repo, and without it a
// run emits hashes pointing at nothing.
const storedIds = new Set(storeCorpus(corpus))
console.error(`  snapshots  ${storedIds.size} blob(s) in ${SNAPSHOT_DIR}/`)
```

and import at the top:

```ts
import { SNAPSHOT_DIR } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
```

Then change the `analyzeCorpus` call to pass the predicate:

```ts
  report = await analyzeCorpus(corpus, {
    candidates: opts.candidates,
    isStored: (sha) => storedIds.has(sha),
  })
```

**Place the store write before the `--fetch-only` exit deliberately**: a fetch-only run has paid for the bytes and should keep them. Say so in your report.

- [ ] **Step 3: Run the full suite and typecheck**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: **544 passing**, typecheck silent — unchanged from Task 3, because this task adds no test. The live path needs network and a key, so it is not unit-testable here; Task 5 exercises it end to end against real committed data. **Do not mock the browser fan to manufacture a test — that would test the mock.**

- [ ] **Step 4: Confirm the committed reports and store are untouched**

```bash
git status --porcelain
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json >/dev/null 2>&1; echo "$f exit=$?"
done
```
Expected: only the two modified source files; four `exit=0`. Nothing under `snapshots/` or `reports/` may appear — this task changes the code path, not the data.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts src/cli/index.ts
git commit -m "feat(cli): a live run commits its bytes before analysing

Ordering is the whole point: store first, then pin, so the pins a report
carries resolve to blobs that exist. Before this, every fresh run emitted
hashes pointing at nothing and orphaned whatever the backfill had stored.

Placed before the --fetch-only exit on purpose: that run has already paid for
the bytes and should keep them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: re-pin the backfilled reports

**Files:**
- Modify: `src/provenance/backfill.ts`, `src/provenance/backfill.test.ts`
- Regenerate: `reports/tesla-fsd.json`, `reports/claude.json`, `reports/vercel.json`

**Interfaces:**
- Consumes: `resolvePin(url, sha256, stored?)`.
- Produces: no new exports; the backfill now emits `snapshot` pins for documents it has stored.

**Why this is correct rather than churn.** The backfill writes the blob and then pins the document. It has always known the blob is committed; it just had no way to say so. Those 25 `hash` pins claim "not enough to replay" about documents that are replayable from this repo.

- [ ] **Step 1: Write the failing test**

In `src/provenance/backfill.test.ts`, add to the existing describe block:

```ts
  it("pins a stored document as snapshot, not hash", () => {
    const { report: out } = backfillFromCorpus(corpus, report, dir) as { report: { docs: Record<string, unknown>[] } }
    expect(out.docs[0]!["pin"]).toEqual({
      kind: "snapshot", sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    })
  })
```

If an existing test in that file asserts `{ kind: "hash", … }` for a stored document, update it to `snapshot` — that expectation encodes the bug. Name any test you changed in your report.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/backfill.test.ts
```
Expected: FAIL — the pin is `hash`.

- [ ] **Step 3: Pass `stored: true`**

In `src/provenance/backfill.ts`, change the `resolvePin` call (currently line 41):

```ts
    // `raw` is putSnapshot's return: the blob is committed by the time we pin,
    // so this document is replayable and the pin should say so.
    const pin = resolvePin(fixture.url, raw, true)
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/backfill.test.ts && npm run typecheck
```
Expected: all pass.

- [ ] **Step 5: Capture the rendered output before regenerating**

```bash
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json 2>/dev/null | grep -v '^>' > /tmp/before-$f.txt
done
```

- [ ] **Step 6: Re-run the backfill on the three reports that have a fixture**

```bash
npm run backfill -- fixtures/tesla-fsd.json reports/tesla-fsd.json
npm run backfill -- fixtures/claude.json reports/claude.json
npm run backfill -- fixtures/vercel.json reports/vercel.json
```

**Do not run it against `reports/chime.json`.** There is no `fixtures/chime.json`; the only fixture sharing a docId with it is a probe capture from a different fetch, and backfilling from it would stamp an unearned integrity baseline onto a published ledger.

- [ ] **Step 7: Verify nothing but the pin kind moved**

```bash
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json 2>/dev/null | grep -v '^>' > /tmp/after-$f.txt
  diff -q /tmp/before-$f.txt /tmp/after-$f.txt && echo "$f render identical" || echo "$f RENDER CHANGED"
done
node -e '
const fs=require("fs"),{createHash}=require("crypto");let ok=0,bad=0,kinds={};
for(const f of ["tesla-fsd","claude","vercel","chime"]){
 const r=JSON.parse(fs.readFileSync(`reports/${f}.json`,"utf8"));
 for(const d of r.docs.filter(d=>d.pin)){
  kinds[d.pin.kind]=(kinds[d.pin.kind]||0)+1;
  const p=`snapshots/${d.pin.sha256}.json`;
  if(!fs.existsSync(p)){bad++;continue}
  const e=JSON.parse(fs.readFileSync(p,"utf8"));
  createHash("sha256").update(e.content,"utf8").digest("hex")===d.pin.sha256?ok++:bad++}}
console.log("pin kinds:",kinds); console.log(`${ok} resolve and hash-match, ${bad} broken`);'
git diff --stat -- snapshots/
```
Expected: four `render identical`; `pin kinds: { permalink: 1, snapshot: 25 }`; `26 resolve and hash-match, 0 broken`; and **no diff under `snapshots/`** — re-pinning must not rewrite a blob.

- [ ] **Step 8: Commit**

```bash
git add src/provenance/backfill.ts src/provenance/backfill.test.ts reports/
git commit -m "run(provenance): the backfilled reports say snapshot, because the blobs are committed

25 pins said hash -- "not enough to replay" -- about documents whose bytes are
in this repo. The backfill always knew it had written the blob; it had no way
to say so until resolvePin grew the flag. Rendered output is unchanged; no blob
was rewritten.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: say what the store now does

**Files:**
- Modify: `README.md`, `src/types.ts` (the `Pin` doc comment)

**Interfaces:** none.

- [ ] **Step 1: Correct the `Pin` doc comment in `src/types.ts`**

It currently ends: *"This branch emits `permalink` (a URL permanent by construction) and `hash` (everything else); `snapshot` is declared for a later phase and currently unused."* That is now false. Rewrite the last sentence to say all three are emitted, and what each one means about replayability — `permalink` and `snapshot` are both reconstructable, `hash` is what a document gets when nobody has committed its bytes.

- [ ] **Step 2: Correct the README's store paragraph**

The "What a pin is, and what is actually stable" section currently says the only writer is the backfill and that a live run emits hashes resolving to nothing. Both are now false. Rewrite so it says:
- a live run commits its documents' bytes before analysing, so a fresh report's pins resolve;
- a pin is `permalink` when the URL is permanent by construction, `snapshot` when the bytes are committed here, and `hash` only when neither holds;
- a `snapshot` pin means replayable, **not** stable — a committed blob says nothing about whether the source will serve the same bytes tomorrow.

Also update the "What this does not yet do" paragraph: the store-wiring absence is now fixed and must come out. **What remains absent and must stay listed: nothing re-fetches, nothing compares two runs, and no drift is reported.**

- [ ] **Step 3: Update the counts you changed**

Run and use the real output:

```bash
npm test 2>&1 | grep -E "^\s+Tests"
node -e 'const fs=require("fs");let k={};for(const f of ["tesla-fsd","claude","vercel","chime"]){const r=JSON.parse(fs.readFileSync(`reports/${f}.json`,"utf8"));for(const d of r.docs.filter(d=>d.pin))k[d.pin.kind]=(k[d.pin.kind]||0)+1}console.log(k)'
ls snapshots | wc -l
```

If the README states a pin-kind breakdown, blob count or test count, make each match. Do not write a number you did not just print.

- [ ] **Step 4: Verify every sentence you wrote**

Re-read your changes one sentence at a time against the code. This project's most persistent defect — caught on six consecutive branches — is prose that outruns its code. In particular do not claim drift detection, re-fetching, or run-to-run comparison; none of those exist yet.

- [ ] **Step 5: Commit**

```bash
git add README.md src/types.ts
git commit -m "docs: all three pin kinds are emitted now, and a live run fills the store

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** This plan is the prerequisite the final review of Phase 2a discovered, plus the pin-kind correction that follows from it. Against the spec's Mode 1 step 6 ("all bytes → `snapshots.put`"): Task 4 implements it. Against the spec's `Pin` definition (`snapshot` is "a committed content-addressed blob"): Tasks 1 and 5 make it true.

| Requirement | Task |
|---|---|
| A live run writes the store | 2, 4 |
| `snapshot` pin kind actually emitted | 1, 5 |
| `permalink` > `snapshot` > `hash` precedence | 1 |
| A `snapshot` pin confers no stability | 1 (tests), unchanged in `stabilityFor` |
| `toPinnedCorpus` stays pure | 3 (injected predicate) |
| Committed reports corrected | 5 |
| Documentation | 6 |

Deferred to Phase 2b-ii and **not** gaps here: `--refresh`, the drift report, `QUOTE_VANISHED`, `STABILITY_VIOLATED`, re-fetch policy, and run-to-run comparison. Deferred to Phase 3: the proposal cache, `--replay`, the double proposer run. Also still recorded and not addressed here: retiring `Corpus`/`asCorpus`/`FetchedDoc`'s borrowed `pin`/`driftHash`; the backfill CLI's subject guard not covering same-subject-wrong-corpus.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Task 5 Step 1 points at an existing test rather than reproducing the whole file, and says what to look for and what to do if found.

**Type consistency.** `resolvePin(url, sha256, stored?)` is defined in Task 1 and called with three arguments in Tasks 3 and 5. `storeCorpus(corpus, dir?): string[]` is defined in Task 2 and called in Task 4. `toPinnedCorpus(corpus, opts?)` is defined in Task 3 and called in Task 4 via `analyzeCorpus`. `isStored: (sha256: string) => boolean` has the same shape in Tasks 3 and 4. `stabilityFor` is unchanged throughout — Task 1 only adds tests for a cell it already handles.

**Two risks worth naming.**
1. Task 4 changes the CLI's live path but adds no test, because the live path needs network and a key. Its correctness rests on Task 3's unit tests plus Task 5's end-to-end check against real committed data. An implementer who wants a test here will be tempted to mock the browser fan; that is out of scope and would test the mock.
2. Task 5 rewrites three published `reports/*.json`. The guard is that rendered output must be unchanged and no blob may be rewritten, both checked in Step 7. If a renderer ever starts reading `pin.kind`, that guard stops being sufficient.

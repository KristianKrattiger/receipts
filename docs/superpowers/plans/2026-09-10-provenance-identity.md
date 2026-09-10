# Provenance Identity (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every document in a ledger a durable identity — a stability classification, a content-addressed snapshot, a raw hash for citation integrity and a normalized hash for change detection — so Phase 2b can tell what actually changed between two runs.

**Architecture:** A new `src/provenance/` module holds four pure units (classify, normalize, snapshots, pin). `toPinnedCorpus` composes them, so pin resolution stays inside the existing pure adapter and `analyzeCorpus` needs no restructure. Per-document provenance lands on `DocSummary`, so a report carries it without a parallel map that can drift. A backfill populates the store from the committed fixtures.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, tsx, `node:crypto`, `node:fs`. No new dependencies.

## Global Constraints

- Node ESM: every relative import ends in `.js`, never `.ts`.
- Tests live beside sources as `*.test.ts`. Runner: `npm test` (`vitest run`). Typecheck: `npm run typecheck`.
- `npm test` must pass at the end of every task. It is **463 tests in 27 files** before this plan starts.
- No new runtime dependencies.
- **The four committed `reports/*.json` must render byte-identically and exit 0 throughout.** Verify with the real CLI. Tesla's audit line must keep reading:
  `audit: proposed 59 over 9 passes · admitted 26 · denied 33 (5 NOT_QUERY_RELEVANT, 15 LOW_CONFIDENCE, 13 DUPLICATE)`
- `npm run site -- reports/*.json` must keep succeeding.
- Every new field on a serialized type is **optional**, because the four committed reports predate all of them. Use the codebase's conditional-spread convention (`...(x !== undefined ? { x } : {})`) so an absent field stays absent in JSON — never assign `undefined`.
- Phase 2a is **entirely offline**. Nothing in it may fetch. If a task seems to need a network call, stop and report — that belongs to Phase 2b.

### Deviations from the spec, decided before planning

- **Spec puts per-document pins in a `provenance.pins` map keyed by docId. This plan puts them on `DocSummary` instead** (`stability`, `pin`, `driftHash`). One structure cannot desync from `docs[]`; two can. Run-level facts (Phase 3's `replay` block: cacheKey, modelId, threshold) still get a report-level `provenance` object when Phase 3 arrives — per-doc facts on the doc, run-level facts on the run.
- **Spec mandates fetching a resolved permalink to verify it.** Phase 2a resolves only URLs that are permanent *by construction* — an SEC EDGAR accession path, a Wikipedia `?oldid=`. Their permanence is a property of the URL's shape and the issuer's contract, not a third party's claim, and the document we already hold **was fetched at that exact URL**, so verification is satisfied by the fetch that already happened. Archive submission and permalink *derivation* (fetching a Wikipedia article to learn its `oldid`) both need network and belong to Phase 2b.
- **`driftHash` lives on `PinnedDoc` as its own field** (the spec's shape). The raw hash stays where Phase 1 put it, inside `pin.sha256`, rather than being duplicated.

### One honest measurement to carry into the README

Across every committed plan, exactly **one** target URL is permanent by construction: `plans/tesla-fsd.json`'s Tesla 10-K (FY2024), an SEC accession URL — the document whose silent loss motivated this spec. **Zero** committed targets carry a Wikipedia `oldid`, so that recognizer ships with synthetic test coverage only. Do not let any prose imply Wikipedia sources are stable today.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/provenance/classify.ts` | `classifyStability(declared?) → Stability` — declared wins, default `volatile` |
| `src/provenance/classify.test.ts` | tests |
| `src/provenance/normalize.ts` | `normalizeForDrift(text) → string`, `driftHashOf(text) → string` |
| `src/provenance/normalize.test.ts` | tests, both directions |
| `src/provenance/snapshots.ts` | content-addressed store at `snapshots/<sha256>.json` |
| `src/provenance/snapshots.test.ts` | tests |
| `src/provenance/pin.ts` | `resolvePin(url, sha256) → Pin` — recognize permanent-by-construction URLs |
| `src/provenance/pin.test.ts` | tests |
| `src/provenance/backfill.ts` | populate the store + report provenance from committed fixtures |
| `src/provenance/backfill.test.ts` | tests |

**Modified:**

| File | Change |
|---|---|
| `src/types.ts` | `SourceTarget.stability?`, `FetchedDoc.stability?`, `DocSummary.stability?`/`.pin?`/`.driftHash?` |
| `src/sources/plan.ts` | validate an optional `stability` on each target |
| `src/fetch/fan.ts:463-467` | carry `stability` from target to doc |
| `src/assay/types.ts` | `PinnedDoc.driftHash` |
| `src/assay/adapt.ts` | `toPinnedCorpus` composes classify + pin + normalize |
| `src/report/build.ts:41` | emit per-doc provenance into `DocSummary` |
| `src/assay/assemble.ts:119` | same, on the refusal path |
| `package.json` | a `backfill` script |
| `README.md` | document what a pin is and what is actually stable today |

**Deleted:** none.

---

### Task 1: `stability` travels from the plan file to the fetched document

**Files:**
- Modify: `src/types.ts` (`SourceTarget`, `FetchedDoc`), `src/sources/plan.ts` (validation), `src/fetch/fan.ts:463-467`
- Modify: `src/sources/plan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SourceTarget.stability?: Stability` and `FetchedDoc.stability?: Stability`, both optional. `Stability` is imported from `src/assay/types.js` — it is already exported there.

- [ ] **Step 1: Write the failing tests**

Append to `src/sources/plan.test.ts`:

```ts
describe("a target may declare its stability", () => {
  const base = { subject: "X", targets: [
    { kind: "vendor_docs", role: "claimant", url: "https://a.example", label: "A", stability: "stable" },
    { kind: "forum", role: "independent", url: "https://b.example", label: "B" },
  ] }

  it("carries a declared stability through", () => {
    const plan = readSourcePlan(JSON.stringify(base), "p.json")
    expect(plan.targets[0]!.stability).toBe("stable")
  })

  it("leaves stability absent as a key when undeclared", () => {
    const plan = readSourcePlan(JSON.stringify(base), "p.json")
    expect("stability" in plan.targets[1]!).toBe(false)
  })

  it("refuses a stability that is not stable or volatile", () => {
    const bad = { subject: "X", targets: [
      { kind: "forum", role: "independent", url: "https://a.example", label: "A", stability: "maybe" },
    ] }
    expect(() => readSourcePlan(JSON.stringify(bad), "p.json")).toThrow(/stability/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/sources/plan.test.ts -t "declare its stability"
```
Expected: FAIL — `stability` is dropped, and the bad value is accepted.

- [ ] **Step 3: Add the fields**

In `src/types.ts`, add to `SourceTarget`:

```ts
  /**
   * Whether this source is expected to return the same bytes on a later fetch.
   *
   * Optional and defaulting to `volatile`: no `SourceKind` predicts stability
   * (`vendor_docs` holds both an immutable SEC filing and a continuously edited
   * docs page), so stability is declared by a plan author or earned by a
   * permanent-by-construction URL — never assumed from the kind.
   */
  stability?: Stability
```

and to `FetchedDoc`, immediately after `kind`:

```ts
  /** Carried from the target that produced this document. Absent means undeclared. */
  stability?: Stability
```

**First, break a circular import this would otherwise create.** `src/assay/types.ts`
already imports from `../types.js`; having `src/types.ts` import back from it is a
cycle. TypeScript erases type-only imports so it would compile, but it breaks the
moment either type needs a runtime value, and it inverts the dependency the rest of
the codebase follows. So **move `Stability` and `Pin` down into `src/types.ts`** —
cut the two declarations from `src/assay/types.ts` verbatim, paste them into
`src/types.ts` above `SourceTarget`, and re-export them from `src/assay/types.ts` so
every existing importer keeps working unchanged:

```ts
export type { Pin, Stability } from "../types.js"
```

Dependencies then flow one way: `src/assay/` depends on `src/types.ts`, never back.
Run `npm test` after the move alone, before adding anything — it must still be 463.

- [ ] **Step 4: Validate it in the plan reader**

In `src/sources/plan.ts`, inside the per-target validation loop (after the existing `role` check around line 118), add:

```ts
    const declared = t!["stability"]
    if (declared !== undefined && declared !== "stable" && declared !== "volatile") {
      throw new Error(
        `receipts: ${path} targets[${i}] stability must be "stable" or "volatile"`,
      )
    }
```

and make sure the object the reader builds for each target carries it through conditionally:

```ts
    ...(declared !== undefined ? { stability: declared as Stability } : {}),
```

- [ ] **Step 5: Carry it in the fan**

In `src/fetch/fan.ts`, in the object literal at lines 463-467, add after `kind: target.kind,`:

```ts
      ...(target.stability !== undefined ? { stability: target.stability } : {}),
```

- [ ] **Step 6: Run the suite**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: 466 passing, typecheck silent.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/sources/plan.ts src/sources/plan.test.ts src/fetch/fan.ts
git commit -m "feat(provenance): let a plan target declare its stability

No SourceKind predicts stability -- vendor_docs holds both an immutable SEC
filing and a continuously edited docs page -- so it is declared, not inferred.
Optional throughout; absent means undeclared, which classify reads as volatile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `classifyStability`

**Files:**
- Create: `src/provenance/classify.ts`, `src/provenance/classify.test.ts`

**Interfaces:**
- Consumes: `Stability` from `src/assay/types.js`.
- Produces: `classifyStability(declared: Stability | undefined): Stability`.

- [ ] **Step 1: Write the failing test**

Create `src/provenance/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { classifyStability } from "./classify.js"

describe("classifyStability", () => {
  it("honours an explicit stable declaration", () => {
    expect(classifyStability("stable")).toBe("stable")
  })

  it("honours an explicit volatile declaration", () => {
    expect(classifyStability("volatile")).toBe("volatile")
  })

  it("defaults an undeclared source to volatile", () => {
    expect(classifyStability(undefined)).toBe("volatile")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/classify.test.ts
```
Expected: FAIL — `Failed to resolve import "./classify.js"`.

- [ ] **Step 3: Write `src/provenance/classify.ts`**

```ts
import type { Stability } from "../assay/types.js"

/**
 * What a document's stability is, before any pin is resolved.
 *
 * Everything defaults to `volatile`. That is the whole of the rule, and the
 * conservative direction: an unclassified stable source is merely
 * under-credited, whereas an unclassified volatile source would be
 * over-credited — a ledger asserting a row rests on something durable when it
 * does not. `pin.ts` may promote a document afterwards, but only on evidence.
 */
export function classifyStability(declared: Stability | undefined): Stability {
  return declared ?? "volatile"
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/classify.test.ts && npm run typecheck
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/provenance/classify.ts src/provenance/classify.test.ts
git commit -m "feat(provenance): classify stability, volatile by default

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: the drift normalizer and `driftHash`

**Files:**
- Create: `src/provenance/normalize.ts`, `src/provenance/normalize.test.ts`
- Modify: `src/assay/types.ts` (`PinnedDoc.driftHash`)

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeForDrift(text: string): string` and `driftHashOf(text: string): string`. `PinnedDoc` gains a required `driftHash: string`.

**Why two hashes.** The raw `sha256` is what citation integrity rests on — character offsets and the exact-substring guarantee depend on raw bytes, so the normalizer must never touch it. `driftHash` answers a different question: did this page change *meaningfully*, or did a clock tick? Without it every page carrying a timestamp reports as drifted on every re-fetch.

- [ ] **Step 1: Write the failing tests**

Create `src/provenance/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { driftHashOf, normalizeForDrift } from "./normalize.js"

describe("normalizeForDrift — strips what only a clock changed", () => {
  it("strips ISO-8601 timestamps", () => {
    const a = "Generated at 2026-09-10T04:12:33.219Z. Uptime is good."
    const b = "Generated at 2026-09-11T22:01:04.000Z. Uptime is good."
    expect(normalizeForDrift(a)).toBe(normalizeForDrift(b))
  })

  it("strips relative times", () => {
    expect(normalizeForDrift("posted 3 hours ago")).toBe(normalizeForDrift("posted 41 minutes ago"))
  })

  it("strips long digit runs", () => {
    expect(normalizeForDrift("req 1757478753123")).toBe(normalizeForDrift("req 9999999999999"))
  })

  it("strips long hex nonces", () => {
    const a = "csrf=0a1b2c3d4e5f60718293a4b5c6d7e8f9"
    const b = "csrf=ffffffffffffffffffffffffffffffff"
    expect(normalizeForDrift(a)).toBe(normalizeForDrift(b))
  })
})

describe("normalizeForDrift — leaves real content alone", () => {
  it("does not strip a year", () => {
    expect(normalizeForDrift("the FY2024 filing")).toContain("2024")
  })

  it("does not strip a percentage or a price", () => {
    const out = normalizeForDrift("improves safety by over 80% for $99/mo")
    expect(out).toContain("80%")
    expect(out).toContain("99")
  })

  it("does not collapse two genuinely different sentences", () => {
    expect(normalizeForDrift("FSD is supervised")).not.toBe(normalizeForDrift("FSD is unsupervised"))
  })

  it("does not strip a short count", () => {
    expect(normalizeForDrift("5 more crashes")).toContain("5")
  })
})

describe("driftHashOf", () => {
  it("agrees for two texts differing only by a timestamp", () => {
    expect(driftHashOf("at 2026-09-10T00:00:00Z ok")).toBe(driftHashOf("at 2026-01-01T12:00:00Z ok"))
  })

  it("differs for two texts differing in prose", () => {
    expect(driftHashOf("ok")).not.toBe(driftHashOf("not ok"))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/normalize.test.ts
```
Expected: FAIL — `Failed to resolve import "./normalize.js"`.

- [ ] **Step 3: Write `src/provenance/normalize.ts`**

```ts
import { createHash } from "node:crypto"

/**
 * Patterns that change without the page changing.
 *
 * Deliberately conservative, and the bias is one-directional: over-normalizing
 * HIDES a real edit, which is the failure that matters, while under-normalizing
 * only produces a false drift flag that a reader can dismiss. So this strips
 * only things that cannot be part of a claim — machine timestamps, relative
 * clocks, long opaque identifiers — and leaves years, prices, percentages and
 * small counts alone, because those are exactly what a vendor's claims are made
 * of.
 */
const RULES: { name: string; re: RegExp; token: string }[] = [
  // 2026-09-10T04:12:33.219Z, 2026-09-10T04:12:33+01:00
  { name: "iso8601", token: "<TS>",
    re: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g },
  // "3 hours ago", "41 minutes ago"
  { name: "relative", token: "<AGO>",
    re: /\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi },
  // 32+ hex characters: csrf tokens, session ids, content hashes
  { name: "hexnonce", token: "<HEX>", re: /\b[A-Fa-f0-9]{32,}\b/g },
  // 8+ consecutive digits: epoch millis, request ids. A year is 4, a price is
  // rarely 8, so this floor keeps real numbers out of scope.
  { name: "digits", token: "<NUM>", re: /\b\d{8,}\b/g },
]

export function normalizeForDrift(text: string): string {
  let out = text
  for (const rule of RULES) out = out.replace(rule.re, rule.token)
  return out
}

export function driftHashOf(text: string): string {
  return createHash("sha256").update(normalizeForDrift(text), "utf8").digest("hex")
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/normalize.test.ts
```
Expected: all passed.

- [ ] **Step 5: Add `driftHash` to `PinnedDoc`**

In `src/assay/types.ts`, add to `PinnedDoc` after `pin`:

```ts
  /**
   * sha256 of the normalized text — see `src/provenance/normalize.ts`.
   *
   * Answers "did this page change meaningfully", which is a different question
   * from `pin.sha256`'s "are these the exact bytes we cited". The raw hash
   * never sees the normalizer: offsets and the exact-substring guarantee depend
   * on raw bytes.
   */
  driftHash: string
```

This will break `toPinnedCorpus` and every test constructing a `PinnedDoc`. That is expected — Task 6 wires the real value. For now, satisfy the compiler at each construction site by computing it with `driftHashOf(text)`, importing from `../provenance/normalize.js`.

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: all green. If a test file constructs a `PinnedDoc` literal, add `driftHash` to it rather than loosening the type.

- [ ] **Step 7: Commit**

```bash
git add src/provenance/normalize.ts src/provenance/normalize.test.ts src/assay/types.ts src/assay/adapt.ts src/assay/assemble.test.ts src/assay/index.test.ts
git commit -m "feat(provenance): a normalized drift hash beside the raw one

Two hashes answer two questions. pin.sha256 is what citation integrity rests
on and never sees the normalizer, because offsets depend on raw bytes.
driftHash asks whether the page changed meaningfully or a clock ticked.

The normalizer is deliberately conservative and the bias is one-directional:
over-normalizing hides a real edit, under-normalizing only raises a false flag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: the content-addressed snapshot store

**Files:**
- Create: `src/provenance/snapshots.ts`, `src/provenance/snapshots.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `putSnapshot(entry: SnapshotEntry, dir?: string): string` returning the sha256; `getSnapshot(sha256: string, dir?: string): SnapshotEntry`; `hasSnapshot(sha256, dir?): boolean`; `SNAPSHOT_DIR = "snapshots"`. `SnapshotEntry` is `{ url: string; fetchedAt: string; content: string }`.

**Addressing rule:** the key is the sha256 of `content` alone, not of the whole entry. Two documents with identical text share one blob however they were fetched, which is what makes the store grow with new content rather than with run count.

- [ ] **Step 1: Write the failing test**

Create `src/provenance/snapshots.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getSnapshot, hasSnapshot, putSnapshot } from "./snapshots.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "snap-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const entry = { url: "https://a.example", fetchedAt: "2026-09-10T00:00:00.000Z", content: "hello world" }

describe("the snapshot store", () => {
  it("addresses a blob by the sha256 of its content alone", () => {
    const id = putSnapshot(entry, dir)
    expect(id).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
  })

  it("round-trips the entry", () => {
    const id = putSnapshot(entry, dir)
    expect(getSnapshot(id, dir)).toEqual(entry)
  })

  it("deduplicates identical content fetched from different urls", () => {
    const a = putSnapshot(entry, dir)
    const b = putSnapshot({ ...entry, url: "https://b.example" }, dir)
    expect(b).toBe(a)
  })

  it("gives different content different ids", () => {
    expect(putSnapshot({ ...entry, content: "goodbye" }, dir)).not.toBe(putSnapshot(entry, dir))
  })

  it("reports presence without reading the blob", () => {
    expect(hasSnapshot("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", dir)).toBe(false)
    putSnapshot(entry, dir)
    expect(hasSnapshot("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", dir)).toBe(true)
  })

  it("names the missing id when a blob is absent", () => {
    expect(() => getSnapshot("0".repeat(64), dir)).toThrow(/0{64}/)
  })

  it("does not rewrite a blob that already exists", () => {
    const id = putSnapshot(entry, dir)
    const first = readFileSync(join(dir, `${id}.json`), "utf8")
    putSnapshot({ ...entry, url: "https://other.example", fetchedAt: "2027-01-01T00:00:00.000Z" }, dir)
    expect(readFileSync(join(dir, `${id}.json`), "utf8")).toBe(first)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/snapshots.test.ts
```
Expected: FAIL — `Failed to resolve import "./snapshots.js"`.

- [ ] **Step 3: Write `src/provenance/snapshots.ts`**

```ts
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const SNAPSHOT_DIR = "snapshots"

export interface SnapshotEntry {
  url: string
  fetchedAt: string
  content: string
}

function pathFor(sha256: string, dir: string): string {
  return join(dir, `${sha256}.json`)
}

/**
 * Write a document's bytes into the content-addressed store, and return the id.
 *
 * The id is the sha256 of `content` ALONE, not of the whole entry: two
 * documents with identical text are the same bytes however they were fetched,
 * so they share one blob. That is what makes the store grow with new content
 * rather than with run count.
 *
 * An existing blob is never rewritten. The first capture's url and fetchedAt
 * are the ones kept, so re-running a plan cannot churn the store — and a blob's
 * bytes can never disagree with its own id.
 */
export function putSnapshot(entry: SnapshotEntry, dir: string = SNAPSHOT_DIR): string {
  const id = createHash("sha256").update(entry.content, "utf8").digest("hex")
  const file = pathFor(id, dir)
  if (existsSync(file)) return id
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, "utf8")
  return id
}

export function hasSnapshot(sha256: string, dir: string = SNAPSHOT_DIR): boolean {
  return existsSync(pathFor(sha256, dir))
}

export function getSnapshot(sha256: string, dir: string = SNAPSHOT_DIR): SnapshotEntry {
  const file = pathFor(sha256, dir)
  if (!existsSync(file)) {
    throw new Error(`receipts: snapshot ${sha256} is not in ${dir}`)
  }
  return JSON.parse(readFileSync(file, "utf8")) as SnapshotEntry
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/snapshots.test.ts && npm run typecheck
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/provenance/snapshots.ts src/provenance/snapshots.test.ts
git commit -m "feat(provenance): a content-addressed snapshot store

Addressed by the sha256 of content alone, so identical text fetched from two
urls is one blob and the store grows with new content, not with run count. An
existing blob is never rewritten, so its bytes cannot disagree with its id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: recognize URLs that are permanent by construction

**Files:**
- Create: `src/provenance/pin.ts`, `src/provenance/pin.test.ts`

**Interfaces:**
- Consumes: `Pin` from `src/assay/types.js`.
- Produces: `resolvePin(url: string, sha256: string): Pin` and `isPermanentUrl(url: string): boolean`.

**What this does and does not do.** It recognizes a URL whose permanence follows from its own shape and the issuer's contract: an SEC EDGAR accession path, or a Wikipedia `?oldid=` revision link. When the document we already hold was fetched **at that exact URL**, no verification fetch is needed — the bytes in hand are the bytes at the permalink, established by the fetch that already happened. It does **not** derive a permalink for a page that has one but was not fetched at it (a Wikipedia article → its current `oldid`), and it does **not** submit anything to an archive. Both need network and belong to Phase 2b.

**Measured, and to be stated honestly:** across every committed plan, exactly one target URL is recognized — `plans/tesla-fsd.json`'s Tesla 10-K accession URL. **No committed target carries a Wikipedia `oldid`,** so that branch has synthetic coverage only.

- [ ] **Step 1: Write the failing test**

Create `src/provenance/pin.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isPermanentUrl, resolvePin } from "./pin.js"

const H = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
const TESLA_10K =
  "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm"

describe("permanent by construction — SEC EDGAR accession paths", () => {
  it("recognizes the committed Tesla 10-K url", () => {
    expect(isPermanentUrl(TESLA_10K)).toBe(true)
  })

  it("pins it as a permalink carrying the same hash", () => {
    expect(resolvePin(TESLA_10K, H)).toEqual({ kind: "permalink", url: TESLA_10K, sha256: H })
  })

  it("does not recognize sec.gov pages outside the accession archive", () => {
    expect(isPermanentUrl("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany")).toBe(false)
    expect(isPermanentUrl("https://www.sec.gov/")).toBe(false)
  })

  it("does not recognize a lookalike host", () => {
    expect(isPermanentUrl("https://sec.gov.evil.example/Archives/edgar/data/1/2/x.htm")).toBe(false)
  })
})

describe("permanent by construction — Wikipedia oldid revisions", () => {
  it("recognizes an oldid revision link", () => {
    expect(isPermanentUrl("https://en.wikipedia.org/w/index.php?title=Tesla_Autopilot&oldid=1234567")).toBe(true)
  })

  it("does not recognize a bare article url", () => {
    expect(isPermanentUrl("https://en.wikipedia.org/wiki/Tesla_Autopilot")).toBe(false)
  })

  it("does not recognize oldid on a non-wikipedia host", () => {
    expect(isPermanentUrl("https://example.com/page?oldid=1234567")).toBe(false)
  })
})

describe("everything else stays a plain hash pin", () => {
  it("pins a vendor marketing page by hash", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H)).toEqual({ kind: "hash", sha256: H })
  })

  it("pins a Hacker News search by hash", () => {
    expect(resolvePin("https://hn.algolia.com/?q=tesla", H)).toEqual({ kind: "hash", sha256: H })
  })

  it("returns a hash pin for a malformed url instead of throwing", () => {
    expect(resolvePin("not a url", H)).toEqual({ kind: "hash", sha256: H })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/pin.test.ts
```
Expected: FAIL — `Failed to resolve import "./pin.js"`.

- [ ] **Step 3: Write `src/provenance/pin.ts`**

```ts
import type { Pin } from "../assay/types.js"

/**
 * A URL is permanent by construction when its permanence follows from its own
 * shape and the issuer's contract, rather than from anyone's claim about it.
 *
 * Two such shapes today:
 *
 *  - an SEC EDGAR *accession* path. The accession number identifies one filed
 *    document; EDGAR does not reissue it, and a filed document is not edited.
 *  - a Wikipedia `oldid` link. It names one revision, and a revision is
 *    immutable by definition — later edits create new ones.
 *
 * Both are checked host-first, against the parsed hostname rather than a
 * substring, so `sec.gov.evil.example` cannot pass for `sec.gov`.
 *
 * This deliberately does NOT *derive* a permalink for a page that has one but
 * was not fetched at it, and does NOT submit anything to an archive. Both need
 * a network fetch, which Phase 2a does not do.
 */
const SEC_ACCESSION = /^\/Archives\/edgar\/data\/\d+\/\d+\//
const WIKIPEDIA_HOST = /(^|\.)wikipedia\.org$/

export function isPermanentUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false

  const host = u.hostname.toLowerCase()
  if (host === "sec.gov" || host === "www.sec.gov") {
    return SEC_ACCESSION.test(u.pathname)
  }
  if (WIKIPEDIA_HOST.test(host)) {
    const oldid = u.searchParams.get("oldid")
    return oldid !== null && /^\d+$/.test(oldid)
  }
  return false
}

/**
 * The pin for a document we already hold.
 *
 * `sha256` is the raw content hash the caller already computed — this function
 * never rehashes, so a pin cannot disagree with the bytes it describes.
 *
 * A recognized permalink needs no verification fetch: the document in hand WAS
 * fetched at this exact URL, so the bytes at the permalink are the bytes we
 * have, established by the fetch that already happened.
 */
export function resolvePin(url: string, sha256: string): Pin {
  return isPermanentUrl(url) ? { kind: "permalink", url, sha256 } : { kind: "hash", sha256 }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/pin.test.ts && npm run typecheck
```
Expected: 10 passed.

- [ ] **Step 5: Confirm the measurement against the real plans**

```bash
npx tsx -e '
import { isPermanentUrl } from "./src/provenance/pin.js"
import { readFileSync, readdirSync } from "node:fs"
for (const f of readdirSync("plans")) {
  const p = JSON.parse(readFileSync(`plans/${f}`, "utf8"))
  for (const t of p.targets) if (isPermanentUrl(t.url)) console.log(f, "->", t.label)
}'
```
Expected: exactly one line, `tesla-fsd.json -> Tesla 10-K (FY2024)`. Record the real output in your report. If more or fewer appear, stop and report it — the plan's stated measurement is wrong and the README must not repeat it.

- [ ] **Step 6: Commit**

```bash
git add src/provenance/pin.ts src/provenance/pin.test.ts
git commit -m "feat(provenance): recognize urls that are permanent by construction

An SEC accession path and a Wikipedia oldid are durable because of their own
shape and the issuer's contract, not because a third party says so -- and when
the document in hand was fetched at that exact url, verification is already
done. Host is checked against the parsed hostname, so sec.gov.evil.example
cannot pass for sec.gov.

Deriving a permalink for a page not fetched at one, and archive submission,
both need network and are Phase 2b.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `toPinnedCorpus` composes the provenance layer

**Files:**
- Modify: `src/assay/adapt.ts`, `src/assay/adapt.test.ts`

**Interfaces:**
- Consumes: `classifyStability`, `resolvePin`, `driftHashOf`.
- Produces: `toPinnedCorpus` unchanged in signature; each `PinnedDoc` now carries a real `stability`, `pin` and `driftHash`.

**The promotion rule:** a recognized permalink promotes an undeclared document to `stable`. It must NOT override an explicit `stability: "volatile"` declaration — a plan author who says a source is volatile knows something the URL shape does not, and silently overruling them would launder an assumption into the ledger.

- [ ] **Step 1: Write the failing tests**

Append to `src/assay/adapt.test.ts`:

```ts
const TESLA_10K =
  "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm"

describe("toPinnedCorpus composes the provenance layer", () => {
  it("pins a permanent url as a permalink and promotes it to stable", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ url: TESLA_10K })], failures: [],
    })
    expect(pinned.docs[0]!.pin.kind).toBe("permalink")
    expect(pinned.docs[0]!.stability).toBe("stable")
  })

  it("leaves an ordinary url a hash pin and volatile", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc()], failures: [] })
    expect(pinned.docs[0]!.pin.kind).toBe("hash")
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })

  it("honours an explicit stable declaration on an ordinary url", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ stability: "stable" })], failures: [],
    })
    expect(pinned.docs[0]!.stability).toBe("stable")
    expect(pinned.docs[0]!.pin.kind).toBe("hash")
  })

  it("does not let a permalink override an explicit volatile declaration", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ url: TESLA_10K, stability: "volatile" })], failures: [],
    })
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })

  it("computes driftHash over the normalized text, not the raw text", () => {
    const a = toPinnedCorpus({ subject: "X", docs: [doc({ text: "ok at 2026-09-10T00:00:00Z" })], failures: [] })
    const b = toPinnedCorpus({ subject: "X", docs: [doc({ text: "ok at 2027-01-01T12:00:00Z" })], failures: [] })
    expect(a.docs[0]!.driftHash).toBe(b.docs[0]!.driftHash)
    expect(a.docs[0]!.pin.sha256).not.toBe(b.docs[0]!.pin.sha256)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/assay/adapt.test.ts -t "composes the provenance layer"
```
Expected: FAIL — everything is hard-coded volatile with a hash pin.

- [ ] **Step 3: Rewrite the mapping in `src/assay/adapt.ts`**

Replace the body of the `.map()` inside `toPinnedCorpus`:

```ts
  const docs: PinnedDoc[] = corpus.docs.map((d) => {
    const raw = sha256(d.text)
    const pin = resolvePin(d.url, raw)
    // A recognized permalink promotes an UNDECLARED document to stable. It must
    // not overrule an explicit declaration: a plan author who wrote
    // `"stability": "volatile"` knows something the url's shape does not, and
    // silently overriding them would launder an assumption into the ledger.
    const stability = d.stability ?? (pin.kind === "permalink" ? "stable" : classifyStability(undefined))
    return {
      docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind,
      fetchedAt: d.fetchedAt, title: d.title, text: d.text,
      stability,
      pin,
      driftHash: driftHashOf(d.text),
      ...(d.via !== undefined ? { via: d.via } : {}),
    }
  })
```

Add the imports:

```ts
import { classifyStability } from "../provenance/classify.js"
import { driftHashOf } from "../provenance/normalize.js"
import { resolvePin } from "../provenance/pin.js"
```

- [ ] **Step 4: Run the full suite**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: all green.

- [ ] **Step 5: Verify the committed ledgers are untouched**

```bash
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json >/dev/null 2>&1; echo "$f exit=$?"
done
npm run cli -- x --render reports/tesla-fsd.json 2>/dev/null | grep -E '^\s+audit:'
```
Expected: four `exit=0`, and the audit line unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/assay/adapt.ts src/assay/adapt.test.ts
git commit -m "feat(provenance): wire classify, pin and driftHash into the corpus adapter

A recognized permalink promotes an undeclared document to stable, and only an
undeclared one -- an explicit volatile declaration stands, because the author
knows something the url shape does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: a report carries its documents' provenance

**Files:**
- Modify: `src/types.ts` (`DocSummary`), `src/report/build.ts:41`, `src/assay/assemble.ts:119`
- Modify: `src/report/build.test.ts`

**Interfaces:**
- Consumes: `PinnedDoc`'s `stability`, `pin`, `driftHash`.
- Produces: `DocSummary` gains optional `stability?: Stability`, `pin?: Pin`, `driftHash?: string`.

**Why optional, and why on `DocSummary`.** Optional because the four committed reports predate all three fields and must keep parsing. On `DocSummary` rather than in a parallel `provenance.pins` map because one structure cannot desync from `docs[]` and two can. Phase 3's run-level `replay` block still gets its own report-level object when it arrives.

- [ ] **Step 1: Write the failing test**

Append to `src/report/build.test.ts`:

```ts
describe("a DocSummary carries its document's provenance", () => {
  it("copies stability, pin and driftHash onto the summary", () => {
    const report = buildReport(
      corpusWith([pinnedDoc({ stability: "stable", pin: { kind: "permalink", url: "https://u", sha256: "ab" }, driftHash: "cd" })]),
      0, { admitted: [], denied: [] },
    )
    expect(report.docs[0]!.stability).toBe("stable")
    expect(report.docs[0]!.pin).toEqual({ kind: "permalink", url: "https://u", sha256: "ab" })
    expect(report.docs[0]!.driftHash).toBe("cd")
  })

  it("leaves the keys absent for a document that has none", () => {
    const report = buildReport(corpusWithLegacyDoc(), 0, { admitted: [], denied: [] })
    expect("stability" in report.docs[0]!).toBe(false)
    expect("pin" in report.docs[0]!).toBe(false)
    expect("driftHash" in report.docs[0]!).toBe(false)
  })
})
```

**`build.test.ts` has no such helpers — do not invent them.** It defines `CORPUS`,
`SPAN`, `SECOND_SPAN` and `rel()`, and its existing provenance tests build corpora
as inline literals. There is already a
`describe("buildReport — provenance survives the trip to DocSummary")` block at
line 108, added when `via` was restored. **Extend that block** in the same inline
style rather than opening a second one; copy the literal shape its `via` test uses
and add `stability`, `pin` and `driftHash` to the document.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/report/build.test.ts -t "carries its document's provenance"
```
Expected: FAIL — the fields are dropped.

- [ ] **Step 3: Extend `DocSummary`**

In `src/types.ts`:

```ts
export interface DocSummary {
  docId: string
  url: string
  label: string
  role: SourceRole
  fetchedAt: string
  via?: FetchVia
  /**
   * Per-document provenance. All three are optional because the four committed
   * reports predate them; a reader must treat absence as "not recorded", never
   * as a claim.
   */
  stability?: Stability
  pin?: Pin
  driftHash?: string
}
```

Import `Pin` alongside the existing `Stability` import.

- [ ] **Step 4: Emit them from both construction sites**

In `src/report/build.ts` at line 41 and `src/assay/assemble.ts` at line 119, add to each `DocSummary` literal, after the existing `via` spread:

```ts
      ...(d.stability !== undefined ? { stability: d.stability } : {}),
      ...(d.pin !== undefined ? { pin: d.pin } : {}),
      ...(d.driftHash !== undefined ? { driftHash: d.driftHash } : {}),
```

Both sites take a doc typed loosely enough that these may be absent — keep the conditional spread rather than asserting they are present.

- [ ] **Step 5: Run the full suite and check the committed ledgers**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json >/dev/null 2>&1; echo "$f exit=$?"
done
npm run site -- reports/*.json >/dev/null && echo "site ok"
```
Expected: green, four `exit=0`, `site ok`.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/report/build.ts src/assay/assemble.ts src/report/build.test.ts
git commit -m "feat(provenance): a report records each document's stability, pin and drift hash

On DocSummary rather than a parallel pins map: one structure cannot desync from
docs[], two can. All three optional -- the four committed reports predate them,
and absence means "not recorded", never a claim.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: backfill the store and the committed reports from the fixtures

**Files:**
- Create: `src/provenance/backfill.ts`, `src/provenance/backfill.test.ts`
- Modify: `package.json` (a `backfill` script)

**Interfaces:**
- Consumes: `putSnapshot`, `resolvePin`, `driftHashOf`, `classifyStability`.
- Produces: `backfillFromCorpus(corpusJson: string, reportJson: string, snapshotDir?: string): { report: unknown; snapshots: number }` — a pure function returning the updated report object and how many blobs it wrote.

**Why this exists.** The four committed reports have no provenance, but `fixtures/` holds the corpora they were generated from — including the 385 KB Tesla 10-K. Backfilling buys content integrity and a drift baseline immediately, without re-running anything or spending a cent. The fixture is matched to the report **by `docId`**, which both already carry.

A document in the report with no matching fixture doc is left exactly as it is — not guessed at, not dropped. Report how many were left alone.

- [ ] **Step 1: Write the failing test**

Create `src/provenance/backfill.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { backfillFromCorpus } from "./backfill.js"
import { getSnapshot } from "./snapshots.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "backfill-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const corpus = JSON.stringify({
  subject: "X",
  docs: [{ docId: "d1", url: "https://a.example", label: "A", role: "claimant",
           kind: "vendor_site", fetchedAt: "2026-09-01T00:00:00.000Z", title: "A", text: "hello world" }],
  failures: [],
})

const report = JSON.stringify({
  subject: "X", generatedAt: "2026-09-01T00:00:00.000Z",
  docs: [{ docId: "d1", url: "https://a.example", label: "A", role: "claimant", fetchedAt: "2026-09-01T00:00:00.000Z" }],
  failures: [], rows: [], audit: { proposed: 0, admitted: 0, denied: [] },
})

describe("backfillFromCorpus", () => {
  it("writes one snapshot per fixture document", () => {
    const { snapshots } = backfillFromCorpus(corpus, report, dir)
    expect(snapshots).toBe(1)
    expect(getSnapshot("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", dir).content)
      .toBe("hello world")
  })

  it("stamps the matching report doc with pin, stability and driftHash", () => {
    const { report: out } = backfillFromCorpus(corpus, report, dir) as { report: { docs: Record<string, unknown>[] } }
    expect(out.docs[0]!["pin"]).toEqual({
      kind: "hash", sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    })
    expect(out.docs[0]!["stability"]).toBe("volatile")
    expect(typeof out.docs[0]!["driftHash"]).toBe("string")
  })

  it("matches fixture to report by docId, not by position", () => {
    const twoDocs = JSON.stringify({ ...JSON.parse(corpus), docs: [
      { docId: "zzz", url: "https://z", label: "Z", role: "independent", kind: "forum",
        fetchedAt: "2026-09-01T00:00:00.000Z", title: "Z", text: "other" },
      JSON.parse(corpus).docs[0],
    ] })
    const { report: out } = backfillFromCorpus(twoDocs, report, dir) as { report: { docs: Record<string, unknown>[] } }
    expect((out.docs[0]!["pin"] as { sha256: string }).sha256)
      .toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
  })

  it("leaves a report doc with no fixture match completely untouched", () => {
    const orphan = JSON.stringify({ ...JSON.parse(report), docs: [
      { docId: "missing", url: "https://m", label: "M", role: "claimant", fetchedAt: "2026-09-01T00:00:00.000Z" },
    ] })
    const { report: out } = backfillFromCorpus(corpus, orphan, dir) as { report: { docs: Record<string, unknown>[] } }
    expect("pin" in out.docs[0]!).toBe(false)
    expect("stability" in out.docs[0]!).toBe(false)
  })

  it("leaves rows and audit exactly as they were", () => {
    const { report: out } = backfillFromCorpus(corpus, report, dir) as { report: Record<string, unknown> }
    expect(out["rows"]).toEqual([])
    expect(out["audit"]).toEqual({ proposed: 0, admitted: 0, denied: [] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/provenance/backfill.test.ts
```
Expected: FAIL — `Failed to resolve import "./backfill.js"`.

- [ ] **Step 3: Write `src/provenance/backfill.ts`**

```ts
import { createHash } from "node:crypto"
import { classifyStability } from "./classify.js"
import { driftHashOf } from "./normalize.js"
import { resolvePin } from "./pin.js"
import { putSnapshot, SNAPSHOT_DIR } from "./snapshots.js"

interface FixtureDoc { docId: string; url: string; fetchedAt: string; text: string; stability?: "stable" | "volatile" }

/**
 * Give an already-committed report the provenance it predates.
 *
 * The four committed reports carry no pins, but `fixtures/` holds the corpora
 * they were generated from — so content integrity and a drift baseline are
 * available without re-running anything or spending a cent.
 *
 * Fixture and report are matched by `docId`, which both carry. A report
 * document with no fixture match is returned exactly as it came in: this
 * function records what the bytes actually were, and has nothing to say about a
 * document whose bytes it does not have.
 */
export function backfillFromCorpus(
  corpusJson: string,
  reportJson: string,
  snapshotDir: string = SNAPSHOT_DIR,
): { report: unknown; snapshots: number; unmatched: number } {
  const corpus = JSON.parse(corpusJson) as { docs: FixtureDoc[] }
  const report = JSON.parse(reportJson) as { docs: Record<string, unknown>[] }

  const byId = new Map(corpus.docs.map((d) => [d.docId, d]))
  let snapshots = 0
  let unmatched = 0

  const docs = report.docs.map((summary) => {
    const fixture = byId.get(summary["docId"] as string)
    if (!fixture) {
      unmatched++
      return summary
    }
    putSnapshot({ url: fixture.url, fetchedAt: fixture.fetchedAt, content: fixture.text }, snapshotDir)
    snapshots++
    const raw = createHash("sha256").update(fixture.text, "utf8").digest("hex")
    const pin = resolvePin(fixture.url, raw)
    const stability = fixture.stability
      ?? (pin.kind === "permalink" ? "stable" : classifyStability(undefined))
    return { ...summary, stability, pin, driftHash: driftHashOf(fixture.text) }
  })

  return { report: { ...report, docs }, snapshots, unmatched }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/provenance/backfill.test.ts && npm run typecheck
```
Expected: 5 passed.

- [ ] **Step 5: Add the runner script**

Create `src/provenance/backfill-cli.ts`:

```ts
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { backfillFromCorpus } from "./backfill.js"

const [corpusPath, reportPath] = process.argv.slice(2)
if (!corpusPath || !reportPath) {
  console.error("usage: backfill <fixture.json> <report.json>")
  process.exit(2)
}

const { report, snapshots, unmatched } = backfillFromCorpus(
  readFileSync(corpusPath, "utf8"),
  readFileSync(reportPath, "utf8"),
)
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
console.error(`${reportPath}: ${snapshots} snapshot(s), ${unmatched} document(s) left untouched`)
```

Add to `package.json` scripts:

```json
    "backfill": "tsx src/provenance/backfill-cli.ts",
```

- [ ] **Step 6: Run the backfill against the real pairs**

**Three of the four reports have a name-matched committed fixture; measured by
docId overlap, each matches completely — Tesla 10/10, Claude 6/6, Vercel 10/10.**
Run those three and report the exact output:

```bash
npm run backfill -- fixtures/tesla-fsd.json reports/tesla-fsd.json
npm run backfill -- fixtures/claude.json reports/claude.json
npm run backfill -- fixtures/vercel.json reports/vercel.json
```

**Do not backfill `reports/chime.json`.** There is no `fixtures/chime.json`. The only
fixture sharing any docId with it is `fixtures/probe-cfpb.json`, which matches 1 of
its 7 documents — and it is a *probe* capture, a different fetch from the run that
produced the report. Its bytes are not established to be the bytes that report was
generated against, so backfilling from it would stamp a false integrity baseline onto
the ledger: exactly the kind of unearned claim this tool exists to catch. Chime keeps
no provenance until it is re-run. Say so in your report.

Then confirm the Tesla 10-K earned a permalink and everything still renders:

```bash
node -e '
const r=require("./reports/tesla-fsd.json");
for (const d of r.docs) if (d.pin && d.pin.kind==="permalink") console.log("permalink:", d.label);
console.log("docs with provenance:", r.docs.filter(d=>d.pin).length, "of", r.docs.length);'
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json >/dev/null 2>&1; echo "$f exit=$?"
done
npm run cli -- x --render reports/tesla-fsd.json 2>/dev/null | grep -E '^\s+audit:'
npm run site -- reports/*.json >/dev/null && echo "site ok"
```
Expected: `permalink: Tesla 10-K (FY2024)`, `docs with provenance: 10 of 10`, all
four ledgers `exit=0`, the audit line unchanged, `site ok`. `reports/chime.json` stays
unbackfilled and its docs carry no `pin` — confirm that is still true afterwards.

- [ ] **Step 7: Commit**

```bash
git add src/provenance/backfill.ts src/provenance/backfill.test.ts src/provenance/backfill-cli.ts package.json snapshots reports
git commit -m "run(provenance): backfill snapshots and pins from the committed fixtures

The reports predate provenance, but fixtures/ holds the corpora they came from,
so integrity and a drift baseline cost nothing to establish. Matched by docId; a
report document with no fixture match is left exactly as it was, because this
records what the bytes were and has nothing to say about bytes it lacks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: document what a pin is, and what is actually stable

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add a section after "The contract, extracted"**

Write it in the README's own voice — plain, specific, willing to name limits. It must say:

- Every document in a ledger now carries three facts: a **stability** (`stable` or `volatile`), a **pin** (how its bytes can be got again), and a **drift hash** (whether the page changed meaningfully, as distinct from a clock ticking).
- Bytes live in a content-addressed `snapshots/` store, keyed by the sha256 of content alone, so identical text is one blob and the store grows with new content rather than with run count.
- A pin is a `permalink` only when the URL is permanent **by construction** — an SEC EDGAR accession path or a Wikipedia `oldid` — because permanence there follows from the URL's shape and the issuer's contract rather than anyone's claim. Everything else is a plain content hash.
- **Exactly one source across every committed plan earns a permalink today: Tesla's FY2024 10-K.** Say the number. Do not imply Wikipedia sources are stable — no committed plan pins a revision.
- Stability is never inferred from a source's kind. `vendor_docs` holds both that immutable filing and two continuously edited documentation sites, so a plan author declares it or a permanent URL earns it.
- What this does **not** yet do: nothing re-fetches, nothing compares two runs, and no drift is reported. That is the next phase.

- [ ] **Step 2: Update the test count**

```bash
npm test 2>&1 | grep -E "^\s+Tests"
```
Put the real number into the `npm test` line in the Development section.

- [ ] **Step 3: Verify every claim you wrote**

Re-read your section against the code, one sentence at a time. In particular re-run the Task 5 Step 5 measurement and confirm the number you wrote matches it. This project's most persistent defect is prose that outruns its code — do not add to it.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): what a pin is, and the one source that earns one today

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (Phase 2a scope).** The spec's Phase 2 is *"classify, pin, snapshots, normalize, the manifest, the backfill, `--refresh` and the drift report."* This plan is the first five plus the backfill; `--refresh` and the drift report are Phase 2b, per the split agreed before planning.

| Phase 2a requirement | Task |
|---|---|
| `classify` | 2, with the plumbing in 1 |
| `normalize` / `driftHash` | 3 |
| `snapshots` | 4 |
| `pin` (deterministic recognizers) | 5 |
| composition into the corpus | 6 |
| the manifest (per-doc, on `DocSummary`) | 7 |
| the backfill | 8 |
| documentation | 9 |

Deferred to Phase 2b and **not** gaps here: `--refresh`, the drift report, `QUOTE_VANISHED`, `STABILITY_VIOLATED`, permalink *derivation* (fetching a Wikipedia article to learn its `oldid`), archive submission, the renderer's provenance footer, and wiring the `snapshots/` store into a live run (`putSnapshot`'s only caller today is the backfill; `toPinnedCorpus` is deliberately pure and a plan run never writes to the store). Deferred to Phase 3: the proposal cache, `--replay`, the double proposer run, `RowProvenance` population, and the report-level `replay` block.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Two steps deliberately point at existing code rather than reproducing it — Task 7 Step 1's `build.test.ts` fixtures and Task 9's README voice — and each says what to look for.

**Type consistency.** `Stability` and `Pin` come from `src/assay/types.ts` and are used unchanged in Tasks 1, 5, 6 and 7. `classifyStability(declared)` is defined in Task 2 and called in 6 and 8. `resolvePin(url, sha256)` is defined in Task 5 and called in 6 and 8. `driftHashOf(text)` is defined in Task 3 and called in 6 and 8. `putSnapshot(entry, dir?)` is defined in Task 4 and called in 8. `PinnedDoc.driftHash` is added in Task 3 and populated in Task 6 — Task 3 Step 5 explicitly warns that this breaks construction sites and says to fix them rather than loosen the type.

**Two risks worth naming.**
1. Task 3 Step 5 adds a **required** field to `PinnedDoc`, which will break every test that builds one as a literal. That is deliberate — a required `driftHash` is what stops a document entering a ledger without one — but an implementer who treats the breakage as a regression will get stuck. The step says so.
2. Task 8 rewrites four committed `reports/*.json`. The guard is that rendering and the audit line must be unchanged afterwards, checked in Step 6. If a renderer ever starts reading `pin`, that guard stops being sufficient and the check needs strengthening.

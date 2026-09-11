# Drift Detection (Phase 2b-ii) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--refresh` re-fetches a published ledger's sources and reports what changed — which documents drifted, which declared-stable source broke its promise, and above all which quoted claims are no longer on the page — without calling the model.

**Architecture:** The comparison is pure: `src/provenance/drift.ts` takes the prior report's per-document manifest and the fresh bytes, and returns a `DriftReport`. The CLI does the impure parts — loading the prior report, reading permalink-pinned documents from the store instead of re-fetching them, fetching the rest, storing the new bytes — and hands the pure function its inputs. `--rerun` is the opt-in that additionally runs `assay()` and writes a new ledger.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, tsx. No new dependencies.

## Global Constraints

- Node ESM: every relative import ends in `.js`, never `.ts`.
- Tests live beside sources as `*.test.ts`. Runner: `npm test` (`vitest run`). Typecheck: `npm run typecheck`.
- `npm test` must pass at the end of every task. It is **546 tests in 35 files** before this plan starts.
- No new runtime dependencies.
- **The four committed `reports/*.json` must render byte-identically and exit 0 throughout.** Tesla's audit line must keep reading:
  `audit: proposed 59 over 9 passes · admitted 26 · denied 33 (5 NOT_QUERY_RELEVANT, 15 LOW_CONFIDENCE, 13 DUPLICATE)`
- **Nothing in this plan modifies a committed report or blob** except Task 1's additive `kind` field, which is re-emitted by the backfill and must change nothing else. `snapshots/` stays at exactly 26 blobs unless a task explicitly says it writes new ones.
- Use the conditional-spread convention (`...(x !== undefined ? { x } : {})`) for optional fields.
- `toPinnedCorpus` stays pure. The comparison in `drift.ts` is pure. Everything that touches network or disk lives in the CLI.
- **`--refresh` makes no model call.** That is the decision that makes it free to run. Only `--rerun` calls the model.
- Every new test that drives the CLI must use a temp working directory and an invalid API key, exactly as `src/cli/index.test.ts` already does. **No test may write into the repository's `snapshots/`.**

### The decision that shapes this phase

`--refresh` is **compare-only by default, re-run opt-in.** `QUOTE_VANISHED` — *a claim we quoted verbatim is no longer on the page* — is an exact-substring check of the prior report's cited spans against re-fetched bytes. It needs no model. Making the most valuable thing this tool can say cost a paid analysis would mean nobody asks. So `--refresh` produces a drift report and nothing else; `--refresh --rerun` also runs `assay()` and writes a new ledger.

### The re-fetch rule

**Re-fetch everything except permalink-pinned documents.** A `permalink` is permanent by construction — re-fetching an SEC accession is pointless and can only fail — so those come from the snapshot store via `getSnapshot`. Every other document is re-fetched: `snapshot` and `hash` pins are volatile by default, and a document *declared* stable but not permalink-pinned is exactly the misdeclaration `STABILITY_VIOLATED` exists to catch.

### What a document can turn out to be

| outcome | meaning |
|---|---|
| `from-store` | permalink-pinned; bytes read from `snapshots/`, not re-fetched; unchanged by construction |
| `unchanged` | re-fetched; `driftHash` identical |
| `drifted` | re-fetched; `driftHash` differs; document was `volatile` |
| `stability-violated` | re-fetched; `driftHash` differs; document was declared `stable` |
| `unreadable` | re-fetch failed; document was readable when the ledger was made |

`unreadable` is a finding, not an error: a source that answered last month and refuses today is exactly the kind of change a diligence tool should surface.

### What `--refresh` refuses

A report whose documents lack `pin` or `driftHash` cannot be compared against anything, so `--refresh` refuses it with a message naming the report and exits 1. Today that is `reports/chime.json` — deliberately unbackfilled, because its only overlapping fixture is a probe capture from a different fetch. Refusing is the honest answer; silently comparing against nothing would be the failure this tool exists to catch.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/provenance/drift.ts` | `compareDrift(prior, fresh) → DocDrift[]`, `findVanishedQuotes(rows, freshText) → QuoteVanished[]`, `buildDriftReport(...)` — all pure |
| `src/provenance/drift.test.ts` | tests for every outcome |
| `src/report/render/drift.ts` | `renderDriftReport(report) → string` for the terminal |
| `src/report/render/drift.test.ts` | tests |
| `src/cli/refresh.ts` | the impure orchestration: load, partition, fetch/read, compare, store, render, optionally re-run |
| `src/cli/refresh.test.ts` | child-process tests against a committed report, no model call |

**Modified:**

| File | Change |
|---|---|
| `src/types.ts` | `DocSummary.kind?: SourceKind`; the `DriftReport` family of types |
| `src/report/build.ts`, `src/assay/assemble.ts` | emit `kind` into `DocSummary` |
| `src/provenance/backfill.ts` | emit `kind` when backfilling |
| `reports/{tesla-fsd,claude,vercel}.json` | gain `kind` per doc via re-running the backfill (Task 1) |
| `src/cli/args.ts` | `--refresh <report.json>` and `--rerun` |
| `src/cli/index.ts` | dispatch to `refresh.ts` when `--refresh` is given |
| `README.md` | document `--refresh`, the outcomes, and `QUOTE_VANISHED` |

**Deleted:** none.

---

### Task 1: a report knows each document's kind

**Files:**
- Modify: `src/types.ts` (`DocSummary`), `src/report/build.ts`, `src/assay/assemble.ts`, `src/provenance/backfill.ts`
- Modify: `src/report/build.test.ts`, `src/provenance/backfill.test.ts`
- Regenerate: `reports/{tesla-fsd,claude,vercel}.json`

**Interfaces:**
- Consumes: `SourceKind` from `src/types.js`.
- Produces: `DocSummary.kind?: SourceKind`, optional and additive.

**Why.** `--refresh` re-fetches from the *report*, not the plan, so it compares like with like even if the plan has since changed. `fetchCorpus` takes `SourceTarget[]`, and a `SourceTarget` needs `kind`. `kind` is carried through the fetch layer and never branched on, so adding it to the summary changes no behaviour — it just makes a report self-describing.

- [ ] **Step 1: Write the failing tests**

In `src/report/build.test.ts`, inside the existing `describe("buildReport — provenance survives the trip to DocSummary")` block, add:

```ts
  it("carries kind through to the summary", () => {
    const corpus = {
      subject: "acme",
      docs: [{
        docId: "d1", url: "https://a.example", label: "A",
        role: "claimant" as const, kind: "vendor_docs" as const,
        fetchedAt: "2026-09-05T00:00:00.000Z", title: "A", text: "body",
      }],
      failures: [],
    }
    expect(buildReport(corpus, 0, { admitted: [], denied: [] }).docs[0]!.kind).toBe("vendor_docs")
  })
```

In `src/provenance/backfill.test.ts`, inside the existing describe block, add:

```ts
  it("stamps the fixture document's kind onto the summary", () => {
    const { report: out } = backfillFromCorpus(corpus, report, dir) as { report: { docs: Record<string, unknown>[] } }
    expect(out.docs[0]!["kind"]).toBe("vendor_site")
  })
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/report/build.test.ts src/provenance/backfill.test.ts
```
Expected: both new cases FAIL — `kind` is dropped.

- [ ] **Step 3: Add the field and emit it**

In `src/types.ts`, add to `DocSummary` after `role`:

```ts
  /**
   * The source kind, carried so a saved report can rebuild the targets it was
   * made from and re-fetch them without the plan file. Optional because the
   * committed reports predate it.
   */
  kind?: SourceKind
```

In `src/report/build.ts` and `src/assay/assemble.ts`, in each `DocSummary` literal, add after the `role` field:

```ts
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
```

In `src/provenance/backfill.ts`, the fixture doc type needs `kind`, and the returned summary must carry it. Extend the `FixtureDoc` interface with `kind: SourceKind` (import the type from `../types.js`) and add `kind: fixture.kind` to the returned object.

- [ ] **Step 4: Run the suite**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: 548 passing.

- [ ] **Step 5: Re-run the backfill so the three reports carry `kind`**

```bash
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json 2>/dev/null | grep -v '^>' > /tmp/before-$f.txt
done
npm run backfill -- fixtures/tesla-fsd.json reports/tesla-fsd.json
npm run backfill -- fixtures/claude.json reports/claude.json
npm run backfill -- fixtures/vercel.json reports/vercel.json
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json 2>/dev/null | grep -v '^>' > /tmp/after-$f.txt
  diff -q /tmp/before-$f.txt /tmp/after-$f.txt && echo "$f render identical" || echo "$f RENDER CHANGED"
done
git diff --stat -- snapshots/
node -e 'const fs=require("fs");for(const f of ["tesla-fsd","claude","vercel"]){const r=JSON.parse(fs.readFileSync(`reports/${f}.json`,"utf8"));console.log(f, r.docs.filter(d=>d.kind).length,"of",r.docs.length,"have kind")}'
```
Expected: four `render identical`; no diff under `snapshots/`; tesla-fsd 10 of 10, claude 6 of 6, vercel 10 of 10. **Do not backfill chime.**

- [ ] **Step 6: Confirm only `kind` was added to each report**

```bash
git diff -U0 -- reports/ | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '"kind":' | grep . && echo "SOMETHING ELSE MOVED" || echo "only kind lines added"
```
Expected: `only kind lines added`.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/report/build.ts src/assay/assemble.ts src/provenance/backfill.ts src/report/build.test.ts src/provenance/backfill.test.ts reports/
git commit -m "feat(report): a summary carries its document's kind

So a saved report can rebuild the targets it was made from and re-fetch them
without the plan file -- comparing like with like even if the plan has since
changed. kind is carried through the fetch layer and never branched on, so
this changes no behaviour; the three backfilled reports gain the field and
render byte-identically.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: the drift types and the pure comparison

**Files:**
- Modify: `src/types.ts` (drift types)
- Create: `src/provenance/drift.ts`, `src/provenance/drift.test.ts`

**Interfaces:**
- Consumes: `DocSummary`, `Stability`, `LedgerRow` from `src/types.js`; `driftHashOf` from `src/provenance/normalize.js`.
- Produces:
  - types `DocDriftOutcome`, `DocDrift`, `QuoteVanished`, `DriftReport` in `src/types.ts`
  - `compareDrift(prior: DocSummary[], fresh: FreshDoc[]): DocDrift[]` where `FreshDoc = { docId: string; text: string } | { docId: string; failure: string }` plus a `fromStore: Set<string>` of docIds read from the store
  - `findVanishedQuotes(rows: LedgerRow[], freshText: Map<string, string>, docs: DocSummary[]): QuoteVanished[]`
  - `buildDriftReport(subject, priorGeneratedAt, docs: DocDrift[], vanished: QuoteVanished[]): DriftReport`

- [ ] **Step 1: Add the types to `src/types.ts`**

Append:

```ts
export type DocDriftOutcome =
  | "from-store" | "unchanged" | "drifted" | "stability-violated" | "unreadable"

export interface DocDrift {
  docId: string
  label: string
  url: string
  stability: Stability
  outcome: DocDriftOutcome
  priorDriftHash: string
  /** Absent for `from-store` (never recomputed) and `unreadable` (nothing to hash). */
  freshDriftHash?: string
  /** For `unreadable`: what the fetch said. */
  reason?: string
}

/** A quoted span that is no longer an exact substring of the re-fetched page. */
export interface QuoteVanished {
  topic: string
  statement: string
  docId: string
  label: string
  text: string
}

export interface DriftReport {
  subject: string
  priorGeneratedAt: string
  checkedAt: string
  docs: DocDrift[]
  vanished: QuoteVanished[]
  summary: {
    fromStore: number
    unchanged: number
    drifted: number
    stabilityViolated: number
    unreadable: number
    vanished: number
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/provenance/drift.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { DocSummary, LedgerRow } from "../types.js"
import { driftHashOf } from "./normalize.js"
import { buildDriftReport, compareDrift, findVanishedQuotes } from "./drift.js"

function prior(over: Partial<DocSummary> = {}): DocSummary {
  const text = over.driftHash === undefined ? "the original page text" : ""
  return {
    docId: "d1", url: "https://a.example", label: "A", role: "independent",
    fetchedAt: "2026-09-01T00:00:00.000Z", stability: "volatile",
    pin: { kind: "snapshot", sha256: "ab" },
    driftHash: driftHashOf(text),
    ...over,
  }
}

describe("compareDrift — one outcome per prior document", () => {
  it("reports unchanged when the drift hash matches", () => {
    const [d] = compareDrift([prior()], [{ docId: "d1", text: "the original page text" }], new Set())
    expect(d!.outcome).toBe("unchanged")
    expect(d!.freshDriftHash).toBe(d!.priorDriftHash)
  })

  it("reports drifted when a volatile document's text changed", () => {
    const [d] = compareDrift([prior()], [{ docId: "d1", text: "the page was edited" }], new Set())
    expect(d!.outcome).toBe("drifted")
    expect(d!.freshDriftHash).not.toBe(d!.priorDriftHash)
  })

  it("reports stability-violated when a declared-stable document changed", () => {
    const [d] = compareDrift(
      [prior({ stability: "stable" })],
      [{ docId: "d1", text: "the page was edited" }], new Set(),
    )
    expect(d!.outcome).toBe("stability-violated")
  })

  it("does not report drift for a change the normalizer strips", () => {
    const [d] = compareDrift(
      [prior({ driftHash: driftHashOf("updated 2026-09-01T00:00:00Z ok") })],
      [{ docId: "d1", text: "updated 2027-01-01T12:00:00Z ok" }], new Set(),
    )
    expect(d!.outcome).toBe("unchanged")
  })

  it("reports unreadable with the fetch's reason when the re-fetch failed", () => {
    const [d] = compareDrift([prior()], [{ docId: "d1", failure: "blocked" }], new Set())
    expect(d!.outcome).toBe("unreadable")
    expect(d!.reason).toBe("blocked")
    expect("freshDriftHash" in d!).toBe(false)
  })

  it("reports from-store for a document read from the snapshot store", () => {
    const [d] = compareDrift([prior({ pin: { kind: "permalink", url: "https://a.example", sha256: "ab" } })], [], new Set(["d1"]))
    expect(d!.outcome).toBe("from-store")
    expect("freshDriftHash" in d!).toBe(false)
  })

  it("reports unreadable when a document is neither fresh nor from the store", () => {
    const [d] = compareDrift([prior()], [], new Set())
    expect(d!.outcome).toBe("unreadable")
    expect(d!.reason).toMatch(/not re-fetched/)
  })

  it("keeps prior order and carries label, url and stability through", () => {
    const out = compareDrift(
      [prior({ docId: "b", label: "B" }), prior({ docId: "a", label: "A", stability: "stable" })],
      [{ docId: "a", text: "the original page text" }, { docId: "b", text: "the original page text" }],
      new Set(),
    )
    expect(out.map((d) => d.docId)).toEqual(["b", "a"])
    expect(out[1]!.stability).toBe("stable")
  })
})

describe("findVanishedQuotes — a cited span that is no longer on the page", () => {
  const docs = [prior({ docId: "d1", label: "Vendor page" })]
  const row = (text: string, docId = "d1"): LedgerRow => ({
    topic: "uptime", statement: "claims 99.9%", status: "unverified", relation: "unsupported",
    sides: [{ docId, start: 0, end: text.length, text, tag: "EXACT" }],
  })

  it("reports a quote that is no longer an exact substring", () => {
    const out = findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "we now guarantee 99.5% uptime"]]), docs)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe("we guarantee 99.9% uptime")
    expect(out[0]!.label).toBe("Vendor page")
  })

  it("does not report a quote that is still present verbatim", () => {
    expect(findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "intro. we guarantee 99.9% uptime. outro"]]), docs)).toEqual([])
  })

  it("is an exact check — a one-character paraphrase counts as vanished", () => {
    expect(findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "we guarantee 99.9% uptime!"]]), docs)).toHaveLength(0)
    expect(findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "we guarantee 99,9% uptime"]]), docs)).toHaveLength(1)
  })

  it("skips a side whose document has no fresh text, rather than calling it vanished", () => {
    expect(findVanishedQuotes([row("anything")], new Map(), docs)).toEqual([])
  })

  it("checks every side of a two-sided row", () => {
    const two: LedgerRow = {
      topic: "t", statement: "s", status: "divergent", relation: "contradicts",
      sides: [
        { docId: "d1", start: 0, end: 5, text: "alpha", tag: "EXACT" },
        { docId: "d2", start: 0, end: 4, text: "beta", tag: "EXACT" },
      ],
    }
    const both = [prior({ docId: "d1", label: "One" }), prior({ docId: "d2", label: "Two" })]
    const out = findVanishedQuotes([two], new Map([["d1", "alpha here"], ["d2", "gamma"]]), both)
    expect(out.map((v) => v.docId)).toEqual(["d2"])
  })
})

describe("buildDriftReport", () => {
  it("tallies every outcome and the vanished count", () => {
    const docs = compareDrift(
      [prior({ docId: "u" }), prior({ docId: "c" }), prior({ docId: "s", stability: "stable" }), prior({ docId: "x" }), prior({ docId: "p" })],
      [
        { docId: "u", text: "the original page text" },
        { docId: "c", text: "changed" },
        { docId: "s", text: "changed" },
        { docId: "x", failure: "timeout" },
      ],
      new Set(["p"]),
    )
    const r = buildDriftReport("X", "2026-09-01T00:00:00.000Z", docs, [
      { topic: "t", statement: "s", docId: "c", label: "C", text: "gone" },
    ])
    expect(r.summary).toEqual({ fromStore: 1, unchanged: 1, drifted: 1, stabilityViolated: 1, unreadable: 1, vanished: 1 })
    expect(r.subject).toBe("X")
    expect(typeof r.checkedAt).toBe("string")
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/provenance/drift.test.ts
```
Expected: FAIL — `Failed to resolve import "./drift.js"`.

- [ ] **Step 4: Write `src/provenance/drift.ts`**

```ts
import type { DocDrift, DocSummary, DriftReport, LedgerRow, QuoteVanished } from "../types.js"
import { driftHashOf } from "./normalize.js"

export type FreshDoc =
  | { docId: string; text: string }
  | { docId: string; failure: string }

/**
 * One outcome per document the prior ledger read, in the prior ledger's order.
 *
 * Pure: it is handed the prior manifest, whatever was re-fetched, and the set
 * of documents that were read from the snapshot store instead. Everything that
 * touches the network or the disk happens in the caller.
 *
 * Drift is judged on `driftHash`, the hash over normalized text, so a page
 * whose only change is a clock does not count. See `normalize.ts` for what
 * that normalization does and, honestly, does not catch.
 *
 * A declared-stable document that changed is `stability-violated` rather than
 * merely `drifted`: the declaration was a promise about the source, and this
 * is the evidence it was wrong. The ledger it came from is not rewritten here
 * -- the caller decides what to do with the finding.
 */
export function compareDrift(
  prior: DocSummary[],
  fresh: FreshDoc[],
  fromStore: Set<string>,
): DocDrift[] {
  const byId = new Map(fresh.map((f) => [f.docId, f]))
  return prior.map((p) => {
    const base = {
      docId: p.docId, label: p.label, url: p.url,
      stability: p.stability ?? "volatile",
      priorDriftHash: p.driftHash ?? "",
    }
    if (fromStore.has(p.docId)) {
      return { ...base, outcome: "from-store" as const }
    }
    const f = byId.get(p.docId)
    if (f === undefined) {
      return { ...base, outcome: "unreadable" as const, reason: "not re-fetched and not in the store" }
    }
    if ("failure" in f) {
      return { ...base, outcome: "unreadable" as const, reason: f.failure }
    }
    const freshDriftHash = driftHashOf(f.text)
    if (freshDriftHash === base.priorDriftHash) {
      return { ...base, outcome: "unchanged" as const, freshDriftHash }
    }
    const outcome = base.stability === "stable" ? "stability-violated" : "drifted"
    return { ...base, outcome: outcome as "stability-violated" | "drifted", freshDriftHash }
  })
}

/**
 * Every cited span in the prior ledger that is no longer an exact substring of
 * the document it was cut from.
 *
 * This is the single most valuable thing the tool can say -- a claim we quoted
 * verbatim is no longer on the page -- and it costs no model call, because it
 * is the same exact-substring check the admission gate already makes, run in
 * reverse against fresh bytes.
 *
 * It is deliberately exact. A quote that now differs by one character has
 * vanished as far as the guarantee is concerned: the ledger's offsets no longer
 * slice out what it says they do.
 *
 * A side whose document has no fresh text is skipped, not reported: "we could
 * not check" is a different fact from "it is gone", and `compareDrift` already
 * says which documents were unreadable.
 */
export function findVanishedQuotes(
  rows: LedgerRow[],
  freshText: Map<string, string>,
  docs: DocSummary[],
): QuoteVanished[] {
  const label = new Map(docs.map((d) => [d.docId, d.label]))
  const out: QuoteVanished[] = []
  for (const row of rows) {
    for (const side of row.sides) {
      const text = freshText.get(side.docId)
      if (text === undefined) continue
      if (text.includes(side.text)) continue
      out.push({
        topic: row.topic, statement: row.statement,
        docId: side.docId, label: label.get(side.docId) ?? side.docId, text: side.text,
      })
    }
  }
  return out
}

export function buildDriftReport(
  subject: string,
  priorGeneratedAt: string,
  docs: DocDrift[],
  vanished: QuoteVanished[],
): DriftReport {
  const count = (o: DocDrift["outcome"]) => docs.filter((d) => d.outcome === o).length
  return {
    subject,
    priorGeneratedAt,
    checkedAt: new Date().toISOString(),
    docs,
    vanished,
    summary: {
      fromStore: count("from-store"),
      unchanged: count("unchanged"),
      drifted: count("drifted"),
      stabilityViolated: count("stability-violated"),
      unreadable: count("unreadable"),
      vanished: vanished.length,
    },
  }
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/provenance/drift.test.ts && npm run typecheck
```
Expected: 14 passed.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/provenance/drift.ts src/provenance/drift.test.ts
git commit -m "feat(provenance): the pure drift comparison, and QUOTE_VANISHED

compareDrift judges each prior document on its normalized drift hash; a
declared-stable document that changed is stability-violated, not merely
drifted. findVanishedQuotes is the admission gate's exact-substring check run
in reverse against fresh bytes -- a claim we quoted verbatim is no longer on
the page -- and needs no model call. Both pure; the caller does the fetching.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: render a drift report

**Files:**
- Create: `src/report/render/drift.ts`, `src/report/render/drift.test.ts`

**Interfaces:**
- Consumes: `DriftReport`, `DocDrift`, `QuoteVanished` from `src/types.js`.
- Produces: `renderDriftReport(r: DriftReport): string`.

**Order is the point.** `stability-violated` first — a broken promise about a source is the loudest finding. Then vanished quotes — the guarantee no longer holds for those rows. Then unreadable, drifted, and only at the end the unchanged and from-store lists, which are the quiet majority.

- [ ] **Step 1: Write the failing tests**

Create `src/report/render/drift.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { DriftReport } from "../../types.js"
import { renderDriftReport } from "./drift.js"

const base: DriftReport = {
  subject: "Acme", priorGeneratedAt: "2026-09-01T00:00:00.000Z", checkedAt: "2026-09-11T00:00:00.000Z",
  docs: [
    { docId: "s", label: "Stable-declared docs", url: "https://a", stability: "stable", outcome: "stability-violated", priorDriftHash: "1", freshDriftHash: "2" },
    { docId: "d", label: "Status page", url: "https://b", stability: "volatile", outcome: "drifted", priorDriftHash: "3", freshDriftHash: "4" },
    { docId: "x", label: "G2", url: "https://c", stability: "volatile", outcome: "unreadable", priorDriftHash: "5", reason: "blocked" },
    { docId: "u", label: "Homepage", url: "https://d", stability: "volatile", outcome: "unchanged", priorDriftHash: "6", freshDriftHash: "6" },
    { docId: "p", label: "10-K", url: "https://e", stability: "stable", outcome: "from-store", priorDriftHash: "7" },
  ],
  vanished: [
    { topic: "uptime", statement: "claims 99.9%", docId: "d", label: "Status page", text: "we guarantee 99.9% uptime" },
  ],
  summary: { fromStore: 1, unchanged: 1, drifted: 1, stabilityViolated: 1, unreadable: 1, vanished: 1 },
}

describe("renderDriftReport", () => {
  it("leads with the subject, both timestamps and the summary line", () => {
    const out = renderDriftReport(base)
    expect(out).toContain("Acme — drift since 2026-09-01T00:00:00.000Z")
    expect(out).toContain("checked 2026-09-11T00:00:00.000Z")
    expect(out).toMatch(/1 stability violated · 1 quote vanished · 1 unreadable · 1 drifted · 1 unchanged · 1 from store/)
  })

  it("puts a stability violation before everything else", () => {
    const out = renderDriftReport(base)
    expect(out.indexOf("STABILITY VIOLATED")).toBeLessThan(out.indexOf("QUOTE VANISHED"))
    expect(out.indexOf("QUOTE VANISHED")).toBeLessThan(out.indexOf("UNREADABLE"))
    expect(out.indexOf("UNREADABLE")).toBeLessThan(out.indexOf("DRIFTED"))
  })

  it("prints the vanished quote verbatim with its topic and source", () => {
    const out = renderDriftReport(base)
    expect(out).toContain("uptime")
    expect(out).toContain("Status page")
    expect(out).toContain('"we guarantee 99.9% uptime"')
  })

  it("names the fetch reason for an unreadable document", () => {
    expect(renderDriftReport(base)).toMatch(/G2.*blocked/)
  })

  it("omits a section entirely when it is empty", () => {
    const quiet: DriftReport = {
      ...base,
      docs: base.docs.filter((d) => d.outcome === "unchanged"),
      vanished: [],
      summary: { fromStore: 0, unchanged: 1, drifted: 0, stabilityViolated: 0, unreadable: 0, vanished: 0 },
    }
    const out = renderDriftReport(quiet)
    expect(out).not.toContain("STABILITY VIOLATED")
    expect(out).not.toContain("QUOTE VANISHED")
    expect(out).toContain("nothing drifted")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/report/render/drift.test.ts
```
Expected: FAIL — `Failed to resolve import "./drift.js"`.

- [ ] **Step 3: Write `src/report/render/drift.ts`**

```ts
import type { DocDrift, DriftReport } from "../../types.js"

/**
 * The drift report for a terminal, loudest finding first.
 *
 * A declared-stable source that changed broke a promise; that goes at the top.
 * A vanished quote means the ledger's guarantee no longer holds for that row;
 * that goes next. Unreadable sources and ordinary drift follow. The unchanged
 * and from-store lists come last, because they are the quiet majority and the
 * reader came for what moved.
 */
export function renderDriftReport(r: DriftReport): string {
  const s = r.summary
  const lines: string[] = [
    "",
    `  ${r.subject} — drift since ${r.priorGeneratedAt}`,
    `  checked ${r.checkedAt}`,
    "",
    `  ${s.stabilityViolated} stability violated · ${s.vanished} quote vanished · ` +
      `${s.unreadable} unreadable · ${s.drifted} drifted · ${s.unchanged} unchanged · ${s.fromStore} from store`,
    "",
  ]

  const section = (title: string, rule: string, docs: DocDrift[], line: (d: DocDrift) => string) => {
    if (docs.length === 0) return
    lines.push(`  ${title}`, `  ${rule}`, "")
    for (const d of docs) lines.push(`    ${line(d)}`)
    lines.push("")
  }
  const of = (o: DocDrift["outcome"]) => r.docs.filter((d) => d.outcome === o)

  section(
    "STABILITY VIOLATED — declared stable, and it changed",
    "-".repeat(50),
    of("stability-violated"),
    (d) => `${d.label}  ${d.url}`,
  )

  if (r.vanished.length > 0) {
    lines.push("  QUOTE VANISHED — cited verbatim, no longer on the page", "  " + "-".repeat(54), "")
    for (const v of r.vanished) {
      lines.push(`    ${v.topic}  [${v.label}]`, `      "${v.text}"`, "")
    }
  }

  section("UNREADABLE — read when the ledger was made, refused now", "-".repeat(56), of("unreadable"),
    (d) => `${d.label}  (${d.reason ?? "unknown"})`)
  section("DRIFTED — volatile, and it changed", "-".repeat(35), of("drifted"),
    (d) => `${d.label}  ${d.url}`)

  const quiet = [...of("unchanged"), ...of("from-store")]
  if (s.stabilityViolated + s.vanished + s.unreadable + s.drifted === 0) {
    lines.push("  nothing drifted", "")
  }
  if (quiet.length > 0) {
    lines.push("  unchanged", "")
    for (const d of quiet) {
      lines.push(`    ${d.outcome === "from-store" ? "from store " : "re-fetched "} ${d.label}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/report/render/drift.test.ts && npm run typecheck
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/report/render/drift.ts src/report/render/drift.test.ts
git commit -m "feat(render): the drift report, loudest finding first

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `--refresh` and `--rerun` flags

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/args.test.ts`

**Interfaces:**
- Produces: `CliOptions.refresh?: string` (a report path) and `CliOptions.rerun: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/cli/args.test.ts` (reuse whatever `parseArgs` fixtures the file already has):

```ts
describe("--refresh and --rerun", () => {
  it("accepts --refresh with a report path", () => {
    expect(parseArgs(["x", "--refresh", "reports/tesla-fsd.json"]).refresh).toBe("reports/tesla-fsd.json")
  })

  it("defaults rerun to false", () => {
    expect(parseArgs(["x", "--refresh", "r.json"]).rerun).toBe(false)
  })

  it("accepts --rerun alongside --refresh", () => {
    expect(parseArgs(["x", "--refresh", "r.json", "--rerun"]).rerun).toBe(true)
  })

  it("refuses --rerun without --refresh", () => {
    expect(() => parseArgs(["x", "--rerun"])).toThrow(/--rerun requires --refresh/)
  })

  it("refuses --refresh together with --from-fixture", () => {
    expect(() => parseArgs(["x", "--refresh", "r.json", "--from-fixture", "f.json"])).toThrow(/--refresh/)
  })

  it("refuses --refresh together with --render", () => {
    expect(() => parseArgs(["x", "--refresh", "r.json", "--render", "r.json"])).toThrow(/--refresh/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/cli/args.test.ts -t "refresh and"
```
Expected: FAIL — unknown option.

- [ ] **Step 3: Add the flags**

In `src/cli/args.ts`: add `"--refresh"` to `VALUE_FLAGS` and `"--rerun"` to `BOOL_FLAGS`; add `refresh?: string` and `rerun: boolean` to `CliOptions`; populate them where the other flags are read. Then add the three exclusion checks beside the existing ones (the file already refuses `--fetch-only` with `--from-fixture`; follow that shape):

```ts
  if (rerun && refresh === undefined) throw new Error("receipts: --rerun requires --refresh")
  if (refresh !== undefined && fromFixture !== undefined) throw new Error("receipts: --refresh re-fetches the report's own sources; it cannot take --from-fixture")
  if (refresh !== undefined && render !== undefined) throw new Error("receipts: --refresh and --render are different modes; pass one")
```

- [ ] **Step 4: Run the suite**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: 573 passing (567 + 6).

- [ ] **Step 5: Add the flags to USAGE in `src/cli/index.ts`**

```
  --refresh <report.json> re-fetch that report's sources and print what changed
                          (drifted, stability violated, unreadable, quotes vanished).
                          Makes no model call. Commits the new bytes to snapshots/.
  --rerun                 with --refresh: also run the analysis on the fresh bytes
                          and write a new ledger (one model call).
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts src/cli/index.ts
git commit -m "feat(cli): --refresh and --rerun flags

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: the refresh orchestration

**Files:**
- Create: `src/cli/refresh.ts`
- Modify: `src/cli/index.ts` (dispatch)

**Interfaces:**
- Consumes: `compareDrift`, `findVanishedQuotes`, `buildDriftReport` (Task 2); `renderDriftReport` (Task 3); `getSnapshot`, `storeCorpus`, `fetchCorpus`; `isRefusal`.
- Produces: `runRefresh(opts: CliOptions, fetchOpts: FanOptions): Promise<{ report: DriftReport; freshCorpus: Corpus; prior: Report }>` — returns rather than exits, so `index.ts` owns the exit code and `--rerun` (Task 6) can continue from the fresh corpus.

- [ ] **Step 1: Write `src/cli/refresh.ts`**

```ts
import { readFileSync } from "node:fs"
import type { FanOptions } from "../fetch/fan.js"
import { fetchCorpus } from "../fetch/fan.js"
import { buildDriftReport, compareDrift, findVanishedQuotes, type FreshDoc } from "../provenance/drift.js"
import { getSnapshot } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
import { isRefusal } from "../assay/types.js"
import type { Corpus, DriftReport, FetchedDoc, Report, Refusal, SourceTarget } from "../types.js"

/**
 * Re-fetch a saved ledger's sources and report what changed. No model call.
 *
 * The prior report is the source of truth for what to fetch: its documents, at
 * their recorded urls and kinds, so the comparison is like with like even if
 * the plan file has since changed. Permalink-pinned documents are read from the
 * snapshot store rather than re-fetched -- a permanent url is permanent by
 * construction, and re-fetching an SEC accession is pointless and can only
 * fail. Everything else is re-fetched, including documents declared stable
 * that are not permalink-pinned: that is exactly the misdeclaration
 * STABILITY_VIOLATED exists to catch.
 */
export async function runRefresh(
  reportPath: string,
  fetchOpts: Omit<FanOptions, "labels">,
): Promise<{ drift: DriftReport; fresh: Corpus; prior: Report }> {
  const saved = JSON.parse(readFileSync(reportPath, "utf8")) as Report | Refusal
  if (isRefusal(saved)) {
    throw new Error(`receipts: ${reportPath} is a refusal, not a ledger; there are no rows to check`)
  }
  const prior = saved
  const missing = prior.docs.filter((d) => d.pin === undefined || d.driftHash === undefined || d.kind === undefined)
  if (missing.length > 0) {
    throw new Error(
      `receipts: ${reportPath} carries no provenance for ${missing.length} of ${prior.docs.length} documents ` +
        `(${missing.slice(0, 3).map((d) => d.label).join(", ")}${missing.length > 3 ? ", …" : ""}); ` +
        `nothing to compare against. A report needs pins and drift hashes before it can be refreshed.`,
    )
  }

  // Partition: permalink-pinned comes from the store, everything else is re-fetched.
  const fromStore = new Set<string>()
  const storeDocs: FetchedDoc[] = []
  const targets: SourceTarget[] = []
  for (const d of prior.docs) {
    if (d.pin!.kind === "permalink") {
      const entry = getSnapshot(d.pin!.sha256)
      fromStore.add(d.docId)
      storeDocs.push({
        docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind!,
        fetchedAt: entry.fetchedAt, title: d.label, text: entry.content,
        ...(d.stability !== undefined ? { stability: d.stability } : {}),
      })
    } else {
      targets.push({
        kind: d.kind!, role: d.role, url: d.url, label: d.label,
        ...(d.stability !== undefined ? { stability: d.stability } : {}),
      })
    }
  }

  console.error(`refreshing ${prior.docs.length} sources: ${targets.length} to re-fetch, ${fromStore.size} from the store`)
  const refetched = targets.length > 0
    ? await fetchCorpus(prior.subject, targets, { ...fetchOpts, ...(prior.labels ? { labels: prior.labels } : {}) })
    : { subject: prior.subject, docs: [], failures: [] }

  // The re-fetched bytes are real captures and belong in the store, whatever
  // the comparison says about them. Guarded like every other store write.
  try {
    storeCorpus(refetched)
  } catch (err) {
    console.error(`could not commit re-fetched bytes: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Match re-fetched docs back to prior ones by docId (both derive it from the url).
  const freshDocs: FreshDoc[] = [
    ...refetched.docs.map((d) => ({ docId: d.docId, text: d.text })),
    ...refetched.failures.map((f) => {
      const p = prior.docs.find((d) => d.url === f.url)
      return { docId: p?.docId ?? f.url, failure: f.reason }
    }),
  ]
  const freshText = new Map<string, string>([
    ...refetched.docs.map((d): [string, string] => [d.docId, d.text]),
    ...storeDocs.map((d): [string, string] => [d.docId, d.text]),
  ])

  const docs = compareDrift(prior.docs, freshDocs, fromStore)
  const vanished = findVanishedQuotes(prior.rows, freshText, prior.docs)
  const drift = buildDriftReport(prior.subject, prior.generatedAt, docs, vanished)

  const fresh: Corpus = {
    subject: prior.subject,
    docs: [...storeDocs, ...refetched.docs],
    failures: refetched.failures,
    ...(prior.labels ? { labels: prior.labels } : {}),
  }
  return { drift, fresh, prior }
}
```

- [ ] **Step 2: Dispatch from `src/cli/index.ts`**

Immediately after the `--render` block and before the API-key check, add:

```ts
if (opts.refresh) {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) die("SOLARI_API_KEY is not set. --refresh re-fetches the report's sources.")
  let result
  try {
    result = await runRefresh(opts.refresh, {
      apiKey, concurrency: opts.concurrency, stealth: opts.stealth,
      proxyCountry: opts.proxy, captcha: opts.captcha,
      ...(opts.proxySession !== undefined ? { proxySession: opts.proxySession } : {}),
      ...(opts.profileId !== undefined ? { profileId: opts.profileId } : {}),
    })
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
  console.log(opts.asJson ? JSON.stringify(result.drift, null, 2) : renderDriftReport(result.drift))
  if (!opts.rerun) {
    // A drift report is a result. Exit 0 whether or not anything drifted:
    // "nothing changed" is a finding too, and a script can read the summary.
    process.exitCode = 0
    // fall through to end of module; nothing below runs because `opts.refresh`
    // is checked again before the fetch path (Step 3)
  }
  // --rerun continues in Task 6
}
```

Copy the exact `fetchCorpus` option construction the file already uses for the fresh-run path so `--refresh` fetches under the same settings; do not invent a second set of defaults.

- [ ] **Step 3: Make the rest of the module skip when refreshing**

The module body below is the fresh-run path. Guard it so a `--refresh` without `--rerun` does not fall into it. Find where `corpus` is assigned (the `if (opts.fromFixture) { … } else { … fetchCorpus … }` block) and wrap the entire remainder of the module from that point in:

```ts
if (!opts.refresh || opts.rerun) {
  // …existing fresh-run body, unchanged…
}
```

Do not restructure the body; indent it and leave every statement as it is. Task 6 makes the `--rerun` branch reuse the fresh corpus instead of fetching again.

- [ ] **Step 4: Typecheck and run the suite**

```bash
npm run typecheck && npm test 2>&1 | tail -3
```
Expected: typecheck silent; 573 passing (no new tests yet — Task 6 adds the child-process test once `--rerun` is wired, so the whole path is tested at once).

- [ ] **Step 5: Confirm the committed reports and store are untouched**

```bash
git status --porcelain
for f in tesla-fsd claude vercel chime; do
  npm run cli -- x --render reports/$f.json >/dev/null 2>&1; echo "$f exit=$?"
done
```
Expected: only the two source files; four `exit=0`; nothing under `snapshots/` or `reports/`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/refresh.ts src/cli/index.ts
git commit -m "feat(cli): --refresh re-fetches a ledger's sources and reports the drift

Permalink-pinned documents come from the store -- re-fetching an SEC accession
is pointless and can only fail. Everything else is re-fetched, including
declared-stable documents that are not permalink-pinned, which is exactly the
misdeclaration STABILITY_VIOLATED exists to catch. No model call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `--rerun`, and the end-to-end test

**Files:**
- Modify: `src/cli/index.ts`
- Create: `src/cli/refresh.test.ts`

**Interfaces:**
- Consumes: `runRefresh` (Task 5).
- Produces: `--refresh --rerun` runs `assay()` on the fresh corpus and writes a new ledger to the same path.

- [ ] **Step 1: Wire `--rerun`**

In the fresh-run body guarded in Task 5 Step 3, the corpus is currently obtained by `--from-fixture` or `fetchCorpus`. Add a third branch at the top of that block: if `opts.refresh && opts.rerun`, take `corpus = result.fresh` from the refresh result instead of fetching (the bytes were just fetched and stored). Everything after — `storeCorpus` (a no-op now, every blob exists), `analyzeCorpus`, rendering, exit code — runs unchanged. After rendering, write the new ledger back to `opts.refresh`:

```ts
if (opts.refresh && opts.rerun) {
  writeFileSync(opts.refresh, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.error(`wrote ${opts.refresh}`)
}
```

- [ ] **Step 2: Write the end-to-end test**

Create `src/cli/refresh.test.ts`. Follow `src/cli/index.test.ts` exactly for spawning the CLI in a temp cwd with an env built from scratch. The test cannot fetch (no Solari key, no network) — so it drives the **refusal** and **argument** paths, which are the parts that do not need a fetch, and asserts the drift machinery is reachable:

```ts
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// Same locating pattern as src/cli/index.test.ts — do not use import.meta.dirname,
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

  it("refuses a saved refusal — there are no rows to check", () => {
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

  it("reaches the fetch for a report that has provenance, and fails there on the invalid key", () => {
    // The committed Tesla report has full provenance. With an invalid Solari
    // key the re-fetch fails, which proves the run got past every guard and
    // into the fetch -- the furthest a keyless test can go.
    const r = run(["x", "--refresh", join(REPO, "reports", "tesla-fsd.json")])
    expect(r.stderr).toMatch(/refreshing 10 sources: 9 to re-fetch, 1 from the store/)
  })
})
```

- [ ] **Step 3: Run to verify**

```bash
npx vitest run src/cli/refresh.test.ts
```
Expected: 4 passed. The last case depends on the Tesla report's exact partition — 9 re-fetched (`snapshot` pins) and 1 from the store (the permalink-pinned 10-K). If the numbers differ, the partition rule is wrong, not the test.

- [ ] **Step 4: Run the full suite and confirm no data moved**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
git status --porcelain
ls snapshots | wc -l
```
Expected: 577 passing; only source files changed; 26 blobs.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/refresh.test.ts
git commit -m "feat(cli): --rerun analyses the fresh bytes and writes a new ledger

The opt-in that costs a model call. --refresh alone stays free.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: document `--refresh`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the "What this does not yet do" paragraph**

The README's "What a pin is" section ends with a paragraph saying nothing re-fetches, nothing compares two runs, and no drift is reported. All three are now false. Replace it with a section describing `--refresh`:

- what it does: re-fetches a saved ledger's sources (permalink-pinned ones come from the store) and reports what changed, **without a model call**;
- the five outcomes, in the order the renderer prints them, one line each;
- **`QUOTE VANISHED`** as its own paragraph — a claim we quoted verbatim is no longer on the page; the admission gate's exact-substring check run in reverse; needs no model, which is why `--refresh` is free to run;
- `--rerun` as the opt-in that also writes a new ledger, at the cost of one model call;
- what it refuses: a report with no provenance (today, chime), because comparing against nothing would be the failure this tool exists to catch;
- an honest limit: `--refresh` has not yet been run against a live source in this repository, because the only committed reports were backfilled from fixtures and the Solari account was exhausted when this was built. State that plainly rather than implying it has been exercised end to end.

- [ ] **Step 2: Update the test count**

```bash
npm test 2>&1 | grep -E "^\s+Tests"
```
Put the real number in the Development section.

- [ ] **Step 3: Verify every sentence**

Re-read against `src/cli/refresh.ts`, `src/provenance/drift.ts` and `src/report/render/drift.ts`. This project's persistent defect — seven consecutive branches — is prose that outruns its code. Do not claim `--refresh` has been run live if it has not.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): --refresh, the five outcomes, and QUOTE VANISHED

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** The spec's Mode 3 and `drift.ts` section, reconciled against the compare-only decision:

| Spec requirement | Task |
|---|---|
| Load the prior manifest | 5 |
| Re-fetch volatile + stable-but-not-permalink; permalink from the store | 5 (the re-fetch rule) |
| Compare `driftHash` per document | 2 |
| `STABILITY_VIOLATED` | 2, rendered first in 3 |
| `QUOTE_VANISHED` | 2, rendered second in 3 |
| Drift report with per-document outcomes | 2, 3 |
| Store the new bytes | 5 |
| Re-run `assay()` and write a new ledger | 6 (opt-in via `--rerun`) |
| Documentation | 7 |

**Deliberately not done, and why:** the spec's drift report joins "rows added / removed / status-changed" to their cause. That needs a *new* ledger to diff against, which only `--rerun` produces, and row-level diffing across two non-deterministic model runs is a different problem from source drift. `QUOTE_VANISHED` is the row-level signal that does not need a second run; the rest is recorded for a later phase. Also deferred: permalink *derivation* (fetching a Wikipedia article to learn its `oldid`) and archive submission — both were deferred from 2a and remain so.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Task 5 Step 2 says to copy the existing `fetchCorpus` option construction rather than reproducing it, and says why.

**Type consistency.** `DocDrift`, `QuoteVanished`, `DriftReport`, `DocDriftOutcome` are declared in Task 2's Step 1 (in `src/types.ts`) and consumed unchanged in Tasks 3 and 5. `FreshDoc` is exported from `drift.ts` in Task 2 and imported in Task 5. `compareDrift(prior, fresh, fromStore)`, `findVanishedQuotes(rows, freshText, docs)` and `buildDriftReport(subject, priorGeneratedAt, docs, vanished)` have the same arity in Tasks 2 and 5. `runRefresh(reportPath, fetchOpts)` returns `{ drift, fresh, prior }` in Task 5 and is consumed with those names in Task 6. `DocSummary.kind?` is added in Task 1 and required non-undefined by Task 5's provenance check.

**Three risks worth naming.**
1. **`--refresh` cannot be exercised live in this repository today.** The Solari account was exhausted when this was built, and all committed reports were backfilled from fixtures. Task 6's test proves the run reaches the fetch and fails there on the invalid key — that is the furthest a keyless test can go. Task 7 must say this plainly.
2. **Task 5 Step 3 wraps the entire fresh-run body of `src/cli/index.ts` in a guard.** That is a large indentation change to a file that has been edited carefully across three phases. The instruction is to indent and leave every statement as it is; an implementer who "tidies" while indenting risks the exact kind of silent control-flow change the last branch's reviews kept catching.
3. **Matching re-fetch failures back to prior docs is by `url`** (Task 5), because a `SourceFailure` carries no `docId`. Two prior documents at the same url (possible in principle, not in any committed report) would both match the first. Recorded, not fixed.

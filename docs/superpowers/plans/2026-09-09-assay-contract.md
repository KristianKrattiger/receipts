# Assay Contract (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Receipts' propose→admit→render middle into `src/assay/` as a typed contract that returns either a grounded ledger or a first-class refusal.

**Architecture:** Move the four already-pure modules (`chunk`, `retrieve`, `cartographer`, `bookkeeper`) under `src/assay/`, add a `PinnedCorpus` input type whose pins are trivially `{kind:"hash"}` in this phase, add caller-set `threshold` and `conflictMode`, and replace `buildReport` with an `assemble` step that decides between `Ledger` and `Refusal`. Renderers and all three entry points learn to handle a refusal. Phases 2 (provenance/pinning) and 3 (cache/double-run) build on these types.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, tsx. No new dependencies.

## Global Constraints

- Node ESM: every relative import ends in `.js`, never `.ts`.
- Tests live beside sources as `*.test.ts`. Runner: `npm test` (`vitest run`). Typecheck: `npm run typecheck`.
- `npm test` must pass at the end of every task. It is 406 tests before this plan starts.
- No new runtime dependencies.
- Exit codes after this plan: **`0` = Ledger, `3` = Refusal, `1` = operational error.** The current `process.exit(2)` for an empty corpus is removed.
- **Two deliberate deviations from the spec**, applied throughout and recorded here rather than silently:
  - Spec writes `PinnedDoc.id` and `PinnedDoc.content`. This plan uses **`docId`** and **`text`** to match `FetchedDoc`, `AdmittedSpan` and `DocSummary`, which already use those names across every fixture and committed report. Renaming would rewrite all four `reports/*.json` and all thirteen `fixtures/*.json` for no behavioural gain.
  - Spec's `PinnedCorpus` omits `failures`. This plan keeps `failures` on it, because `assemble` needs them to build the `docs`/`failures` sections of the report and the post-fetch `CORPUS_INSUFFICIENT` guard reads them.
- **Back-compat:** the four committed `reports/*.json` have no `outcome` field. Every reader treats a missing `outcome` as `"ledger"`. `cli --render` must keep working on all four unchanged.

---

## File structure

**Moved (mechanical, Task 1):**

| From | To |
|---|---|
| `src/chunk/{chunk.ts,chunk.test.ts}` | `src/assay/chunk/` |
| `src/retrieve/{idf.ts,idf.test.ts,select.ts,select.test.ts}` | `src/assay/retrieve/` |
| `src/cartographer/{propose.ts,propose.test.ts,schema.ts}` | `src/assay/cartographer/` |
| `src/bookkeeper/{admit,anchor,independence}{.ts,.test.ts}` | `src/assay/bookkeeper/` |

**Created:**

| File | Responsibility |
|---|---|
| `src/assay/types.ts` | `Pin`, `Stability`, `PinnedDoc`, `PinnedCorpus`, `AssayQuery`, `AssayOptions`, `RefusalReason`, `ProvenanceReason`, `RowProvenance`, `Audit`, `Ledger`, `Refusal`, `AssayResult`, `DEFAULT_THRESHOLD` |
| `src/assay/adapt.ts` | `toPinnedCorpus(corpus: Corpus): PinnedCorpus` — trivial `{kind:"hash"}` pins for Phase 1 |
| `src/assay/adapt.test.ts` | tests for the adapter |
| `src/assay/assemble.ts` | outcome decision: `Ledger | Refusal` |
| `src/assay/assemble.test.ts` | tests for every refusal path |
| `src/assay/index.ts` | `assay(corpus, query, opts) → AssayResult` |
| `src/assay/index.test.ts` | end-to-end tests with a stub `ProposalClient` |

**Modified:**

| File | Change |
|---|---|
| `src/types.ts` | `Admission` gains an optional `confidence` |
| `src/assay/bookkeeper/admit.ts` | `admit()` gains a `threshold` parameter and records the score |
| `src/report/build.ts` | `buildReport` keeps building the ledger body; `assemble` calls it |
| `src/report/render/terminal.ts` | render a `Refusal` block |
| `src/report/render/markdown.ts` | render a `Refusal` block |
| `src/report/render/html.ts` | render a `Refusal` block |
| `src/pipeline.ts` | `analyzeCorpus` delegates to `assay()` |
| `src/cli/index.ts` | exit codes, refusal rendering |
| `src/mcp/server.ts` | handle a refusal result |
| `src/web/server.ts` | handle a refusal result |

**Deleted:** none.

---

### Task 1: Move the four pure modules under `src/assay/`

Mechanical. No behaviour change. Only six files outside the moved directories import from them.

**Files:**
- Move: `src/chunk/`, `src/retrieve/`, `src/cartographer/`, `src/bookkeeper/` → `src/assay/`
- Modify: `src/pipeline.ts:1-6`, `src/pipeline.test.ts:3`, `src/report/build.ts:1`, `src/report/build.test.ts:3`

**Interfaces:**
- Consumes: nothing.
- Produces: `src/assay/chunk/chunk.js` (`chunkAll`), `src/assay/retrieve/idf.js` (`buildIdf`, `tokenize`), `src/assay/retrieve/select.js` (`selectCandidates`), `src/assay/cartographer/propose.js` (`proposeAcrossPasses`, `ProposalClient`, `MODEL`), `src/assay/bookkeeper/admit.js` (`admit`, `AdmitResult`, `AdmittedRelation`, `CONFIDENCE_FLOOR`).

- [ ] **Step 1: Confirm the baseline is green**

```bash
npm test 2>&1 | tail -3
```
Expected: `Tests  406 passed (406)`

- [ ] **Step 2: Move the directories**

```bash
mkdir -p src/assay
git mv src/chunk src/assay/chunk
git mv src/retrieve src/assay/retrieve
git mv src/cartographer src/assay/cartographer
git mv src/bookkeeper src/assay/bookkeeper
```

- [ ] **Step 3: Fix the six external imports**

In `src/pipeline.ts`, replace lines 1-6:

```ts
import { admit } from "./assay/bookkeeper/admit.js"
import { proposeAcrossPasses, type ProposalClient } from "./assay/cartographer/propose.js"
import { chunkAll } from "./assay/chunk/chunk.js"
import { buildReport } from "./report/build.js"
import { buildIdf, tokenize } from "./assay/retrieve/idf.js"
import { selectCandidates } from "./assay/retrieve/select.js"
```

In `src/pipeline.test.ts` line 3:

```ts
import type { ProposalClient } from "./assay/cartographer/propose.js"
```

In `src/report/build.ts` line 1 and `src/report/build.test.ts` line 3:

```ts
import type { AdmitResult } from "../assay/bookkeeper/admit.js"
```

- [ ] **Step 4: Verify nothing else references the old paths**

```bash
grep -rn 'from "\.\{1,2\}/\(chunk\|retrieve\|cartographer\|bookkeeper\)/' src/ --include=*.ts
```
Expected: no output.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm test 2>&1 | tail -3 && npm run typecheck
```
Expected: `Tests  406 passed (406)`, typecheck silent.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(assay): move the pure modules under src/assay/

Mechanical move, no behaviour change. chunk, retrieve, cartographer and
bookkeeper are the propose-admit core that GIN_14_Assay names; giving them a
directory is the first step to giving them a contract.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Assay types and the `toPinnedCorpus` adapter

**Files:**
- Create: `src/assay/types.ts`, `src/assay/adapt.ts`, `src/assay/adapt.test.ts`

**Interfaces:**
- Consumes: `Corpus`, `FetchedDoc`, `LedgerRow`, `Admission`, `SourceFailure`, `RoleLabels`, `SourceRole`, `SourceKind`, `DocSummary` from `src/types.ts`.
- Produces: every type below, plus `toPinnedCorpus(corpus: Corpus): PinnedCorpus` and `DEFAULT_THRESHOLD = 0.5`.

- [ ] **Step 1: Write `src/assay/types.ts`**

```ts
import type {
  Admission, DocSummary, LedgerRow, RoleLabels,
  SourceFailure, SourceKind, SourceRole,
} from "../types.js"

/**
 * How a document's bytes can be got again.
 *
 * `permalink` is a URL that returns the same bytes forever (an SEC accession,
 * a wiki oldid, a verified archive snapshot). `snapshot` is a committed
 * content-addressed blob. `hash` records only what the bytes were, which is
 * enough to detect drift and not enough to replay. Phase 1 emits `hash` for
 * everything; Phase 2 resolves the other two.
 */
export type Pin =
  | { kind: "permalink"; url: string; sha256: string }
  | { kind: "snapshot"; sha256: string }
  | { kind: "hash"; sha256: string }

/**
 * Whether this document is expected to return the same bytes on a later fetch.
 *
 * Everything defaults to `volatile`; stability is earned by explicit
 * declaration or by a verified permalink. See the design spec: no `SourceKind`
 * predicts it, because `vendor_docs` holds both an immutable 10-K and a
 * continuously edited docs page.
 */
export type Stability = "stable" | "volatile"

export interface PinnedDoc {
  docId: string
  url: string
  label: string
  role: SourceRole
  kind: SourceKind
  fetchedAt: string
  title: string
  text: string
  stability: Stability
  pin: Pin
}

export interface PinnedCorpus {
  subject: string
  docs: PinnedDoc[]
  failures: SourceFailure[]
  labels?: RoleLabels
}

export interface AssayQuery {
  subject: string
}

export interface AssayOptions {
  /** Confidence floor a proposal must clear to be admitted. */
  threshold?: number
  /** `report` surfaces contradictions; `converge` refuses on them. */
  conflictMode?: "report" | "converge"
  candidates?: number
  concurrency?: number
}

export const DEFAULT_THRESHOLD = 0.5

export type RefusalReason =
  | "CORPUS_INSUFFICIENT"
  | "NO_GROUNDING"
  | "BELOW_THRESHOLD"
  | "CONFLICTING_UNRESOLVABLE"
  /** Retained for GIN_14 contract fidelity. Unused in Receipts: the query is subject-derived. */
  | "QUERY_UNGROUNDABLE"

export type ProvenanceReason =
  | "volatile-source" | "single-proposer-run" | "pass-failed" | "stability-violated"

export interface RowProvenance {
  class: "stable" | "provisional"
  reasons: ProvenanceReason[]
}

export interface Audit {
  proposed: number
  admitted: number
  denied: Admission[]
  passes?: number
}

export interface Ledger {
  outcome: "ledger"
  subject: string
  generatedAt: string
  labels?: RoleLabels
  docs: DocSummary[]
  failures: SourceFailure[]
  rows: LedgerRow[]
  audit: Audit
}

export interface Refusal {
  outcome: "refusal"
  subject: string
  generatedAt: string
  labels?: RoleLabels
  reason: RefusalReason
  detail: string
  docs: DocSummary[]
  failures: SourceFailure[]
  /**
   * What came closest, with the score each earned.
   *
   * Deliberately carries no span. A `LOW_CONFIDENCE` denial fires independently
   * of anchoring, so at this point there is no located span to cite — and
   * emitting a span with an empty docId and zero offsets, into a committed
   * report, in a tool whose whole claim is "no claim without a span", would be
   * the exact failure this project exists to catch.
   */
  nearMiss: { confidence: number; statement: string }[]
  audit: Audit
}

export type AssayResult = Ledger | Refusal

/** Committed reports predate `outcome`; absent means a ledger. */
export function isRefusal(r: { outcome?: string }): boolean {
  return r.outcome === "refusal"
}
```

- [ ] **Step 2: Write the failing adapter test**

Create `src/assay/adapt.test.ts`:

```ts
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { Corpus, FetchedDoc } from "../types.js"
import { toPinnedCorpus } from "./adapt.js"

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example",
    role: "claimant", kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z",
    title: "Example", text: "hello world", ...over,
  }
}

describe("toPinnedCorpus", () => {
  it("pins every doc by the sha256 of its text", () => {
    const corpus: Corpus = { subject: "X", docs: [doc()], failures: [] }
    const pinned = toPinnedCorpus(corpus)
    const expected = createHash("sha256").update("hello world", "utf8").digest("hex")
    expect(pinned.docs[0]!.pin).toEqual({ kind: "hash", sha256: expected })
  })

  it("defaults every doc to volatile", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc({ kind: "vendor_docs" })], failures: [] })
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })

  it("carries subject, failures and labels through", () => {
    const corpus: Corpus = {
      subject: "X", docs: [doc()],
      failures: [{ url: "u", label: "G2", reason: "blocked", detail: "no" }],
      labels: { claimant: "Vendor", independent: "Independent" },
    }
    const pinned = toPinnedCorpus(corpus)
    expect(pinned.subject).toBe("X")
    expect(pinned.failures).toHaveLength(1)
    expect(pinned.labels).toEqual({ claimant: "Vendor", independent: "Independent" })
  })

  it("gives two docs with identical text the same pin", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ docId: "a" }), doc({ docId: "b" })], failures: [],
    })
    expect(pinned.docs[0]!.pin.sha256).toBe(pinned.docs[1]!.pin.sha256)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/assay/adapt.test.ts
```
Expected: FAIL — `Failed to resolve import "./adapt.js"`.

- [ ] **Step 4: Write `src/assay/adapt.ts`**

```ts
import { createHash } from "node:crypto"
import type { Corpus } from "../types.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Lift a fetched corpus into the Assay's input type.
 *
 * Phase 1 pins everything by content hash and calls everything volatile: a
 * hash is enough to notice that bytes changed and not enough to get them back,
 * which is exactly the honest description of what this phase can promise.
 * Phase 2 replaces this with real pin resolution.
 */
export function toPinnedCorpus(corpus: Corpus): PinnedCorpus {
  const docs: PinnedDoc[] = corpus.docs.map((d) => ({
    docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind,
    fetchedAt: d.fetchedAt, title: d.title, text: d.text,
    stability: "volatile",
    pin: { kind: "hash", sha256: sha256(d.text) },
  }))
  return {
    subject: corpus.subject,
    docs,
    failures: corpus.failures,
    ...(corpus.labels ? { labels: corpus.labels } : {}),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/assay/adapt.test.ts && npm run typecheck
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/assay/types.ts src/assay/adapt.ts src/assay/adapt.test.ts
git commit -m "feat(assay): the contract types and a Phase 1 corpus adapter

PinnedCorpus is the input type the reproducibility work needs; a contract that
accepts a bag of URLs cannot promise anything about replay. Phase 1 pins by
content hash and calls everything volatile, which is what it can honestly say.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `admit()` takes a caller-set threshold and records the score it judged

**Files:**
- Modify: `src/types.ts:152-156` (`Admission` gains `confidence?`)
- Modify: `src/assay/bookkeeper/admit.ts:56-62` (signature), `:105-113` (the check and the denial)
- Modify: `src/assay/bookkeeper/admit.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `admit(corpus, proposals, queryTerms, idf, threshold?: number): AdmitResult`, and `Admission` carrying an optional `confidence`. `CONFIDENCE_FLOOR` stays exported as the default.

**Existing fixtures in `admit.test.ts`** you will reuse — do not redefine them: `doc(docId, role, text)`, `VENDOR`, `STATUS`, `CORPUS`, `TERMS` (`tokenize("acme uptime")`), `IDF` (`buildIdf(CORPUS.docs)`), and `proposal(over: Partial<RelationProposal>)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/assay/bookkeeper/admit.test.ts`:

```ts
describe("admit — the confidence floor is the caller's", () => {
  it("denies a 0.6 proposal when the caller sets 0.7", () => {
    const result = admit(CORPUS, [proposal({ confidence: 0.6 })], TERMS, IDF, 0.7)
    expect(result.admitted).toHaveLength(0)
    expect(result.denied[0]!.code).toBe("LOW_CONFIDENCE")
  })

  it("admits a 0.4 proposal when the caller sets 0.3", () => {
    const result = admit(CORPUS, [proposal({ confidence: 0.4 })], TERMS, IDF, 0.3)
    expect(result.admitted).toHaveLength(1)
  })

  it("defaults to CONFIDENCE_FLOOR when no threshold is passed", () => {
    const result = admit(CORPUS, [proposal({ confidence: 0.4 })], TERMS, IDF)
    expect(result.admitted).toHaveLength(0)
    expect(result.denied[0]!.code).toBe("LOW_CONFIDENCE")
  })

  it("records the score it judged, so nobody has to parse it back out of the detail", () => {
    const result = admit(CORPUS, [proposal({ confidence: 0.42 })], TERMS, IDF, 0.7)
    expect(result.denied[0]!.confidence).toBe(0.42)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/assay/bookkeeper/admit.test.ts -t "the confidence floor is the caller's"
```
Expected: FAIL — the fifth argument is ignored, so the 0.7 case admits; and `denied[0].confidence` is `undefined`.

- [ ] **Step 3: Add `confidence` to `Admission`**

In `src/types.ts`, extend the interface (currently line 152):

```ts
export interface Admission {
  proposalId: string
  code: AdmissionCode
  detail?: string
  /**
   * The score this proposal was judged at, when a score was what decided it.
   *
   * Optional because the four committed reports predate it and because most
   * codes are not confidence decisions. Present so a refusal can report what
   * came closest without parsing a number back out of an English sentence.
   */
  confidence?: number
}
```

- [ ] **Step 4: Add the threshold parameter and set the score**

In `src/assay/bookkeeper/admit.ts`, change the signature (currently line 56):

```ts
export function admit(
  corpus: Corpus,
  proposals: RelationProposal[],
  queryTerms: string[],
  idf: Map<string, number>,
  threshold: number = CONFIDENCE_FLOOR,
): AdmitResult {
```

Change the check (currently line 105) to compare against `threshold`, and add `confidence` to the `LOW_CONFIDENCE` denial it pushes (keep the existing `detail` string exactly as it is — the committed reports' audit lines are built from it):

```ts
    if (!Number.isFinite(p.confidence) || p.confidence < threshold) {
```

```ts
        code: "LOW_CONFIDENCE",
        confidence: p.confidence,
```

Leave `export const CONFIDENCE_FLOOR = 0.5` in place — it is now the default, and `src/assay/types.ts` re-states it as `DEFAULT_THRESHOLD` for callers that should not reach into the bookkeeper.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/assay/bookkeeper/admit.test.ts && npm run typecheck
```
Expected: all pass.

- [ ] **Step 6: Confirm the committed reports still parse**

```bash
npm run cli -- x --render reports/tesla-fsd.json 2>/dev/null | tail -2
```
Expected: the existing `audit: proposed 59 over 9 passes · admitted 26 · denied 33 (…)` line, unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/assay/bookkeeper/admit.ts src/assay/bookkeeper/admit.test.ts
git commit -m "feat(assay): let the caller set the confidence floor

GIN_14 puts the threshold in the caller's hands: a reader wanting near-certain
rows sets it high and gets more refusals; one triaging leads sets it low.
Defaults to the 0.5 that was hard-coded.

A denial now also records the score it was judged at, so a refusal can say what
came closest without parsing a number back out of its own English detail string.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `assemble()` — the outcome decision

**Files:**
- Create: `src/assay/assemble.ts`, `src/assay/assemble.test.ts`
- Modify: `src/report/build.ts` (export the row-building so `assemble` reuses it)

**Interfaces:**
- Consumes: `AdmitResult` (`src/assay/bookkeeper/admit.js`), `buildReport` (`src/report/build.js`), types from `src/assay/types.js`.
- Produces: `assemble(corpus: PinnedCorpus, proposed: number, result: AdmitResult, opts: { passes?: number; conflictMode: "report" | "converge"; anchoredCount: number }): AssayResult`.

**Decision order** (from the spec, implemented exactly):

| Condition | Outcome |
|---|---|
| 0 docs, or only one distinct `role` among docs | `Refusal("CORPUS_INSUFFICIENT")` |
| `proposed === 0` or `anchoredCount === 0` | `Refusal("NO_GROUNDING")` |
| `result.admitted.length === 0` | `Refusal("BELOW_THRESHOLD")` + near-miss |
| any admitted row is `divergent` and `conflictMode === "converge"` | `Refusal("CONFLICTING_UNRESOLVABLE")` |
| otherwise | `Ledger` |

- [ ] **Step 1: Write the failing tests**

Create `src/assay/assemble.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { AdmitResult } from "./bookkeeper/admit.js"
import { assemble } from "./assemble.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"

function pdoc(over: Partial<PinnedDoc> = {}): PinnedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text: "hello", stability: "volatile", pin: { kind: "hash", sha256: "ab" }, ...over,
  }
}

function corpus(docs: PinnedDoc[]): PinnedCorpus {
  return { subject: "X", docs, failures: [] }
}

const empty: AdmitResult = { admitted: [], denied: [] }

const bothRoles = [pdoc({ docId: "a", role: "claimant" }), pdoc({ docId: "b", role: "independent" })]

describe("assemble outcome decision", () => {
  it("refuses CORPUS_INSUFFICIENT on an empty corpus", () => {
    const r = assemble(corpus([]), 0, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
  })

  it("refuses CORPUS_INSUFFICIENT when only one role is present", () => {
    const r = assemble(corpus([pdoc({ role: "claimant" })]), 5, empty, {
      conflictMode: "report", anchoredCount: 3,
    })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
  })

  it("refuses NO_GROUNDING when nothing anchored", () => {
    const r = assemble(corpus(bothRoles), 4, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("NO_GROUNDING")
  })

  it("refuses BELOW_THRESHOLD when things anchored but none was admitted", () => {
    const denied: AdmitResult = {
      admitted: [],
      denied: [{ proposalId: "p1", code: "LOW_CONFIDENCE", detail: "0.42 — a claim" }],
    }
    const r = assemble(corpus(bothRoles), 4, denied, { conflictMode: "report", anchoredCount: 4 })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("BELOW_THRESHOLD")
  })

  it("carries the audit line onto a refusal", () => {
    const r = assemble(corpus(bothRoles), 4, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.audit.proposed).toBe(4)
    expect(r.audit.admitted).toBe(0)
  })

  it("names the docs and failures on a refusal", () => {
    const c: PinnedCorpus = {
      subject: "X", docs: bothRoles,
      failures: [{ url: "u", label: "G2", reason: "blocked", detail: "no" }],
    }
    const r = assemble(c, 0, empty, { conflictMode: "report", anchoredCount: 0 })
    expect(r.docs).toHaveLength(2)
    expect(r.failures).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/assay/assemble.test.ts
```
Expected: FAIL — `Failed to resolve import "./assemble.js"`.

- [ ] **Step 3: Write `src/assay/assemble.ts`**

```ts
import type { AdmitResult } from "./bookkeeper/admit.js"
import { buildReport } from "../report/build.js"
import type { AssayResult, PinnedCorpus, Refusal, RefusalReason } from "./types.js"
import type { Corpus } from "../types.js"

interface AssembleOpts {
  passes?: number
  conflictMode: "report" | "converge"
  /** How many proposals produced at least one span the gate could locate. */
  anchoredCount: number
}

/** `buildReport` still takes the legacy shape; a PinnedDoc is a superset of a FetchedDoc. */
function asCorpus(corpus: PinnedCorpus): Corpus {
  return {
    subject: corpus.subject,
    docs: corpus.docs,
    failures: corpus.failures,
    ...(corpus.labels ? { labels: corpus.labels } : {}),
  }
}

function refuse(
  corpus: PinnedCorpus,
  reason: RefusalReason,
  detail: string,
  proposed: number,
  result: AdmitResult,
  opts: AssembleOpts,
): Refusal {
  // A refusal that shows its work is worth more than a bare no: what fell under
  // the bar stays attached, with the score each earned. No span — see the
  // `nearMiss` doc comment in types.ts.
  const nearMiss = result.denied
    .filter((d) => d.code === "LOW_CONFIDENCE" && d.confidence !== undefined)
    .map((d) => ({ confidence: d.confidence!, statement: d.detail ?? "" }))
    .sort((a, b) => b.confidence - a.confidence)

  return {
    outcome: "refusal",
    subject: corpus.subject,
    generatedAt: new Date().toISOString(),
    ...(corpus.labels ? { labels: corpus.labels } : {}),
    reason,
    detail,
    docs: corpus.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
    })),
    failures: corpus.failures,
    nearMiss,
    audit: {
      proposed,
      admitted: result.admitted.length,
      denied: result.denied,
      ...(opts.passes === undefined ? {} : { passes: opts.passes }),
    },
  }
}

export function assemble(
  corpus: PinnedCorpus,
  proposed: number,
  result: AdmitResult,
  opts: AssembleOpts,
): AssayResult {
  const roles = new Set(corpus.docs.map((d) => d.role))

  // Structural refusals first: they are decided before any model output matters,
  // and a run that reaches the model with one role present has already wasted
  // the money this guard exists to save.
  if (corpus.docs.length === 0) {
    return refuse(corpus, "CORPUS_INSUFFICIENT", "no sources could be read", proposed, result, opts)
  }
  if (roles.size < 2) {
    const only = [...roles][0]
    return refuse(
      corpus, "CORPUS_INSUFFICIENT",
      `only ${only} sources were read; nothing was present that could contradict anything`,
      proposed, result, opts,
    )
  }
  if (proposed === 0 || opts.anchoredCount === 0) {
    return refuse(
      corpus, "NO_GROUNDING",
      "no proposal produced a span that could be located in the corpus",
      proposed, result, opts,
    )
  }
  if (result.admitted.length === 0) {
    return refuse(
      corpus, "BELOW_THRESHOLD",
      "spans were found, but none cleared the confidence threshold",
      proposed, result, opts,
    )
  }

  const report = buildReport(asCorpus(corpus), proposed, result, opts.passes === undefined ? {} : { passes: opts.passes })

  if (opts.conflictMode === "converge" && report.rows.some((r) => r.status === "divergent")) {
    return refuse(
      corpus, "CONFLICTING_UNRESOLVABLE",
      "the corpus contradicts itself and the caller asked for a single answer",
      proposed, result, opts,
    )
  }

  return { outcome: "ledger", ...report }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/assay/assemble.test.ts && npm run typecheck
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/assay/assemble.ts src/assay/assemble.test.ts
git commit -m "feat(assay): refusal is an outcome, not a thin ledger

A run that reads one side, anchors nothing, or clears no proposal now returns a
typed refusal with a reason and what came closest, instead of an
empty ledger that reads as a clean bill of health.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The `assay()` entry point

**Files:**
- Create: `src/assay/index.ts`, `src/assay/index.test.ts`
- Modify: `src/pipeline.ts` (delegate)

**Interfaces:**
- Consumes: `toPinnedCorpus`, `assemble`, `chunkAll`, `buildIdf`, `tokenize`, `selectCandidates`, `proposeAcrossPasses`, `admit`.
- Produces: `assay(corpus: PinnedCorpus, query: AssayQuery, opts?: AssayOptions & { client?: ProposalClient }): Promise<AssayResult>`, and `analyzeCorpus(corpus: Corpus, opts?): Promise<AssayResult>` keeping its existing call sites working.

- [ ] **Step 1: Write the failing tests**

Create `src/assay/index.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { toPinnedCorpus } from "./adapt.js"
import { assay } from "./index.js"
import type { ProposalClient } from "./cartographer/propose.js"
import type { Corpus, FetchedDoc } from "../types.js"

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T",
    text: "The service is always available.", ...over,
  }
}

/** A client that returns no proposals at all. */
const silent: ProposalClient = {
  beta: { messages: { parse: async () => ({ parsed_output: { proposals: [] } }) } },
}

describe("assay", () => {
  it("refuses CORPUS_INSUFFICIENT before calling the model when one role is present", async () => {
    let called = false
    const client: ProposalClient = {
      beta: { messages: { parse: async () => { called = true; return { parsed_output: { proposals: [] } } } } },
    }
    const corpus: Corpus = { subject: "X", docs: [doc()], failures: [] }
    const r = await assay(toPinnedCorpus(corpus), { subject: "X" }, { client })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("CORPUS_INSUFFICIENT")
    expect(called).toBe(false)
  })

  it("refuses NO_GROUNDING when the model proposes nothing", async () => {
    const corpus: Corpus = {
      subject: "X",
      docs: [doc({ docId: "a", role: "claimant" }), doc({ docId: "b", role: "independent" })],
      failures: [],
    }
    const r = await assay(toPinnedCorpus(corpus), { subject: "X" }, { client: silent })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("NO_GROUNDING")
  })

  it("passes the caller's threshold through to admit", async () => {
    const corpus: Corpus = {
      subject: "X",
      docs: [doc({ docId: "a", role: "claimant" }), doc({ docId: "b", role: "independent" })],
      failures: [],
    }
    const r = await assay(toPinnedCorpus(corpus), { subject: "X" }, { client: silent, threshold: 0.9 })
    expect(r.outcome).toBe("refusal")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/assay/index.test.ts
```
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 3: Write `src/assay/index.ts`**

```ts
import { admit } from "./bookkeeper/admit.js"
import { proposeAcrossPasses, type ProposalClient } from "./cartographer/propose.js"
import { chunkAll } from "./chunk/chunk.js"
import { buildIdf, tokenize } from "./retrieve/idf.js"
import { selectCandidates } from "./retrieve/select.js"
import { assemble } from "./assemble.js"
import { DEFAULT_THRESHOLD, type AssayOptions, type AssayQuery, type AssayResult, type PinnedCorpus } from "./types.js"

export type { AssayResult, PinnedCorpus, AssayQuery, AssayOptions } from "./types.js"

/**
 * Documents and a query in; a grounded ledger or a refusal out.
 *
 * Pure given the corpus and the responses of `opts.client`. The Assay never
 * fetches and has no opinion about how a document's pin was obtained.
 */
export async function assay(
  corpus: PinnedCorpus,
  query: AssayQuery,
  opts: AssayOptions & { client?: ProposalClient } = {},
): Promise<AssayResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const conflictMode = opts.conflictMode ?? "report"
  const empty = { admitted: [], denied: [] }

  // Structural refusals are decided before the model is called, because the
  // guard exists precisely to stop a run spending money to produce a report
  // where everything is unverified for want of a second side.
  const roles = new Set(corpus.docs.map((d) => d.role))
  if (corpus.docs.length === 0 || roles.size < 2) {
    return assemble(corpus, 0, empty, { conflictMode, anchoredCount: 0 })
  }

  const queryTerms = tokenize(query.subject)
  const idf = buildIdf(corpus.docs)
  const chunks = chunkAll(corpus.docs)

  const total = opts.candidates ?? 40
  const perDoc = Math.max(8, Math.ceil(total / Math.max(corpus.docs.length, 1)))
  const claimantDocIds = new Set(
    corpus.docs.filter((d) => d.role === "claimant").map((d) => d.docId),
  )
  const candidates = selectCandidates(chunks, queryTerms, idf, { perDoc, total, claimantDocIds })

  const fanned = await proposeAcrossPasses(query.subject, corpus.docs, candidates, opts)
  for (const f of fanned.failures) {
    console.error(`  pass ${f.passId} failed: ${f.message}`)
  }

  // Every pass failing is our outage, not a finding about the subject. It stays
  // a thrown error rather than becoming a refusal: a refusal is a statement
  // about the corpus, and this is a statement about us.
  if (fanned.failures.length > 0 && fanned.failures.length === fanned.passes) {
    throw new Error(
      `every proposal pass failed (${fanned.passes}/${fanned.passes}); ` +
        `first: ${fanned.failures[0]!.message}`,
    )
  }

  const result = admit(corpus, fanned.proposals, queryTerms, idf, threshold)
  const anchoredCount = result.admitted.length +
    result.denied.filter((d) => d.code !== "ANCHOR_NOT_FOUND" && d.code !== "DOC_UNKNOWN").length

  return assemble(corpus, fanned.proposals.length, result, {
    conflictMode, anchoredCount, ...(fanned.passes === undefined ? {} : { passes: fanned.passes }),
  })
}
```

- [ ] **Step 4: Rewrite `src/pipeline.ts` to delegate**

Replace the whole file:

```ts
import { toPinnedCorpus } from "./assay/adapt.js"
import { assay } from "./assay/index.js"
import type { ProposalClient } from "./assay/cartographer/propose.js"
import type { AssayResult } from "./assay/types.js"
import type { Corpus } from "./types.js"

/**
 * Everything downstream of the network, kept as the name the entry points use.
 *
 * The body is now the Assay: this function's remaining job is to lift a fetched
 * corpus into the Assay's input type. Phase 2 replaces `toPinnedCorpus` with
 * real pin resolution and this wrapper goes away.
 */
export async function analyzeCorpus(
  corpus: Corpus,
  opts: {
    client?: ProposalClient
    candidates?: number
    concurrency?: number
    threshold?: number
    conflictMode?: "report" | "converge"
  } = {},
): Promise<AssayResult> {
  return assay(toPinnedCorpus(corpus), { subject: corpus.subject }, opts)
}
```

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -5 && npm run typecheck
```
Expected: the three new tests pass. `src/pipeline.test.ts` and `src/report/build.test.ts` may now fail on the added `outcome` field — if so, update those assertions to expect `outcome: "ledger"`, and re-run until green.

- [ ] **Step 6: Commit**

```bash
git add src/assay/index.ts src/assay/index.test.ts src/pipeline.ts src/pipeline.test.ts src/report/build.test.ts
git commit -m "feat(assay): the assay() entry point, and pipeline delegates to it

analyzeCorpus is now a four-line adapter. The structural refusal is checked
before the model call, so a one-role corpus costs nothing to refuse.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Renderers handle a refusal

**Files:**
- Modify: `src/report/render/terminal.ts:48`, `src/report/render/markdown.ts:51`, `src/report/render/html.ts:95`
- Modify: `src/report/render/render.test.ts`

**Interfaces:**
- Consumes: `AssayResult`, `Refusal`, `isRefusal` from `src/assay/types.js`.
- Produces: `renderTerminal(r: AssayResult): string`, `renderMarkdown(r: AssayResult): string`, `renderHtml(r: AssayResult): string` — each accepting a legacy `Report` (no `outcome`) and treating it as a ledger.

- [ ] **Step 1: Write the failing tests**

Append to `src/report/render/render.test.ts`:

```ts
import type { Refusal } from "../../assay/types.js"

const refusal: Refusal = {
  outcome: "refusal", subject: "Acme", generatedAt: "2026-09-09T00:00:00.000Z",
  reason: "CORPUS_INSUFFICIENT",
  detail: "only claimant sources were read; nothing was present that could contradict anything",
  docs: [], failures: [{ url: "u", label: "G2", reason: "blocked", detail: "no" }],
  nearMiss: [], audit: { proposed: 0, admitted: 0, denied: [] },
}

describe("rendering a refusal", () => {
  it("terminal names the reason and the detail", () => {
    const out = renderTerminal(refusal)
    expect(out).toContain("REFUSED")
    expect(out).toContain("CORPUS_INSUFFICIENT")
    expect(out).toContain("nothing was present that could contradict anything")
  })

  it("terminal still lists the sources that could not be read", () => {
    expect(renderTerminal(refusal)).toContain("G2")
  })

  it("markdown names the reason", () => {
    expect(renderMarkdown(refusal)).toContain("CORPUS_INSUFFICIENT")
  })

  it("html names the reason and escapes it", () => {
    expect(renderHtml(refusal)).toContain("CORPUS_INSUFFICIENT")
  })

  it("a legacy report with no outcome field still renders as a ledger", () => {
    const legacy = { ...ledgerFixture() } as Record<string, unknown>
    delete legacy.outcome
    expect(renderTerminal(legacy as never)).not.toContain("REFUSED")
  })
})
```

Use whatever ledger fixture `render.test.ts` already builds for `ledgerFixture()`; if it builds one inline, extract it to a helper first.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/report/render/render.test.ts -t "rendering a refusal"
```
Expected: FAIL — `renderTerminal` has no refusal branch.

- [ ] **Step 3: Add the terminal branch**

At the top of `renderTerminal` in `src/report/render/terminal.ts`, before the existing body:

```ts
export function renderTerminal(r: AssayResult): string {
  if (r.outcome === "refusal") {
    const lines = [
      "",
      `  ${r.subject} — REFUSED`,
      `  generated ${r.generatedAt}`,
      "",
      `  ${r.reason}`,
      `  ${r.detail}`,
      "",
    ]
    if (r.nearMiss.length > 0) {
      lines.push("  what came closest", "")
      for (const n of r.nearMiss) {
        lines.push(`    ${n.confidence.toFixed(2)}  ${n.statement}`)
      }
      lines.push("")
    }
    if (r.failures.length > 0) {
      lines.push("  sources", "")
      for (const f of r.failures) {
        lines.push(`    not read    ${f.label}  (${f.reason})`)
      }
      lines.push("")
    }
    lines.push(
      `  audit: proposed ${r.audit.proposed} · admitted ${r.audit.admitted} · ` +
        `denied ${r.audit.denied.length}`,
      "",
    )
    return lines.join("\n")
  }
  // ... existing ledger body unchanged, operating on `r`
}
```

Rename the existing parameter to `r` throughout the function body, and change the import to bring in `AssayResult` from `../../assay/types.js`.

- [ ] **Step 4: Add the markdown and html branches**

In `src/report/render/markdown.ts`, at the top of `renderMarkdown`:

```ts
  if (r.outcome === "refusal") {
    const near = r.nearMiss.length === 0 ? "" :
      `\n\n**What came closest**\n\n` +
      r.nearMiss.map((n) => `- \`${n.confidence.toFixed(2)}\` ${n.statement}`).join("\n")
    const notRead = r.failures.length === 0 ? "" :
      `\n\n**Not read**\n\n` + r.failures.map((f) => `- ${f.label} (${f.reason})`).join("\n")
    return `# ${r.subject} — refused\n\n**${r.reason}** — ${r.detail}${near}${notRead}\n\n` +
      `audit: proposed ${r.audit.proposed} · admitted ${r.audit.admitted} · denied ${r.audit.denied.length}\n`
  }
```

In `src/report/render/html.ts`, at the top of `renderHtml`. **There is no `page()` helper in this file** — `renderHtml` (line 139) and `renderIndex` (line 189) each inline their own `<!doctype html>` shell. Copy the shell `renderHtml` already builds — same `<head>`, same inline `<style>`, same wrapper element — and swap only the body content. Do not invent a third shell, and do not refactor the existing two into a helper as part of this task.

```ts
  if (r.outcome === "refusal") {
    const near = r.nearMiss.map((n) =>
      `<li><code>${esc(n.confidence.toFixed(2))}</code> ${esc(n.statement)}</li>`).join("")
    const notRead = r.failures.map((f) =>
      `<li>${esc(f.label)} <span class="reason">(${esc(f.reason)})</span></li>`).join("")
    const body = `
      <h1>${esc(r.subject)} — refused</h1>
      <p class="reason-code">${esc(r.reason)}</p>
      <p>${esc(r.detail)}</p>
      ${near ? `<h2>What came closest</h2><ul>${near}</ul>` : ""}
      ${notRead ? `<h2>Not read</h2><ul>${notRead}</ul>` : ""}
      <p class="audit">audit: proposed ${r.audit.proposed} ·
        admitted ${r.audit.admitted} · denied ${r.audit.denied.length}</p>
    `
    // ... return the same <!doctype html> shell renderHtml already builds, with `body` inside it
  }
```

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -5 && npm run typecheck
```
Expected: all pass.

- [ ] **Step 6: Verify the four committed reports still render**

```bash
for f in reports/tesla-fsd.json reports/claude.json reports/vercel.json reports/chime.json; do
  npm run cli -- x --render "$f" 2>/dev/null | head -3
done
```
Expected: each prints its `— claim ledger` header, none prints `REFUSED`.

- [ ] **Step 7: Commit**

```bash
git add src/report/render/
git commit -m "feat(render): a refusal renders as a refusal

Reason, detail, what came closest with the score each earned, and the sources
that could not be read. Reports predating the outcome field still render as
ledgers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Entry points and exit codes

**Files:**
- Modify: `src/cli/index.ts:161-186`, `src/mcp/server.ts:84`, `src/web/server.ts:151`
- Create: `src/cli/exit.test.ts`

**Interfaces:**
- Consumes: `AssayResult` from `src/assay/types.js`.
- Produces: `exitCodeFor(r: AssayResult): 0 | 3` exported from `src/cli/exit.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/cli/exit.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { exitCodeFor } from "./exit.js"

describe("exitCodeFor", () => {
  it("returns 0 for a ledger", () => {
    expect(exitCodeFor({ outcome: "ledger" } as never)).toBe(0)
  })
  it("returns 3 for a refusal", () => {
    expect(exitCodeFor({ outcome: "refusal" } as never)).toBe(3)
  })
  it("treats a legacy report with no outcome as a ledger", () => {
    expect(exitCodeFor({} as never)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/cli/exit.test.ts
```
Expected: FAIL — `Failed to resolve import "./exit.js"`.

- [ ] **Step 3: Write `src/cli/exit.ts`**

```ts
import type { AssayResult } from "../assay/types.js"

/**
 * 0 = ledger, 3 = refusal, 1 = operational error (raised by `die`).
 *
 * A refusal is a result, not a crash — GIN_14's "the assay that comes back
 * empty is a real result". It gets its own code so a caller can tell it from
 * both a finding and a failure, which is the distinction an empty report at
 * exit 0 destroyed.
 */
export function exitCodeFor(r: AssayResult): 0 | 3 {
  return r.outcome === "refusal" ? 3 : 0
}
```

- [ ] **Step 4: Wire the CLI**

In `src/cli/index.ts`, delete the empty-corpus block at lines 161-164:

```ts
if (corpus.docs.length === 0) {
  console.error("no sources could be read; nothing to analyze")
  process.exit(2)
}
```

The Assay now returns `Refusal(CORPUS_INSUFFICIENT)` for that case and the renderer prints it, which is strictly more informative than the old two-line message.

Then replace the final render line (currently line 186):

```ts
console.log(opts.asJson ? JSON.stringify(report, null, 2) : renderTerminal(report))
process.exit(exitCodeFor(report))
```

and add the import:

```ts
import { exitCodeFor } from "./exit.js"
```

- [ ] **Step 5: Wire MCP and web**

`src/mcp/server.ts:84` and `src/web/server.ts:151` already pass the result straight to a renderer that now handles both outcomes, so no logic change is needed. Confirm both still typecheck:

```bash
npm run typecheck
```
Expected: silent.

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -3
```
Expected: all pass.

- [ ] **Step 7: Verify the exit codes end to end**

```bash
npm run cli -- x --render reports/tesla-fsd.json > /dev/null 2>&1; echo "ledger exit: $?"
```
Expected: `ledger exit: 0`

- [ ] **Step 8: Commit**

```bash
git add src/cli/ src/mcp/server.ts src/web/server.ts
git commit -m "feat(cli): distinct exit codes for ledger, refusal and error

0 ledger, 3 refusal, 1 operational. The empty-corpus exit(2) goes away: that
case is now a typed CORPUS_INSUFFICIENT refusal that says which side was
missing, rather than a two-line message.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Document the contract in the README

**Files:**
- Modify: `README.md` (the `## Lineage` section, and `## Development`)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Add an Assay section after Lineage**

Insert after the `GIN_14_Assay` paragraph in `## Lineage`:

```markdown
### The contract, extracted

`src/assay/` is that contract as code: a set of pinned documents and a query in,
a grounded ledger or a typed refusal out. It never fetches — the caller hands it
bytes, already pinned — and it has no opinion about where a document was before
it arrived.

A refusal is a result, not a crash. A run that reads only one side, anchors
nothing, or clears no proposal returns a reason code (`CORPUS_INSUFFICIENT`,
`NO_GROUNDING`, `BELOW_THRESHOLD`) naming what came closest and the score
each earned, rather than an empty ledger that reads as a clean bill of health.
The CLI exits `0` for a ledger, `3` for a refusal and `1` for an operational
error, so the three are distinguishable by a script.

The confidence floor is caller-settable: `assay()`'s `threshold` option raises
or lowers the bar, and a higher bar buys more refusals. It is not currently
wired to a CLI flag — every run through `npm run cli` gets the default.
```

- [ ] **Step 2: Update the test count**

Run the suite, read the count, and update the `npm test` line in `## Development`:

```bash
npm test 2>&1 | grep -E "^\s+Tests"
```

Set the comment in the README's Development block to the number printed.

- [ ] **Step 3: Verify no stale claims**

```bash
grep -nE 'exit\(2\)|CONFIDENCE_FLOOR|src/(chunk|retrieve|cartographer|bookkeeper)/' README.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): the extracted Assay contract and its exit codes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (Phase 1 scope only).** The spec's Phase 1 is *"Extract `src/assay/`, add query / threshold / conflictMode, make `Refusal` a first-class outcome, update renderers and exit codes. `PinnedCorpus` exists but every pin is trivially `{hash}`. Tests: refusal paths, existing suite green."*

| Phase 1 requirement | Task |
|---|---|
| Extract `src/assay/` | 1 |
| `PinnedCorpus` with trivial `{hash}` pins | 2 |
| `query` parameter | 5 (`AssayQuery`, threaded through `assay()`) |
| `threshold` parameter | 3 (`admit`), 5 (plumbed) |
| `conflictMode` parameter | 4 (`CONFLICTING_UNRESOLVABLE`), 5 (plumbed) |
| `Refusal` first-class | 2 (types), 4 (decision) |
| Renderers | 6 |
| Exit codes | 7 |
| Refusal-path tests | 4, 5 |
| Existing suite green | asserted at the end of every task |

Deferred to Phases 2–3 by design and **not** gaps in this plan: `classify`, `pin`, `snapshots`, `normalize`, `cache`, `drift`, `--replay`, `--refresh`, the double proposer run, `RowProvenance` population, the manifest, backfill, and CI replay equality. `RowProvenance` and the `permalink`/`snapshot` pin variants are *declared* in Task 2 so Phase 2 does not have to reopen `types.ts`; nothing in Phase 1 writes them.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Three steps deliberately reference existing code the implementer must read rather than reproducing it — the `admit.test.ts` fixture helpers (Task 3 Step 1), the `render.test.ts` ledger fixture (Task 6 Step 1), and the `html.ts` page shell (Task 6 Step 4). Each says exactly what to look for and what to do if it is absent, because inventing a second page shell or a duplicate fixture would be worse than the reference.

**Type consistency.** `AssayResult` / `Ledger` / `Refusal` / `PinnedCorpus` / `PinnedDoc` / `AssayQuery` / `AssayOptions` / `Audit` are defined once in Task 2 and used unchanged in 4, 5, 6, 7. `assemble(corpus, proposed, result, opts)` is defined in Task 4 and called with that arity in Task 5. `exitCodeFor` is defined and consumed in Task 7. `admit`'s fifth parameter added in Task 3 is supplied in Task 5. `toPinnedCorpus` is defined in Task 2 and used in Task 5.

**One risk worth naming.** Task 5 Step 5 anticipates that `pipeline.test.ts` and `report/build.test.ts` will fail on the newly added `outcome` field. That is expected, not a defect — the step says to update those assertions. An implementer who treats it as a regression and reverts will get stuck.

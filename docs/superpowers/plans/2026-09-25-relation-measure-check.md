# Relation Measure Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deny a relational ledger row (`contradicts`, `corroborates`, `updates`) unless a frontier-model verifier judges that the claim and the evidence measure the same property at a comparable scope.

**Architecture:** `admit()` splits into a pure per-proposal `screen()` and the existing duplicate/admission loop `admitScreened()`. A new async `verifyMeasures()` runs between them in `assayOnce`, calling a `MeasureVerifier` for each screened relational proposal and turning failures into `NOT_SAME_MEASURE` / `RELATION_UNVERIFIED` denials. The Receipts adapter implements the verifier over the Anthropic parse client, through its own proposal-cache wrapper, so checked ledgers replay.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, zod 4, `@anthropic-ai/sdk` 0.70 beta parse with `betaZodOutputFormat`, tsx.

**Spec:** `docs/superpowers/specs/2026-09-25-relation-measure-check-design.md`

## Global Constraints

- The verifier sees the claimant quote, the independent quote and the proposed relation only — never `topic`, `statement`, `rationale`, document labels or URLs.
- The verifier prompt contains no example drawn from `fixtures/relation-labels.json` and none of its notes, verbatim or paraphrased.
- `unsupported` proposals are never verified.
- A failing or refused verifier call denies with `RELATION_UNVERIFIED` (fail closed); every call in a sample failing throws.
- Both new codes are reached only after anchoring: neither joins `NOT_ANCHORING_EVIDENCE`.
- `audit.relationCheck` is `true` on checked ledgers and **absent** (never `false`) otherwise, so reports made before this change replay identically.
- With the check on, `ANTHROPIC_API_KEY` is required even under `--client ollama`.
- Bar: deny ≥ 24 of 30 negatives, admit ≥ 4 of 5 positives, second run agrees on ≥ 90% of verdicts. Default stays off unless the bar is met.
- Run `npm test` and `npm run typecheck` before every commit; both must pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/assay/bookkeeper/admit.ts` | modify | split into `admitContext`, `orderForAdmission`, `screen`, `admitScreened`; `admit` composes them |
| `src/assay/bookkeeper/admit-split.test.ts` | create | equivalence of the split with `admit()` |
| `src/assay/bookkeeper/measure.ts` | create | `MeasureVerifier` interface, `verifyMeasures` |
| `src/assay/bookkeeper/measure.test.ts` | create | `verifyMeasures` with fake verifiers |
| `src/assay/types.ts` | modify | two `AdmissionCode`s, `Audit.relationCheck`, `AssayOptions.verifier` |
| `src/assay/assemble.ts` | modify | thread `relationCheck` into the audit |
| `src/assay/index.ts` | modify | screen → verify → admit in `assayOnce` |
| `src/assay/measure-wiring.test.ts` | create | `assay()` with a verifier |
| `src/cartographer/measure.ts` | create | zod schema, prompt, `toMeasureVerifier`, `RELATION_CHECK_DEFAULT` |
| `src/cartographer/measure.test.ts` | create | adapter request shape, refusal, schema errors |
| `src/types.ts` | modify | `ReceiptsManifest.relationCheck` |
| `src/pipeline.ts`, `src/analyze-live.ts` | modify | build and cache the verifier, stamp the manifest |
| `src/cli/replay.ts` | modify | cache-only verifier when the manifest has `relationCheck` |
| `src/cli/replay.test.ts` | modify | checked ledger replays identically |
| `src/cli/args.ts`, `src/cli/args.test.ts`, `src/cli/index.ts` | modify | flags, key check |
| `src/report/render/provenance.ts` + terminal/markdown/html | modify | "relations not verified" line |
| `fixtures/relation-labels.json` | create | the 36 labeled relational rows |
| `src/eval/relation-labels.ts`, `src/eval/relation-labels.test.ts` | create | scoring and bar logic |
| `src/eval/relation-eval.ts`, `package.json` | create/modify | `npm run relation-eval` |

---

### Task 1: Split `admit()` into `screen()` and `admitScreened()`

**Files:**
- Modify: `src/assay/bookkeeper/admit.ts:167-435`
- Create: `src/assay/bookkeeper/admit-split.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AdmitContext {
    byId: Map<string, PinnedDoc>; independents: PinnedDoc[]; ownDomains: ReturnType<typeof claimantDomains>
    queryTerms: string[]; idf: Map<string, number>; threshold: number; lexicon: Lexicon
  }
  export function admitContext(corpus: PinnedCorpus, queryTerms: string[], idf: Map<string, number>, threshold: number | undefined, lexicon: Lexicon): AdmitContext
  export function orderForAdmission(proposals: RelationProposal[]): RelationProposal[]
  export type ScreenedOk = { ok: true; proposal: RelationProposal; fromSpan: AdmittedSpan; toDoc: PinnedDoc | null; toSpan: AdmittedSpan | null; sides: [PinnedDoc, AdmittedSpan][] }
  export type Screened = { ok: false; denial: Admission } | ScreenedOk
  export function screen(p: RelationProposal, ctx: AdmitContext): Screened
  export function admitScreened(screened: Screened[], ctx: AdmitContext): AdmitResult
  ```
  `admit()` keeps its exact signature and output.

- [ ] **Step 1: Write the failing test**

Create `src/assay/bookkeeper/admit-split.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { admit, admitContext, admitScreened, orderForAdmission, screen } from "./admit.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
import { TEST_PROFILE } from "../test-profile.js"
import type { PinnedCorpus, RelationProposal } from "../types.js"

function doc(docId: string, role: PinnedCorpus["docs"][number]["role"], text: string): PinnedCorpus["docs"][number] {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "claimant" ? "vendor_site" : "status_page",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: docId, text,
    stability: "volatile", pin: { kind: "hash", sha256: "00" }, driftHash: "00",
  }
}

const CORPUS: PinnedCorpus = {
  subject: "acme",
  docs: [
    doc("vendor", "claimant", "Acme guarantees 99.99% uptime for every workspace on a paid plan. Acme support answers within one hour."),
    doc("status", "independent", "Acme reported four separate uptime incidents in the last ninety days."),
  ],
  failures: [],
}
const TERMS = tokenize("acme uptime")
const IDF = buildIdf(CORPUS.docs)

function p(over: Partial<RelationProposal>): RelationProposal {
  return {
    proposalId: "p0", type: "contradicts", topic: "uptime", statement: "s",
    from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    to: { docId: "status", quote: "four separate uptime incidents" },
    rationale: "r", confidence: 0.9, ...over,
  }
}

// A mix that exercises every branch: admitted, low confidence, unknown doc,
// unanchorable quote, a duplicate pair, an unsupported twin retired by the
// related-span rule, and an admitted unsupported claim.
const MIX: RelationProposal[] = [
  p({ proposalId: "u1", type: "unsupported", to: null }),
  p({ proposalId: "c1" }),
  p({ proposalId: "low", confidence: 0.1 }),
  p({ proposalId: "unk", to: { docId: "nope", quote: "x" } }),
  p({ proposalId: "gone", from: { docId: "vendor", quote: "Acme never said this" } }),
  p({ proposalId: "dup" }),
  p({ proposalId: "u2", type: "unsupported", to: null, from: { docId: "vendor", quote: "Acme support answers within one hour." } }),
]

describe("admit split", () => {
  it("screen then admitScreened reproduces admit() exactly, denials in the same order", () => {
    const whole = admit(CORPUS, MIX, TERMS, IDF, undefined, TEST_PROFILE.lexicon)
    const ctx = admitContext(CORPUS, TERMS, IDF, undefined, TEST_PROFILE.lexicon)
    const split = admitScreened(orderForAdmission(MIX).map((x) => screen(x, ctx)), ctx)
    expect(split).toEqual(whole)
    expect(whole.admitted.length).toBeGreaterThan(0)
    expect(whole.denied.map((d) => d.code)).toContain("DUPLICATE")
  })

  it("screen is per-proposal: the same proposal screens the same whatever else is in the batch", () => {
    const ctx = admitContext(CORPUS, TERMS, IDF, undefined, TEST_PROFILE.lexicon)
    const alone = screen(p({ proposalId: "dup" }), ctx)
    expect(alone.ok).toBe(true)
    const denied = screen(p({ proposalId: "low", confidence: 0.1 }), ctx)
    expect(denied).toMatchObject({ ok: false, denial: { proposalId: "low", code: "LOW_CONFIDENCE" } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/assay/bookkeeper/admit-split.test.ts`
Expected: FAIL — `admitContext is not a function` (or a missing-export error).

- [ ] **Step 3: Implement the split**

In `src/assay/bookkeeper/admit.ts`, change the type import to add `Admission` (already imported) and `RelationType` (already imported); then replace everything from the `admit` doc comment (line 158) to the end of the file with the code below. **Move every existing comment block along with the code it sits on, unchanged** — the code below omits them only for length; the reviewer checks that none was dropped.

```ts
export interface AdmitContext {
  byId: Map<string, PinnedDoc>
  independents: PinnedDoc[]
  ownDomains: ReturnType<typeof claimantDomains>
  queryTerms: string[]
  idf: Map<string, number>
  threshold: number
  lexicon: Lexicon
}

export function admitContext(
  corpus: PinnedCorpus,
  queryTerms: string[],
  idf: Map<string, number>,
  threshold: number = CONFIDENCE_FLOOR,
  lexicon: Lexicon,
): AdmitContext {
  return {
    byId: new Map(corpus.docs.map((d) => [d.docId, d])),
    independents: corpus.docs.filter((d) => d.role === "independent"),
    ownDomains: claimantDomains(corpus.docs),
    queryTerms, idf, threshold, lexicon,
  }
}

/** (existing "Contradictions before corroborations..." comment moves here) */
export function orderForAdmission(proposals: RelationProposal[]): RelationProposal[] {
  return [...proposals].sort((a, b) => typeRank(a.type) - typeRank(b.type))
}

export type ScreenedOk = {
  ok: true
  proposal: RelationProposal
  fromSpan: AdmittedSpan
  toDoc: PinnedDoc | null
  toSpan: AdmittedSpan | null
  sides: [PinnedDoc, AdmittedSpan][]
}
export type Screened = { ok: false; denial: Admission } | ScreenedOk

/**
 * Every gate that depends only on this one proposal, in the order admit()
 * has always applied them. Pure: no cross-proposal state, so a verifier can
 * run between screening and admission without changing either.
 */
export function screen(p: RelationProposal, ctx: AdmitContext): Screened {
  const deny = (denial: Admission): Screened => ({ ok: false, denial })
  if (!Number.isFinite(p.confidence) || p.confidence < ctx.threshold) {
    return deny({
      proposalId: p.proposalId, code: "LOW_CONFIDENCE",
      detail: `${p.confidence} — ${p.topic}: ${p.statement}`, confidence: p.confidence,
    })
  }
  const fromDoc = ctx.byId.get(p.from.docId)
  if (!fromDoc) return deny({ proposalId: p.proposalId, code: "DOC_UNKNOWN", detail: p.from.docId })
  if (fromDoc.role !== "claimant") {
    return deny({ proposalId: p.proposalId, code: "FROM_NOT_CLAIMANT", detail: fromDoc.docId })
  }
  const fromAnchor = findAnchor(fromDoc.text, p.from.quote)
  if (!fromAnchor.ok) return deny({ proposalId: p.proposalId, code: fromAnchor.code, detail: p.from.quote.slice(0, 60) })
  const fromSpan: AdmittedSpan = {
    docId: fromDoc.docId, start: fromAnchor.start, end: fromAnchor.end,
    text: p.from.quote, tag: fromAnchor.tag,
  }

  let toDoc: PinnedDoc | null = null
  let toSpan: AdmittedSpan | null = null
  if (p.to) {
    toDoc = ctx.byId.get(p.to.docId) ?? null
    if (!toDoc) return deny({ proposalId: p.proposalId, code: "DOC_UNKNOWN", detail: p.to.docId })
    if (toDoc.docId === fromDoc.docId) return deny({ proposalId: p.proposalId, code: "SELF_PAIR", detail: toDoc.docId })
    if (toDoc.role !== "independent") {
      return deny({ proposalId: p.proposalId, code: "TO_NOT_INDEPENDENT", detail: toDoc.docId })
    }
    const toAnchor = findAnchor(toDoc.text, p.to.quote)
    if (!toAnchor.ok) return deny({ proposalId: p.proposalId, code: toAnchor.code, detail: p.to.quote.slice(0, 60) })
    toSpan = { docId: toDoc.docId, start: toAnchor.start, end: toAnchor.end, text: p.to.quote, tag: toAnchor.tag }
  }

  const sides: [PinnedDoc, AdmittedSpan][] = [[fromDoc, fromSpan]]
  if (toDoc && toSpan) sides.push([toDoc, toSpan])

  const launderedSide = sides.find(([d, s]) => d.role === "independent" && citesClaimant(s.text, ctx.ownDomains))
  if (launderedSide) {
    return deny({
      proposalId: p.proposalId, code: "SELF_SOURCED",
      detail: `${launderedSide[0].label} cites the claimant's own domain`,
    })
  }
  if (p.type !== "unsupported" && toDoc && toSpan) {
    const blocked = blocksNonHolding(toDoc, toSpan, fromSpan, ctx.idf, ctx.independents, ctx.lexicon)
    if (blocked) return deny({ proposalId: p.proposalId, code: blocked, detail: toSpan.text.slice(0, 80) })
  }
  const offTopic = sides.some(
    ([d, s]) => idfRelevance(windowAround(d.text, s.start, s.end), ctx.queryTerms, ctx.idf) < DIVERGENCE_IDF_FLOOR,
  )
  if (offTopic) return deny({ proposalId: p.proposalId, code: "NOT_QUERY_RELEVANT" })

  return { ok: true, proposal: p, fromSpan, toDoc, toSpan, sides }
}

/** Duplicate detection and admission over screened proposals, in their given order. */
export function admitScreened(screened: Screened[], ctx: AdmitContext): AdmitResult {
  const admitted: AdmittedRelation[] = []
  const denied: Admission[] = []
  const seen = new Set<string>()
  const admittedRanges = new Map<string, [number, number][]>()
  const overlaps = (key: string, start: number, end: number) =>
    (admittedRanges.get(key) ?? []).some(([s, e]) => start < e && s < end)
  const remember = (key: string, start: number, end: number) => {
    const list = admittedRanges.get(key)
    if (list) list.push([start, end])
    else admittedRanges.set(key, [[start, end]])
  }

  for (const s of screened) {
    if (!s.ok) {
      denied.push(s.denial)
      continue
    }
    const { proposal: p, fromSpan, toDoc, toSpan, sides } = s

    const pairKey = `pair:${sides.map(([, sp]) => `${sp.docId}@${sp.start}`).sort().join("|")}`
    if (seen.has(pairKey)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: pairKey })
      continue
    }
    const textKey = `text:${p.type}:${fromSpan.docId}:${normalizeQuote(fromSpan.text)}`
    if (seen.has(textKey)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: textKey.slice(0, 80) })
      continue
    }
    seen.add(textKey)
    const claimKey = `claim:${p.type}:${fromSpan.docId}`
    if (overlaps(claimKey, fromSpan.start, fromSpan.end)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: `${claimKey}@${fromSpan.start}-${fromSpan.end}` })
      continue
    }
    const relatedKey = `related:${fromSpan.docId}`
    const bindingKey = `binding-contradict:${fromSpan.docId}`
    if (p.type === "corroborates" && standingOf(toDoc) === "interested" && overlaps(bindingKey, fromSpan.start, fromSpan.end)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: "interested corroboration cannot override binding contradiction" })
      continue
    }
    if ((p.type === "unsupported" || p.type === "corroborates") && overlaps(relatedKey, fromSpan.start, fromSpan.end)) {
      denied.push({ proposalId: p.proposalId, code: "DUPLICATE", detail: relatedKey })
      continue
    }

    seen.add(pairKey)
    remember(claimKey, fromSpan.start, fromSpan.end)
    if (p.type !== "unsupported") remember(relatedKey, fromSpan.start, fromSpan.end)
    if (p.type === "contradicts" && standingOf(toDoc) === "binding") remember(bindingKey, fromSpan.start, fromSpan.end)

    admitted.push({
      proposal: p,
      sides: sides.map(([, span]) => span),
      ...(p.type !== "unsupported" && toDoc && toSpan && unmarkedSpan(toDoc, toSpan, ctx.lexicon)
        ? { contextUnverified: true as const }
        : {}),
    })
  }
  return { admitted, denied }
}

/** (existing "The sole writer of report content." comment moves here, unchanged) */
export function admit(
  corpus: PinnedCorpus,
  proposals: RelationProposal[],
  queryTerms: string[],
  idf: Map<string, number>,
  threshold: number = CONFIDENCE_FLOOR,
  lexicon: Lexicon,
): AdmitResult {
  const ctx = admitContext(corpus, queryTerms, idf, threshold, lexicon)
  return admitScreened(orderForAdmission(proposals).map((p) => screen(p, ctx)), ctx)
}
```

Also add `Admission` to the type import at the top if it is not already imported (it is, via `Admission, AdmittedSpan, ...`).

- [ ] **Step 4: Run the new test and the whole admit suite**

Run: `npx vitest run src/assay/bookkeeper`
Expected: PASS, including every existing `admit.test.ts` case unchanged.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` then `npm run typecheck` — both pass.

```bash
git add src/assay/bookkeeper/admit.ts src/assay/bookkeeper/admit-split.test.ts
git commit -m "Split admit() into per-proposal screening and admission

Every gate up to NOT_QUERY_RELEVANT depends only on its own proposal,
so admit() becomes screen() then admitScreened(), with identical output.
A relation verifier can now run between them, before duplicate
detection. See docs/superpowers/specs/2026-09-25-relation-measure-check-design.md.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `verifyMeasures` and the two denial codes

**Files:**
- Create: `src/assay/bookkeeper/measure.ts`
- Create: `src/assay/bookkeeper/measure.test.ts`
- Modify: `src/assay/types.ts:83-86` (`AdmissionCode`)

**Interfaces:**
- Consumes: `Screened`, `ScreenedOk`, `admitContext`, `orderForAdmission`, `screen`, `admitScreened` from Task 1.
- Produces:
  ```ts
  export type RelationalType = Exclude<RelationType, "unsupported">
  export interface MeasureInput { claim: string; evidence: string; relation: RelationalType }
  export interface MeasureVerdict {
    claim_property: string; claim_scope: string; evidence_property: string; evidence_scope: string
    same_property: boolean; comparable_scope: boolean
  }
  export interface MeasureVerifier { verify(input: MeasureInput): Promise<MeasureVerdict> }
  export function measureDetail(v: MeasureVerdict): string
  export function verifyMeasures(screened: Screened[], verifier: MeasureVerifier, opts?: { concurrency?: number }): Promise<Screened[]>
  ```
  New `AdmissionCode`s: `"NOT_SAME_MEASURE" | "RELATION_UNVERIFIED"`.

- [ ] **Step 1: Write the failing tests**

Create `src/assay/bookkeeper/measure.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { admitContext, admitScreened, orderForAdmission, screen } from "./admit.js"
import { measureDetail, verifyMeasures, type MeasureInput, type MeasureVerdict, type MeasureVerifier } from "./measure.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
import { TEST_PROFILE } from "../test-profile.js"
import type { PinnedCorpus, RelationProposal } from "../types.js"

function doc(docId: string, role: PinnedCorpus["docs"][number]["role"], text: string): PinnedCorpus["docs"][number] {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "claimant" ? "vendor_site" : "status_page",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: docId, text,
    stability: "volatile", pin: { kind: "hash", sha256: "00" }, driftHash: "00",
  }
}
const CORPUS: PinnedCorpus = {
  subject: "acme",
  docs: [
    doc("vendor", "claimant", "Acme guarantees 99.99% uptime for every workspace on a paid plan."),
    doc("status", "independent", "Acme reported four separate uptime incidents in the last ninety days."),
  ],
  failures: [],
}
const TERMS = tokenize("acme uptime")
const IDF = buildIdf(CORPUS.docs)
const ctx = admitContext(CORPUS, TERMS, IDF, undefined, TEST_PROFILE.lexicon)

function p(over: Partial<RelationProposal> = {}): RelationProposal {
  return {
    proposalId: "p0", type: "contradicts", topic: "uptime", statement: "the statement",
    from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    to: { docId: "status", quote: "four separate uptime incidents" },
    rationale: "the rationale", confidence: 0.9, ...over,
  }
}
const screenAll = (ps: RelationProposal[]) => orderForAdmission(ps).map((x) => screen(x, ctx))

const SAME: MeasureVerdict = {
  claim_property: "uptime", claim_scope: "every paid workspace",
  evidence_property: "uptime incidents", evidence_scope: "the last ninety days",
  same_property: true, comparable_scope: true,
}
function fake(decide: (input: MeasureInput) => MeasureVerdict | Error): MeasureVerifier & { calls: MeasureInput[] } {
  const calls: MeasureInput[] = []
  return {
    calls,
    async verify(input) {
      calls.push(input)
      const v = decide(input)
      if (v instanceof Error) throw v
      return v
    },
  }
}

describe("verifyMeasures", () => {
  it("admits a relational proposal the verifier passes", async () => {
    const out = await verifyMeasures(screenAll([p()]), fake(() => SAME))
    expect(admitScreened(out, ctx).admitted).toHaveLength(1)
  })

  it("denies NOT_SAME_MEASURE when either answer is false, naming both properties", async () => {
    for (const verdict of [{ ...SAME, same_property: false }, { ...SAME, comparable_scope: false }]) {
      const out = await verifyMeasures(screenAll([p()]), fake(() => verdict))
      const r = admitScreened(out, ctx)
      expect(r.admitted).toHaveLength(0)
      expect(r.denied).toEqual([{ proposalId: "p0", code: "NOT_SAME_MEASURE", detail: measureDetail(verdict) }])
      expect(measureDetail(verdict)).toBe("uptime (every paid workspace) vs uptime incidents (the last ninety days)")
    }
  })

  it("denies RELATION_UNVERIFIED on a failed call and keeps going", async () => {
    const out = await verifyMeasures(
      screenAll([p(), p({ proposalId: "p1", type: "updates" })]),
      fake((input) => (input.relation === "contradicts" ? new Error("refused") : SAME)),
    )
    const r = admitScreened(out, ctx)
    expect(r.denied).toContainEqual({ proposalId: "p0", code: "RELATION_UNVERIFIED", detail: "refused" })
    expect(r.admitted.map((a) => a.proposal.proposalId)).toEqual(["p1"])
  })

  it("throws when every verifier call fails", async () => {
    await expect(verifyMeasures(screenAll([p()]), fake(() => new Error("schema"))))
      .rejects.toThrow("every relation check failed (1/1); first: schema")
  })

  it("never asks about unsupported proposals or already-denied ones", async () => {
    const v = fake(() => SAME)
    await verifyMeasures(screenAll([
      p({ proposalId: "u", type: "unsupported", to: null }),
      p({ proposalId: "low", confidence: 0.1 }),
    ]), v)
    expect(v.calls).toEqual([])
  })

  it("sends the two quotes and the relation, nothing else", async () => {
    const v = fake(() => SAME)
    await verifyMeasures(screenAll([p()]), v)
    expect(v.calls).toEqual([{
      claim: "Acme guarantees 99.99% uptime",
      evidence: "four separate uptime incidents",
      relation: "contradicts",
    }])
  })

  it("a denied proposal does not block a later one with the same claim", async () => {
    const out = await verifyMeasures(
      screenAll([p(), p({ proposalId: "p1", to: { docId: "status", quote: "in the last ninety days" } })]),
      fake((input) => (input.evidence.includes("four") ? { ...SAME, same_property: false } : SAME)),
    )
    const r = admitScreened(out, ctx)
    expect(r.admitted.map((a) => a.proposal.proposalId)).toEqual(["p1"])
    expect(r.denied.map((d) => d.code)).toEqual(["NOT_SAME_MEASURE"])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/assay/bookkeeper/measure.test.ts`
Expected: FAIL — cannot resolve `./measure.js`.

- [ ] **Step 3: Add the codes and implement `verifyMeasures`**

In `src/assay/types.ts`, extend `AdmissionCode`:

```ts
export type AdmissionCode =
  | "ADMITTED" | "ANCHOR_NOT_FOUND" | "DOC_UNKNOWN" | "QUOTE_TOO_LONG"
  | "NOT_QUERY_RELEVANT" | "LOW_CONFIDENCE" | "DUPLICATE" | "SELF_PAIR"
  | "SELF_SOURCED" | "INCOHERENT_QUOTE" | "ISSUE_STATEMENT" | "HOLDING_COMPETITOR"
  | "FROM_NOT_CLAIMANT" | "TO_NOT_INDEPENDENT"
  /** The verifier found the two quotes do not measure the same property at a comparable scope. */
  | "NOT_SAME_MEASURE"
  /** The verifier call failed, was refused, or returned an unusable verdict. Fail closed. */
  | "RELATION_UNVERIFIED"
```

Create `src/assay/bookkeeper/measure.ts`:

```ts
import type { Admission, RelationType } from "../types.js"
import type { Screened, ScreenedOk } from "./admit.js"

export type RelationalType = Exclude<RelationType, "unsupported">

/** Everything the verifier is allowed to see. No topic, statement, rationale, label or URL. */
export interface MeasureInput {
  claim: string
  evidence: string
  relation: RelationalType
}

export interface MeasureVerdict {
  claim_property: string
  claim_scope: string
  evidence_property: string
  evidence_scope: string
  same_property: boolean
  comparable_scope: boolean
}

/**
 * Judges whether the evidence can bear on the claim at all: the same property,
 * at a scope from which a conclusion about the claim follows. Not whether the
 * relation type is right. See
 * docs/superpowers/specs/2026-09-25-relation-measure-check-design.md.
 */
export interface MeasureVerifier {
  verify(input: MeasureInput): Promise<MeasureVerdict>
}

export function measureDetail(v: MeasureVerdict): string {
  return `${v.claim_property} (${v.claim_scope}) vs ${v.evidence_property} (${v.evidence_scope})`
}

/**
 * Put every screened relational proposal to the verifier and replace the ones
 * it fails with denials, keeping order. Runs before duplicate detection, so a
 * pairing it denies never blocks a later pairing of the same claim.
 *
 * A call that throws denies RELATION_UNVERIFIED -- fail closed, like every
 * other gate. Every call failing is our outage, not a finding: it throws.
 */
export async function verifyMeasures(
  screened: Screened[],
  verifier: MeasureVerifier,
  opts: { concurrency?: number } = {},
): Promise<Screened[]> {
  const out = [...screened]
  const targets = out.flatMap((s, i) => (s.ok && s.proposal.type !== "unsupported" && s.toSpan ? [i] : []))
  if (targets.length === 0) return out

  let failures = 0
  let firstError: string | undefined
  let next = 0
  const deny = (s: ScreenedOk, code: Admission["code"], detail: string): Screened =>
    ({ ok: false, denial: { proposalId: s.proposal.proposalId, code, detail } })

  const worker = async () => {
    for (let n = next++; n < targets.length; n = next++) {
      const i = targets[n]!
      const s = out[i] as ScreenedOk
      try {
        const v = await verifier.verify({
          claim: s.fromSpan.text,
          evidence: s.toSpan!.text,
          relation: s.proposal.type as RelationalType,
        })
        if (!(v.same_property && v.comparable_scope)) out[i] = deny(s, "NOT_SAME_MEASURE", measureDetail(v))
      } catch (err) {
        failures++
        const message = err instanceof Error ? err.message : String(err)
        firstError ??= message
        out[i] = deny(s, "RELATION_UNVERIFIED", message.slice(0, 120))
      }
    }
  }
  const limit = Math.min(Math.max(opts.concurrency ?? 3, 1), targets.length)
  await Promise.all(Array.from({ length: limit }, worker))

  if (failures === targets.length) {
    throw new Error(`every relation check failed (${failures}/${targets.length}); first: ${firstError}`)
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/assay/bookkeeper`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm test` and `npm run typecheck`. If a renderer or audit test enumerates every `AdmissionCode` (e.g. an exhaustive label map), add the two new codes there with labels `"not same measure"` and `"relation unverified"`.

```bash
git add src/assay/bookkeeper/measure.ts src/assay/bookkeeper/measure.test.ts src/assay/types.ts
git commit -m "Add verifyMeasures: deny relations whose quotes measure different things

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the verifier into `assay()` and stamp the audit

**Files:**
- Modify: `src/assay/types.ts` (`Audit`, `AssayOptions`)
- Modify: `src/assay/assemble.ts:8-13` (`AssembleOpts`), `auditOf`, `buildLedger`, `assemble`
- Modify: `src/assay/index.ts:38-80` (`assayOnce`)
- Create: `src/assay/measure-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `verifyMeasures`, `MeasureVerifier` from Task 2.
- Produces: `AssayOptions.verifier?: MeasureVerifier`; `Audit.relationCheck?: true`.

- [ ] **Step 1: Write the failing test**

Create `src/assay/measure-wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { assay } from "./index.js"
import type { ProposalClient } from "./cartographer/propose.js"
import type { MeasureVerifier } from "./bookkeeper/measure.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"
import { TEST_PROFILE } from "./test-profile.js"

function doc(over: Partial<PinnedDoc>): PinnedDoc {
  return {
    docId: "d", url: "https://example.com", label: "L", role: "claimant", kind: "vendor_site",
    fetchedAt: "2026-09-09T00:00:00.000Z", title: "T", text: "",
    stability: "volatile", pin: { kind: "hash", sha256: "00" }, driftHash: "00", ...over,
  }
}
const corpus: PinnedCorpus = {
  subject: "Acme",
  docs: [
    doc({ docId: "a", role: "claimant", text: "Acme guarantees 99.99% uptime for every account." }),
    doc({ docId: "b", role: "independent", text: "Acme has run without incident for the past year." }),
  ],
  failures: [],
}
const client: ProposalClient = {
  propose: async () => ({
    stopReason: "end_turn",
    proposals: [{
      type: "corroborates", topic: "uptime", statement: "s",
      from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
      to: { docId: "b", quote: "Acme has run without incident for the past year." },
      rationale: "r", confidence: 0.9,
    }] as never,
  }),
}
const verdict = (ok: boolean): MeasureVerifier => ({
  verify: async () => ({
    claim_property: "uptime", claim_scope: "every account", evidence_property: "incidents",
    evidence_scope: "one year", same_property: ok, comparable_scope: ok,
  }),
})

describe("assay with a relation verifier", () => {
  it("stamps audit.relationCheck and admits what the verifier passes", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client, profile: TEST_PROFILE, verifier: verdict(true) })
    expect(r.outcome).toBe("ledger")
    expect(r.audit.relationCheck).toBe(true)
    if (r.outcome === "ledger") expect(r.rows).toHaveLength(1)
  })

  it("denies NOT_SAME_MEASURE, which still counts as anchored evidence", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client, profile: TEST_PROFILE, verifier: verdict(false) })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("BELOW_THRESHOLD")
    expect(r.audit.denied.map((d) => d.code)).toEqual(["NOT_SAME_MEASURE"])
    expect(r.audit.relationCheck).toBe(true)
  })

  it("leaves relationCheck absent without a verifier", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client, profile: TEST_PROFILE })
    expect("relationCheck" in r.audit).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/assay/measure-wiring.test.ts`
Expected: FAIL — typecheck/`verifier` ignored, `relationCheck` undefined.

- [ ] **Step 3: Implement**

`src/assay/types.ts` — add to `Audit` (after `runDisagreement?: true`):

```ts
  /** Every relational row was put to the relation measure verifier. Absent, never false, on unchecked runs. */
  relationCheck?: true
```

and to `AssayOptions` (after `clientForSample`), with `import type { MeasureVerifier } from "./bookkeeper/measure.js"` at the top:

```ts
  /** Judges every screened relational proposal before admission. Absent: no relation check. */
  verifier?: MeasureVerifier
```

`src/assay/assemble.ts` — extend `AssembleOpts`:

```ts
interface AssembleOpts {
  passes?: number
  conflictMode: "report" | "converge"
  /** How many proposals produced at least one span the gate could locate. */
  anchoredCount: number
  relationCheck?: true
}
```

change `auditOf`'s `opts` parameter type to `{ passes?: number; relationCheck?: true } = {}` and add, after the `passes` line in its return:

```ts
    ...(opts.relationCheck ? { relationCheck: true as const } : {}),
```

change `buildLedger`'s `opts` type to `{ passes?: number; relationCheck?: true } = {}`, and in `assemble` replace the `buildLedger(...)` call with:

```ts
  const report = buildLedger(corpus, proposed, result, {
    ...(opts.passes === undefined ? {} : { passes: opts.passes }),
    ...(opts.relationCheck ? { relationCheck: true as const } : {}),
  })
```

`src/assay/index.ts` — import `admitContext, admitScreened, orderForAdmission, screen` from `./bookkeeper/admit.js` and `verifyMeasures` from `./bookkeeper/measure.js`; in `assayOnce` replace

```ts
  const result = admit(corpus, fanned.proposals, admitTerms, idf, threshold, opts.profile.lexicon)
```

with

```ts
  const ctx = admitContext(corpus, admitTerms, idf, threshold, opts.profile.lexicon)
  let screened = orderForAdmission(fanned.proposals).map((p) => screen(p, ctx))
  if (opts.verifier) {
    screened = await verifyMeasures(screened, opts.verifier, opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {})
  }
  const result = admitScreened(screened, ctx)
```

and add `...(opts.verifier ? { relationCheck: true as const } : {}),` to the `assemble(...)` options object in the same function. Remove the now-unused `admit` import if nothing else in the file uses it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/assay`
Expected: PASS. `mergeRuns` spreads `left.audit`, so `relationCheck` survives `--runs 2` without changes; confirm `src/assay/merge.test.ts` still passes.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
git add src/assay/types.ts src/assay/assemble.ts src/assay/index.ts src/assay/measure-wiring.test.ts
git commit -m "Run the relation verifier between screening and admission

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Anthropic verifier adapter

**Files:**
- Create: `src/cartographer/measure.ts`
- Create: `src/cartographer/measure.test.ts`

**Interfaces:**
- Consumes: `MeasureInput`, `MeasureVerdict`, `MeasureVerifier` (Task 2); `MODEL`, `SdkProposalClient` from `src/cartographer/anthropic.ts`.
- Produces: `MeasureVerdictSchema`, `MEASURE_SYSTEM`, `measureUserMessage(input): string`, `toMeasureVerifier(sdk, model?): MeasureVerifier`, `RELATION_CHECK_DEFAULT: boolean` (false until Task 7).

- [ ] **Step 1: Write the failing test**

Create `src/cartographer/measure.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { SdkProposalClient } from "./anthropic.js"
import { MEASURE_SYSTEM, measureUserMessage, toMeasureVerifier } from "./measure.js"

const VERDICT = {
  claim_property: "p", claim_scope: "s", evidence_property: "q", evidence_scope: "t",
  same_property: true, comparable_scope: false,
}
const INPUT = { claim: "Acme guarantees 99.99% uptime.", evidence: "Acme was down for six hours.", relation: "contradicts" as const }

function sdk(reply: object) {
  const bodies: Record<string, unknown>[] = []
  const client: SdkProposalClient = {
    beta: { messages: { parse: async (body) => { bodies.push(body as never); return reply as never } } },
  }
  return { client, bodies }
}

describe("toMeasureVerifier", () => {
  it("sends the two quotes and the relation under the measure prompt, and returns the verdict", async () => {
    const { client, bodies } = sdk({ stop_reason: "end_turn", parsed_output: VERDICT })
    const out = await toMeasureVerifier(client, "claude-test").verify(INPUT)
    expect(out).toEqual(VERDICT)
    expect(bodies[0]).toMatchObject({
      model: "claude-test", max_tokens: 1024, system: MEASURE_SYSTEM,
      messages: [{ role: "user", content: measureUserMessage(INPUT) }],
    })
    expect(measureUserMessage(INPUT)).toContain('"Acme guarantees 99.99% uptime."')
    expect(measureUserMessage(INPUT)).toContain('"Acme was down for six hours."')
    expect(measureUserMessage(INPUT)).toContain("contradicts")
  })

  it("throws 'refused' on a refusal and 'schema' on an unusable verdict", async () => {
    await expect(toMeasureVerifier(sdk({ stop_reason: "refusal" }).client).verify(INPUT)).rejects.toThrow("refused")
    await expect(toMeasureVerifier(sdk({ stop_reason: "end_turn", parsed_output: { same_property: "yes" } }).client).verify(INPUT))
      .rejects.toThrow("schema")
  })

  it("keeps the prompt free of the labeled rows it will be measured on", () => {
    for (const word of ["Tesla", "Vercel", "Chime", "Claude", "robotaxi", "Redis", "FDIC"]) {
      expect(MEASURE_SYSTEM).not.toContain(word)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cartographer/measure.test.ts`
Expected: FAIL — cannot resolve `./measure.js`.

- [ ] **Step 3: Implement**

Create `src/cartographer/measure.ts`:

```ts
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import type { MeasureInput, MeasureVerdict, MeasureVerifier } from "../assay/bookkeeper/measure.js"
import { MODEL, type SdkProposalClient } from "./anthropic.js"

/** Whether a run checks relations when neither --relation-check nor --no-relation-check is given. Set by the relation-eval bar. */
export const RELATION_CHECK_DEFAULT = false

export const MeasureVerdictSchema = z.object({
  claim_property: z.string(),
  claim_scope: z.string(),
  evidence_property: z.string(),
  evidence_scope: z.string(),
  same_property: z.boolean(),
  comparable_scope: z.boolean(),
})

/**
 * The rule only, in general terms. No example may come from
 * fixtures/relation-labels.json or its notes: the eval would then measure
 * recall of its own answers.
 */
export const MEASURE_SYSTEM = [
  "You check whether a piece of evidence can bear on a claim at all.",
  "You are given a claim quoted from a vendor's own materials, a quote from an independent source, and the relation someone proposed between them.",
  "Do not judge whether the proposed relation is the right one. Judge only whether the evidence could bear on the claim.",
  "First state what property the claim asserts and about what scope: which products, people, period or population it covers.",
  "Then state what the evidence measures or reports, and about what scope.",
  "same_property is true only when both are about the same property: the same capability, metric, feature or fact.",
  "Sharing a subject, a product name or a topic is not enough.",
  "comparable_scope is true when a conclusion about the claim can follow from the evidence at the evidence's scope.",
  "Scope is not size. A single case can show that something exists or can happen, so it can bear on a claim that something exists or is possible.",
  "A single case cannot establish or refute a rate, an average, a trend or a claim about a whole population.",
  "Evidence about part of a population bears on a claim about the whole only when the claim is about every member.",
].join(" ")

export function measureUserMessage(input: MeasureInput): string {
  return [
    "Claim, quoted from the vendor's own materials:",
    `"${input.claim}"`,
    "",
    "Evidence, quoted from an independent source:",
    `"${input.evidence}"`,
    "",
    `Proposed relation: the evidence ${input.relation} the claim.`,
  ].join("\n")
}

type ParseBody = Parameters<SdkProposalClient["beta"]["messages"]["parse"]>[0]

/**
 * The relation measure verifier over the parse-shaped client, so it can be
 * wrapped by the proposal cache and replayed like any proposal.
 */
export function toMeasureVerifier(sdk: SdkProposalClient, model: string = MODEL): MeasureVerifier {
  return {
    async verify(input: MeasureInput): Promise<MeasureVerdict> {
      const response = await sdk.beta.messages.parse({
        model,
        max_tokens: 1024,
        system: MEASURE_SYSTEM,
        messages: [{ role: "user", content: measureUserMessage(input) }],
        output_format: betaZodOutputFormat(MeasureVerdictSchema) as unknown as ParseBody["output_format"],
      })
      if (response.stop_reason === "refusal") throw new Error("refused")
      const parsed = MeasureVerdictSchema.safeParse(response.parsed_output)
      if (!parsed.success) throw new Error("schema")
      return parsed.data
    },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cartographer`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
git add src/cartographer/measure.ts src/cartographer/measure.test.ts
git commit -m "Add the Anthropic relation measure verifier

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cache, manifest and replay

**Files:**
- Modify: `src/types.ts:25` (`ReceiptsManifest`)
- Modify: `src/pipeline.ts` (`analyzeCorpus` opts)
- Modify: `src/analyze-live.ts`
- Modify: `src/cli/replay.ts`
- Modify: `src/cli/replay.test.ts`

**Interfaces:**
- Consumes: `toMeasureVerifier` (Task 4); `AssayOptions.verifier` (Task 3).
- Produces: `AnalyzeLiveOpts.relationCheck?: boolean`, `AnalyzeLiveOpts.verifierClient?: SdkProposalClient`; `ReceiptsManifest.relationCheck?: { model: string; keys: string[] }`; `ReplayDeps.verifierClient?: CachedProposalClient`.

- [ ] **Step 1: Write the failing replay test**

In `src/cli/replay.test.ts`, add after `makeReplayable`:

```ts
const RELATION = {
  type: "corroborates", topic: "uptime", statement: "s",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
  to: { docId: "b", quote: "Acme has run without incident for the past year." },
  rationale: "r", confidence: 0.9,
}
const relationStub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [RELATION] } }) as never } },
}
const verdictStub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({
    stop_reason: "end_turn",
    parsed_output: {
      claim_property: "uptime", claim_scope: "every account", evidence_property: "incidents",
      evidence_scope: "one year", same_property: true, comparable_scope: true,
    },
  }) as never } },
}

async function makeCheckedReplayable(): Promise<{ path: string; deps: ReplayDeps; saved: AssayResult }> {
  const stored = new Set(storeCorpus(CORPUS, snapDir))
  const cached = withProposalCache(relationStub, { dir: cacheDir })
  const verifierCached = withProposalCache(verdictStub, { dir: cacheDir })
  const result = await assay(
    toPinnedCorpus(CORPUS, { isStored: (sha) => stored.has(sha) }), { subject: CORPUS.subject },
    { client: toAssayClient(cached, "claude-opus-5"), candidates: 40, profile: receipts("frontier"),
      verifier: toMeasureVerifier(verifierCached, "claude-opus-5") },
  )
  const replay: ReceiptsManifest = {
    sample: 0, keys: cached.keys, model: "claude-opus-5", candidates: 40, threshold: 0.5,
    conflictMode: "report", profile: "receipts", tier: "frontier",
    relationCheck: { model: "claude-opus-5", keys: verifierCached.keys },
  }
  const saved: AssayResult = { ...result, replay }
  const path = join(cwd, "checked.json")
  writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`)
  return {
    path, saved,
    deps: {
      snapshot: (sha) => getSnapshot(sha, snapDir),
      client: cacheOnlyClient({ dir: cacheDir }),
      verifierClient: cacheOnlyClient({ dir: cacheDir }),
    },
  }
}
```

and inside `describe("runReplay", ...)`:

```ts
  it("replays a relation-checked ledger with a cache-only verifier, identically", async () => {
    const { path, saved, deps } = await makeCheckedReplayable()
    expect(saved.outcome).toBe("ledger")
    expect(saved.audit.relationCheck).toBe(true)
    const r = await runReplay(path, profileFor, deps)
    expect(r.diff).toEqual([])
    expect(r.replayed).toBe(saved.replay!.keys.length + (saved.replay as ReceiptsManifest).relationCheck!.keys.length)
  })

  it("fails the replay when a verifier response is missing from the cache", async () => {
    const { path, saved, deps } = await makeCheckedReplayable()
    unlinkSync(join(cacheDir, `${(saved.replay as ReceiptsManifest).relationCheck!.keys[0]}.json`))
    await expect(runReplay(path, profileFor, deps)).rejects.toThrow("replay: no cached response for")
  })
```

Add `import { toMeasureVerifier } from "../cartographer/measure.js"` to the file's imports.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/replay.test.ts`
Expected: FAIL — `relationCheck` not on `ReceiptsManifest`, `verifierClient` not on `ReplayDeps`, and the replay diff shows `audit.relationCheck: true → undefined`.

- [ ] **Step 3: Implement**

`src/types.ts`:

```ts
export type ReceiptsManifest = ReplayManifest & {
  tier?: PromptTier
  /** Present when the run checked relations: the verifier's model and its cache keys. */
  relationCheck?: { model: string; keys: string[] }
}
```

`src/pipeline.ts` — add to `analyzeCorpus`'s `opts` type, with `import type { MeasureVerifier } from "./assay/bookkeeper/measure.js"`:

```ts
    /** Judges every relational proposal before admission. Absent: no relation check. */
    verifier?: MeasureVerifier
```

(it already flows through `...assayOpts`).

`src/cli/replay.ts` — add to `ReplayDeps`:

```ts
  /** Serves verifier responses. Default: a cache-only client at sample 0. */
  verifierClient?: CachedProposalClient
```

import `toMeasureVerifier` from `../cartographer/measure.js` and `type MeasureVerifier` from `../assay/bookkeeper/measure.js`; after the `wrap` function add:

```ts
  // A checked ledger replays its verdicts from the cache, under the verifier
  // model the manifest names. A ledger stamped before the check has none, and
  // replays with no verifier, as it was made.
  const relationCheck = (saved.replay as ReceiptsManifest).relationCheck
  const verifierInner = relationCheck ? (deps.verifierClient ?? cacheOnlyClient({ sample: 0 })) : undefined
  const verifier: MeasureVerifier | undefined = relationCheck && verifierInner
    ? toMeasureVerifier({
        beta: {
          messages: {
            parse: async (body) => {
              try {
                return await verifierInner.beta.messages.parse(body)
              } catch (err) {
                failure ??= err instanceof Error ? err : new Error(String(err))
                throw err
              }
            },
          },
        },
      }, relationCheck.model)
    : undefined
```

pass `...(verifier ? { verifier } : {}),` in the `assay(...)` options, and change the `replayed` line to:

```ts
  const replayed = [...bySample.values()].reduce((n, c) => n + c.keys.length, 0) + (verifierInner?.keys.length ?? 0)
```

`src/analyze-live.ts` — import `toMeasureVerifier` from `./cartographer/measure.js`; add to `AnalyzeLiveOpts`:

```ts
  /** Check every relational proposal with the frontier-model verifier. Default false. */
  relationCheck?: boolean
  /** Parse-shaped client for the verifier. Default: the Anthropic client, whatever the proposer is. */
  verifierClient?: SdkProposalClient
```

after `clientForSample` is defined, add:

```ts
  // The verifier always runs on the frontier model, through its own cache
  // wrapper: the proposer's wrapper may wrap a local model. One wrapper at
  // sample 0 serves both samples, so a pair both samples propose is judged once.
  const verifierInner = opts.relationCheck ? (opts.verifierClient ?? defaultClient()) : undefined
  const verifierCached = verifierInner && !opts.noCache
    ? withProposalCache(verifierInner, { dir: cacheDir, sample: 0 })
    : undefined
  const verifier = verifierInner ? toMeasureVerifier(verifierCached ?? verifierInner, MODEL) : undefined
```

pass `...(verifier ? { verifier } : {}),` to `analyzeCorpus`; change the `clients` list to include `verifierCached` when present:

```ts
  const clients: CachedProposalClient[] = [
    ...(opts.noCache ? [] : (runs === 2 ? [cached0!, cached1!] : [cached0!])),
    ...(verifierCached ? [verifierCached] : []),
  ]
```

and add `...(verifierCached ? { relationCheck: { model: MODEL, keys: verifierCached.keys } } : {}),` to **both** manifest literals.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli/replay.test.ts src/analyze-live.test.ts 2>/dev/null; npx vitest run src/cli src/assay`
Expected: PASS, including every pre-existing replay test (their manifests carry no `relationCheck`).

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
git add src/types.ts src/pipeline.ts src/analyze-live.ts src/cli/replay.ts src/cli/replay.test.ts
git commit -m "Cache relation verdicts and replay relation-checked ledgers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CLI flags, key check, and the "relations not verified" line

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/args.test.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/report/render/provenance.ts`, `src/report/render/terminal.ts`, `src/report/render/markdown.ts`, `src/report/render/html.ts`
- Test: `src/report/render/render.test.ts`

**Interfaces:**
- Consumes: `AnalyzeLiveOpts.relationCheck` (Task 5), `RELATION_CHECK_DEFAULT` (Task 4), `Audit.relationCheck` (Task 3).
- Produces: `CliOptions.relationCheck?: boolean`; `relationCheckNote(report): string | undefined`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/args.test.ts`, add:

```ts
describe("--relation-check", () => {
  it("parses either flag and leaves the default to the caller when neither is given", () => {
    expect(parseArgs(["acme"]).relationCheck).toBeUndefined()
    expect(parseArgs(["acme", "--relation-check"]).relationCheck).toBe(true)
    expect(parseArgs(["acme", "--no-relation-check"]).relationCheck).toBe(false)
  })
  it("refuses both at once, and either on a run that makes no model call", () => {
    expect(() => parseArgs(["acme", "--relation-check", "--no-relation-check"]))
      .toThrow("receipts: --relation-check and --no-relation-check conflict")
    expect(() => parseArgs(["acme", "--replay", "r.json", "--relation-check"]))
      .toThrow("receipts: --relation-check chooses whether a model call checks relations; this run makes none")
  })
})
```

In `src/report/render/render.test.ts`, add (adjusting the import list to include `relationCheckNote` from `./provenance.js`):

```ts
describe("relationCheckNote", () => {
  const row = (relation: string) => ({ relation }) as never
  it("says relations were not verified when a relational row has no check stamp", () => {
    expect(relationCheckNote({ rows: [row("contradicts")], audit: {} as never })).toBe("relations not verified")
  })
  it("is silent for a checked ledger, or one with only unsupported rows", () => {
    expect(relationCheckNote({ rows: [row("contradicts")], audit: { relationCheck: true } as never })).toBeUndefined()
    expect(relationCheckNote({ rows: [row("unsupported")], audit: {} as never })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/cli/args.test.ts src/report/render/render.test.ts`
Expected: FAIL — unknown flag / missing export.

- [ ] **Step 3: Implement**

`src/cli/args.ts`: add `"--relation-check", "--no-relation-check"` to `BOOL_FLAGS`; add to `CliOptions`:

```ts
  /** Check relations with the frontier-model verifier. Absent: RELATION_CHECK_DEFAULT decides. */
  relationCheck?: boolean
```

and in `parseArgs`, next to the `--client` validation:

```ts
  const checkOn = seen.has("--relation-check")
  const checkOff = seen.has("--no-relation-check")
  if (checkOn && checkOff) throw new Error("receipts: --relation-check and --no-relation-check conflict")
  if ((checkOn || checkOff) && (replay !== undefined || render !== undefined || fetchOnly || (refresh !== undefined && !rerun))) {
    throw new Error(`receipts: ${checkOn ? "--relation-check" : "--no-relation-check"} chooses whether a model call checks relations; this run makes none`)
  }
```

and in the returned object: `...(checkOn ? { relationCheck: true } : checkOff ? { relationCheck: false } : {}),`.

`src/cli/index.ts`: import `RELATION_CHECK_DEFAULT` from `../cartographer/measure.js`; in `USAGE` add after `--prompt-tier`:

```
  --relation-check        check every proposed relation with the frontier model before
  --no-relation-check     admitting it (needs ANTHROPIC_API_KEY, whatever --client is)
```

after the `OLLAMA_MODEL` check add:

```ts
const relationCheck = opts.relationCheck ?? RELATION_CHECK_DEFAULT
if (makesModelCall && relationCheck && !process.env.ANTHROPIC_API_KEY) {
  die("ANTHROPIC_API_KEY is not set. The relation check verifies every proposed relation with the frontier model, whatever --client proposes; pass --no-relation-check to skip it.")
}
```

and pass `relationCheck,` in the `analyzeLive(corpus, { ... })` call.

`src/report/render/provenance.ts`:

```ts
/** Present when a ledger shows relations no verifier checked. */
export function relationCheckNote(report: Pick<Report, "rows" | "audit">): string | undefined {
  if (report.audit.relationCheck === true) return undefined
  return report.rows.some((row) => row.relation !== "unsupported") ? "relations not verified" : undefined
}
```

In `terminal.ts` after `if (footer) out.push(\`  ${footer}\`)`:

```ts
  const unchecked = relationCheckNote(report)
  if (unchecked) out.push(`  ${unchecked}`)
```

In `markdown.ts`, after the `...(footer ? [footer, ""] : [])` line, add `...(relationCheckNote(report) ? [relationCheckNote(report)!, ""] : []),`. In `html.ts`, append `${relationCheckNote(report) ? `<br>${esc(relationCheckNote(report)!)}` : ""}` right after the `${footer ? ... : ""}` expression. Import `relationCheckNote` in all three.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS. Renderer tests whose fixture reports carry relational rows and no stamp now render one more line, "relations not verified": update those expectations to include it — that line is the intended change.

- [ ] **Step 5: Typecheck, commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts src/cli/index.ts src/report/render
git commit -m "Add --relation-check and mark unchecked ledgers in every renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The labeled set and `npm run relation-eval`

**Files:**
- Create: `fixtures/relation-labels.json`
- Create: `src/eval/relation-labels.ts`, `src/eval/relation-labels.test.ts`
- Create: `src/eval/relation-eval.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `MeasureVerifier`, `MeasureVerdict` (Task 2); `toMeasureVerifier` (Task 4); `defaultClient` from `src/cartographer/anthropic.ts`.
- Produces:
  ```ts
  export interface LabeledRelation {
    id: string; subject: string; relation: "contradicts" | "corroborates" | "updates"
    claim: { source: string; text: string }; evidence: { source: string; text: string }
    verdict: "holds" | "wrong_relation" | "no_relation"; should?: string; note?: string
    expect: "admit" | "deny" | "exclude"
  }
  export function expectationOf(verdict: LabeledRelation["verdict"], should?: string): LabeledRelation["expect"]
  export interface EvalRun { admitted: Record<string, boolean> }
  export function runEval(rows: LabeledRelation[], verifier: MeasureVerifier): Promise<EvalRun>
  export function score(rows: LabeledRelation[], run: EvalRun): { negativesDenied: number; negatives: number; positivesAdmitted: number; positives: number }
  export function agreement(a: EvalRun, b: EvalRun): number
  export const BAR = { negatives: 24, positives: 4, agreement: 0.9 }
  export function meetsBar(s: ReturnType<typeof score>, agree: number): boolean
  ```

- [ ] **Step 1: Generate the fixture**

The labels live in the GIN session scratchpad (`C:/Users/krist/AppData/Local/Temp/claude/C--Users-krist-Projects-GIN/456b95b6-433b-4653-8ec7-0641cbd61213/scratchpad`). Run from the Receipts root:

```bash
node - "C:/Users/krist/AppData/Local/Temp/claude/C--Users-krist-Projects-GIN/456b95b6-433b-4653-8ec7-0641cbd61213/scratchpad" <<'EOF'
const fs = require("fs"), path = require("path")
const S = process.argv[2]
const key = JSON.parse(fs.readFileSync(path.join(S, "label-key.json"), "utf8"))
const rows = {}
for (const d of JSON.parse(fs.readFileSync(path.join(S, "label-seed.json"), "utf8"))) rows[d.doc_id] = d.data
for (const f of fs.readdirSync(path.join(S, "seed2"))) rows[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(S, "seed2", f), "utf8"))
const dir = path.join(S, "labels-out2", "labels")
const labels = {}
for (const f of fs.readdirSync(dir)) { const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); labels[f.replace(/\.json$/, "")] = d.data ?? d }
const out = []
for (const [id, r] of Object.entries(rows).sort((a, b) => a[1].n - b[1].n)) {
  if (r.relation === "unsupported" || !r.evidence) continue
  const l = labels[id]
  if (!l || !l.verdict || l.verdict === "unsure") throw new Error("unlabeled relational row " + id)
  const expect = l.verdict === "no_relation" ? "deny"
    : l.verdict === "holds" ? "admit"
    : ["contradicts", "corroborates", "updates"].includes(l.should) ? "admit" : "exclude"
  out.push({
    id, subject: r.subject, relation: r.relation,
    claim: { source: r.claim.source, text: r.claim.text },
    evidence: { source: r.evidence.source, text: r.evidence.text },
    verdict: l.verdict, ...(l.should ? { should: l.should } : {}), ...(l.note ? { note: l.note } : {}), expect,
  })
}
const count = (e) => out.filter((x) => x.expect === e).length
if (out.length !== 36 || count("deny") !== 30 || count("admit") !== 5 || count("exclude") !== 1) {
  throw new Error(`unexpected counts: ${out.length} rows, ${count("deny")}/${count("admit")}/${count("exclude")}`)
}
fs.writeFileSync("fixtures/relation-labels.json", JSON.stringify({
  description: "Relational ledger rows hand-labeled blind on 2026-09-25 (see docs/superpowers/specs/2026-09-25-relation-measure-check-design.md). No proposer identity. Never quote these rows or notes in the verifier prompt.",
  rows: out,
}, null, 2) + "\n")
console.log("wrote", out.length, "rows")
EOF
```

Expected: `wrote 36 rows`.

- [ ] **Step 2: Write the failing tests**

Create `src/eval/relation-labels.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { MeasureVerifier } from "../assay/bookkeeper/measure.js"
import { agreement, expectationOf, meetsBar, runEval, score, type LabeledRelation } from "./relation-labels.js"

const rows = (JSON.parse(readFileSync("fixtures/relation-labels.json", "utf8")) as { rows: LabeledRelation[] }).rows
const verdict = (ok: boolean) => ({
  claim_property: "a", claim_scope: "b", evidence_property: "c", evidence_scope: "d",
  same_property: ok, comparable_scope: ok,
})
const oracle: MeasureVerifier = {
  verify: async (input) => verdict(rows.find((r) => r.claim.text === input.claim && r.evidence.text === input.evidence)!.expect === "admit"),
}
const denyAll: MeasureVerifier = { verify: async () => verdict(false) }

describe("relation labels", () => {
  it("holds 30 to deny, 5 to admit, 1 excluded", () => {
    expect(rows.map((r) => r.expect).sort()).toEqual([...Array(5).fill("admit"), ...Array(30).fill("deny"), "exclude"])
  })
  it("maps verdicts to expectations", () => {
    expect(expectationOf("no_relation")).toBe("deny")
    expect(expectationOf("holds")).toBe("admit")
    expect(expectationOf("wrong_relation", "updates")).toBe("admit")
    expect(expectationOf("wrong_relation", "unsupported")).toBe("exclude")
  })
  it("scores an oracle at the top of the bar, and deny-all fails on positives", async () => {
    const good = await runEval(rows, oracle)
    expect(score(rows, good)).toEqual({ negativesDenied: 30, negatives: 30, positivesAdmitted: 5, positives: 5 })
    expect(meetsBar(score(rows, good), agreement(good, good))).toBe(true)
    const bad = await runEval(rows, denyAll)
    expect(meetsBar(score(rows, bad), 1)).toBe(false)
  })
  it("never sends an excluded row to the verifier", async () => {
    const seen: string[] = []
    await runEval(rows, { verify: async (i) => { seen.push(i.claim); return verdict(true) } })
    expect(seen).toHaveLength(35)
  })
  it("measures agreement over the rows both runs judged", () => {
    expect(agreement({ admitted: { a: true, b: false } }, { admitted: { a: true, b: true } })).toBe(0.5)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/eval/relation-labels.test.ts`
Expected: FAIL — cannot resolve `./relation-labels.js`.

- [ ] **Step 4: Implement**

Create `src/eval/relation-labels.ts`:

```ts
import type { MeasureVerifier } from "../assay/bookkeeper/measure.js"

export interface LabeledRelation {
  id: string
  subject: string
  relation: "contradicts" | "corroborates" | "updates"
  claim: { source: string; text: string }
  evidence: { source: string; text: string }
  verdict: "holds" | "wrong_relation" | "no_relation"
  should?: string
  note?: string
  expect: "admit" | "deny" | "exclude"
}

/**
 * No relation must be denied. A relation that holds must be admitted, and so
 * must a wrong-type pairing whose quotes still bear on each other: the check
 * judges bearing, not type. A pairing that should have been `unsupported` is
 * an independence failure this check is not built to catch.
 */
export function expectationOf(verdict: LabeledRelation["verdict"], should?: string): LabeledRelation["expect"] {
  if (verdict === "no_relation") return "deny"
  if (verdict === "holds") return "admit"
  return should === "contradicts" || should === "corroborates" || should === "updates" ? "admit" : "exclude"
}

export interface EvalRun {
  /** Row id to whether the verifier admitted it. Excluded rows are absent. */
  admitted: Record<string, boolean>
}

export async function runEval(rows: LabeledRelation[], verifier: MeasureVerifier): Promise<EvalRun> {
  const admitted: Record<string, boolean> = {}
  for (const r of rows) {
    if (r.expect === "exclude") continue
    const v = await verifier.verify({ claim: r.claim.text, evidence: r.evidence.text, relation: r.relation })
    admitted[r.id] = v.same_property && v.comparable_scope
  }
  return { admitted }
}

export function score(rows: LabeledRelation[], run: EvalRun) {
  const deny = rows.filter((r) => r.expect === "deny")
  const admit = rows.filter((r) => r.expect === "admit")
  return {
    negativesDenied: deny.filter((r) => run.admitted[r.id] === false).length,
    negatives: deny.length,
    positivesAdmitted: admit.filter((r) => run.admitted[r.id] === true).length,
    positives: admit.length,
  }
}

export function agreement(a: EvalRun, b: EvalRun): number {
  const ids = Object.keys(a.admitted).filter((id) => id in b.admitted)
  if (ids.length === 0) return 0
  return ids.filter((id) => a.admitted[id] === b.admitted[id]).length / ids.length
}

/** From the spec: deny >= 24 of 30, admit >= 4 of 5, runs agree on >= 90%. */
export const BAR = { negatives: 24, positives: 4, agreement: 0.9 } as const

export function meetsBar(s: ReturnType<typeof score>, agree: number): boolean {
  return s.negativesDenied >= BAR.negatives && s.positivesAdmitted >= BAR.positives && agree >= BAR.agreement
}
```

Create `src/eval/relation-eval.ts`:

```ts
import { readFileSync } from "node:fs"
import { defaultClient, MODEL } from "../cartographer/anthropic.js"
import { toMeasureVerifier } from "../cartographer/measure.js"
import { agreement, BAR, meetsBar, runEval, score, type LabeledRelation } from "./relation-labels.js"

/**
 * Run the real verifier twice over the labeled set and report against the
 * bar. Uncached on purpose: the second run measures stability, which a cache
 * would hide. Exit 0 when the bar is met, 1 when not.
 */
if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY is not set. relation-eval calls the frontier model.")
  process.exit(2)
}
const rows = (JSON.parse(readFileSync("fixtures/relation-labels.json", "utf8")) as { rows: LabeledRelation[] }).rows
const verifier = toMeasureVerifier(defaultClient(), MODEL)
const first = await runEval(rows, verifier)
const second = await runEval(rows, verifier)
const s = score(rows, first)
const agree = agreement(first, second)
console.log(`model       ${MODEL}`)
console.log(`negatives   denied ${s.negativesDenied}/${s.negatives}  (bar ${BAR.negatives})`)
console.log(`positives   admitted ${s.positivesAdmitted}/${s.positives}  (bar ${BAR.positives})`)
console.log(`stability   ${(agree * 100).toFixed(0)}% agreement  (bar ${BAR.agreement * 100}%)`)
for (const r of rows.filter((x) => x.expect !== "exclude" && (first.admitted[x.id] === true) !== (x.expect === "admit"))) {
  console.log(`  miss ${r.id} ${r.subject} ${r.relation} expected ${r.expect}`)
}
const pass = meetsBar(s, agree)
console.log(pass ? "PASS" : "FAIL")
process.exitCode = pass ? 0 : 1
```

In `package.json` `scripts`, add: `"relation-eval": "tsx --env-file-if-exists=.env src/eval/relation-eval.ts",`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/eval/relation-labels.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
git add fixtures/relation-labels.json src/eval/relation-labels.ts src/eval/relation-labels.test.ts src/eval/relation-eval.ts package.json
git commit -m "Add the labeled relation set and npm run relation-eval

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Measure, record, and set the default

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-relation-measure-check-design.md` (new `## Results` section)
- Modify: `src/cartographer/measure.ts` (`RELATION_CHECK_DEFAULT`) only if the bar is met

- [ ] **Step 1: The user adds an Anthropic key**

This machine has no `ANTHROPIC_API_KEY` (Receipts' `.env` holds only `OLLAMA_HOST` and `OLLAMA_MODEL`). **The user** adds `ANTHROPIC_API_KEY=...` to `receipts/.env` themselves; the agent never enters it.

- [ ] **Step 2: Run the eval**

Run: `npm run relation-eval`
Expected: four lines of numbers, any misses by row id, then `PASS` or `FAIL`. Record the full output.

- [ ] **Step 3: Record the results in the spec**

Append to the spec:

```markdown
## Results (2026-MM-DD, <model>)

| Measure | Result | Bar |
|---|---|---|
| Negatives denied | N / 30 | 24 |
| Positives admitted | N / 5 | 4 |
| Run-to-run agreement | N% | 90% |

Misses: <row ids from the eval output, each with its subject and relation>.
Verdict: <PASS: on by default | FAIL: off by default, behind --relation-check>.
```

with the real numbers from Step 2 — no estimates.

- [ ] **Step 4: Set the default only if the bar is met**

If `PASS`: set `export const RELATION_CHECK_DEFAULT = true` in `src/cartographer/measure.ts`, update the spec's `**Status:**` to `implemented, on by default`, run `npm test` (a run with the default on and no key now dies with the relation-check message — update any CLI test that relied on the old default). If `FAIL`: leave it `false` and set the status to `implemented, off by default (bar not met)`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-25-relation-measure-check-design.md src/cartographer/measure.ts
git commit -m "Record the relation-eval results and set the relation check default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

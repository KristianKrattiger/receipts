# Disputed Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing "unmarked, no holding backs this" softening — today wired up only for `corroborates` (`context_unverified`) — to `contradicts`/`updates` too, via a new `disputed` `RowStatus`, across the shared engine and every renderer in both repos, then regenerate the one committed ledger it changes.

**Architecture:** One new `RowStatus` value threaded through: the engine (`types.ts`, `admit.ts`, `assemble.ts`, `merge.ts`, all shared between repos via the standing copy), three independent renderers in receipts (`html.ts`, `markdown.ts`, `terminal.ts`, each with its own duplicated `HEADINGS`/`SECTION_ORDER`), one eval helper (`yield.ts`), and claim-record's narrator and web UI. No detection logic changes anywhere — this only changes what an already-admitted unmarked contradiction/update is labeled.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- New `RowStatus` value: `"disputed"`, exact string, lowercase, matching `"context_unverified"`'s style.
- Severity ordering (every `STATUS_ORDER`/`SECTION_ORDER`/`STATUSES` list): `divergent < disputed < unverified < context_unverified < corroborated`.
- Label wording, mirroring `context_unverified`'s exact pattern: `"Disputed — unmarked independent quote, no competing holding"` (terminal.ts: `"DISPUTED — unmarked independent quote, no competing holding"`).
- `HOLDING_COMPETITOR_FLOOR`, `holdingCompetesWithClaim`, `blocksNonHolding` are untouched by this plan — this is purely a labeling change downstream of admission, not a detection change.
- Full spec: `docs/superpowers/specs/2026-09-24-disputed-status-design.md`.
- Wherever `RowStatus` gains a member, TypeScript will refuse to compile any `Record<RowStatus, ...>` or hand-constructed `Audit`-typed object literal missing the new key. Treat every resulting compile error as a required, mechanical fix (add the corresponding `disputed`/`"disputed"` entry) — this is the type system enumerating the literal sites for you; do not work around a compile error by loosening a type.

---

## Task 1: Engine core (receipts) — `types.ts`, `admit.ts`, `assemble.ts`, `merge.ts`

**Files:**
- Modify: `src/assay/types.ts` (`RowStatus`, `Audit`)
- Modify: `src/assay/bookkeeper/admit.ts` (rename `unmarkedCorroboration` → `unmarkedSpan`, broaden its call site)
- Modify: `src/assay/assemble.ts` (`rowStatus`, `STATUS_ORDER`, `auditOf`)
- Modify: `src/assay/merge.ts` (its own `STATUS_ORDER`, `auditFromUnion`)
- Test: `src/assay/assemble.test.ts`, `src/assay/bookkeeper/admit.test.ts`, `src/assay/merge.test.ts`

**Interfaces:**
- Consumes: nothing from another task.
- Produces: `RowStatus` now includes `"disputed"`; `AdmittedRelation.contextUnverified` (unchanged field name/shape — `true` or absent) now set for `contradicts`/`updates` as well as `corroborates`; `rowStatus(type, opts)` returns `"disputed"` for an unmarked `contradicts`/`updates`; `Audit.disputed: number`. Every later task (renderers, narrator, web UI) reads these, none of them write to them.

- [ ] **Step 1: `types.ts` — add the new `RowStatus` member and `Audit` field**

In `src/assay/types.ts`, change:
```ts
export type RowStatus = "divergent" | "corroborated" | "unverified" | "context_unverified"
```
to:
```ts
export type RowStatus = "divergent" | "corroborated" | "unverified" | "context_unverified" | "disputed"
```
And in the `Audit` interface, right after the existing `contextUnverified` field:
```ts
  /** Admitted corroborations labeled context_unverified (unmarked, no holding competitor). */
  contextUnverified: number
```
add:
```ts
  /** Admitted contradictions/updates labeled disputed (unmarked, no holding competitor). */
  disputed: number
```

- [ ] **Step 2: `npm run typecheck` — confirm it now fails, and see where**

Run: `npm run typecheck`
Expected: FAIL, with compile errors at every `Record<RowStatus, ...>` and every hand-constructed `Audit`-typed object literal missing `disputed`. Do not fix any of them yet — this step is to see the full list before touching code, so later fixes can be checked against it.

- [ ] **Step 3: `admit.ts` — rename `unmarkedCorroboration` to `unmarkedSpan`, broaden its use**

In `src/assay/bookkeeper/admit.ts`, the function currently reads:
```ts
function unmarkedCorroboration(toDoc: PinnedDoc, toSpan: AdmittedSpan, lexicon: Lexicon): boolean {
  const envelope = enclosingSentence(toDoc.text, toSpan.start, toSpan.end)
  return discourseRole(envelope.text, lexicon) === "unmarked"
}
```
Rename it (body unchanged):
```ts
function unmarkedSpan(toDoc: PinnedDoc, toSpan: AdmittedSpan, lexicon: Lexicon): boolean {
  const envelope = enclosingSentence(toDoc.text, toSpan.start, toSpan.end)
  return discourseRole(envelope.text, lexicon) === "unmarked"
}
```
Its one call site, at the end of `admit()`, currently reads:
```ts
    admitted.push({
      proposal: p,
      sides: sides.map(([, span]) => span),
      ...(p.type === "corroborates" && toDoc && toSpan && unmarkedCorroboration(toDoc, toSpan, lexicon)
        ? { contextUnverified: true as const }
        : {}),
    })
```
Change the guard from `p.type === "corroborates"` to `p.type !== "unsupported"` (mirrors the exact guard already used a few lines above this, for the `blocksNonHolding` call — the same set of proposals that go through the competing-holding check are the set eligible for this flag) and update the renamed call:
```ts
    admitted.push({
      proposal: p,
      sides: sides.map(([, span]) => span),
      ...(p.type !== "unsupported" && toDoc && toSpan && unmarkedSpan(toDoc, toSpan, lexicon)
        ? { contextUnverified: true as const }
        : {}),
    })
```

- [ ] **Step 4: `admit.test.ts` — write the new failing test**

In `src/assay/bookkeeper/admit.test.ts`, inside the `describe("admit — an issue statement is not corroboration", ...)` block (the one with the local `CLAIM`/`HOLDING` fixtures, containing the six `HOLDING_COMPETITOR` tests), add a new test reusing the existing off-topic-statute fixture shape from the `"still admits an unmarked statute contradiction when no holding competes with the claimant quote"` test (already in this file) — same fixtures, same proposal, but now also asserting the admitted relation carries the flag:

```ts
  it("carries contextUnverified for an unmarked contradiction with no competing holding", () => {
    const falseClaim = doc("vendor", "claimant",
      "A factory may discharge acme effluent into navigable waters without a permit if the river is already polluted.")
    const statute = doc("statute", "independent",
      "Except as in compliance with a permit, the discharge of any acme effluent by any person shall be unlawful.")
    const corpus: PinnedCorpus = { subject: "acme", docs: [falseClaim, statute], failures: [] }
    const r = admit(
      corpus,
      [proposal({
        type: "contradicts",
        from: { docId: "vendor", quote: "A factory may discharge acme effluent into navigable waters without a permit" },
        to: { docId: "statute", quote: "the discharge of any acme effluent by any person shall be unlawful" },
      })],
      TERMS,
      buildIdf(corpus.docs), undefined, TEST_PROFILE.lexicon)
    expect(r.denied).toEqual([])
    expect(r.admitted).toHaveLength(1)
    expect(r.admitted[0]!.contextUnverified).toBe(true)
  })
```

- [ ] **Step 5: Run the new admit.ts test — confirm it fails**

Run: `npx vitest run src/assay/bookkeeper/admit.test.ts -t "carries contextUnverified for an unmarked contradiction"`
Expected: FAIL — `r.admitted[0]!.contextUnverified` is `undefined`, not `true` (Step 3 not yet applied). If you've already done Step 3, do it now in the other order and confirm PASS instead — either order is fine as long as you see the transition.

- [ ] **Step 6: `assemble.ts` — `rowStatus`, `STATUS_ORDER`, `auditOf`**

In `src/assay/assemble.ts`, `rowStatus` currently reads:
```ts
export function rowStatus(
  type: RelationType,
  opts: { contextUnverified?: boolean } = {},
): RowStatus {
  if (type === "contradicts" || type === "updates") return "divergent"
  if (type === "corroborates") return opts.contextUnverified ? "context_unverified" : "corroborated"
  return "unverified"
}
```
Change to:
```ts
export function rowStatus(
  type: RelationType,
  opts: { contextUnverified?: boolean } = {},
): RowStatus {
  if (type === "contradicts" || type === "updates") {
    return opts.contextUnverified ? "disputed" : "divergent"
  }
  if (type === "corroborates") return opts.contextUnverified ? "context_unverified" : "corroborated"
  return "unverified"
}
```
`STATUS_ORDER` currently reads:
```ts
const STATUS_ORDER: Record<RowStatus, number> = {
  divergent: 0,
  unverified: 1,
  context_unverified: 2,
  corroborated: 3,
}
```
Change to:
```ts
const STATUS_ORDER: Record<RowStatus, number> = {
  divergent: 0,
  disputed: 1,
  unverified: 2,
  context_unverified: 3,
  corroborated: 4,
}
```
In `auditOf`, the line:
```ts
    contextUnverified: result.admitted.filter((a) => a.contextUnverified).length,
```
becomes two lines, partitioning `result.admitted` completely between them (every relation that can carry the flag is exactly one of `corroborates` or not, per Step 3's `p.type !== "unsupported"` guard — `unsupported` never sets it):
```ts
    contextUnverified: result.admitted.filter((a) => a.contextUnverified && a.proposal.type === "corroborates").length,
    disputed: result.admitted.filter((a) => a.contextUnverified && a.proposal.type !== "corroborates").length,
```

- [ ] **Step 7: `assemble.test.ts` — write the new test**

In `src/assay/assemble.test.ts`, inside `describe("assemble — context_unverified and trap counts", ...)`, right after the `"labels an unmarked corroboration context_unverified, not corroborated"` test, add:
```ts
  it("labels an unmarked contradiction disputed, not divergent", () => {
    const admitted: AdmitResult = {
      admitted: [{
        proposal: {
          proposalId: "p1", type: "contradicts", topic: "uptime",
          statement: "commentators", from: { docId: "a", quote: "99.9%" },
          to: { docId: "b", quote: "commentators" }, rationale: "", confidence: 0.9,
        },
        sides: [
          { docId: "a", start: 0, end: 5, text: "99.9%", tag: "EXACT" },
          { docId: "b", start: 0, end: 12, text: "commentators", tag: "EXACT" },
        ],
        contextUnverified: true,
      }],
      denied: [],
    }
    const r = assemble(corpus(bothRoles), 1, admitted, { conflictMode: "report", anchoredCount: 1 })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows[0]!.status).toBe("disputed")
    expect(r.rows[0]!.relation).toBe("contradicts")
    expect(r.audit.disputed).toBe(1)
    expect(r.audit.contextUnverified).toBe(0)
  })
```

- [ ] **Step 8: Run it — confirm it fails, then passes**

Run: `npx vitest run src/assay/assemble.test.ts -t "labels an unmarked contradiction disputed"`
Expected before Step 6: FAIL (`r.rows[0]!.status` is `"divergent"`). After Step 6: PASS.

- [ ] **Step 9: `merge.ts` — its own `STATUS_ORDER`, `auditFromUnion`**

In `src/assay/merge.ts`, `STATUS_ORDER` currently reads:
```ts
const STATUS_ORDER: Record<RowStatus, number> = {
  divergent: 0,
  unverified: 1,
  context_unverified: 2,
  corroborated: 3,
}
```
Change to the same five entries as `assemble.ts`'s (Step 6):
```ts
const STATUS_ORDER: Record<RowStatus, number> = {
  divergent: 0,
  disputed: 1,
  unverified: 2,
  context_unverified: 3,
  corroborated: 4,
}
```
In `auditFromUnion`, the line:
```ts
    contextUnverified: rows.filter((r) => r.status === "context_unverified").length,
```
gets a parallel line right after it:
```ts
    contextUnverified: rows.filter((r) => r.status === "context_unverified").length,
    disputed: rows.filter((r) => r.status === "disputed").length,
```

- [ ] **Step 10: `merge.test.ts` — write the new test, and fix the four now-incomplete `Audit` literals**

Add `disputed: 0,` to each of the four hand-constructed `Audit` object literals already in this file (all typed against `AssayResult`'s ledger `audit`, so each is currently missing the new required field — `npm run typecheck` from Step 2 named these):
- The `ledger()` helper's audit literal (currently ends `..., holdingCompetitorDenied: 0, contextUnverified: 0 },`)
- The `refusal()` helper's audit literal (same trailing shape)
- Both audit literals inside the `"recounts claimant coverage from the union"`-style test further down the file (each currently ends `issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0,`)

In each of the four, insert `disputed: 0,` right after `contextUnverified: 0,` (or `contextUnverified: 0 },` → `contextUnverified: 0, disputed: 0 },` for the two single-line ones).

Then, right after the existing `"recounts context_unverified from the union, not sample 0's audit"` test, add its `disputed` counterpart:
```ts
  it("recounts disputed from the union, not sample 0's audit", () => {
    const marked = row({
      topic: "uptime", status: "divergent", relation: "contradicts",
      sides: [span("a", 10), span("b", 1)],
    })
    const unmarked = row({
      topic: "safety", status: "disputed", relation: "contradicts",
      sides: [span("a", 20), span("b", 3)],
    })
    const r = mergeRuns(
      ledger([marked]),
      ledger([marked, unmarked]),
      {
        admittedA: meta([marked], ["b"]),
        admittedB: meta([marked, unmarked], ["b", "unsupported"]),
        failuresA: [],
        failuresB: [],
        docs,
      },
    )
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows.filter((x) => x.status === "disputed")).toHaveLength(1)
    expect(r.audit.disputed).toBe(1)
  })
```

- [ ] **Step 11: Run the full receipts suite and typecheck**

Run: `npm run typecheck && npx vitest run`

`tsc` checks the whole project, not per-file, so `npm run typecheck` is expected to still FAIL after this task — Step 2's baseline already named the reason: `src/cli/exit.test.ts`, `src/eval/yield.test.ts`, `src/report/build.test.ts`, `src/report/render/html.test.ts`, and `src/report/render/render.test.ts` each hand-construct an `Audit` literal still missing `disputed`. Read the actual error list now and confirm every remaining error is inside exactly those five files — Task 2 owns fixing them (its own Step 1 starts from this same list). If any error appears outside that list, stop and report BLOCKED with the exact error, since that would mean this task's own changes left something incomplete. Otherwise, report DONE_WITH_CONCERNS: the vitest run itself may show related failures in those same five files (not compile errors, but assertions/fixtures depending on the missing field) — note them, but do not fix them here.

- [ ] **Step 12: Commit**

```bash
git add src/assay/types.ts src/assay/bookkeeper/admit.ts src/assay/assemble.ts src/assay/merge.ts src/assay/assemble.test.ts src/assay/bookkeeper/admit.test.ts src/assay/merge.test.ts
git commit -m "$(cat <<'EOF'
Add a disputed status: the divergent counterpart to context_unverified

Extends the existing "unmarked, no holding backs this" softening from
corroborates-only to contradicts/updates too. blocksNonHolding's
detection logic is unchanged -- this only relabels an already-admitted
unmarked contradiction/update from a flat "divergent" to "disputed",
the same honesty context_unverified already gives unmarked
corroborations. See docs/superpowers/specs/2026-09-24-disputed-status-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Receipts renderers — `html.ts`, `markdown.ts`, `terminal.ts`, `yield.ts`

**Files:**
- Modify: `src/report/render/html.ts`, `src/report/render/markdown.ts`, `src/report/render/terminal.ts`, `src/eval/yield.ts`
- Test: `src/report/render/html.test.ts`, `src/report/render/render.test.ts` (mechanical fixes), `src/eval/yield.test.ts` (mechanical fixes via typecheck), `src/cli/exit.test.ts` (mechanical fix), `src/report/build.test.ts` (mechanical fix)

**Interfaces:**
- Consumes: `RowStatus` including `"disputed"` (Task 1).
- Produces: nothing further tasks depend on (Task 3 reads these renderers' *output*, via `--render`, not their internals).

- [ ] **Step 1: Confirm the exact typecheck error list from Task 1**

Run: `npm run typecheck`
Expected: errors only in the five files named in Task 1's Step 11 note. This task fixes all five (the two renderer test files properly, in Step 5 below; `src/cli/exit.test.ts` and `src/report/build.test.ts` are mechanical `disputed: 0`/`disputed: N` fixes to their own hand-constructed `Audit`-typed literals — apply the same pattern as Task 1 Step 10: read what typecheck names, add the missing field with the value that keeps the test's existing intent, matching neighbouring `context_unverified`-style fields already in the same literal).

- [ ] **Step 2: `html.ts` — `HEADINGS`, `SECTION_ORDER`, CSS, count summary**

In `src/report/render/html.ts`, `HEADINGS` currently reads:
```ts
const HEADINGS: Record<RowStatus, string> = {
  divergent: "Divergent — the vendor's claim is contradicted",
  unverified: "Unverified — no independent source either way",
  context_unverified: "Context unverified — unmarked independent quote, no competing holding",
  corroborated: "Corroborated — independently confirmed",
}
```
Add a `disputed` entry:
```ts
const HEADINGS: Record<RowStatus, string> = {
  divergent: "Divergent — the vendor's claim is contradicted",
  disputed: "Disputed — unmarked independent quote, no competing holding",
  unverified: "Unverified — no independent source either way",
  context_unverified: "Context unverified — unmarked independent quote, no competing holding",
  corroborated: "Corroborated — independently confirmed",
}
```
`SECTION_ORDER` currently reads:
```ts
const SECTION_ORDER: RowStatus[] = ["divergent", "unverified", "context_unverified", "corroborated"]
```
becomes:
```ts
const SECTION_ORDER: RowStatus[] = ["divergent", "disputed", "unverified", "context_unverified", "corroborated"]
```
The `STYLE` block's two CSS-variable lines currently read:
```ts
:root { --bg:#fff; --fg:#16161d; --muted:#6b6b76; --line:#e4e4e9;
        --divergent:#b4243c; --unverified:#8a6100; --context_unverified:#c05600; --corroborated:#1f6f43; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16161d; --fg:#e8e8ee; --muted:#9a9aa6; --line:#2c2c36;
          --divergent:#ff8095; --unverified:#e0b050; --context_unverified:#f0a040; --corroborated:#6fd39b; }
}
```
Add `--disputed` to both (a red-orange between `--divergent` and `--context_unverified` in each palette):
```ts
:root { --bg:#fff; --fg:#16161d; --muted:#6b6b76; --line:#e4e4e9;
        --divergent:#b4243c; --disputed:#c23616; --unverified:#8a6100; --context_unverified:#c05600; --corroborated:#1f6f43; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16161d; --fg:#e8e8ee; --muted:#9a9aa6; --line:#2c2c36;
          --divergent:#ff8095; --disputed:#ff9d6e; --unverified:#e0b050; --context_unverified:#f0a040; --corroborated:#6fd39b; }
}
```
The `h2.<status>` rules currently read:
```ts
h2.divergent { color: var(--divergent); }
h2.unverified { color: var(--unverified); }
h2.context_unverified { color: var(--context_unverified); }
h2.corroborated { color: var(--corroborated); }
```
Add one:
```ts
h2.divergent { color: var(--divergent); }
h2.disputed { color: var(--disputed); }
h2.unverified { color: var(--unverified); }
h2.context_unverified { color: var(--context_unverified); }
h2.corroborated { color: var(--corroborated); }
```
The per-report count-summary (in the multi-report index renderer) currently reads:
```ts
      // All four statuses, in the order the report itself uses. Listing only
      // divergent and unverified described Tesla's 26-row ledger as "6
      // divergent, 6 unverified" and silently dropped the 14 corroborations —
      // half the work, and the half carrying the vendor's own SEC filing
      // agreeing with its critics. Corroboration is a finding too.
      return (
        `<li><a href="${esc(name)}.html">${esc(report.subject)}</a> — ` +
        `${count("divergent")} divergent, ${count("corroborated")} corroborated, ` +
        `${count("unverified")} unverified, ${count("context_unverified")} context_unverified</li>`
      )
```
Change to five statuses, inserting `disputed` right after `divergent` (the other two negative signals together, at the head of the list):
```ts
      // All five statuses, in the order the report itself uses. Listing only
      // divergent and unverified described Tesla's 26-row ledger as "6
      // divergent, 6 unverified" and silently dropped the 14 corroborations —
      // half the work, and the half carrying the vendor's own SEC filing
      // agreeing with its critics. Corroboration is a finding too.
      return (
        `<li><a href="${esc(name)}.html">${esc(report.subject)}</a> — ` +
        `${count("divergent")} divergent, ${count("disputed")} disputed, ${count("corroborated")} corroborated, ` +
        `${count("unverified")} unverified, ${count("context_unverified")} context_unverified</li>`
      )
```

- [ ] **Step 3: `markdown.ts` — `HEADINGS`, `SECTION_ORDER`**

Same two changes as `html.ts` Step 2's first two edits (no CSS/count-summary in this file):
```ts
const HEADINGS: Record<RowStatus, string> = {
  divergent: "Divergent — the vendor's claim is contradicted",
  disputed: "Disputed — unmarked independent quote, no competing holding",
  unverified: "Unverified — no independent source either way",
  context_unverified: "Context unverified — unmarked independent quote, no competing holding",
  corroborated: "Corroborated — independently confirmed",
}

const SECTION_ORDER: RowStatus[] = ["divergent", "disputed", "unverified", "context_unverified", "corroborated"]
```

- [ ] **Step 4: `terminal.ts` — `HEADINGS`, `SECTION_ORDER`**

Same shape, upper-case wording matching this file's existing convention:
```ts
const HEADINGS: Record<RowStatus, string> = {
  divergent: "DIVERGENT — the vendor's claim is contradicted",
  disputed: "DISPUTED — unmarked independent quote, no competing holding",
  unverified: "UNVERIFIED — no independent source either way",
  context_unverified: "CONTEXT UNVERIFIED — unmarked independent quote, no competing holding",
  corroborated: "CORROBORATED — independently confirmed",
}

const SECTION_ORDER: RowStatus[] = ["divergent", "disputed", "unverified", "context_unverified", "corroborated"]
```

- [ ] **Step 5: `html.test.ts` — update the three hardcoded count-summary assertions and the comment**

In `src/report/render/html.test.ts`:
- The comment currently reading `// All four statuses. Listing only two described Tesla's 26-row ledger as` becomes `// All five statuses. Listing only two described Tesla's 26-row ledger as` (word "four" → "five"; rest of the comment unchanged).
- Line matching `/1 divergent, 0 corroborated, 0 unverified, 0 context_unverified/` becomes `/1 divergent, 0 disputed, 0 corroborated, 0 unverified, 0 context_unverified/`.
- Line matching `/acme<\/a> — 1 divergent, 0 corroborated, 0 unverified, 0 context_unverified/` becomes `/acme<\/a> — 1 divergent, 0 disputed, 0 corroborated, 0 unverified, 0 context_unverified/`.
- Line matching `/beta<\/a> — 0 divergent, 0 corroborated, 0 unverified, 0 context_unverified/` becomes `/beta<\/a> — 0 divergent, 0 disputed, 0 corroborated, 0 unverified, 0 context_unverified/`.

- [ ] **Step 6: `render.test.ts` and `yield.ts`/`yield.test.ts` — mechanical fixes**

`src/eval/yield.ts`'s `STATUSES` array currently reads:
```ts
const STATUSES: RowStatus[] = ["divergent", "unverified", "context_unverified", "corroborated"]
```
becomes:
```ts
const STATUSES: RowStatus[] = ["divergent", "disputed", "unverified", "context_unverified", "corroborated"]
```
Then run `npm run typecheck` and `npx vitest run src/report/render/render.test.ts src/eval/yield.test.ts src/cli/exit.test.ts src/report/build.test.ts` — fix any remaining reported error the same mechanical way as Task 1 Step 10 (add the missing `disputed`/`"disputed"` entry with a value matching the test's existing intent for its neighbouring `context_unverified`-shaped field). None of these files should need a *new* test in this task — only completeness fixes to what's already there.

- [ ] **Step 7: Run the full receipts suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/report/render/html.ts src/report/render/markdown.ts src/report/render/terminal.ts src/eval/yield.ts src/report/render/html.test.ts src/report/render/render.test.ts src/eval/yield.test.ts src/cli/exit.test.ts src/report/build.test.ts
git commit -m "$(cat <<'EOF'
Render the disputed status in all three report formats plus eval yield

HEADINGS/SECTION_ORDER in html.ts, markdown.ts, terminal.ts; STATUSES
in eval/yield.ts; html.ts's CSS palette, h2 rule, and per-report count
summary. Mechanical completeness fixes to the Audit/RowStatus literals
typecheck named in cli/exit.test.ts and report/build.test.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Regenerate the Tesla ledger and reconcile README (receipts)

**Files:**
- Modify: `reports/tesla-fsd.json` (regenerated from cache, not hand-edited)
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1 and 2's complete engine + renderer changes.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Confirm the pre-regeneration baseline**

Run: `npm run replay`
Expected: `1 replayed, 3 not replayable` (same as before this plan — replay itself doesn't fail; it will report a *diff*, not an error, once the engine's status derivation changed underneath it).

- [ ] **Step 2: Regenerate `reports/tesla-fsd.json` from the cache**

Use the same technique as the two prior restamps this session (2026-09-23, `remove-self-pass` and `side-role-invariant` plans): reconstruct the corpus the way `runReplay` does (`src/cli/replay.ts`), re-run `admit()`/`assemble()` against the already-cached proposal responses (no network call, no cost), and write the result back as the new `reports/tesla-fsd.json`. Confirmed in advance (spec's Testing section): all three of the ledger's current `divergent` rows have an unmarked independent span and will become `disputed`.

- [ ] **Step 3: Confirm the regenerated ledger**

Run: `npm run replay`
Expected: `1 replayed, 3 not replayable` (identical to Step 1 — replay reproduces itself now that the file on disk reflects the new engine). Inspect `reports/tesla-fsd.json`'s `rows`: the three previously-`divergent` rows now read `"status": "disputed"`; `audit.disputed` is `3`; `audit.contextUnverified` is unchanged (still whatever it was, since no corroboration's status changes).

- [ ] **Step 4: Render the regenerated ledger and reconcile README**

Run:
```bash
npm run cli -- --render reports/tesla-fsd.json
```
(This is `src/cli/index.ts`'s `--render` flag — re-prints the saved report via `renderTerminal`, no fetch, no model call, no key needed; the same command that produced README's existing fenced examples of this ledger.) Compare the real output against every passage in `README.md` that currently shows or describes this ledger:
- Three fenced example blocks currently containing `DIVERGENT — the vendor's claim is contradicted` (grep `README.md` for `DIVERGENT` to find all three) — each must be regenerated from the real `--render` output, not hand-edited to say `DISPUTED`; read what the command actually prints and paste that.
- The paragraph beginning `"All three divergent rows cite the same Tesla sentence"` — rewrite to say `disputed`, and re-verify the paragraph's own claims (which sentence, how many independent quotes, which sources) still match the regenerated ledger's actual content; don't just do a word substitution if the underlying facts changed.
- The `audit: proposed 27 over 7 passes · admitted 4 · denied 11 (...)` summary line and any other literal count in this section — re-verify against the regenerated report's real `audit` object; the admitted/denied counts should be unchanged (this task doesn't change *what* is admitted, only how three already-admitted rows are labeled), but confirm rather than assume.
- Search `README.md` for any other literal occurrence of "divergent" tied to this specific ledger (not the general design-explanation prose about what "divergent" *means* as a status, which is still accurate and unrelated to this specific ledger's row count) and reconcile each one the same way.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean. (No test file asserts on `reports/tesla-fsd.json`'s specific row statuses directly — if one does, and it currently expects `"divergent"` for one of these three rows, update it to `"disputed"` the same way Task 1/2 handled other fallout, and note it in your report since it wasn't anticipated here.)

- [ ] **Step 6: Commit**

```bash
git add reports/tesla-fsd.json README.md
git commit -m "$(cat <<'EOF'
Regenerate the Tesla ledger with the disputed status; reconcile README

All three of the ledger's divergent rows have an unmarked independent
span (no first-party "we tested" holding backs any of them under
receipts' lexicon) and are relabeled disputed. No admission changed --
same 4 admitted rows, same denial counts -- only how three already-
admitted contradictions are described. README's rendered examples and
prose reconciled against a real --render of the regenerated ledger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Sync the engine to Claim/Record and add the paraphrase regression test

**Files:**
- Modify: `claim-record/src/assay/` (full directory replace via sync, not hand-edited)
- Modify: `claim-record/src/instance/calibration/calibration.test.ts`
- Test: mechanical fixes wherever typecheck names an incomplete `Audit`/`RowStatus` literal in claim-record (same pattern as Task 1 Step 10 — `src/assay/merge.test.ts`'s copy, synced along with the rest of `src/assay/`, needs no separate fix since it arrives already-fixed from the sync)

**Interfaces:**
- Consumes: Tasks 1's engine changes, via the synced `src/assay` copy.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Sync the engine from receipts**

```bash
rm -rf src/assay
cp -r ../receipts/src/assay src/assay
```

- [ ] **Step 2: Confirm the copy is byte-identical**

Run: `diff -rq src/assay ../receipts/src/assay`
Expected: no output.

- [ ] **Step 3: Run typecheck — see what's incomplete outside `src/assay`**

Run: `npm run typecheck`
Expected: FAIL, naming every hand-constructed `Audit`/`Record<RowStatus,...>` literal outside `src/assay/` that's now missing `disputed` — at minimum `src/narrator/narrate.test.ts` (Task 5 owns this one; skip it here) and possibly others. Note the full list in your report; fix everything EXCEPT `src/narrator/narrate.ts`/`src/narrator/narrate.test.ts` (explicitly Task 5's job) and `src/web/audit.js`/`src/web/audit.test.ts` (explicitly Task 6's job) in this task, the same mechanical way as Task 1 Step 10.

- [ ] **Step 4: Write the paraphrase regression test**

In `claim-record/src/instance/calibration/calibration.test.ts`, add a new test inside `describe("calibration — quote-mining gates", ...)`, after the existing `"denies an unmarked contradiction of a true twin when another Record document holds"` test — this reproduces the exact scenario the final review of the prior plan found, confirming it now renders `disputed` rather than a bare `divergent`:
```ts
  it("labels a paraphrase-evaded contradiction disputed, not a bare divergent", () => {
    const paraphrase = proposal({
      proposalId: "paraphrase",
      type: "contradicts",
      statement: "commentators paraphrase away scienter",
      from: { docId: "claim", quote: "Scienter, intent to deceive, manipulate, or defraud, is required in a private action under Section 10(b)." },
      to: { docId: "commentators", quote: "Under Section 10(b), carelessness in keeping the accounts suffices for liability, as commentators have written." },
    })
    const { result, assembled } = run(
      [pin("commentators", "independent", "Under Section 10(b), carelessness in keeping the accounts suffices for liability, as commentators have written."), TELLABS],
      [paraphrase],
    )
    expect(result.denied).toEqual([])
    expect(result.admitted).toHaveLength(1)
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("disputed")
    expect(assembled.audit.disputed).toBe(1)
  })
```
This test calls `pin`, which exists in `corpus.ts` but is not currently exported (`function pin(docId: string, role: SourceRole, text: string): PinnedDoc {`). Export it — add `export` to that one declaration, the function body is otherwise unchanged:
```ts
export function pin(docId: string, role: SourceRole, text: string): PinnedDoc {
```
Then add `pin` to `calibration.test.ts`'s existing import from `./corpus.js`. The import currently reads:
```ts
import {
  ARGUMENT, BLUE_CHIP, CENTRAL_BANK, CLAIM, COMMENTATORS, goldCorpus, HOCHFELDER, STATUTE, SUBJECT, TELLABS,
} from "./corpus.js"
```
becomes:
```ts
import {
  ARGUMENT, BLUE_CHIP, CENTRAL_BANK, CLAIM, COMMENTATORS, goldCorpus, HOCHFELDER, pin, STATUTE, SUBJECT, TELLABS,
} from "./corpus.js"
```

- [ ] **Step 5: Run it — confirm it reproduces the finding, then passes**

Run: `npx vitest run src/instance/calibration/calibration.test.ts -t "labels a paraphrase-evaded contradiction disputed"`
Expected: PASS (the engine is already synced with both the holding-competitor fix and the disputed-status change by this point in the plan — this test is confirming the ALREADY-LANDED fix's behavior, not proving a red-then-green transition; there is no "before" state to compare against in this checkout, since Task 1's redesign long since replaced the original algorithm). If it denies via `HOLDING_COMPETITOR` instead of admitting, or admits with `status: "divergent"` instead of `"disputed"`, stop and report BLOCKED — either would mean something regressed between the two prior plans and this one.

- [ ] **Step 6: Run the full claim-record suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean except for the two files explicitly deferred to Tasks 5/6 (`src/narrator/narrate.ts`-adjacent and `src/web/audit.js`-adjacent) — confirm no OTHER file fails. Test suite: all passing tests still pass; `narrate.test.ts` and `audit.test.ts` may still fail to even compile at this point, which is expected and not this task's job to fix.

- [ ] **Step 7: Commit**

```bash
git add src/assay src/instance/calibration/corpus.ts src/instance/calibration/calibration.test.ts
git commit -m "$(cat <<'EOF'
Sync the disputed-status engine; add the paraphrase regression test

Confirms the exact scenario the holding-competitor redesign's final
review found -- a paraphrased unmarked contradiction that evades
blocksNonHolding -- now renders disputed rather than a bare divergent.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
(Include whichever other files Step 3's mechanical fixes touched, if any, in this same commit — list them explicitly in your report.)

---

## Task 5: Claim/Record narrator

**Files:**
- Modify: `src/narrator/narrate.ts`
- Test: `src/narrator/narrate.test.ts`

**Interfaces:**
- Consumes: `RowStatus` including `"disputed"` (via the synced engine, Task 4).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Confirm the current typecheck failure here**

Run: `npm run typecheck`
Expected: at least one error in `src/narrator/narrate.test.ts` — its `ledger()` test helper hand-constructs an `Audit`-typed object literal without `disputed`.

- [ ] **Step 2: `narrate.ts` — extend the citation-completeness check**

In `src/narrator/narrate.ts`, the check currently reads:
```ts
        if (row.status === "divergent" && sides.size < row.sides.length) {
          throw new NarratorError(`divergent row ${rowIndex} must cite both sides`)
        }
```
Change to:
```ts
        if ((row.status === "divergent" || row.status === "disputed") && sides.size < row.sides.length) {
          throw new NarratorError(`${row.status} row ${rowIndex} must cite both sides`)
        }
```

- [ ] **Step 3: `narrate.test.ts` — fix the incomplete `Audit` literal and write the new test**

The `ledger()` helper's `audit` object literal currently ends:
```ts
    audit: { proposed: 1, admitted: rows.length, denied: [], claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [], independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0 },
```
Add `disputed: 0`:
```ts
    audit: { proposed: 1, admitted: rows.length, denied: [], claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [], independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0, disputed: 0 },
```
Then, in `describe("checkCitations", ...)`, right after the existing `"rejects citing only one side of a divergent row"` test, add its `disputed` counterpart:
```ts
  it("rejects citing only one side of a disputed row", () => {
    const disputed = ledger([row({
      status: "disputed",
      relation: "contradicts",
      sides: [side("c", "We guarantee 99.99% uptime."), side("r", "four outages")],
    })])
    expect(() => checkCitations(disputed, [{
      text: "x", citations: [{ rowIndex: 0, sideIndex: 0 }],
    }])).toThrow(/both sides/)
  })
```

- [ ] **Step 4: Run it — confirm it fails, then passes**

Run: `npx vitest run src/narrator/narrate.test.ts -t "rejects citing only one side of a disputed row"`
Expected before Step 2: FAIL (no error thrown, since `"disputed" !== "divergent"` under the old check). After Step 2: PASS.

- [ ] **Step 5: Run the full claim-record suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean except `src/web/audit.js`-adjacent files (Task 6). Everything else passing.

- [ ] **Step 6: Commit**

```bash
git add src/narrator/narrate.ts src/narrator/narrate.test.ts
git commit -m "$(cat <<'EOF'
Require both sides cited for a disputed row, same as divergent

A disputed row is the same two-sided shape as divergent, just less
confidently sourced -- a narrative asserting it still has to cite
what it's disputed by.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Claim/Record web UI

**Files:**
- Modify: `src/web/index.html`
- Modify: `src/web/audit.js`
- Test: `src/web/audit.test.ts`

**Interfaces:**
- Consumes: `row.status` values including `"disputed"` (already handled generically by `index.html`'s `class="row ${row.status}"` — no JS change needed there, only CSS); `Audit.disputed` (Task 1, via the sync).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: `index.html` — add the CSS rules**

In `src/web/index.html`, the status CSS rules currently read:
```css
    .row { border-left: 3px solid #888; padding-left: 0.75rem; margin: 1rem 0; }
    .divergent { border-color: #e03131; }
    .unverified { border-color: #ced4da; }
    .context_unverified { border-color: #f08c00; }
    .corroborated { border-color: #2f9e44; }
    .tag { font-weight: 700; }
    .tag.divergent { color: #e03131; }
    .tag.unverified { color: #f8f9fa; }
    .tag.context_unverified { color: #f08c00; }
    .tag.corroborated { color: #2f9e44; }
```
Add `.disputed`/`.tag.disputed`, right after the `divergent` rule in each group (a red-orange between `.divergent`'s `#e03131` and `.context_unverified`'s `#f08c00`):
```css
    .row { border-left: 3px solid #888; padding-left: 0.75rem; margin: 1rem 0; }
    .divergent { border-color: #e03131; }
    .disputed { border-color: #e8590c; }
    .unverified { border-color: #ced4da; }
    .context_unverified { border-color: #f08c00; }
    .corroborated { border-color: #2f9e44; }
    .tag { font-weight: 700; }
    .tag.divergent { color: #e03131; }
    .tag.disputed { color: #e8590c; }
    .tag.unverified { color: #f8f9fa; }
    .tag.context_unverified { color: #f08c00; }
    .tag.corroborated { color: #2f9e44; }
```

- [ ] **Step 2: `audit.js` — add the `Disputed:` line to `formatAudit`**

The relevant part of `formatAudit`'s return statement currently reads (one long template literal):
```
Issue-statement denials: ${audit.issueStatementDenied ?? 0}. Holding-competitor denials: ${audit.holdingCompetitorDenied ?? 0}. Context-unverified: ${audit.contextUnverified ?? 0}.${denialPart}
```
Insert a `Disputed:` sentence right after `Context-unverified:`, before the `${denialPart}`:
```
Issue-statement denials: ${audit.issueStatementDenied ?? 0}. Holding-competitor denials: ${audit.holdingCompetitorDenied ?? 0}. Context-unverified: ${audit.contextUnverified ?? 0}. Disputed: ${audit.disputed ?? 0}.${denialPart}
```

- [ ] **Step 3: `audit.test.ts` — extend the `base` fixture and its assertion**

The `base` fixture currently reads:
```ts
const base = {
  proposed: 7, admitted: 3, denied: [],
  claimantChunks: 10, claimantCovered: 4, claimantOmitted: 6, claimantOmittedPreviews: [],
  independentDocsTotal: 3, independentDocsAdmitted: 2,
  issueStatementDenied: 1, holdingCompetitorDenied: 2, contextUnverified: 1,
}
```
Add `disputed: 2` (a distinct value from `contextUnverified: 1`, so a swapped-field bug would show up as a wrong-number test failure, not a coincidentally-matching one):
```ts
const base = {
  proposed: 7, admitted: 3, denied: [],
  claimantChunks: 10, claimantCovered: 4, claimantOmitted: 6, claimantOmittedPreviews: [],
  independentDocsTotal: 3, independentDocsAdmitted: 2,
  issueStatementDenied: 1, holdingCompetitorDenied: 2, contextUnverified: 1, disputed: 2,
}
```
In the first test (`"prints coverage, admission, both denial counters, and context_unverified"`), add one more assertion right after the existing `"Context-unverified: 1."` line:
```ts
    expect(html).toContain("Context-unverified: 1.")
    expect(html).toContain("Disputed: 2.")
```

- [ ] **Step 4: Run it — confirm it fails, then passes**

Run: `npx vitest run src/web/audit.test.ts`
Expected before Step 2: FAIL (`"Disputed: 2."` not present in the output). After Step 2: PASS.

- [ ] **Step 5: Run the full claim-record suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both fully clean now — this is the last task, so every file named across Tasks 4-6's typecheck runs should be resolved.

- [ ] **Step 6: Manual verification**

Following the same pattern as the prior plan's `escapeHtml` manual check: start the dev server (`npm run dev`), and using either a live corpus or the same synthetic-file-upload technique (constructing `File` objects via `DataTransfer` in the browser console, if no live model access is available), produce a ledger with at least one `disputed` row and confirm it renders with the new border/tag color, distinct from `divergent` and `context_unverified`. Stop the server afterward.

- [ ] **Step 7: Commit**

```bash
git add src/web/index.html src/web/audit.js src/web/audit.test.ts
git commit -m "$(cat <<'EOF'
Style disputed rows in the web UI; surface the count in the audit line

CSS only for index.html (row.status already drives the class
generically) -- no JS change there. formatAudit gains a Disputed
sentence, mirroring Context-unverified.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final check (whole-branch review, after all six tasks)

- `receipts`: `npm run typecheck && npx vitest run && npm run replay` — replay must report `1 replayed, 3 not replayable`, identical to itself.
- `claim-record`: `npm run typecheck && npx vitest run`.
- `diff -rq claim-record/src/assay receipts/src/assay` — empty.
- `grep -rn "unmarkedCorroboration" receipts/src claim-record/src` — empty (Task 1 renamed it; the sync should carry the rename).
- Confirm every `Record<RowStatus, ...>` in both repos (search `HEADINGS\|STATUS_ORDER\|STATUSES\|SECTION_ORDER` — the four independently-duplicated lists this plan touches) has exactly five entries, same five statuses, in the plan's stated order.
- README's three `DIVERGENT` example blocks and the "All three divergent rows" paragraph read as regenerated, not hand-edited — spot-check one block's exact text against a fresh `--render` of the committed `reports/tesla-fsd.json`.

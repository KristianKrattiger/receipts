# Side-Role Invariant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admit()` structurally enforces that a relation's `from` side is a claimant document and its `to` side (when present) is an independent document, closing the gap that let an independent-vs-independent pair be admitted, and deliberately retiring claimant-vs-claimant self-contradiction admissions.

**Architecture:** Two new checks in the shared engine's `src/assay/bookkeeper/admit.ts` — `FROM_NOT_CLAIMANT` (checked before the `from` anchor search) and `TO_NOT_INDEPENDENT` (checked after the existing `SELF_PAIR` check, before the `to` anchor search). The `sides` field's doc comment is rewritten to state the new invariant and explain why the array shape is kept. `types.ts`'s `AdmissionCode` and `assemble.ts`'s `NOT_ANCHORING_EVIDENCE` gain both codes. Task 1 does this in `receipts`; Task 2 copies the identical engine to `claim-record`; Task 3 regenerates `reports/tesla-fsd.json` (the one committed ledger this touches) from already-cached proposal responses — no new model call, no cost — and rewrites the one README paragraph that narrated the row being removed; Task 4 reviews, merges, pushes both.

**Tech Stack:** TypeScript (strict, nodenext), vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-side-role-invariant-design.md` — read it first.

## Global Constraints

- `src/assay/` stays byte-identical between `receipts` and `claim-record`; `diff -rq receipts/src/assay claim-record/src/assay` empty after Task 2 and through Task 4.
- Exact denial codes: `FROM_NOT_CLAIMANT`, `TO_NOT_INDEPENDENT`.
- A same-document pair (`toDoc.docId === fromDoc.docId`) still reports `SELF_PAIR`, not `TO_NOT_INDEPENDENT` — `SELF_PAIR`'s check stays ordered before the new one.
- Both new codes join `NOT_ANCHORING_EVIDENCE` (same semantic as `DOC_UNKNOWN`: no span was ever located for that side).
- `claim-record`'s README.md and architecture.md do not enumerate the generic engine denial codes today (confirmed: no `SELF_PAIR`, `DOC_UNKNOWN`, or `ANCHOR_NOT_FOUND` reference anywhere in either file) — do not add one there. Only `receipts`' README.md and architecture.md carry the denial-code table this plan updates.
- `reports/tesla-fsd.json`'s regeneration in Task 3 makes no model call and costs nothing — reconstruct the corpus from the report's pins plus `snapshots/`, re-admit the same cached proposal responses, keep `generatedAt`, `replay`, `docs`, `failures`, `subject`, and `labels` from the saved report unchanged, replace only `rows` and `audit`.
- Commit messages: imperative summary, body explaining why, ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- `npm run typecheck` and `npx vitest run` clean before every commit. Current baseline: `receipts` 751 tests / 50 files at `956df54`; `claim-record` 236 tests / 20 files at `5535ad9`.
- `claim-record`'s working tree carries one unrelated, pre-existing uncommitted change (`src/instance/ollama.ts`) not part of this plan. Do not commit it: use explicit file paths with `git add`, never `git add -A`, in every `claim-record` task.

## File Structure

**receipts:**
- `src/assay/bookkeeper/admit.ts` — the two checks; `sides` doc comment rewritten
- `src/assay/types.ts` — `AdmissionCode` gains two codes
- `src/assay/assemble.ts` — `NOT_ANCHORING_EVIDENCE` gains two codes
- `src/assay/bookkeeper/admit.test.ts` — two new test cases
- `README.md`, `architecture.md` — denial-code table; the "One row to be suspicious of" paragraph rewritten
- `reports/tesla-fsd.json` — regenerated (Task 3)

**claim-record:**
- `src/assay/` — copied from receipts (Task 2)

---

### Task 1: The two checks, in the engine

**Files:**
- Modify: `src/assay/bookkeeper/admit.ts:17-23` (the `sides` doc comment), `:219-256` (the `from`/`to` resolution block)
- Modify: `src/assay/types.ts:83-85` (`AdmissionCode`)
- Modify: `src/assay/assemble.ts:40-42` (`NOT_ANCHORING_EVIDENCE`)
- Test: `src/assay/bookkeeper/admit.test.ts`

**Interfaces:**
- Produces: `AdmissionCode` including `"FROM_NOT_CLAIMANT" | "TO_NOT_INDEPENDENT"`. No signature changes — `admit()`'s parameters are unchanged.

- [ ] **Step 1: Branch**

```bash
git checkout -b side-role-invariant
```

- [ ] **Step 2: Write the failing tests**

Open `src/assay/bookkeeper/admit.test.ts`. Find the `describe("admit — denies unsound proposals", ...)` block. Immediately after the closing `})` of the `it("denies a repeat of an already-admitted pair", ...)` test (the one asserting `"DUPLICATE"`), and before the next test in the file, insert:

```ts
  it("denies a proposal whose 'from' side is an independent document", () => {
    const r = admit(
      CORPUS,
      [proposal({
        from: { docId: "status", quote: "Acme reported four separate uptime incidents in the last ninety days" },
        to: { docId: "vendor", quote: "Acme guarantees 99.99% uptime for every workspace on a paid plan" },
      })],
      TERMS, IDF, undefined, TEST_PROFILE.lexicon,
    )
    expect(r.admitted).toEqual([])
    expect(r.denied[0]!.code).toBe("FROM_NOT_CLAIMANT")
    expect(r.denied[0]!.detail).toBe("status")
  })

  it("denies a proposal whose 'to' side is a second, different claimant document", () => {
    const twoVendors: PinnedCorpus = {
      subject: "acme",
      docs: [
        VENDOR,
        doc("vendor2", "claimant", "Acme's enterprise plan includes a 99.99% uptime commitment."),
      ],
      failures: [],
    }
    const r = admit(
      twoVendors,
      [proposal({
        from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime for every workspace on a paid plan" },
        to: { docId: "vendor2", quote: "Acme's enterprise plan includes a 99.99% uptime commitment" },
      })],
      TERMS, buildIdf(twoVendors.docs), undefined, TEST_PROFILE.lexicon,
    )
    expect(r.admitted).toEqual([])
    expect(r.denied[0]!.code).toBe("TO_NOT_INDEPENDENT")
    expect(r.denied[0]!.detail).toBe("vendor2")
  })
```

These use the file's existing `doc()`, `proposal()`, `CORPUS`, `TERMS`, `IDF`, `VENDOR`, `buildIdf` — already imported/defined at the top of the file. No new imports needed.

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/assay/bookkeeper/admit.test.ts`
Expected: both new tests FAIL. The first with something like `expected undefined to be 'FROM_NOT_CLAIMANT'` or a thrown type error once Step 5 lands the type — right now, before any code change, `admit()` doesn't deny either proposal for the reason claimed (the first is currently admitted or denied for an unrelated reason; the second is currently *admitted*, not denied at all). Confirm the failure is about the missing check, not a typo in the test.

- [ ] **Step 4: `types.ts` and `assemble.ts`**

In `src/assay/types.ts`, find:

```ts
export type AdmissionCode =
  | "ADMITTED" | "ANCHOR_NOT_FOUND" | "DOC_UNKNOWN" | "QUOTE_TOO_LONG"
  | "NOT_QUERY_RELEVANT" | "LOW_CONFIDENCE" | "DUPLICATE" | "SELF_PAIR"
  | "SELF_SOURCED" | "INCOHERENT_QUOTE" | "ISSUE_STATEMENT" | "HOLDING_COMPETITOR"
```

Replace with:

```ts
export type AdmissionCode =
  | "ADMITTED" | "ANCHOR_NOT_FOUND" | "DOC_UNKNOWN" | "QUOTE_TOO_LONG"
  | "NOT_QUERY_RELEVANT" | "LOW_CONFIDENCE" | "DUPLICATE" | "SELF_PAIR"
  | "SELF_SOURCED" | "INCOHERENT_QUOTE" | "ISSUE_STATEMENT" | "HOLDING_COMPETITOR"
  | "FROM_NOT_CLAIMANT" | "TO_NOT_INDEPENDENT"
```

In `src/assay/assemble.ts`, find:

```ts
export const NOT_ANCHORING_EVIDENCE = new Set([
  "ANCHOR_NOT_FOUND", "QUOTE_TOO_LONG", "INCOHERENT_QUOTE", "DOC_UNKNOWN", "LOW_CONFIDENCE",
])
```

Replace with:

```ts
export const NOT_ANCHORING_EVIDENCE = new Set([
  "ANCHOR_NOT_FOUND", "QUOTE_TOO_LONG", "INCOHERENT_QUOTE", "DOC_UNKNOWN", "LOW_CONFIDENCE",
  "FROM_NOT_CLAIMANT", "TO_NOT_INDEPENDENT",
])
```

- [ ] **Step 5: The checks, in `admit.ts`**

Find:

```ts
    const fromDoc = byId.get(p.from.docId)
    if (!fromDoc) {
      denied.push({ proposalId: p.proposalId, code: "DOC_UNKNOWN", detail: p.from.docId })
      continue
    }
    const fromAnchor = findAnchor(fromDoc.text, p.from.quote)
```

Replace with:

```ts
    const fromDoc = byId.get(p.from.docId)
    if (!fromDoc) {
      denied.push({ proposalId: p.proposalId, code: "DOC_UNKNOWN", detail: p.from.docId })
      continue
    }
    // Every relation type, in every field profile's prompt, has always said
    // "from" is the claimant's own claim. Checked here rather than trusted to
    // the prompt: a gate that only holds when the model complies is not a
    // gate. No anchor is attempted -- the document is wrong regardless of
    // what the quote says.
    if (fromDoc.role !== "claimant") {
      denied.push({ proposalId: p.proposalId, code: "FROM_NOT_CLAIMANT", detail: fromDoc.docId })
      continue
    }
    const fromAnchor = findAnchor(fromDoc.text, p.from.quote)
```

Find:

```ts
      if (toDoc.docId === fromDoc.docId) {
        denied.push({ proposalId: p.proposalId, code: "SELF_PAIR", detail: toDoc.docId })
        continue
      }
      const toAnchor = findAnchor(toDoc.text, p.to.quote)
```

Replace with:

```ts
      if (toDoc.docId === fromDoc.docId) {
        denied.push({ proposalId: p.proposalId, code: "SELF_PAIR", detail: toDoc.docId })
        continue
      }
      // Claimant-vs-claimant self-contradiction was deliberately admissible
      // here once. Two small-model runs (2026-09-22, 2026-09-23) showed it
      // producing nothing but repeated self-pair hallucinations and vague
      // non-conflicts; see docs/superpowers/specs/2026-09-23-side-role-invariant-design.md.
      // Ordered after SELF_PAIR so a same-document pair keeps the more
      // specific code.
      if (toDoc.role !== "independent") {
        denied.push({ proposalId: p.proposalId, code: "TO_NOT_INDEPENDENT", detail: toDoc.docId })
        continue
      }
      const toAnchor = findAnchor(toDoc.text, p.to.quote)
```

- [ ] **Step 6: Rewrite the `sides` doc comment**

Find:

```ts
  /**
   * One span for an unsupported claim, two for a relation between sources, in
   * `from`-then-`to` order. Deliberately not split into vendor/independent
   * slots: both sides of a pair can share a role — a vendor's pricing page
   * contradicting its own docs is one of the more damning findings available —
   * and role-keyed slots silently discard the second span when that happens.
   * Consumers label each side from its own document's role.
   */
  sides: AdmittedSpan[]
```

Replace with:

```ts
  /**
   * One span for an unsupported claim, two for a relation between sources, in
   * `from`-then-`to` order — always claimant-then-independent for a two-sided
   * relation, since `admit()` requires it (`FROM_NOT_CLAIMANT`,
   * `TO_NOT_INDEPENDENT`). Kept as an array rather than role-keyed fields
   * anyway: nothing downstream (renderers, report types, calibration
   * fixtures, in either repo) gains anything from the rename that the fixed
   * order doesn't already give it, and restructuring would ripple through
   * both repos for no behavioral reason to.
   *
   * Claimant-vs-claimant self-contradiction was deliberately admissible here
   * once — "a vendor's pricing page contradicting its own docs" — until the
   * 2026-09-22/23 small-model runs showed it producing nothing but repeated
   * self-pair hallucinations and vague non-conflicts in practice. See
   * docs/superpowers/specs/2026-09-23-side-role-invariant-design.md.
   */
  sides: AdmittedSpan[]
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npm run typecheck && npx vitest run`
Expected: all pass, including the two new tests and the unmodified `SELF_PAIR` table row (still denies `SELF_PAIR`, not `TO_NOT_INDEPENDENT`, confirming the ordering).

- [ ] **Step 8: Commit**

```bash
git add src/assay/bookkeeper/admit.ts src/assay/bookkeeper/admit.test.ts src/assay/types.ts src/assay/assemble.ts
git commit -F - <<'EOF'
admit() requires from-claimant, to-independent-or-null.

A 2026-09-23 qwen2.5:14b run admitted a row pairing two independent
documents with no claimant side at all -- nothing checked that "from"
referenced a claimant document; every prompt tier has only ever assumed it.
FROM_NOT_CLAIMANT closes that gap.

Separately, admit.ts's own sides-field comment named claimant-vs-claimant
self-contradiction as a deliberately supported case. Across every ledger
this project has stamped, that pairing produced one questionable row and,
under a small model, nothing but self-pair hallucinations and vague
non-conflicts on two separate attempts. TO_NOT_INDEPENDENT retires it --
a deliberate reversal of that comment's rationale, not an oversight; the
comment is rewritten to say so.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Copy the engine to Claim/Record

**Repo:** `C:\Users\krist\Projects\claim-record`, branch `side-role-invariant` off `master`.

**Files:**
- Replace: `src/assay/` with `receipts/src/assay/` at receipts' `side-role-invariant` HEAD

**Interfaces:**
- Consumes: Task 1's engine, unchanged in every other respect.

- [ ] **Step 1: Branch and copy**

```bash
cd C:/Users/krist/Projects/claim-record
git status --porcelain
```

Expected: only `src/instance/ollama.ts` modified (pre-existing, unrelated — leave it).

```bash
git checkout -b side-role-invariant
rm -rf src/assay
cp -r ../receipts/src/assay src/assay
diff -rq src/assay ../receipts/src/assay && echo IDENTICAL
```

- [ ] **Step 2: Run**

```bash
npm run typecheck && npx vitest run
```

Expected: all pass (236 baseline + however many `src/assay` carried in from Task 1's `admit.test.ts` additions). No Claim/Record test exercises same-role pairing today, so nothing here should need a fixture change.

- [ ] **Step 3: Confirm no doc update is needed**

```bash
grep -rn "SELF_PAIR\|DOC_UNKNOWN\|ANCHOR_NOT_FOUND" README.md architecture.md
```

Expected: no output (confirms the Global Constraints note — this repo's docs don't enumerate generic engine codes, so `FROM_NOT_CLAIMANT`/`TO_NOT_INDEPENDENT` don't need a matching entry here).

- [ ] **Step 4: Commit**

```bash
git add src/assay
git commit -F - <<'EOF'
Pull the side-role invariant from Receipts.

src/assay/ copied from Receipts side-role-invariant (byte-identical).
admit() now requires "from" claimant, "to" independent-or-null
(FROM_NOT_CLAIMANT, TO_NOT_INDEPENDENT). No fixture here exercised
same-role pairing, and this repo's docs don't enumerate generic engine
codes, so nothing else changes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Regenerate the committed Tesla ledger; rewrite the one paragraph about it

**Repo:** `receipts`, branch `side-role-invariant`.

**Files:**
- Modify: `reports/tesla-fsd.json` (regenerated, not hand-edited)
- Modify: `README.md` (the "One row to be suspicious of" paragraph; the `npm test # N tests` line)
- Modify: `architecture.md` (denial-code table)

**Interfaces:**
- Consumes: `runReplay(reportPath, profileFor, deps?)` from `src/cli/replay.ts`; `receiptsFor` from `src/instance/profile.ts` as the `profileFor` argument (both already exist — no signature change in this plan).

- [ ] **Step 1: Confirm the current ledger has exactly one row this will remove**

```bash
npx tsx -e '
import { readFileSync } from "node:fs"
const d = JSON.parse(readFileSync("reports/tesla-fsd.json", "utf8"))
const docs = Object.fromEntries(d.docs.map((x: any) => [x.docId, x.role]))
for (const row of d.rows) {
  const roles = row.sides.map((s: any) => docs[s.docId])
  if (new Set(roles).size === 1) console.log(row.status, roles, row.statement.slice(0, 50))
}
'
```

Expected: exactly one line, `divergent [ 'claimant', 'claimant' ] All Tesla vehicles manufactured after 2014 are equ`.

- [ ] **Step 2: Regenerate from cache — no model call, no cost**

```bash
npx tsx -e '
import { readFileSync, writeFileSync } from "node:fs"
import { runReplay } from "./src/cli/replay.ts"
import { receiptsFor } from "./src/instance/profile.ts"

const path = "reports/tesla-fsd.json"
const saved = JSON.parse(readFileSync(path, "utf8"))
const r = await runReplay(path, receiptsFor)
console.log(`replayed ${r.replayed} responses; ${r.diff.length} differing leaf(es):`)
for (const line of r.diff) console.log("  " + line)
if (r.result.outcome !== "ledger") throw new Error(`replay produced ${r.result.outcome}`)
const next = { ...saved, rows: r.result.rows, audit: r.result.audit }
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
'
```

Expected output: `replayed 16 responses;` followed by one or more differing leaves naming the dropped row (e.g. `rows.length: 5 → 4` and the shifted-index lines the file's own `diffJson` comment describes). Read the diff and confirm every difference traces to the one claimant-vs-claimant row leaving `rows` and its counters in `audit` — nothing else should move. If anything else differs, STOP and report it; do not proceed to Step 3.

- [ ] **Step 3: Verify replay is now identical to itself**

```bash
npm run cli -- tesla --replay reports/tesla-fsd.json
```

Expected: `replay: identical (16 responses from cache)`, exit 0.

```bash
npm run replay
```

Expected: `1 replayed, 3 not replayable`, exit 0 (unchanged from before this task — same counts, different content).

- [ ] **Step 4: Rewrite the README paragraph**

Find (near the Tesla narrative, search for `One row to be suspicious of`):

```markdown
**One row to be suspicious of.** The first divergent row pairs two *Tesla*
pages against each other. The engine admits a claimant-vs-claimant pairing
(only a same-document pair is `SELF_PAIR`), and the two quotes do not
contradict each other on any plain reading. It is left in because the ledger
prints what the gate admitted, and the gate has no rule against it; whether
Receipts should refuse claimant-only pairings is an open question for the
instance, recorded here rather than patched in the output.
```

Replace with:

```markdown
**The claimant-vs-claimant row is gone.** An earlier version of this ledger
paired two *Tesla* pages against each other — the engine admitted it because
nothing forbade a claimant-vs-claimant pairing, and the two quotes did not
contradict each other on any plain reading. `admit()` now requires a
relation's independent side to actually be independent (`TO_NOT_INDEPENDENT`)
and its claimant side to actually be the claimant (`FROM_NOT_CLAIMANT`,
closing a related gap where an independent-vs-independent pair could be
admitted with no claimant side at all). The ledger below was regenerated
from the same sixteen cached responses under the new rule; no new model call
was made.
```

Update the test count line — run `npx vitest run` and use the number it prints in `npm test        # N tests`.

- [ ] **Step 5: `architecture.md` denial-code table**

Find:

```markdown
| `ISSUE_STATEMENT` | Independent quote is an issue or argument sentence |
| `HOLDING_COMPETITOR` | Independent quote is a non-holding sentence and this or another Record document holds on the claim |
```

Replace with:

```markdown
| `ISSUE_STATEMENT` | Independent quote is an issue or argument sentence |
| `HOLDING_COMPETITOR` | Independent quote is a non-holding sentence and this or another Record document holds on the claim |
| `FROM_NOT_CLAIMANT` | The claim side of a relation does not reference a claimant document |
| `TO_NOT_INDEPENDENT` | The evidence side of a relation (when present) does not reference an independent document |
```

- [ ] **Step 6: Run everything and commit**

```bash
npm run typecheck && npx vitest run && npm run replay
```

Expected: clean; `1 replayed, 3 not replayable`.

```bash
git add reports/tesla-fsd.json README.md architecture.md
git commit -F - <<'EOF'
Regenerate the Tesla ledger under the side-role invariant.

Same sixteen cached responses, no new model call. The one claimant-vs-
claimant row drops out; rows and audit are the only fields that changed.
README's paragraph about that row is rewritten to say it's gone and why.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Review, merge, push

- [ ] Final whole-branch review on both branches (`receipts`: base `956df54`, head = Task 3's commit; `claim-record`: base `5535ad9`, head = Task 2's commit). Fix findings.
- [ ] Merge `side-role-invariant` → `main` (receipts) and → `master` (claim-record), `--no-ff`.
- [ ] `diff -rq receipts/src/assay claim-record/src/assay` empty; `npm run typecheck && npx vitest run` clean in both; `npm run replay` in receipts still `1 replayed, 3 not replayable`.
- [ ] Push both.

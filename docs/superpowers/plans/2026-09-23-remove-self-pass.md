# Remove Self-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `planPasses` stops emitting the claimant-only ("self") proposer pass — every proposal it could make is now guaranteed denied by the side-role invariant, so it is a paid model call for a row that can never exist.

**Architecture:** One deletion in the shared engine's `src/assay/cartographer/propose.ts` (Task 1, receipts), copied to `claim-record` (Task 2), then the committed Tesla ledger regenerated for free from the same cache and every README/architecture.md passage narrating "sixteen"/"8 passes" reconciled against the real new numbers (Task 3), reviewed and merged (Task 4).

**Tech Stack:** TypeScript (strict, nodenext), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-remove-self-pass-design.md` — read it first.

## Global Constraints

- `planPasses` no longer emits a `passId: "self"` entry under any claimant document count. Everything else about pass planning (one pass per independent document, the whole-corpus `unsupported` pass, the empty-corpus fallback) is unchanged.
- `src/assay/` stays byte-identical between `receipts` and `claim-record`; `diff -rq` empty after Task 2 and through Task 4.
- The Tesla ledger regeneration replaces only `rows` and `audit` — `replay.keys`, every `replay.samples[].keys`, `generatedAt`, `docs`, `failures`, `subject`, `labels` stay exactly as committed (cache keys are plain hashes; the two now-orphaned self-pass keys join the existing orphaned-key precedent, documented by count only, same as the 2026-09-12/2026-09-14 Opus keys already are).
- Verified counts to confirm, not assume, via the regeneration script's real output before writing any prose: `proposed` drops from 35 to 27 (mergeRuns sums `proposed` across both samples, so this is 4 self-pass proposals from each of the two samples, not just sample 0's), `denied` from 15 to 11 (`denied` is sample 0 only, per mergeRuns; all four dropped denials were `TO_NOT_INDEPENDENT`), `admitted` stays 4, `rows` stays 4, `passes` drops from 8 to 7. `npm run cli -- tesla --replay reports/tesla-fsd.json` reports `replay: identical (14 responses from cache)`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (or the model that wrote it, truthfully).
- `npm run typecheck` and `npx vitest run` clean before every commit. Current baseline: `receipts` 755 tests / 50 files at `3406282`; `claim-record` 240 tests / 20 files at `760c0cb`.
- `claim-record`'s working tree carries one unrelated, pre-existing uncommitted change (`src/instance/ollama.ts`), not part of this plan. Use explicit `git add` paths there, never `-A`.

## File Structure

**receipts:**
- `src/assay/cartographer/propose.ts` — delete the self-pass block and its doc-comment paragraph
- `src/assay/cartographer/propose.test.ts` — remove/rewrite the four self-pass-specific assertions
- `README.md`, `architecture.md` — every "sixteen"/"8 passes" passage describing *this* ledger or *this* mechanism (not other, historical restamps)
- `reports/tesla-fsd.json` — regenerated (Task 3)

**claim-record:**
- `src/assay/` — copied from receipts (Task 2)

---

### Task 1: Delete the self pass

**Files:**
- Modify: `src/assay/cartographer/propose.ts:82-87` (doc comment), `:126-130` (the pass block)
- Test: `src/assay/cartographer/propose.test.ts`

**Interfaces:**
- `planPasses(docs, candidates): ProposalPass[]` — signature unchanged; return value no longer contains a `passId: "self"` entry.

- [ ] **Step 1: Branch**

```bash
git checkout -b remove-self-pass
```

- [ ] **Step 2: Rewrite the failing tests**

Open `src/assay/cartographer/propose.test.ts`. Three tests reference `"self"` and must change; a fourth ("omits the self pass when only one claimant document was read") is deleted outright — there is no self pass to omit under any count once this task lands.

Find:

```ts
describe("planPasses", () => {
  it("makes one pass per independent document", () => {
    const passes = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(passes.map((p) => p.passId)).toEqual(["i1", "i2", "self", "unsupported"])
  })

  it("gives every pass the whole claimant side and exactly one independent source", () => {
    const [first] = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(first!.candidates.map((c) => c.docId)).toEqual(["v1", "v2", "i1"])
  })

  // The pass is still added and still asks the model for self-contradiction
  // — but admit() now denies every claimant-vs-claimant result it can
  // produce, as SELF_PAIR or TO_NOT_INDEPENDENT. This test only guards that
  // planPasses still includes it; see propose.ts's ProposalPass doc comment
  // for why that makes this pass a paid call with no possible admitted row.
  it("adds a claimant-only pass so self-contradiction can be proposed", () => {
    const self = planPasses(FANNED_DOCS, FANNED_CANDIDATES).find((p) => p.passId === "self")
    expect(self!.candidates.map((c) => c.docId)).toEqual(["v1", "v2"])
  })

  it("omits the self pass when only one claimant document was read", () => {
    const docs = FANNED_DOCS.filter((d) => d.docId !== "v2")
    const cands = FANNED_CANDIDATES.filter((c) => c.docId !== "v2")
    expect(planPasses(docs, cands).map((p) => p.passId)).toEqual(["i1", "i2", "unsupported"])
  })
```

Replace with:

```ts
describe("planPasses", () => {
  it("makes one pass per independent document", () => {
    const passes = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(passes.map((p) => p.passId)).toEqual(["i1", "i2", "unsupported"])
  })

  it("gives every pass the whole claimant side and exactly one independent source", () => {
    const [first] = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(first!.candidates.map((c) => c.docId)).toEqual(["v1", "v2", "i1"])
  })

  // The claimant-only pass this project once had asked the model for
  // self-contradiction, but its candidates were always claimant-only, so
  // every relation it could produce had both sides claimant. Once admit()
  // required "to" to be independent (2026-09-23), no proposal from that
  // pass could ever be admitted -- see
  // docs/superpowers/specs/2026-09-23-remove-self-pass-design.md. planPasses
  // no longer emits it, at any claimant document count.
  it("never plans a claimant-only pass, regardless of how many claimant documents were read", () => {
    const twoClaimants = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(twoClaimants.some((p) => p.passId === "self")).toBe(false)

    const oneClaimant = planPasses(
      FANNED_DOCS.filter((d) => d.docId !== "v2"),
      FANNED_CANDIDATES.filter((c) => c.docId !== "v2"),
    )
    expect(oneClaimant.map((p) => p.passId)).toEqual(["i1", "i2", "unsupported"])
  })
```

Find (the second `describe`, further down the file):

```ts
  it("marks every per-source pass relational", () => {
    const passes = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(passes.filter((p) => p.mode === "relational").map((p) => p.passId))
      .toEqual(["i1", "i2", "self"])
  })
```

Replace with:

```ts
  it("marks every per-source pass relational", () => {
    const passes = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(passes.filter((p) => p.mode === "relational").map((p) => p.passId))
      .toEqual(["i1", "i2"])
  })
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/assay/cartographer/propose.test.ts`
Expected: FAIL — the rewritten assertions expect no `"self"` pass, but `planPasses` still emits one for `FANNED_DOCS` (two claimant documents).

- [ ] **Step 4: Delete the pass and its comment**

In `src/assay/cartographer/propose.ts`, find:

```ts
 * The claimant-only ("self") pass still runs and still asks the model for
 * claimant-vs-claimant relations — but `admit()` now denies every one of
 * them, as `SELF_PAIR` or `TO_NOT_INDEPENDENT` (see
 * docs/superpowers/specs/2026-09-23-side-role-invariant-design.md), so it
 * cannot produce the rows it exists for. It is kept only because removing
 * it is a separate decision — it changes the pass count and what replay
 * reproduces — that has not been made yet: it costs money for nothing
 * right now.
 */
```

Replace with:

```ts
 */
```

(The paragraph explaining why the self pass existed and why it was wasteful is deleted along with the pass — there is nothing left to explain. The surrounding paragraphs about splitting relational and unsupported passes are untouched.)

Find:

```ts
  // Self-contradiction needs at least two claimant documents to be possible.
  const claimantDocCount = new Set(claimant.map((c) => c.docId)).size
  if (claimantDocCount >= 2) {
    passes.push({ passId: "self", mode: "relational", candidates: claimant })
  }

  // One pass over everything, for the judgement only the whole corpus can make.
```

Replace with:

```ts
  // One pass over everything, for the judgement only the whole corpus can make.
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm run typecheck && npx vitest run`
Expected: all pass. Total count drops by one test (the deleted "omits the self pass" case) from the current baseline.

- [ ] **Step 6: Commit**

```bash
git add src/assay/cartographer/propose.ts src/assay/cartographer/propose.test.ts
git commit -F - <<'EOF'
planPasses no longer plans the claimant-only pass.

Its candidates were always claimant-only, so every relation it could
propose had both sides claimant. Since admit() requires "to" to be
independent (2026-09-23), nothing that pass could ever produce is
admissible. It cost a model call every live run with two or more claimant
documents, for a row that could never exist.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Copy the engine to Claim/Record

**Repo:** `C:\Users\krist\Projects\claim-record`, branch `remove-self-pass` off `master`.

**Files:**
- Replace: `src/assay/` with `receipts/src/assay/` at receipts' `remove-self-pass` HEAD

- [ ] **Step 1: Branch and copy**

```bash
cd C:/Users/krist/Projects/claim-record
git status --porcelain
```

Expected: only `src/instance/ollama.ts` modified (pre-existing, unrelated — leave it).

```bash
git checkout -b remove-self-pass
rm -rf src/assay
cp -r ../receipts/src/assay src/assay
diff -rq src/assay ../receipts/src/assay && echo IDENTICAL
```

- [ ] **Step 2: Run**

```bash
npm run typecheck && npx vitest run
```

Expected: all pass, one fewer test than the current baseline (the deleted `propose.test.ts` case carried through the copy).

- [ ] **Step 3: Commit**

```bash
git add src/assay
git commit -F - <<'EOF'
Pull the self-pass removal from Receipts.

src/assay/ copied from Receipts remove-self-pass (byte-identical).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Regenerate the Tesla ledger; reconcile every "sixteen"/"8 passes" passage

**Repo:** `receipts`, branch `remove-self-pass`.

**Files:**
- Modify: `reports/tesla-fsd.json` (regenerated, not hand-edited)
- Modify: `README.md` (six passages — see Step 4), `architecture.md` (one passage — see Step 5)

**Interfaces:**
- Consumes: `runReplay(reportPath, profileFor, deps?)` from `src/cli/replay.ts`; `receiptsFor` from `src/instance/profile.ts`. Same regeneration technique as the 2026-09-23 side-role-invariant plan's Task 3.

- [ ] **Step 1: Regenerate from cache — no model call, no cost**

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
console.log("new audit:", JSON.stringify(r.result.audit, (k, v) => k === "denied" || k === "claimantOmittedPreviews" ? undefined : v, 2))
const next = { ...saved, rows: r.result.rows, audit: r.result.audit }
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
'
```

If the multi-line `-e` script produces no output in your shell (a known Git Bash/Windows quirk), write it to a temp `.mts` file instead and run `npx tsx path/to/file.mts` — same content.

Expected: `replayed 14 responses;` (not 16 — the two self-pass keys are never requested by the new pass plan). The printed `new audit` should show `proposed: 31`, `admitted: 4`, and `denied` reduced by four (read the actual printed numbers — the Global Constraints section states what to expect, but confirm against this real output before writing any prose). If anything else differs from those expectations, STOP and report BLOCKED with the full output; do not proceed to Step 2.

- [ ] **Step 2: Verify replay is identical to itself**

```bash
npm run cli -- tesla --replay reports/tesla-fsd.json
```

Expected: `replay: identical (14 responses from cache)`, exit 0.

```bash
npm run replay
```

Expected: `1 replayed, 3 not replayable`, exit 0 (same tally as before this task — only the content changed).

- [ ] **Step 3: `src/cli/replay.test.ts` — update the committed count**

Find:

```ts
    expect(r.stdout).toContain("replay: identical (16 responses from cache)")
```

Replace with:

```ts
    expect(r.stdout).toContain("replay: identical (14 responses from cache)")
```

- [ ] **Step 4: README.md — six passages**

Read each passage in full before editing; only change what actually describes the *current* committed Tesla ledger or the *current* pass-planning mechanism. Do not touch a sentence describing a different, historical, already-superseded restamp (the 2026-09-14 Opus restamp's "sixteen new responses were written" and its "16 cached responses (8 per sample)" are historical facts about that event and stay as written).

**4a.** Search "sixteen `qwen2.5:7b` responses took about fifty":

```markdown
committed Tesla ledger's sixteen `qwen2.5:7b` responses took about fifty
minutes on a laptop.
```

→ change `sixteen` to `fourteen` (this describes what the *current* committed ledger uses; the original generation run made 16 live calls, but 2 are no longer part of what replay reads).

**4b.** Search "recorded sixteen responses in":

```markdown
on a local Ollama (`--client ollama`) — recorded sixteen responses in
`cache/proposals/` and stamped `profile: "receipts"` and
`model: "qwen2.5:7b"` on the manifest. `npm run cli -- tesla --replay
reports/tesla-fsd.json` exits 0 with `replay: identical (16 responses from
cache)`;
```

→ change both `sixteen` and `16` to `fourteen`/`14`.

**4c.** Search "sixteen Tesla responses from the 2026-09-17 restamp":

```markdown
`cache/proposals/` sits alongside `snapshots/`: the content-addressed response
cache described in [Replaying a ledger](#replaying-a-ledger). It holds the
sixteen Tesla responses from the 2026-09-17 restamp (the 2026-09-12 and
2026-09-14 keys, thirty-two Opus responses, remain on disk and no longer
replay); any live entry point creates the directory on first use.
```

Replace with:

```markdown
`cache/proposals/` sits alongside `snapshots/`: the content-addressed response
cache described in [Replaying a ledger](#replaying-a-ledger). It holds
fourteen currently-used Tesla responses from the 2026-09-17 restamp (two
more from that restamp, and the 2026-09-12 and 2026-09-14 keys — thirty-two
Opus responses — remain on disk and no longer replay: the removed
claimant-only pass's two responses joined the pile on 2026-09-23); any live
entry point creates the directory on first use.
```

**4d.** Search "the Tesla ledger's audit\nline says `8 passes`" (the pass-planning explanation paragraph — read `README.md` around the text "one pass per independent source that contributed candidates, a claimant-only pass when two or more claimant documents contributed candidates"):

```markdown
In general the model is not called once. It is called once per proposal pass:
one pass per independent source that contributed candidates, a claimant-only
pass when two or more claimant documents contributed candidates, and one pass
over everything for the unsupported-claim judgement — the Tesla ledger's audit
line says `8 passes`. (When no independent source contributed candidates there
is exactly one pass, over everything.)
```

Replace with:

```markdown
In general the model is not called once. It is called once per proposal pass:
one pass per independent source that contributed candidates, and one pass
over everything for the unsupported-claim judgement — the Tesla ledger's audit
line says `7 passes`. (When no independent source contributed candidates there
is exactly one pass, over everything.)
```

(This paragraph used to describe a claimant-only pass that no longer exists — the sentence is rewritten, not just the number.)

**4e.** The `<details>` "ledger in full (unedited)" block (search "audit: proposed 35 over 8 passes"): regenerate it the same way Task 3 of the side-role-invariant plan did. Run:

```bash
npm run cli -- tesla --render reports/tesla-fsd.json
```

and replace the block's contents with the real output (the `DIVERGENT`/`CONTEXT UNVERIFIED` sections, the `sources` list, and the `audit:`/`provenance:` lines), byte for byte. The rows themselves should be unchanged from before this task (only `proposed`/`denied`/`passes` in the audit line move); confirm by eye that all four rows' text is identical to what was there before.

**4f.** Update the `npm test        # N tests` line in the Development section to whatever `npx vitest run` prints after this task's changes.

- [ ] **Step 5: `architecture.md` — one passage**

Search "which is why the 2026-09-14 restamp wrote sixteen new keys" — this describes the 2026-09-14 event specifically and is historically accurate; leave it untouched. Confirm by reading the full sentence that it names "2026-09-14", not "2026-09-17" or "the committed ledger" — if it does name the current ledger, adjust; otherwise make no change here and note in the report that this one was checked and correctly left alone.

- [ ] **Step 6: Read the whole Tesla section once more, top to bottom**

The prior regeneration (2026-09-23, side-role-invariant Task 3) missed a fourth stale passage on the first pass and only caught it on a deliberate full re-read. Do that here too: read `README.md` from the start of the `## A real ledger` section (or wherever the Tesla narrative begins) through the end of the Tesla-specific content, looking for any other sentence whose numbers (rows, proposed, denied, passes, responses) don't match the regenerated `reports/tesla-fsd.json`. Fix anything you find; note it in the report even if nothing turns up.

- [ ] **Step 7: Run everything and commit**

```bash
npm run typecheck && npx vitest run && npm run replay
```

Expected: clean; `1 replayed, 3 not replayable`.

```bash
git add reports/tesla-fsd.json README.md architecture.md src/cli/replay.test.ts
git commit -F - <<'EOF'
Regenerate the Tesla ledger without the retired self pass.

Same fourteen cached responses that remain relevant, no new model call.
Passes 8 -> 7, proposed 35 -> 27 (both samples independently proposed
four self-pass items each), denied 15 -> 11 (sample 0 only, all four dropped
denials were TO_NOT_INDEPENDENT from the removed pass); rows and admitted
count are unchanged. Every README/architecture.md passage narrating the
old sixteen-response, eight-pass count is reconciled against the real new
numbers; passages describing other, historical restamps are untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Review, merge, push

- [ ] Final whole-branch review on both branches (`receipts`: base `3406282`, head = Task 3's commit; `claim-record`: base `760c0cb`, head = Task 2's commit). Fix findings.
- [ ] Merge `remove-self-pass` → `main` (receipts) and → `master` (claim-record), `--no-ff`.
- [ ] `diff -rq receipts/src/assay claim-record/src/assay` empty; `npm run typecheck && npx vitest run` clean in both; `npm run replay` in receipts still `1 replayed, 3 not replayable`.
- [ ] Check for any new commits on `origin/main` (receipts) or `origin/master` (claim-record) pushed since this branch started (e.g. by another session) and merge them into `main`/`master` before pushing, the same way the 2026-09-23 side-role-invariant plan's Task 4 picked up `a10923c`.
- [ ] Push both.

# Holding-Competitor Redesign and Claim/Record Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `holdingCompetesWithClaim`'s over-broad two-token-overlap/IDF-relevance gate with a validated joint-vocabulary-intersection signal in the shared Assay engine, sync the fix to Claim/Record with a regression test proving the false positive it fixes, then close two small, unrelated Claim/Record hardening gaps (unescaped UI sinks, untested empty-subject guard).

**Architecture:** One function in `receipts/src/assay/bookkeeper/admit.ts` changes signature and implementation; both call sites in the same file simplify to pass an argument they already compute. The change is synced to `claim-record/src/assay` via the project's standing `rm -rf && cp -r` mirror, exactly as every prior engine change this session. The two Claim/Record fixes (items 2 and 3) touch only `claim-record/src/web/index.html` and two Claim/Record test files — no engine involvement.

**Tech Stack:** TypeScript, Vitest, Node's `http`/`fetch` for the server integration test. No new dependencies.

## Global Constraints

- `HOLDING_COMPETITOR_FLOOR = 0.2` (exact value from the spec's validation; do not retune).
- `src/assay/` must stay byte-identical between `receipts` and `claim-record` at every commit boundary in Task 2 — verified with `diff -rq`, not assumed.
- Item 2 (innerHTML escaping) gets no new automated test — the user explicitly chose manual-verify-only over building jsdom test infrastructure for a single static file. Do not add one.
- Full spec: `docs/superpowers/specs/2026-09-24-holding-competitor-and-hardening-design.md`.

---

## Task 1: Redesign `holdingCompetesWithClaim` in the shared engine (receipts)

**Files:**
- Modify: `src/assay/bookkeeper/admit.ts:62-88` (delete `distinctiveOverlap` and the old `holdingCompetesWithClaim`, add `HOLDING_COMPETITOR_FLOOR`, `distinctive`, and the new `holdingCompetesWithClaim`)
- Modify: `src/assay/bookkeeper/admit.ts:102-129` (`blocksNonHolding`'s two call sites)
- Test: `src/assay/bookkeeper/admit.test.ts` (no edits — existing suite is the safety net; see Step 1)

**Interfaces:**
- Consumes: nothing from another task.
- Produces: `holdingCompetesWithClaim(holding: string, claimQuote: string, unmarkedSpan: string, idf: Map<string, number>): boolean` — new signature (was `(holding, fromSpanText, terms, idf)`). `blocksNonHolding`'s own signature and return type (`"ISSUE_STATEMENT" | "HOLDING_COMPETITOR" | null`) are unchanged; Task 2 depends only on `blocksNonHolding`'s unchanged external behavior, not on any of these internals.

This is a refactor validated by the spec's own empirical work (six real scenarios in both repos, scripted and checked before the spec was written — see the spec's "Why" section), not new behavior. There is no new failing test to write in receipts: the false positive this fixes never reproduces against receipts' own "acme" fixtures (the spec explains why — Blue Chip's coincidental vocabulary overlap is a Claim/Record-domain artifact). The safety net is the existing suite, run both before and after the change.

- [ ] **Step 1: Confirm the existing suite is green before touching anything**

Run: `npx vitest run src/assay/bookkeeper/admit.test.ts`
Expected: PASS, all tests including the six `HOLDING_COMPETITOR` cases at (approximately) lines 752, 786, 826, 873, 895, 922.

- [ ] **Step 2: Replace `distinctiveOverlap` and the old `holdingCompetesWithClaim`**

In `src/assay/bookkeeper/admit.ts`, replace this block (currently lines 62-88):

```ts
function distinctiveOverlap(a: string, b: string): number {
  const stop = new Set([
    "that", "with", "from", "this", "they", "them", "than", "then", "when", "what",
    "have", "been", "were", "will", "shall", "into", "upon", "also", "such", "only",
    "more", "some", "over", "under", "even", "must", "does",
  ])
  const left = new Set(tokenize(a).filter((t) => t.length >= 4 && !stop.has(t)))
  const right = new Set(tokenize(b).filter((t) => t.length >= 4 && !stop.has(t)))
  let n = 0
  for (const t of left) if (right.has(t)) n++
  return n
}

/**
 * A holding competes with a claimant quote when IDF says so, or when two
 * content tokens overlap. Claim-quote IDF mass is often unmatched words
 * (negligent, bookkeeping) while the holding still names the same nouns.
 */
function holdingCompetesWithClaim(
  holding: string,
  fromSpanText: string,
  terms: string[],
  idf: Map<string, number>,
): boolean {
  if (idfRelevance(holding, terms, idf) >= DIVERGENCE_IDF_FLOOR) return true
  return distinctiveOverlap(fromSpanText, holding) >= 2
}
```

with:

```ts
const HOLDING_COMPETITOR_FLOOR = 0.2

function distinctive(text: string): Set<string> {
  const stop = new Set([
    "that", "with", "from", "this", "they", "them", "than", "then", "when", "what",
    "have", "been", "were", "will", "shall", "into", "upon", "also", "such", "only",
    "more", "some", "over", "under", "even", "must", "does",
  ])
  return new Set(tokenize(text).filter((t) => t.length >= 4 && !stop.has(t)))
}

/**
 * A holding competes with a claim when it shares IDF-weighted vocabulary with
 * what the claim quote and the disputed sentence are jointly about — not with
 * the claim alone, which an unrelated holding can resemble by incidental
 * subject overlap (two Section 10(b) sentences that concern different
 * questions). Requiring the shared vocabulary to be common to *both* the
 * claim and the sentence under test narrows the match to the sentence's
 * actual subject. See
 * docs/superpowers/specs/2026-09-24-holding-competitor-and-hardening-design.md.
 */
function holdingCompetesWithClaim(
  holding: string,
  claimQuote: string,
  unmarkedSpan: string,
  idf: Map<string, number>,
): boolean {
  const claimVocab = distinctive(claimQuote)
  const jointVocab = [...distinctive(unmarkedSpan)].filter((t) => claimVocab.has(t))
  const holdingVocab = distinctive(holding)
  let weight = 0
  for (const t of jointVocab) if (holdingVocab.has(t)) weight += idf.get(t) ?? Math.log(2)
  return weight >= HOLDING_COMPETITOR_FLOOR
}
```

- [ ] **Step 3: Update both call sites in `blocksNonHolding`**

In the same file, `blocksNonHolding` (currently lines 102-129) currently reads:

```ts
function blocksNonHolding(
  toDoc: PinnedDoc,
  toSpan: AdmittedSpan,
  fromSpan: AdmittedSpan,
  idf: Map<string, number>,
  independents: PinnedDoc[],
  lexicon: Lexicon,
): "ISSUE_STATEMENT" | "HOLDING_COMPETITOR" | null {
  const envelope = enclosingSentence(toDoc.text, toSpan.start, toSpan.end)
  const role = discourseRole(envelope.text, lexicon)
  if (role === "issue" || role === "argument") return "ISSUE_STATEMENT"
  if (role === "holding") return null
  const sameDocTerms = [...new Set([...tokenize(fromSpan.text), ...tokenize(envelope.text)])]
  for (const sentence of sentences(toDoc.text)) {
    if (sentence.start < envelope.end && envelope.start < sentence.end) continue
    if (discourseRole(sentence.text, lexicon) !== "holding") continue
    if (holdingCompetesWithClaim(sentence.text, fromSpan.text, sameDocTerms, idf)) return "HOLDING_COMPETITOR"
  }
  const fromTerms = tokenize(fromSpan.text)
  for (const other of independents) {
    if (other.docId === toDoc.docId) continue
    for (const sentence of sentences(other.text)) {
      if (discourseRole(sentence.text, lexicon) !== "holding") continue
      if (holdingCompetesWithClaim(sentence.text, fromSpan.text, fromTerms, idf)) return "HOLDING_COMPETITOR"
    }
  }
  return null
}
```

Replace the body from `const sameDocTerms = ...` through the end of the cross-doc loop with:

```ts
  for (const sentence of sentences(toDoc.text)) {
    if (sentence.start < envelope.end && envelope.start < sentence.end) continue
    if (discourseRole(sentence.text, lexicon) !== "holding") continue
    if (holdingCompetesWithClaim(sentence.text, fromSpan.text, envelope.text, idf)) return "HOLDING_COMPETITOR"
  }
  for (const other of independents) {
    if (other.docId === toDoc.docId) continue
    for (const sentence of sentences(other.text)) {
      if (discourseRole(sentence.text, lexicon) !== "holding") continue
      if (holdingCompetesWithClaim(sentence.text, fromSpan.text, envelope.text, idf)) return "HOLDING_COMPETITOR"
    }
  }
  return null
```

(The function signature, the `envelope`/`role` lines above it, and everything else are unchanged.)

- [ ] **Step 4: Run the admit suite again — must still be green**

Run: `npx vitest run src/assay/bookkeeper/admit.test.ts`
Expected: PASS, identical test list to Step 1, now exercising the new implementation. If any of the six `HOLDING_COMPETITOR` cases fails, do not proceed — the new signal disagrees with a real scenario the spec validated; stop and re-check the spec's numbers against this test's exact fixture text.

- [ ] **Step 5: Run the full receipts suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean/PASS. No other file references `distinctiveOverlap` (confirm with a quick search if unsure — it was private to `admit.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/assay/bookkeeper/admit.ts
git commit -m "$(cat <<'EOF'
Redesign holdingCompetesWithClaim: joint claim/span vocabulary intersection

The old signal (IDF-relevance of the holding against the claim alone,
OR raw token overlap) let an unrelated holding block a legitimate row
whenever it happened to share incidental subject vocabulary with the
claim. Validated against every real HOLDING_COMPETITOR scenario in
both repos plus the reproduced false positive; see
docs/superpowers/specs/2026-09-24-holding-competitor-and-hardening-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Sync the engine to Claim/Record and add the Blue Chip regression test

**Files:**
- Modify: `claim-record/src/assay/` (full directory replace via sync, not hand-edited)
- Modify: `claim-record/src/instance/calibration/corpus.ts` (add `BLUE_CHIP` fixture)
- Modify: `claim-record/src/instance/calibration/calibration.test.ts` (add regression test + two new imports)

**Interfaces:**
- Consumes: Task 1's `holdingCompetesWithClaim`/`blocksNonHolding` behavior, via the synced `src/assay` copy — no direct import of anything Task-1-specific; the test only calls `admit()` and `assemble()`, both unchanged in signature.
- Produces: nothing further tasks depend on.

This task proves the fix by reproducing the false positive from the still-old engine copy first (red), then syncing (green) — the only point in this plan where a genuine before/after is possible, since the false positive needs Claim/Record's own corpus to reproduce.

- [ ] **Step 1: Add the `BLUE_CHIP` fixture to `corpus.ts`**

In `claim-record/src/instance/calibration/corpus.ts`, add after the existing `STATUTE` export (currently lines 36-37):

```ts
/** Unrelated holding: same statute, different question (standing, not scienter). */
export const BLUE_CHIP = pin("blue_chip", "independent",
  "We hold that a private right of action under Section 10(b) extends only to actual purchasers or sellers of securities, and standing does not extend to those who merely relied on a misrepresentation without transacting.")
```

- [ ] **Step 2: Write the failing regression test**

In `claim-record/src/instance/calibration/calibration.test.ts`, change the import (currently line 7-9):

```ts
import {
  ARGUMENT, CENTRAL_BANK, CLAIM, COMMENTATORS, goldCorpus, HOCHFELDER, SUBJECT, TELLABS,
} from "./corpus.js"
```

to:

```ts
import {
  ARGUMENT, BLUE_CHIP, CENTRAL_BANK, CLAIM, COMMENTATORS, goldCorpus, HOCHFELDER, STATUTE, SUBJECT, TELLABS,
} from "./corpus.js"
```

Then add this proposal constant after `RESIDUAL` (currently ends line 79) and this test inside the `describe("calibration — quote-mining gates", ...)` block, after the last test in that block (currently ends line 157, just before the block's closing `})`):

```ts
const STATUTE_UNMARKED = proposal({
  proposalId: "statute",
  type: "corroborates",
  statement: "statute corroborates the negligence claim",
  from: { docId: "claim", quote: "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter." },
  to: { docId: "statute", quote: "Section 10(b) makes it unlawful to use any manipulative or deceptive device in connection with the purchase or sale of any security." },
})
```

```ts
  it("still admits an unmarked statute corroboration when an unrelated standing holding is in the pile", () => {
    const { result } = run([STATUTE, BLUE_CHIP], [STATUTE_UNMARKED])
    expect(result.denied).toEqual([])
    expect(result.admitted).toHaveLength(1)
  })
```

- [ ] **Step 3: Run the new test alone — confirm it fails against the still-old engine copy**

Run: `npx vitest run src/instance/calibration/calibration.test.ts -t "unrelated standing holding"`
Expected: FAIL — `result.denied` contains a `HOLDING_COMPETITOR` denial instead of being empty. This is the reproduced false positive: `claim-record/src/assay` still has the pre-Task-1 implementation at this point.

- [ ] **Step 4: Sync the engine from receipts**

```bash
rm -rf src/assay
cp -r ../receipts/src/assay src/assay
```

- [ ] **Step 5: Confirm the copy is byte-identical**

Run: `diff -rq src/assay ../receipts/src/assay`
Expected: no output (empty diff).

- [ ] **Step 6: Run the new test again — confirm it now passes**

Run: `npx vitest run src/instance/calibration/calibration.test.ts -t "unrelated standing holding"`
Expected: PASS.

- [ ] **Step 7: Run the full Claim/Record suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean/PASS — including every pre-existing `HOLDING_COMPETITOR`/manufactured-doubt case in `calibration.test.ts` (lines 127-157), unaffected by the new fixture.

- [ ] **Step 8: Commit**

```bash
git add src/assay src/instance/calibration/corpus.ts src/instance/calibration/calibration.test.ts
git commit -m "$(cat <<'EOF'
Sync the joint-vocabulary holdingCompetesWithClaim fix; add the Blue Chip regression

Reproduces and fixes the false positive that motivated the redesign:
an unrelated Blue-Chip-style standing holding no longer blocks a
legitimate unmarked statute corroboration. Engine copy synced from
receipts (docs/superpowers/specs/2026-09-24-holding-competitor-and-hardening-design.md).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Escape the unescaped `innerHTML` sinks in Claim/Record's web UI

**Files:**
- Modify: `claim-record/src/web/index.html:69` (import) and `:158-178` (6 sinks)
- Test: `claim-record/src/server/index.test.ts` (no edits — existing suite is the regression check, per the user's explicit choice not to add new test infrastructure for this file)

**Interfaces:**
- Consumes: `escapeHtml` from `claim-record/src/web/audit.js` (already exported: `export function escapeHtml(s)`, escapes `&`, `<`, `>`, `"`).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Confirm the existing server suite is green before touching anything**

Run: `npx vitest run src/server/index.test.ts`
Expected: PASS (both existing tests).

- [ ] **Step 2: Import `escapeHtml` in `index.html`**

In `claim-record/src/web/index.html`, line 69 currently reads:

```js
    import { formatAudit } from "./audit.js"
```

Change to:

```js
    import { escapeHtml, formatAudit } from "./audit.js"
```

- [ ] **Step 3: Wrap the 6 unsafe sinks**

In the same file, the `run` button's click handler (currently lines 146-179) has six interpolations that need `escapeHtml(...)` around the named field. Each change below is a single-expression wrap — nothing else on the line changes.

Line 158, currently:

```js
      if (!res.ok) { out.innerHTML = `<p class="refusal">${data.error}</p>`; return }
```

becomes:

```js
      if (!res.ok) { out.innerHTML = `<p class="refusal">${escapeHtml(data.error)}</p>`; return }
```

Line 162, currently:

```js
        out.innerHTML = `<p class="refusal">Refusal: ${r.reason}</p><p>${r.detail ?? ""}</p>${auditLine}`
```

becomes (note: `r.reason` is an engine-controlled enum, left unescaped; `r.detail` is free text):

```js
        out.innerHTML = `<p class="refusal">Refusal: ${r.reason}</p><p>${escapeHtml(r.detail ?? "")}</p>${auditLine}`
```

Line 170, currently:

```js
          return `<div><strong>${role}</strong> ${doc?.label ?? s.docId}<blockquote>${s.text}</blockquote></div>`
```

becomes:

```js
          return `<div><strong>${role}</strong> ${escapeHtml(doc?.label ?? s.docId)}<blockquote>${escapeHtml(s.text)}</blockquote></div>`
```

Line 173, currently:

```js
        return `<div class="row ${row.status}"><span class="tag ${row.status}">${row.status}</span> — ${row.statement}${prov}${sides}</div>`
```

becomes:

```js
        return `<div class="row ${row.status}"><span class="tag ${row.status}">${row.status}</span> — ${escapeHtml(row.statement)}${prov}${sides}</div>`
```

Line 176, currently:

```js
        ? `<h2>Narrative</h2>` + data.narrative.paragraphs.map((p) => `<p>${p.text}</p>`).join("")
```

becomes:

```js
        ? `<h2>Narrative</h2>` + data.narrative.paragraphs.map((p) => `<p>${escapeHtml(p.text)}</p>`).join("")
```

`role`, `row.status`, and `row.provenance.class` (inside `prov`, line 172, unchanged) stay unwrapped — all three are values the engine itself produces from a closed set (`"claimant" | "independent"` mapped to a label, an `AdmissionCode`-adjacent status string, a provenance class), never text lifted from an uploaded document.

- [ ] **Step 4: Run the server suite again — must still be green**

Run: `npx vitest run src/server/index.test.ts`
Expected: PASS — this file's tests assert literal substrings of `index.html` (e.g. `"Claim / Record"`, `id="narrate"`, `from "./audit.js"`); a broken template literal or a typo in the import would surface here even without a dedicated escaping test.

- [ ] **Step 5: Manual verification**

Start the dev server and confirm normal rendering is unchanged, then confirm a crafted value is escaped instead of executed:

```bash
npm run dev
```

This runs `tsx --env-file-if-exists=.env src/server/index.ts`, serving the UI at `http://127.0.0.1:8787`. In the browser, upload a Claim file with body `We guarantee <img src=x onerror=alert(1)> uptime.` and a Record file that contradicts it, run the assay, and confirm the row's statement shows the literal text `<img src=x onerror=alert(1)>` (escaped, inert) rather than executing it or vanishing. Stop the server afterward (Ctrl+C).

- [ ] **Step 6: Run the full Claim/Record suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean/PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/index.html
git commit -m "$(cat <<'EOF'
Escape untrusted fields before innerHTML in claim-record's web UI

data.error, r.detail, doc.label, s.text, row.statement, and narrative
paragraph text can all originate from an uploaded document and were
written into innerHTML unescaped. Engine-controlled enum values
(role, row.status, provenance.class) are left as-is.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Empty-subject guard test coverage

**Files:**
- Modify: `claim-record/src/instance/run.test.ts` (add one unit test)
- Modify: `claim-record/src/server/index.test.ts` (add one integration test)

**Interfaces:**
- Consumes: `runClaimRecord` (`src/instance/run.ts`, `RunInput`/`UploadError` already exported), `createApp` (`src/server/index.ts`, already exported). No changes to either — the guard already exists at `run.ts:40` (`if (!subject) throw new UploadError("subject is required")`) and the server already maps `UploadError` to HTTP 400 (`server/index.ts:66-68`). Confirmed separately: `anthropicClient()` (the server's default client when `body.client` is omitted) does not throw synchronously without `ANTHROPIC_API_KEY` set — construction is lazy — so neither test needs to stub or configure a client for this path.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the unit test**

In `claim-record/src/instance/run.test.ts`, add inside the `describe("runClaimRecord", ...)` block, after the existing `"rejects a pdf upload"` test (currently ends line 56):

```ts
  it("rejects an empty subject", async () => {
    await expect(runClaimRecord({
      subject: "   ",
      claim: [{ name: "a.txt", text: "x" }],
      record: [{ name: "b.txt", text: "y" }],
      client: client([]),
    })).rejects.toThrow(UploadError)
  })
```

(Whitespace-only, not just `""`, to exercise the `.trim()` in `run.ts:39` as well as the emptiness check.)

- [ ] **Step 2: Run it**

Run: `npx vitest run src/instance/run.test.ts -t "rejects an empty subject"`
Expected: PASS immediately — the guard already exists; this closes a coverage gap, not a behavior change.

- [ ] **Step 3: Write the integration test**

In `claim-record/src/server/index.test.ts`, add inside the `describe("createApp", ...)` block, after the existing `"serves the audit renderer the page imports"` test (currently ends line 33):

```ts
  it("returns 400 for an empty subject", async () => {
    server = createApp()
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/assay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "", claim: [], record: [] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("subject is required")
  })
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/server/index.test.ts -t "returns 400 for an empty subject"`
Expected: PASS. The request never reaches `anthropicClient()`'s `propose` method (the subject guard in `runClaimRecord` throws first), so no network call happens and no `ANTHROPIC_API_KEY` is needed.

- [ ] **Step 5: Run the full Claim/Record suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean/PASS.

- [ ] **Step 6: Commit**

```bash
git add src/instance/run.test.ts src/server/index.test.ts
git commit -m "$(cat <<'EOF'
Add empty-subject guard coverage (unit + HTTP integration)

The guard already existed in run.ts:40 and server/index.ts's
UploadError-to-400 mapping; neither had a test.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final check (whole-branch review, after all four tasks)

- `receipts`: `npm run typecheck && npx vitest run && npm run replay` — replay must report `1 replayed, 3 not replayable`, identical to its state before this plan (this change touches denial logic replay re-runs, so this is a genuine check, not an assumption).
- `claim-record`: `npm run typecheck && npx vitest run`.
- `diff -rq claim-record/src/assay receipts/src/assay` — empty.
- Confirm no other file in either repo references `distinctiveOverlap` (deleted in Task 1).

# A `disputed` status for unmarked contradictions/updates

**Date:** 2026-09-24
**Status:** approved design
**Repos:** `receipts` (engine, three renderers) and `claim-record` (engine copy, narrator, web UI).

## Why

The final whole-branch review of the `holding-competitor-fix` branch (spec `2026-09-24-holding-competitor-and-hardening-design.md`, Task 1's `holdingCompetesWithClaim` redesign) found a real false-negative class: an unmarked sentence that *paraphrases* a claim rather than quoting its wording can slip past `blocksNonHolding`'s vocabulary-overlap check even when a genuinely on-point holding exists elsewhere in the pile, letting the claim render as a flat, confident `divergent` (red) row.

Concretely: claim "Scienter … is required in a private action under Section 10(b)." An unmarked commentator sentence, worded differently ("carelessness in keeping the accounts suffices for liability"), is proposed as a `contradicts`. A real holding (Tellabs: "plaintiffs … must plead facts evidencing scienter …") sits in the same pile and directly answers the claim — but shares almost no surface vocabulary with the paraphrase, so the redesigned `holdingCompetesWithClaim` doesn't flag it as competing, and the contradiction is admitted and rendered as `divergent`.

A fallback signal was investigated and rejected before writing this spec: routing low-overlap cases back to the original claim-vs-holding-alone check does not work, because the false positive this session already fixed (an unrelated Blue Chip standing holding) and the paraphrase false negative land on **identical** claim/span vocabulary overlap (both share only the word "section," weight 0.1335) — no threshold, on any bag-of-words signal tried (claim-alone relevance, span-alone overlap, joint claim/span intersection), separates them. This is not a tuning problem: both cases are three sentences sharing generic subject-matter framing but differing in actual substantive content, and telling "a different question about the same statute" apart from "the same question, differently worded" is a semantic distinction a bag-of-words signal cannot make. Decided: do not keep chasing a lexical discriminator that the data shows doesn't exist.

Instead: reduce the *severity* of the failure mode rather than trying to eliminate it. The engine already has a precedent for exactly this pattern — an unmarked **corroboration** (no holding backs it up, but nothing contradicts it either) doesn't render as a confident `corroborated`; it renders as the softer `context_unverified` (`assemble.ts`'s `rowStatus`, gated on `AdmittedRelation.contextUnverified`, set in `admit.ts` when `unmarkedCorroboration` — the `to` span's enclosing sentence has discourse role `"unmarked"`, not `"holding"`). That same "no holding backs this — the pile only has a plain sentence" evidentiary-quality signal applies identically to `contradicts`/`updates`; today it's only wired up for `corroborates`. Extending it closes nothing lexically, but a reader now sees "disputed by an unmarked source, no competing holding" instead of a confident "divergent" — the honest reflection of the evidentiary reality, whether the row is a genuine but weakly-sourced contradiction or a paraphrase that slipped past the vocabulary check.

## Decision

New `RowStatus` value: **`"disputed"`** — the `contradicts`/`updates` counterpart to `"context_unverified"`. Label wording mirrors `context_unverified`'s exact pattern: `"Disputed — unmarked independent quote, no competing holding"`.

**Severity ordering** (`STATUS_ORDER`, wherever it appears): `divergent (0) < disputed (1) < unverified (2) < context_unverified (3) < corroborated (4)`. A disputed row is still a negative signal — more concerning than "no evidence either way" (`unverified`) — just less confident than a holding-backed `divergent`.

**Trigger, generalized from `unmarkedCorroboration`**: the same discourse-role check (`to` span's enclosing sentence has role `"unmarked"`, not `"holding"`) applies uniformly across `contradicts`, `updates`, and `corroborates` — not just `corroborates`. This is not new logic; it is removing an artificial type restriction from logic that already exists and already means the same thing for every relation type: "no holding-marked source backs this side."

## Engine changes (`src/assay/`)

**`types.ts`**
- `RowStatus` gains `"disputed"`: `export type RowStatus = "divergent" | "corroborated" | "unverified" | "context_unverified" | "disputed"`.
- `Audit` gains a parallel counter, next to the existing `contextUnverified` field:
  ```ts
  /** Admitted corroborations labeled context_unverified (unmarked, no holding competitor). */
  contextUnverified: number
  /** Admitted contradictions/updates labeled disputed (unmarked, no holding competitor). */
  disputed: number
  ```

**`bookkeeper/admit.ts`**
- Rename `unmarkedCorroboration` to `unmarkedSpan` (it no longer names a corroboration-specific concept — same body, same two parameters, same return type):
  ```ts
  function unmarkedSpan(toDoc: PinnedDoc, toSpan: AdmittedSpan, lexicon: Lexicon): boolean {
    const envelope = enclosingSentence(toDoc.text, toSpan.start, toSpan.end)
    return discourseRole(envelope.text, lexicon) === "unmarked"
  }
  ```
- The `admitted.push` at the end of `admit()` currently gates the flag on `p.type === "corroborates"`. Broaden to every two-sided relation (mirrors the exact guard already used for the `blocksNonHolding` call a few lines above it, so the same set of proposals that go through the competing-holding check are the same set eligible for the flag):
  ```ts
  admitted.push({
    proposal: p,
    sides: sides.map(([, span]) => span),
    ...(p.type !== "unsupported" && toDoc && toSpan && unmarkedSpan(toDoc, toSpan, lexicon)
      ? { contextUnverified: true as const }
      : {}),
  })
  ```
  The `AdmittedRelation.contextUnverified` field itself is unchanged in name and shape — it always meant "no holding-marked source backs this side," independent of relation type; only *which* proposals could ever set it changes.

**`assemble.ts`**
- `rowStatus` currently returns a flat `"divergent"` for `contradicts`/`updates`. Branch it the same way `corroborates` already is:
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
- `STATUS_ORDER` gains `disputed: 1`, and the existing entries shift to match the ordering above:
  ```ts
  const STATUS_ORDER: Record<RowStatus, number> = {
    divergent: 0,
    disputed: 1,
    unverified: 2,
    context_unverified: 3,
    corroborated: 4,
  }
  ```
- `auditOf` gains the parallel counter, next to the existing `contextUnverified` line:
  ```ts
  contextUnverified: result.admitted.filter((a) => a.contextUnverified && a.proposal.type === "corroborates").length,
  disputed: result.admitted.filter((a) => a.contextUnverified && a.proposal.type !== "corroborates").length,
  ```
  (`a.proposal.type !== "corroborates"` rather than an explicit `"contradicts" || "updates"` list: `unsupported` never sets the flag per the `admit.ts` guard above, so the two counters partition `result.admitted` completely between them — every flagged relation is counted exactly once, by construction, not by re-deriving the relation-type list a second time.)

**`merge.ts`**
- Its own duplicated `STATUS_ORDER` (pre-existing duplication with `assemble.ts`, not introduced by this change, not this task's job to unify) gets the same five entries in the same order.
- `auditFromUnion` gains the parallel line, next to the existing one:
  ```ts
  contextUnverified: rows.filter((r) => r.status === "context_unverified").length,
  disputed: rows.filter((r) => r.status === "disputed").length,
  ```

## Rendering changes

**`src/report/render/html.ts`, `markdown.ts`, `terminal.ts`** (receipts) — each file independently defines its own `HEADINGS: Record<RowStatus, string>` and `SECTION_ORDER: RowStatus[]`. Both need a `"disputed"` entry in each file:
- `html.ts` / `markdown.ts` heading text: `"Disputed — unmarked independent quote, no competing holding"` (mirrors the `context_unverified` heading's exact pattern, divergent polarity implied by "Disputed" itself, matching how `context_unverified`'s own heading never restates "corroborated").
- `terminal.ts` heading text (its existing convention is upper-case): `"DISPUTED — unmarked independent quote, no competing holding"`.
- `SECTION_ORDER` in all three: insert `"disputed"` right after `"divergent"`, matching the severity ordering above: `["divergent", "disputed", "unverified", "context_unverified", "corroborated"]`.
- `html.ts` additionally has: a CSS custom property per status (`--divergent`, `--unverified`, `--context_unverified`, `--corroborated`, both light and dark blocks) — add `--disputed`, picking a shade between `--divergent`'s red and `--context_unverified`'s orange (implementer's call on the exact hex, staying within the file's existing red/orange/amber/green palette); a `h2.<status>` CSS rule per status — add `h2.disputed`; and the multi-report index page's per-report count-summary line (`${count("divergent")} divergent, …`) — add `, ${count("disputed")} disputed` to the string, and update the adjacent comment (currently says "All four statuses" — becomes "All five statuses").

**`src/eval/yield.ts`** (receipts) — `STATUSES: RowStatus[]` gains `"disputed"`, in the same position as the `SECTION_ORDER` arrays above.

**`src/narrator/narrate.ts`** (claim-record) — the citation-completeness check currently only requires both sides to be cited for `divergent` rows. A `disputed` row is the same two-sided shape (claimant quote + independent span) and deserves the same guarantee — a narrative asserting a contradiction, confident or not, must still cite what it's contradicted by:
  ```ts
  if ((row.status === "divergent" || row.status === "disputed") && sides.size < row.sides.length) {
    throw new NarratorError(`${row.status} row ${rowIndex} must cite both sides`)
  }
  ```

**`src/web/index.html`** (claim-record) — the row/tag styling is driven entirely by `class="row ${row.status}"` / `class="tag ${row.status}"` (`src/web/index.html:173`), so a new status needs new CSS rules, not new JS. Mirror the existing `.divergent` / `.tag.divergent` pair, using a shade between divergent's red (`#e03131`) and context_unverified's orange (`#f08c00`):
  ```css
  .disputed { border-color: #e8590c; }
  ```
  ```css
  .tag.disputed { color: #e8590c; }
  ```
  (Placed next to the existing `.divergent`/`.context_unverified` rules; exact hex is the implementer's call within the file's existing palette.)

**`src/web/audit.js`** (claim-record) — `formatAudit` prints `Context-unverified: N.` from `audit.contextUnverified`. Add a parallel `Disputed: N.` from the new `audit.disputed` field, placed right after it:
  ```js
  Context-unverified: ${audit.contextUnverified ?? 0}. Disputed: ${audit.disputed ?? 0}.
  ```

## What does not change

- `blocksNonHolding`'s decision logic (from the prior spec's redesign) is untouched — this change does not make detection better or worse; it only changes what an already-admitted unmarked contradiction/update looks like to a reader.
- The paraphrase false-negative is **not fixed** by this change. A paraphrase that evades `blocksNonHolding` is still admitted; it now renders as `disputed` instead of `divergent`, which is strictly more honest but still means the row exists at all. This is the accepted tradeoff, not an oversight — see Why.
- `discourse.ts`, retrieval, replay, and the field profile are untouched.
- Determinism: `unmarkedSpan`'s check is a pure function of `toDoc.text`/`toSpan`/`lexicon`, same as the pre-existing `corroborates`-only version; the `assay()`-twice-strictly-equal test is unaffected.

## Testing

- `receipts/src/assay/assemble.test.ts`: extend `rowStatus`'s existing test table with two new cases — `rowStatus("contradicts", { contextUnverified: true })` → `"disputed"`, and `rowStatus("updates", { contextUnverified: true })` → `"disputed"` (confirm the existing `rowStatus("contradicts")` / no-flag case still returns `"divergent"` unchanged).
- `receipts/src/assay/bookkeeper/admit.test.ts`: add one new case reusing the existing "off-topic acme statute" fixture's shape (an unmarked, genuinely uncontested contradiction) — assert the admitted relation now carries `contextUnverified: true` (it previously carried no such field for a `contradicts` proposal).
- `claim-record/src/instance/calibration/calibration.test.ts`: add the reviewer's own paraphrase reproduction as a new fixture and test — an unmarked sentence paraphrasing (not quoting) the claim, proposed `contradicts`, with a genuinely on-point holding (Tellabs) present in the pile. Assert it is **admitted** (matching today's, and this spec's, actual behavior — the paraphrase still evades `blocksNonHolding`) but with `assembled.rows[0]!.status === "disputed"`, not `"divergent"`. This is the regression test that makes the softening observable and keeps the known limitation from silently regressing further (e.g. a future change that makes `disputed` collapse back into `divergent`).
- `claim-record/src/narrator/narrate.test.ts`: extend (or mirror) the existing `divergent`-must-cite-both-sides test for `disputed`.
- Run the full suite in both repos after the engine change. Any test that currently asserts `status === "divergent"` (or a raw `AdmittedRelation` shape) for a fixture whose `to` span has discourse role `"unmarked"` (not `"holding"`) will need its expectation updated to `"disputed"` — this is intended fallout of the new, more accurate behavior, not a regression to work around. A test failing for any other reason is a real problem and must not be "fixed" by loosening its assertion.
- `npm run typecheck` in both repos: `RowStatus` gaining a member means every `Record<RowStatus, ...>` (the `HEADINGS` maps, both `STATUS_ORDER` maps) will fail to compile until the new key is added — this is the type system doing part of the completeness check for us, not an extra step to remember separately.
- `diff -rq receipts/src/assay claim-record/src/assay` empty after the sync.
- `npm run replay` on receipts' `main`/`reports/tesla-fsd.json`: checked directly against the real corpus and lexicon before writing the plan (not assumed) — all three of the ledger's current `divergent` rows (`FSD (Supervised) helps reduce collision rates`, `Tesla vehicles with FSD (Supervised) engaged exper[ience fewer collisions]`, and the May-2026-NHTSA `updates` row) have an independent span whose enclosing sentence is `discourseRole === "unmarked"` — none of them is a first-party "we tested/measured" holding under receipts' lexicon (`instance/profile.ts`'s `LEXICON.holding`). All three will flip to `disputed` once this change lands. A regeneration task is required: the same free, cache-only technique used for the two prior restamps this session (reconstruct the corpus via `runReplay`'s own path, re-run `admit()`/`assemble()` against the already-cached proposal responses, write the result back as the new `reports/tesla-fsd.json`). `npm run replay` must report the same `1 replayed, 3 not replayable` afterward, identical to itself; only the regenerated ledger's row statuses (not its row count or audit shape beyond the new counters) change.

## Out of scope

- Solving the underlying lexical indistinguishability between "an unrelated holding on the same broad subject" and "a paraphrased holding-backed contradiction" — investigated and rejected in Why; would need a non-lexical (e.g. model-scored) signal, a materially different kind of change from anything in this spec.
- Unifying the duplicated `STATUS_ORDER` (now in two files) or `SECTION_ORDER`/`HEADINGS` (now in three files) into one shared source of truth — pre-existing duplication, not introduced by this change, and a real refactor with its own blast radius.
- Any change to `blocksNonHolding`, `holdingCompetesWithClaim`, or `HOLDING_COMPETITOR_FLOOR` — those are exactly as landed in the prior spec.

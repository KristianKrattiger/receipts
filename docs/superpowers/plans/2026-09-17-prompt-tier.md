# Prompt Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Receipts a second, small-model proposer prompt, chosen explicitly on the command line, stamped on the manifest, and replayed under the same tier.

**Architecture:** The engine (`src/assay/`) is untouched. Receipts' profile becomes a function of a tier: `receipts("frontier" | "small")`. `--prompt-tier` selects it (default `small` with `--client ollama`), `analyzeLive` stamps it, `runReplay` resolves the profile through a tier → profile function and treats an absent tier as `frontier`. Claim/Record mirrors the function shape with one prompt for both tiers.

**Tech Stack:** TypeScript (strict, nodenext), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-prompt-tier-design.md` — read it first.

## Global Constraints

- `src/assay/` is not modified; `diff -rq receipts/src/assay claim-record/src/assay` stays empty.
- `receipts("frontier").system` is byte-identical to today's `RECEIPTS.system` (the Tesla cache keys on it; `npm run replay` stays `1 replayed, 3 not replayable`).
- `receipts("small")` and `receipts("frontier")` differ only in `system`.
- A manifest with no `tier` replays under `frontier`.
- Exact sentences: `receipts: --prompt-tier must be frontier or small`; `receipts: --prompt-tier picks the proposer prompt for a model call; this run makes none`; `receipts: <path> is not replayable: stamped under prompt tier "X", which this instance does not have`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (or the model that wrote it, truthfully).
- `npm run typecheck` and `npx vitest run` clean before every commit.

## File Structure

- `src/instance/prompt-small.ts` — `SMALL_SYSTEM`
- `src/instance/profile.ts` — `PromptTier`, `PROMPT_TIERS`, `receipts(tier)`; `RECEIPTS` removed; the frontier string stays here
- `src/instance/profile.test.ts` — property tests over both tiers; difference/equality test
- `src/analyze-live.ts` — `tier` option, stamped
- `src/assay/types.ts` — **not touched**; `ReplayManifest.tier` is added via a Receipts-side type extension in `src/types.ts` (see Task 2)
- `src/cli/replay.ts` — `runReplay(path, profileFor, deps)`; unknown-tier refusal
- `src/cli/args.ts`, `src/cli/index.ts`, `src/cli/replay-all.ts`, `src/pipeline.ts` — callers
- `README.md`, `architecture.md` — docs
- `claim-record/src/instance/profile.ts`, `run.ts` — mirror

---

### Task 1: `receipts(tier)` and the small prompt

**Files:**
- Create: `src/instance/prompt-small.ts`
- Modify: `src/instance/profile.ts`, `src/instance/profile.test.ts`, and every importer of `RECEIPTS`: `src/pipeline.ts:6,38`, `src/analyze-live.ts:5,104,110`, `src/cli/index.ts:8,157`, `src/cli/replay-all.ts:5,22`, `src/cli/replay.test.ts`, `src/instance/calibration/calibration.test.ts`, `src/instance/calibration/tesla-candidates.test.ts`

**Interfaces:**
- Produces: `export type PromptTier = "frontier" | "small"`; `export const PROMPT_TIERS: readonly PromptTier[]`; `export function receipts(tier: PromptTier): FieldProfile`; `export const SMALL_SYSTEM: string`.

- [ ] **Step 1: Failing tests**

Rewrite `src/instance/profile.test.ts` so every existing assertion runs for both tiers, and add the shape test:

```ts
import { describe, expect, it } from "vitest"
import { PROMPT_TIERS, receipts } from "./profile.js"

describe.each(PROMPT_TIERS)("the %s prompt: the confidence scale is defined, not left to the model", (tier) => {
  const system = receipts(tier).system
  // Six of thirteen low-confidence denials across the first three reports sat
  // within 0.1 of the floor, four at exactly 0.45. An undefined scale produces
  // a hedge, and the hedge was being read as a quality signal.
  it("says what the number measures", () => {
    expect(system).toMatch(/stand in the relation you are claiming|stands in the relation you claim/)
  })
  it("separates certainty about the relation from truth of the claim", () => {
    expect(system).toMatch(/not how likely the underlying claim is to be true|not whether the claim is true/)
  })
  // Telling the model its output is filtered invites it to aim at the gate.
  it("does not tell the model that low-confidence proposals are discarded", () => {
    expect(system).not.toContain("filtered out")
    expect(system).not.toMatch(/0\.5\b/)
  })
})

describe("receipts(tier)", () => {
  it("differs between tiers only in the system prompt", () => {
    const a = receipts("frontier")
    const b = receipts("small")
    expect(a.system).not.toBe(b.system)
    expect({ ...a, system: "" }).toEqual({ ...b, system: "" })
    expect(a.name).toBe("receipts")
  })
  it("keeps the frontier prompt byte-identical to the string Tesla's cache was keyed on", () => {
    expect(receipts("frontier").system.length).toBe(3574)
    expect(receipts("frontier").system.startsWith("You compare a vendor's own claims against independent reports about that vendor.")).toBe(true)
  })
  it("gives the small prompt the example the 7B model got wrong, and a tighter cap", () => {
    const s = receipts("small").system
    expect(s).toContain("7x\\nSafer\\nThan a Human Driver")
    expect(s).toMatch(/25 words/)
    expect(s.length).toBeLessThan(receipts("frontier").system.length / 2)
  })
})
```

Run: `npx vitest run src/instance/profile.test.ts` — Expected: FAIL, `receipts`/`PROMPT_TIERS` not exported.

- [ ] **Step 2: The small prompt**

`src/instance/prompt-small.ts`:

```ts
/**
 * The Receipts proposer prompt for a small local model. Same relation types,
 * same JSON shape, same rules as the frontier prompt -- said first, shorter,
 * with the example the 7B model got wrong. The engine's quote gate is 40
 * words; the cap here is 25 so a model that overshoots still clears it.
 */
export const SMALL_SYSTEM = `Rules, in order of importance:

1. Every "quote" is copied character-for-character from one excerpt. Do not fix
   typos, change whitespace, or trim punctuation. A quote that is not an exact
   substring of its excerpt is thrown away.
2. A quote is one line of prose, 25 words or fewer. Excerpts are page text, so a
   line break is a layout edge (a stat tile, a table cell, a heading). Never
   quote across one.
   Good: "When engaged and under your active supervision, your likelihood of
   being in a collision goes down."
   Bad: "7x\\nSafer\\nThan a Human Driver" -- three tiles of a graphic, not a
   sentence. Skip it and quote a prose sentence instead.
3. A quote stands on its own as a claim. "7x safer than a human driver", not
   "than a human driver". A bare number is not a claim.
4. "from" is always a claimant excerpt. "to" is an independent excerpt, or
   another claimant excerpt only when two of the vendor's own pages disagree
   with each other, or null for unsupported.

You compare a vendor's own claims against independent reports about that vendor.
Excerpts are tagged with a docId and a role: claimant (the vendor's own pages)
or independent (status pages, review sites, forums, filings by others).

Relation types:
  contradicts   an independent excerpt contradicts a vendor claim
  corroborates  an independent excerpt confirms a vendor claim
  updates       an independent excerpt reports a newer state than the claim
  unsupported   a specific, checkable vendor claim no excerpt corroborates ("to": null)

Confidence is how certain you are that the two quotes stand in the relation you
are claiming -- not whether the claim is true, and not how important it is.
  0.95  the quotes say opposing (or matching) things outright
  0.70  the relation holds, but depends on context around the quotes
  0.30  the quotes are about adjacent topics and the link is inference
Use values in between when they fit. Do not cluster on one number.

Return every relation you can support. Fewer exact quotes beat more loose ones.`
```

- [ ] **Step 3: `receipts(tier)`**

In `src/instance/profile.ts`: keep the frontier string exactly where it is but move it into a module-level `const FRONTIER_SYSTEM = \`...\`` (byte-identical; verify with the length test). Replace `export const RECEIPTS: FieldProfile = { name: "receipts", system: ..., lexicon: {...}, retrieval: {...} }` with:

```ts
import { SMALL_SYSTEM } from "./prompt-small.js"

export type PromptTier = "frontier" | "small"
export const PROMPT_TIERS: readonly PromptTier[] = ["frontier", "small"]

const SYSTEM: Record<PromptTier, string> = { frontier: FRONTIER_SYSTEM, small: SMALL_SYSTEM }

/**
 * Receipts' field profile for a proposer tier. Lexicon and retrieval are the
 * same either way; only the system prompt differs, and it is part of the
 * proposal cache key, so the two tiers never read each other's responses.
 */
export function receipts(tier: PromptTier): FieldProfile {
  return { name: "receipts", system: SYSTEM[tier], lexicon: LEXICON, retrieval: RETRIEVAL }
}
```

with `LEXICON` and `RETRIEVAL` as module-level constants holding today's values. Update the doc comment: the frontier string is the one the engine shipped until the profile existed.

- [ ] **Step 4: Callers**

Replace every `RECEIPTS` import/use with `receipts("frontier")` for now (Tasks 2–3 thread the real tier through `analyzeLive`, `runReplay`, and the CLI): `src/pipeline.ts`, `src/analyze-live.ts` (`profile: receipts("frontier").name` → simply `profile: "receipts"` is not allowed — keep it derived: `const PROFILE_NAME = receipts("frontier").name` at module top), `src/cli/index.ts`, `src/cli/replay-all.ts`, `src/cli/replay.test.ts`, both calibration tests.

- [ ] **Step 5: Run and commit**

`npm run typecheck && npx vitest run` — all pass. `npm run replay` → `1 replayed, 3 not replayable`.

```bash
git add -A && git commit -F - <<'EOF'
Receipts' profile takes a prompt tier; a small-model prompt is drafted.

receipts("frontier") is today's profile byte for byte; receipts("small")
differs only in the system string -- rules first, a third the length, the
stat-tile example the 7B model quoted twice, a 25-word cap under the
engine's 40, three confidence anchors. Nothing selects "small" yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The manifest records the tier; replay honours it

**Files:**
- Modify: `src/types.ts` (Receipts' `Report`/manifest types — find `replay?: ReplayManifest` at ~:119), `src/analyze-live.ts`, `src/cli/replay.ts`, `src/cli/replay-all.ts`, `src/cli/index.ts:157`
- Test: `src/analyze-live.test.ts`, `src/cli/replay.test.ts`

**Interfaces:**
- `AnalyzeLiveOpts.tier?: PromptTier` (default `"frontier"`); the manifest literal gains `tier`.
- `src/assay/types.ts` is not touched. Receipts records the tier by widening its own manifest type: in `src/types.ts`, `export type ReceiptsManifest = ReplayManifest & { tier?: PromptTier }` and `Report.replay?: ReceiptsManifest`. If `Report.replay` is typed directly as `ReplayManifest` from the engine, change only Receipts' alias.
- `runReplay(reportPath, profileFor: (tier: string) => FieldProfile | undefined, deps?)` — the second parameter becomes a resolver; the name check uses the resolved profile.
- **Typing without touching the engine.** `AssayResult.replay` and `Refusal.replay` are the engine's `ReplayManifest`, which has no `tier`. Build the manifest as a variable typed `ReceiptsManifest` and assign it (`const manifest: ReceiptsManifest = {...}; result.replay = manifest`) — an object literal assigned directly would fail TypeScript's excess-property check. Read it back through the alias: `(saved.replay as ReceiptsManifest).tier` in `replay.ts`, and `(out.result.replay as ReceiptsManifest | undefined)?.tier` in the analyze-live test. Export `ReceiptsManifest` from `src/types.ts`.

- [ ] **Step 1: Failing tests**

`src/analyze-live.test.ts`:

```ts
  it("stamps the prompt tier it was told to use, defaulting to frontier, and keys the cache per tier", async () => {
    const small = await analyzeLive(CORPUS, { client: stub, tier: "small", runs: 1, snapshotDir: snapDir, cacheDir })
    const frontier = await analyzeLive(CORPUS, { client: stub, runs: 1, snapshotDir: snapDir, cacheDir })
    expect(small.result.replay?.tier).toBe("small")
    expect(frontier.result.replay?.tier).toBe("frontier")
    expect(small.result.replay?.keys).not.toEqual(frontier.result.replay?.keys)
  })
```

`src/cli/replay.test.ts` — `makeReplayable` gains a `tier: PromptTier = "frontier"` parameter, uses `receipts(tier)` for the assay call and stamps `tier` on the manifest literal; every `runReplay(path, receipts("frontier"), deps)` becomes `runReplay(path, profileFor, deps)` where

```ts
const profileFor = (tier: string) => (PROMPT_TIERS as readonly string[]).includes(tier) ? receipts(tier as PromptTier) : undefined
```

Add:

```ts
  it("replays a small-tier ledger under the small prompt", async () => {
    const { path, deps } = await makeReplayable(CORPUS, "claude-opus-5", "small")
    const r = await runReplay(path, profileFor, deps)
    expect(r.identical).toBe(true)
    expect(r.replayed).toBeGreaterThan(0)
  })

  it("replays a ledger with no tier under frontier", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay: Record<string, unknown> }
    delete saved.replay["tier"]
    writeFileSync(path, JSON.stringify(saved))
    const r = await runReplay(path, profileFor, deps)
    expect(r.identical).toBe(true)
  })

  it("refuses a ledger stamped under a tier this instance does not have", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay: Record<string, unknown> }
    saved.replay["tier"] = "colossal"
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, profileFor, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: stamped under prompt tier "colossal", which this instance does not have`,
    )
  })
```

(The `makeReplayable(corpus, model, tier)` order: keep `model` second as it is today.) Run both files — Expected: FAIL on typing and on the refusal sentence.

- [ ] **Step 2: Implement**

`src/analyze-live.ts`: `tier?: PromptTier` on the options; `const tier = opts.tier ?? "frontier"`; `const profile = receipts(tier)`; pass `profile` to `analyzeCorpus` (it currently hard-codes `receipts("frontier")` in `pipeline.ts` — add a `profile?: FieldProfile` option to `analyzeCorpus` defaulting to `receipts("frontier")` and pass it through); both manifest literals gain `tier` and use `profile.name`.

`src/cli/replay.ts`:

```ts
export async function runReplay(
  reportPath: string,
  profileFor: (tier: string) => FieldProfile | undefined,
  deps: ReplayDeps = { ...unchanged... },
): Promise<ReplayOutcome> {
  ...after the no-profile check:
  const tier = saved.replay.tier ?? "frontier"
  const profile = profileFor(tier)
  if (!profile) {
    throw new Error(`receipts: ${reportPath} is not replayable: stamped under prompt tier "${tier}", which this instance does not have`)
  }
  if (saved.replay.profile !== profile.name) { ...unchanged... }
```

and the `assay(` call passes `profile`. `src/cli/replay-all.ts` and `src/cli/index.ts` pass a `profileFor` built from `PROMPT_TIERS`/`receipts` — put that one function in `src/instance/profile.ts` as `export function receiptsFor(tier: string): FieldProfile | undefined` and use it in all three places (tests included).

- [ ] **Step 3: Run and commit**

`npm run typecheck && npx vitest run` clean; `npm run replay` → `1 replayed, 3 not replayable` (the committed ledger has no `tier` → frontier).

```bash
git add -A && git commit -F - <<'EOF'
Stamp the prompt tier on the manifest; replay under the same one.

A manifest without a tier replays under frontier: it was the only prompt
that existed when those ledgers were stamped. A tier this instance does not
have is a refusal, not a guess.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `--prompt-tier` and docs

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/index.ts` (usage text, key check region, `analyzeLive` call), `README.md` (cost section paragraph on `--client ollama`; the Development block; the "Replaying a ledger" paragraph), `architecture.md` (the `src/instance/profile.ts` layout line)
- Test: `src/cli/args.test.ts`

- [ ] **Step 1: Failing tests** (`src/cli/args.test.ts`, next to the `--client` test)

```ts
  it("selects the prompt tier: frontier by default, small with --client ollama, explicit wins", () => {
    expect(parseArgs(["acme"]).promptTier).toBe("frontier")
    expect(parseArgs(["acme", "--client", "ollama"]).promptTier).toBe("small")
    expect(parseArgs(["acme", "--client", "ollama", "--prompt-tier", "frontier"]).promptTier).toBe("frontier")
    expect(parseArgs(["acme", "--prompt-tier", "small"]).promptTier).toBe("small")
    expect(() => parseArgs(["acme", "--prompt-tier", "huge"])).toThrow("receipts: --prompt-tier must be frontier or small")
    expect(() => parseArgs(["acme", "--replay", "r.json", "--prompt-tier", "small"]))
      .toThrow("receipts: --prompt-tier picks the proposer prompt for a model call; this run makes none")
  })
```

Every `toEqual({ subject: "acme", ... })` whole-object assertion in this file gains `promptTier: "frontier"`.

- [ ] **Step 2: Implement**

`args.ts`: `promptTier: PromptTier` on `CliOptions` (always present); `"--prompt-tier"` in `VALUE_FLAGS`; after the `--client` block:

```ts
  const rawTier = values.get("--prompt-tier")
  if (rawTier !== undefined) {
    if (rawTier !== "frontier" && rawTier !== "small") throw new Error("receipts: --prompt-tier must be frontier or small")
    if (replay !== undefined || render !== undefined || fetchOnly || (refresh !== undefined && !rerun)) {
      throw new Error("receipts: --prompt-tier picks the proposer prompt for a model call; this run makes none")
    }
  }
  const promptTier: PromptTier = rawTier ?? (rawClient === "ollama" ? "small" : "frontier")
```

and `promptTier` in the returned object. `index.ts`: usage text —

```
  --prompt-tier <tier>    proposer prompt: frontier (default) or small (default with
                          --client ollama). Stamped on the manifest; replay uses the same.
```

— and `analyzeLive(corpus, { ..., tier: opts.promptTier, ...proposer })`.

- [ ] **Step 3: Docs**

README cost section, after the `--client ollama` paragraph:

```markdown
`--prompt-tier small` (the default with `--client ollama`) sends the
small-model prompt in `src/instance/prompt-small.ts`: the same rules as the
frontier prompt, stated first and shorter, with the stat-tile example the
7B model got wrong. The tier is stamped on the manifest and replay uses the
same one. Whether it helps is measured, not assumed: run the same model over
the same fixture with `--prompt-tier frontier` and `--prompt-tier small` and
compare `ANCHOR_NOT_FOUND + INCOHERENT_QUOTE + QUOTE_TOO_LONG` on the two
audit lines. Not yet run; the committed Tesla ledger is the frontier prompt
on `qwen2.5:7b`.
```

"Replaying a ledger": one sentence — a manifest without `tier` replays under `frontier`, the only prompt that existed before 2026-09-17. `architecture.md` layout line for `src/instance/profile.ts`: "the field profile, by prompt tier (`frontier`, `small`)"; add `src/instance/prompt-small.ts`. Development block test count: whatever `npx vitest run` prints.

- [ ] **Step 4: Run and commit**

`npm run typecheck && npx vitest run` clean; `npm run replay` unchanged.

```bash
git add -A && git commit -F - <<'EOF'
--prompt-tier selects the proposer prompt; small is the default with --client ollama.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Claim/Record mirrors the shape

**Repo:** `claim-record`, branch `prompt-tier` off `master`.

**Files:** `src/instance/profile.ts`, `src/instance/run.ts`, `src/instance/calibration/calibration.test.ts`, `src/instance/run.test.ts`, `architecture.md`

- [ ] **Step 1: Failing test** — in `run.test.ts` (or a new `profile.test.ts`): `claimRecord("frontier")` and `claimRecord("small")` are `toEqual` (one prompt for both, for now) and `CLAIM_RECORD` is no longer exported. Run — FAIL.

- [ ] **Step 2: Implement** — `export type PromptTier = "frontier" | "small"`; `export function claimRecord(tier: PromptTier): FieldProfile` returning the same object for either tier, with a comment: "Claim/Record has one prompt; both tiers return it until a small-model prompt is written. The tier exists so the two instances present the same shape." `run.ts` passes `profile: claimRecord("frontier")`; calibration test uses `claimRecord("frontier").lexicon`. `architecture.md` layout line mentions the tier.

- [ ] **Step 3: Run and commit** — `npm run typecheck && npx vitest run` clean; `diff -rq src/assay ../receipts/src/assay` empty.

```bash
git add -A && git commit -F - <<'EOF'
Claim/Record's profile takes a prompt tier; one prompt serves both.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Review, merge, push

- [ ] Final whole-branch review on both branches; fix findings.
- [ ] Merge `prompt-tier` → `main` (receipts) and → `master` (claim-record), `--no-ff`; `diff -rq` of `src/assay/` empty; push both.

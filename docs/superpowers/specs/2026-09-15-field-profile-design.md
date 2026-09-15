# Field profile: a domain-neutral Assay engine

**Date:** 2026-09-15
**Status:** approved design, awaiting plan
**Repos:** `receipts` (engine of record + Receipts instance) and `claim-record` (Claim/Record instance). `src/assay/` stays byte-identical across both; the instance code is per repo.

## Why

The 2026-09-14 review of both repos found the same shape of defect three times: an engine default that suits one field instance and starves the other.

1. **Retrieval.** `retrieveQueryTerms` unions the subject with every token of every claimant document. For Claim/Record that rescues a thin subject (`10(b)` tokenizes to `10`, `b`). For Receipts it makes "Tesla FSD" 0.04% of the query mass: the 10-K's five candidate slots went to its cover page, signature page, and three financial tables — zero FSD-relevant chunks — and the README then attributed the vanished 10-K corroborations to the holding gate, which the audit shows fired zero times. Measured on the committed Tesla snapshots: current policy 16/40 FSD-relevant candidates, 0/5 for the 10-K; subject-only 25/40 and 3/5.
2. **End-pinning.** `capDoc` keeps each document's first and last chunk. On an opinion that is the caption and the disposition; on a web page it is nav chrome. 18 of Tesla's 40 slots are pinned boilerplate.
3. **Lexicon.** `discourseRole` tags `holding` from `we hold | held: | we conclude | we reverse`. Across 7,229 sentences of Tesla's independent sources there are zero holdings, so `corroborated` is structurally unreachable for Receipts and the README presents that as a finding about the corpus.

The engine also ships a default proposer system prompt that is vendor-vs-independent — Receipts' — with Claim/Record overriding it through `AssayOptions.system`. So the engine "knows" one domain in three places and the other instance patches around it.

## Decision

The engine knows no domain. Everything field-specific — prompt, lexicon, retrieval policy — arrives as one required value, the **field profile**, owned by the instance. The engine refuses to run without one. Both instances become peers.

Rejected alternatives, recorded so they are not re-litigated:

- *Engine keeps the legal lexicon as default; instances extend.* Smaller change, but the engine still "knows about" cert grants, and the default retrieval policy would still be one instance's.
- *Empty default profile.* A caller who forgets the profile gets a ledger that looks normal and never denies anything. Refusal is the safer failure.
- *Corpus-derived or proposer-suggested cues* (the bookkeeper "learning" holding markers from the pile or the model). Either makes `holding` mean "shares the claim's vocabulary" — which the relevance gate already measures — or makes the cue set differ between samples. The lexicon stays closed and extractive: a sentence is `holding` because it contains a fixed cue phrase, reproducible by anyone with the regex.

## The contract

```ts
export interface FieldProfile {
  /** Names this field in the replay manifest and error messages: "receipts", "claim-record". */
  name: string
  /** Proposer system prompt. Replaces AssayOptions.system. */
  system: string
  /**
   * Closed cue lists, one RegExp per role, tested against a trimmed sentence.
   * holding: the source itself commits to a finding. issue: poses one.
   * argument: reports someone else's position. A sentence ending in "?" is
   * `issue` in every field — that rule stays in the engine as structure, not
   * vocabulary.
   */
  lexicon: { holding: RegExp; issue: RegExp; argument: RegExp }
  retrieval: {
    /** "subject": the query subject alone ranks chunks. "subject+claimant": every claimant token joins the query. */
    queryTerms: "subject" | "subject+claimant"
    /** Keep each document's first and last chunk regardless of rank. */
    pinEnds: boolean
  }
}
```

Every field is required. A profile can express "no cues" only by writing a regex that matches nothing, and its name sits in the ledger's manifest saying who chose it. The type lives in `src/assay/types.ts`; the values live in each instance (`src/instance/profile.ts` in both repos) and reach the engine only as an argument. The isolation test's rule — nothing under `src/assay/` imports from outside it — is unchanged.

## Engine changes (`src/assay/`)

**Entry.** `AssayOptions.profile: FieldProfile`, required. `assay()` throws first thing without it: `assay: no field profile — the engine has no lexicon, prompt, or retrieval policy of its own`. `AssayOptions.system` is removed. `assayOnce` passes `profile.system` to `proposeAcrossPasses`; the `SYSTEM` constant in `cartographer/propose.ts` is deleted and `system` becomes a required input of the propose path.

**Retrieval** (`index.ts`). Query terms from `profile.retrieval.queryTerms`: `"subject"` → `tokenize(subject)`; `"subject+claimant"` → `retrieveQueryTerms(subject, claimantTexts)` as today. `selectCandidates` gains `pinEnds: boolean`; `capDoc` pins only when true, otherwise it is IDF rank with the existing start-offset tiebreak. Admission terms remain `tokenize(subject)` — the relevance gate is not a retrieval policy and the profile does not touch it.

**Discourse** (`bookkeeper/discourse.ts`). The `HOLDING`, `ISSUE`, `ARGUMENT` constants are deleted. `discourseRole(sentence, lexicon)` tests, in order: `lexicon.holding` → `holding`; `lexicon.issue` or trailing `?` → `issue`; `lexicon.argument` → `argument`; else `unmarked`. `admit()` takes the lexicon and threads it to `blocksNonHolding` and `unmarkedCorroboration`. `assemble` and `merge` are untouched.

**Replay manifest.** `ReplayManifest.profile: string`. `runReplay` takes the profile it will replay under and refuses when the names differ: `receipts: <path> is not replayable: stamped under profile "X", replaying under "Y"`. A manifest with no `profile` is refused like one with no `keys` (`generated before the field profile existed`), and `replay-all` counts it as not replayable. A profile whose contents changed under the same name is not detected by the manifest; the replay diff reports it as a finding, which is what the diff is for.

**What leaves the engine.** `src/assay/calibration/` moves to `claim-record/src/instance/calibration/`; it exercises the legal lexicon and belongs with it. Engine tests that call `assay`, `admit`, `discourseRole`, or `blocksNonHolding` use a test-local `src/assay/test-profile.ts` carrying a minimal legal-shaped lexicon (`we hold`, `granted certiorari`, `petitioner argues`), because the existing admit fixtures are written in that vocabulary. The isolation test additionally asserts that no non-test file under `src/assay/` imports `test-profile`.

**Determinism.** The profile is a value; the lexicon applies after the model; retrieval choices are in the request bytes and therefore in the cache key. The `assay()`-twice-strictly-equal test stays and runs with a profile.

## Instances

### Claim/Record (`claim-record/src/instance/profile.ts`, export `CLAIM_RECORD`)

- `system: CLAIM_RECORD_SYSTEM` (from `prompt.ts`)
- `lexicon`: the engine's three regexes moved verbatim, minus the trailing-`?` alternation of `ISSUE`, which the engine keeps as structure
- `retrieval: { queryTerms: "subject+claimant", pinEnds: true }`
- `run.ts` passes `profile: CLAIM_RECORD` and drops `system:`. The calibration corpus and tests move to `src/instance/calibration/` with only the import path and the profile argument changed. Behaviour is byte-identical to today; the only new observable is `profile: "claim-record"` on a stamped manifest.

### Receipts (`receipts/src/instance/profile.ts`, export `RECEIPTS`)

- `system`: the engine's current `SYSTEM` string, moved verbatim — Tesla's request bytes do not change on this account
- `retrieval: { queryTerms: "subject", pinEnds: false }` — the pre-2026-09-14 policy the measurement favours
- `lexicon`: a web/press cue list drafted in the plan for the owner's review, on the legal lexicon's principle — the source *itself* committing to a finding. Starting shape: `holding` = first-person test/measurement commitments (*we tested*, *our testing found*, *in our tests*, *we measured*, *we confirmed*, *we observed*); `issue` = nothing beyond the engine's `?` rule; `argument` = attributed hearsay (*critics argue*, *proponents claim*, *some say*, *reportedly*, *allegedly*, *according to*). It will be short and wrong in places; the calibration set below is how it gets corrected.
- Callers: `pipeline.ts` (fresh runs, `--refresh --rerun`, MCP and web via `analyzeLive`) and `cli/replay.ts` pass `RECEIPTS`; `cli/refresh.test.ts` and `cli/replay.test.ts` follow.

### Receipts calibration (`receipts/src/instance/calibration/`)

Canned web-shaped cases in the four classes, mirroring Claim/Record's: a true twin corroborated by an *"our testing found …"* sentence → `corroborated` (unreachable today); a false twin contradicted by one → `divergent`; an unmarked forum sentence with no competitor → `context_unverified`; the same sentence with a competing *"we measured …"* elsewhere in the pile → `HOLDING_COMPETITOR`. Plus an offline check over the committed Tesla snapshots: under `RECEIPTS`, at least one 10-K candidate contains "Full Self-Driving" or "driver assist". That is the test that would have caught the 2026-09-14 showcase before it was paid for.

## Restamp and documentation

Changing retrieval changes the request, so every Tesla cache key misses and `--replay` on the committed ledger refuses (no `profile` in its manifest) until it is restamped. The plan ends with an owner-triggered, paid `--refresh --rerun` on Tesla — Solari re-fetch, drift, two fresh samples — after which `npm run replay` must report it replayed under `profile: "receipts"`.

README and `architecture.md` in both repos describe the profile as the engine's only source of domain knowledge, list the two profiles, and say where the calibration sets live. Receipts' README rewrites its Tesla narrative from the *restamped* ledger and from the audit counters, not prose: what the gate denied (`issueStatementDenied`, `holdingCompetitorDenied`), how many candidates the 10-K received, and whether `corroborated` occurs now that the lexicon can fire. Until the restamp lands, the README states that the committed ledger predates the profile and is not replayable.

## Error handling

| Where | Condition | Behaviour |
|---|---|---|
| `assay()` | no `profile` | throw the sentence above; no model call |
| `runReplay` | manifest has no `profile` | refuse: `not replayable: no field profile recorded — generated before the profile existed` |
| `runReplay` | manifest `profile` ≠ supplied profile's `name` | refuse: `stamped under profile "X", replaying under "Y"` |
| `replay-all` | either refusal | counted as not replayable, exit 0 as today |
| `discourseRole` | lexicon regex has the `g` flag | not guarded; the profile is code reviewed like code. Noted, not handled. |

## Testing

- **Engine:** every existing test passes with the test-local profile; `assay()` without a profile throws the exact sentence; `discourseRole` with a match-nothing lexicon returns `unmarked` for everything except a trailing `?`; `selectCandidates` with `pinEnds: false` returns pure rank order (a doc whose first chunk scores 0 does not appear); `queryTerms: "subject"` ranks by subject alone (a claimant-vocabulary chunk with no subject term scores 0); replay refuses on missing and mismatched profile name; isolation test extended.
- **Claim/Record:** calibration suite passes unchanged at its new path; `run.test.ts` unchanged in assertions.
- **Receipts:** new calibration cases as listed; the Tesla 10-K candidate check; `pipeline.test.ts` / `refresh.test.ts` / `replay.test.ts` pass with `RECEIPTS`; the committed-ledger replay test is retargeted to the restamped ledger once it exists, and until then asserts the "no field profile recorded" refusal.
- **Both:** typecheck clean; `diff -rq` of `src/assay/` between the repos is empty.

## Out of scope

- The two-token overlap heuristic in `holdingCompetesWithClaim` (review finding D) — a separate design.
- Claim/Record's unescaped `innerHTML` sinks and the empty-subject test — a separate fix.
- Chunking policy (`preferNewline`) as a profile field. It changed on 2026-09-14 for both instances and neither has asked for it to differ.
- Detecting a changed profile *body* under an unchanged name.

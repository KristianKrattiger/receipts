# Prompt tier: a small-model prompt, chosen explicitly

**Date:** 2026-09-17
**Status:** approved design
**Repos:** `receipts` (all of it) and `claim-record` (one profile change). `src/assay/` is untouched.

## Why

The 2026-09-17 Tesla restamp ran `qwen2.5:7b` through the Receipts prompt written for Opus. Of sample 0's fourteen denials, eight were quoting mechanics — three `ANCHOR_NOT_FOUND`, three `INCOHERENT_QUOTE` (the `7x / Safer / Than a Human Driver` stat tile, twice), two `QUOTE_TOO_LONG` — where the Opus ledger's were all `LOW_CONFIDENCE` and `DUPLICATE`. The rules the small model broke are the ones the prompt states at length, after a long preamble, with a calibration essay. A prompt written for a small model says the same rules first, shorter, with an example.

A prompt that varies must vary *explicitly*. The field-profile spec made the prompt a byte-stable value the instance chooses and the cache keys on; a prompt inferred from the model would be a hidden default again.

## Decision

- **Two tiers, `"frontier"` and `"small"`, both strings on the instance.** The engine does not change: `FieldProfile.system` stays one string. Receipts' profile becomes `receipts(tier: PromptTier): FieldProfile` — the same `name`, `lexicon`, and `retrieval`, with the tier's system string. `RECEIPTS` (the constant) is removed; every caller says which tier it wants.
- **Chosen on the command line, recorded on the manifest.** `--prompt-tier frontier|small`. Default `small` when `--client ollama`, `frontier` otherwise. `analyzeLive` takes `tier` and stamps `ReplayManifest.tier`. `runReplay` replays under `receipts(saved.replay.tier ?? "frontier")`.
- **Absent `tier` means `frontier`.** Every ledger stamped before this change used the one prompt that existed, which is the `frontier` string byte for byte. This is stated, not inferred.
- **Claim/Record declares both tiers.** `claimRecord(tier)` returns its one prompt for either, with a comment saying it has no small-model prompt yet. Its `run.ts` passes `"frontier"`.

Rejected: inferring the tier from Ollama's `/api/show` parameter count (a silent default; a re-tagged model would change the prompt with no flag changing); lowering `--candidates` for the small tier (changes retrieval, so the two tiers' ledgers would differ in more than the prompt).

## The small prompt

`src/instance/prompt-small.ts`, exported `SMALL_SYSTEM`. Same four relation types, same JSON shape, same rule content as the frontier prompt. Differences, all of form:

- rules first, numbered, before the role description
- about a third the length
- one literal example pair: a good quote (a full prose sentence from an excerpt) and the bad one (`"7x\nSafer\nThan a Human Driver"`, three tiles of a graphic)
- a self-imposed cap of 25 words per quote, under the engine's 40
- three confidence anchors — 0.95 (the quotes say opposing or matching things outright), 0.7 (the relation holds with context around the quotes), 0.3 (adjacent topics, the link is inference) — in place of the calibration essay

The three prompt-property tests in `src/instance/profile.test.ts` (says what the number measures; separates relation certainty from claim truth; never mentions filtering or the threshold) run against both tiers.

## CLI

| Flag | Rule |
|---|---|
| `--prompt-tier frontier\|small` | value flag; any other value: `receipts: --prompt-tier must be frontier or small` |
| omitted | `small` if `--client ollama`, else `frontier` |
| with `--replay`, `--render`, `--fetch-only`, or `--refresh` without `--rerun` | `receipts: --prompt-tier picks the proposer prompt for a model call; this run makes none` |

The usage text documents the flag and the default. The manifest carries `tier`; `--replay` output is unchanged.

## Acceptance, and what is not tested

Whether the small prompt is *better* cannot be tested without a model. The acceptance procedure is documented in the README and run by the owner: same model, same fixture, `--prompt-tier frontier` and `--prompt-tier small`, compare `ANCHOR_NOT_FOUND + INCOHERENT_QUOTE + QUOTE_TOO_LONG` on the two audit lines. The README records the pair when it has been run. The committed Tesla ledger is not restamped by this change.

What is tested: the prompt-property tests on both tiers; `receipts("small").system !== receipts("frontier").system` and everything else on the profile equal; `--prompt-tier` parsing, default, and the two refusals; `analyzeLive` stamps the tier it was given and keys the cache differently per tier; `runReplay` replays a `small`-stamped ledger under the small prompt and a tier-less one under `frontier`.

## Error handling

| Where | Condition | Behaviour |
|---|---|---|
| `parseArgs` | bad value | throw the sentence above |
| `parseArgs` | tier on a no-model-call run | throw the sentence above |
| `runReplay` | manifest `tier` is a string the instance does not know | `receipts: <path> is not replayable: stamped under prompt tier "X", which this instance does not have` |

## Out of scope

- Anything under `src/assay/`.
- A Claim/Record small prompt.
- Restamping Tesla, or any automated proposer benchmark.

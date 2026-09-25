# Relation measure check: admit a relation only when both quotes measure the same thing

**Date:** 2026-09-25
**Status:** design, pending review
**Repos:** `receipts` (engine, CLI, eval script). `claim-record` is out of scope until this passes its bar here.

## Why

On 2026-09-25 every admitted row from four ledgers was hand-labeled blind: fresh SEAR-proposer runs (GIN's copy-only Qwen2.5-7B sidecar, `--client sear`) on `fixtures/tesla-fsd.json` and `fixtures/vercel.json`, pooled and shuffled with the committed frontier ledgers `reports/tesla-fsd.json` and `reports/vercel.json`. The labeler saw only the two quotes, their sources and the proposed relation, never which proposer wrote the row.

| Proposer · subject | Rows | Holds | No relation |
|---|---|---|---|
| SEAR · Tesla FSD | 11 | 0 | 11 |
| SEAR · Vercel | 10 | 0 | 10 |
| Frontier · Tesla FSD | 4 | 0 | 4 |
| Frontier · Vercel | 10 | 9 | 1 |

All 9 rows that hold are `unsupported` rows. **Of 26 relational rows (`contradicts`, `corroborates`, `updates`) across both proposers, none holds.** "Wrong relation" was never used: every failure was two quotes that do not speak to each other at all.

The labeler's rationales split the failures in two:

- **Junk quote** (16 rows, 15 of them SEAR): one side is not a usable statement — a pricing-table cell ("100 GB / month included"), a sentence cut at a chunk edge, a legal fragment ("Tesla opposed the motion."), an off-topic forum post. Out of scope here: a mechanical fix to `isCoherentQuote` and the chunker, tracked separately.
- **Topic only** (10 rows, 4 of the 5 frontier failures): both quotes are real statements about the subject, but one cannot bear on the other. The rationales apply one test throughout — **the two quotes must measure the same property, at a comparable scope**:
  - interventions every 13 miles measure driver takeovers, not collisions;
  - one crash, or robotaxi incidents in one city, cannot contradict a fleet-wide collision rate;
  - a critique of the name "Full Self-Driving" says nothing about camera hardware;
  - an SAE Level 2 classification does not change a list of standard safety equipment;
  - a security breach does not alter a claim about security features.

Every one of these rows passed every existing gate. `NOT_QUERY_RELEVANT` checks that each side is about the subject; nothing checks that the sides are about the *same thing*.

A lexical discriminator is ruled out by precedent: `2026-09-24-disputed-status-design.md` found that no bag-of-words signal separates "the same question, reworded" from "a different question on the same statute", and topic-only pairs are that second case by construction.

## Decision

A **verifier** — one frontier-model call per surviving relational proposal — judges whether the claim and the evidence measure the same property at a comparable scope. A proposal that fails is denied with a new code, `NOT_SAME_MEASURE`. `unsupported` proposals are never verified.

The check decides only whether the quotes bear on each other. Whether the proposed relation *type* is right is out of scope: the labels contain no such failure.

## Design

### Where it sits

`admit()` today runs, per proposal, a chain of gates (`LOW_CONFIDENCE`, `DOC_UNKNOWN`, `FROM_NOT_CLAIMANT`, anchoring, `SELF_PAIR`, `TO_NOT_INDEPENDENT`, `SELF_SOURCED`, `blocksNonHolding`, `NOT_QUERY_RELEVANT`) and then, in the same loop, duplicate detection and admission. The verifier must run **before** duplicate detection: a bad row admitted first and removed afterwards would already have blocked a later good row with the same claim as `DUPLICATE`.

Every gate up to and including `NOT_QUERY_RELEVANT` depends only on its own proposal, so `admit()` splits cleanly into two steps without changing behaviour:

1. `screen(proposal, ctx)` — pure and synchronous: the existing per-proposal gates. Returns the anchored sides (`fromSpan`, optional `toDoc`/`toSpan`) or a denial.
2. `admitScreened(screened, ctx)` — the existing duplicate-detection and admission loop, unchanged apart from taking screened proposals.

`admit()` remains, defined as `admitScreened(proposals.map(screen))`, so every existing caller and test is untouched.

A new asynchronous step runs between them in `assayOnce` (`src/assay/index.ts`):

```
screen (sync)  →  verifyMeasures (async, relational only)  →  admitScreened (sync)
```

`verifyMeasures(screened, verifier)` returns the screened list with each failing relational proposal replaced by its denial. Order is preserved.

### What the verifier sees

The claimant quote, the independent quote, and the proposed relation. Nothing else: not the proposer's `topic`, `statement` or `rationale` (so a persuasive rationale cannot carry a weak pairing), and not document labels or URLs. This matches what the labeler judged on.

### What it returns

A structured verdict (zod schema, `output_format` as the proposer uses):

```ts
{
  claim_property: string      // what the claim asserts, e.g. "collision rate of cars with active safety features"
  claim_scope: string         // e.g. "Tesla's whole consumer fleet"
  evidence_property: string   // e.g. "miles between driver interventions"
  evidence_scope: string      // e.g. "one reviewer's FSD test drives"
  same_property: boolean
  comparable_scope: boolean
}
```

Admitted only if `same_property && comparable_scope`. Otherwise `NOT_SAME_MEASURE`, with detail `"<claim_property> (<claim_scope>) vs <evidence_property> (<evidence_scope>)"`, so every denial is explainable in the audit.

### Prompt, and keeping the test set clean

The system prompt states the rule in general terms — the evidence bears on the claim only if it measures the same property, at a scope from which a conclusion about the claim follows; sharing a subject or a topic is not enough. It contains **no example drawn from the labeled rows and none of the labeler's rationales**, verbatim or paraphrased. The eval below would otherwise measure recall of its own examples. Illustrations, if any, come from subjects outside the labeled set.

### Model, caching, replay

- **Model:** the frontier Anthropic model (`MODEL` in `src/cartographer/anthropic.ts`), through the same parse-shaped `SdkProposalClient`, **independent of `--client`**. A SEAR or Ollama run proposes locally and still verifies with the frontier model.
- **Cache:** verifier calls go through the existing proposal cache (`src/provenance/proposal-cache.ts`), keyed on the canonical request body like any proposal. Their keys are recorded in the manifest's `keys` in call order, after the proposal keys of the same sample. Calls are made in proposal-id order, so the order is deterministic.
- **Replay:** `--replay` serves verifier responses from the cache like proposals. A verifier cache miss makes the report not replayable, as a missing proposal entry does today. Reports made before this check have no verifier keys and replay unchanged.
- **Opt out:** `--no-relation-check` skips the step. It is stamped on the manifest (`relationCheck: false`) and the ledger footer says "relations not verified", so an unchecked ledger cannot pass for a checked one. With the check on, `ANTHROPIC_API_KEY` is required even with `--client sear|ollama`; the CLI exits naming the flag otherwise.

### Error handling

- A verifier call that throws, is refused (`stop_reason: "refusal"`), or returns output failing the verdict schema denies that proposal with **`RELATION_UNVERIFIED`**, detail `refused`, `schema`, or the error message. Fail closed, like every other gate.
- If **every** verifier call in a sample fails, the sample throws — our outage, not a finding — mirroring "every proposal pass failed".
- `NOT_SAME_MEASURE` and `RELATION_UNVERIFIED` join `DenialCode` in `src/assay/types.ts`, and the audit summary line counts them like the others. Both are reached only after both quotes anchored, so both count toward `anchoredCount`; neither joins `NOT_ANCHORING_EVIDENCE` in `src/assay/assemble.ts`.

## Measurement: the bar before the check is on by default

The labeled set is committed as `fixtures/relation-labels.json`: for each row, the two quotes, their sources, the proposed relation, and the labeler's verdict. No proposer identity. It holds the 26 relational negatives above, plus the relational rows of the committed `reports/claude.json` (6) and `reports/chime.json` (4) once labeled — those are the positives the current set lacks.

`npm run relation-eval` runs the real verifier over the set and reports counts against the bar:

- **Negatives:** denies at least **21 of 26** (80%).
- **Positives:** admits at least **80%** of the rows labeled as holding.
- **Stability:** a second full run agrees with the first on at least **90%** of verdicts.

If the check passes, it ships on by default. If it misses, it ships **off** by default behind `--relation-check`, and the numbers are recorded in a Results section of this spec. An earlier model-judge sweep (GIN's framing work, 7B through Opus) failed its bar; this spec does not assume the verifier passes.

## Testing

Unit tests make no live model calls.

1. **Refactor equivalence:** `admitScreened(proposals.map(screen))` reproduces `admit()` on the whole existing `admit.test.ts` suite.
2. **`verifyMeasures` with a fake verifier:** both booleans true → admitted; either false → `NOT_SAME_MEASURE` with both properties in the detail; refusal, schema mismatch, thrown error → `RELATION_UNVERIFIED`; every call failing → throws; `unsupported` proposals never reach the verifier.
3. **Ordering:** a proposal the verifier denies does not block a later proposal with the same claim and type from being admitted.
4. **Isolation:** the verifier request body contains the two quotes and the relation and no `topic`, `statement`, `rationale`, document label or URL.
5. **Cache and replay:** verifier keys land in the manifest after the sample's proposal keys, in proposal-id order; a replay served from the cache rebuilds an identical ledger.
6. **CLI:** `--no-relation-check` is stamped on the manifest and shown in the footer; a checked run without `ANTHROPIC_API_KEY` exits with a message naming the flag, including under `--client sear` and `--client ollama`.
7. **Eval script:** reads `fixtures/relation-labels.json` and reports the three bar numbers; tested with a fake verifier.

## Out of scope

- Junk quotes: table cells and fragments in `isCoherentQuote`; chunks cut mid-word or mid-sentence in `src/assay/chunk/chunk.ts` (tracked separately).
- Judging whether the relation type is correct.
- `claim-record`'s engine copy.
- A local verifier model. Revisit only if the frontier verifier passes its bar and local-only runs matter.

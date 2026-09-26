# Relation measure check: admit a relation only when both quotes measure the same thing

**Date:** 2026-09-25
**Status:** design, pending review
**Repos:** `receipts` (engine, CLI, eval script). `claim-record` is out of scope until this passes its bar here.

## Why

On 2026-09-25 every admitted row from four ledgers was hand-labeled blind: fresh SEAR-proposer runs (GIN's copy-only Qwen2.5-7B sidecar, driven from a SEAR client that is not on this branch) on `fixtures/tesla-fsd.json` and `fixtures/vercel.json`, pooled and shuffled with the committed frontier ledgers `reports/tesla-fsd.json` and `reports/vercel.json`. The labeler saw only the two quotes, their sources and the proposed relation, never which proposer wrote the row.

| Proposer · subject | Rows | Holds | No relation |
|---|---|---|---|
| SEAR · Tesla FSD | 11 | 0 | 11 |
| SEAR · Vercel | 10 | 0 | 10 |
| Frontier · Tesla FSD | 4 | 0 | 4 |
| Frontier · Vercel | 10 | 9 | 1 |

All 9 rows that hold are `unsupported` rows. **Of 26 relational rows (`contradicts`, `corroborates`, `updates`) across both proposers, none holds.** Every failure was two quotes that do not speak to each other at all.

A second round added the relational rows of the committed frontier ledgers `reports/claude.json` (6) and `reports/chime.json` (4), to find rows that should pass:

| Subject | Rows | Holds | Wrong relation | No relation |
|---|---|---|---|---|
| Claude | 6 | 1 | 2 | 3 |
| Chime | 4 | 2 | 1 | 1 |

So across 36 relational rows: 3 hold, 3 have the wrong relation type, 30 are no relation.

The labeler's rationales split the no-relation failures in two:

- **Junk quote** (16 rows, 15 of them SEAR): one side is not a usable statement — a pricing-table cell ("100 GB / month included"), a sentence cut at a chunk edge, a legal fragment ("Tesla opposed the motion."), an off-topic forum post. Out of scope here: a mechanical fix to `isCoherentQuote` and the chunker, tracked separately.
- **Topic only** (14 rows, 8 of the 9 frontier failures): both quotes are real statements about the subject, but one cannot bear on the other. The rationales apply one test throughout — **the two quotes must measure the same property, at a scope from which a conclusion about the claim follows**:
  - interventions every 13 miles measure driver takeovers, not collisions;
  - one crash, or robotaxi incidents in one city, cannot contradict a fleet-wide collision rate;
  - a critique of the name "Full Self-Driving" says nothing about camera hardware;
  - an SAE Level 2 classification does not change a list of standard safety equipment;
  - a security breach does not alter a claim about security features;
  - an account outage does not speak to priority access at peak times; an incident report on a model does not speak to a recommendation to use it.

Scope is not size. One user reproducing Redis and SQLite with Claude Code was labeled as corroborating "expert-level collaboration … from coding a product": a single case can show a capability exists. A single crash was labeled as unable to contradict a fleet-wide collision rate: a single case cannot move a rate. The verifier has to make that distinction, not compare magnitudes.

Every one of these rows passed every existing gate. `NOT_QUERY_RELEVANT` checks that each side is about the subject; nothing checks that the sides are about the *same thing*.

A lexical discriminator is ruled out by precedent: `2026-09-24-disputed-status-design.md` found that no bag-of-words signal separates "the same question, reworded" from "a different question on the same statute", and topic-only pairs are that second case by construction.

## Decision

A **verifier** — one frontier-model call per surviving relational proposal — judges whether the claim and the evidence measure the same property at a comparable scope. A proposal that fails is denied with a new code, `NOT_SAME_MEASURE`. `unsupported` proposals are never verified.

The check decides only whether the quotes bear on each other. Whether the proposed relation *type* is right is out of scope here, although the labels show it fails too: two Claude rows proposed as `contradicts` were labeled `updates` (another model beating Claude on one benchmark qualifies "top-tier" and "use it for demanding reasoning" without refuting either). The check must admit those two rows — the quotes do bear on each other — and a type check is a follow-up.

One more failure is not about measurement at all: a Chime row whose "independent" quote is word for word the claimant's own sentence, republished on another site. Its quotes measure the same thing, so the check admits it; it is an independence failure, excluded from this check's bar and listed under follow-ups.

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

- **Model:** the frontier Anthropic model (`MODEL` in `src/cartographer/anthropic.ts`), through the same parse-shaped `SdkProposalClient`, **independent of `--client`**. An Ollama run proposes locally and still verifies with the frontier model.
- **Cache:** verifier calls go through the existing proposal cache (`src/provenance/proposal-cache.ts`), keyed on the canonical request body like any proposal, through their **own** cache wrapper around the Anthropic client — the proposer's wrapper may wrap an Ollama client. One wrapper at `sample: 0` serves both samples of a `--runs 2` run, so a pair both samples propose is verified once. Its keys are stamped separately on the manifest: `relationCheck: { model, keys }`. Cache keys are content hashes and replay serves whatever key a request hashes to, so the order of verifier calls (run with the same concurrency as proposal passes) does not affect replay.
- **Replay:** a manifest carrying `relationCheck` is replayed with a cache-only verifier for that model. A verifier cache miss makes the report not replayable, as a missing proposal entry does today. Reports made before this check carry no `relationCheck` and replay without a verifier, unchanged.
- **Stamp on the report:** a checked ledger carries `audit.relationCheck: true`. A ledger with relational rows and no such stamp renders the footer line "relations not verified", so an unchecked ledger cannot pass for a checked one. The stamp is absent, never `false`, on unchecked runs, so every report made before this check keeps an identical replay.
- **Flags:** `--relation-check` turns the step on and `--no-relation-check` turns it off; the default is the constant `RELATION_CHECK_DEFAULT`, set by the measurement below. With the check on, `ANTHROPIC_API_KEY` is required even with `--client ollama`; the CLI exits naming `--no-relation-check` otherwise.

### Error handling

- A verifier call that throws, is refused (`stop_reason: "refusal"`), or returns output failing the verdict schema denies that proposal with **`RELATION_UNVERIFIED`**, detail `refused`, `schema`, or the error message. Fail closed, like every other gate.
- If **every** verifier call in a sample fails, the sample throws — our outage, not a finding — mirroring "every proposal pass failed".
- `NOT_SAME_MEASURE` and `RELATION_UNVERIFIED` join `DenialCode` in `src/assay/types.ts`, and the audit summary line counts them like the others. Both are reached only after both quotes anchored, so both count toward `anchoredCount`; neither joins `NOT_ANCHORING_EVIDENCE` in `src/assay/assemble.ts`.

## Measurement: the bar before the check is on by default

The labeled set is committed as `fixtures/relation-labels.json`: for each of the 36 relational rows, the two quotes, their sources, the proposed relation, the labeler's verdict and note. No proposer identity. The eval reads it as:

- **Must deny (30):** every row labeled no relation.
- **Must admit (5):** the 3 rows that hold and the 2 wrong-type rows whose quotes bear on each other (`contradicts` labeled `updates`).
- **Excluded (1):** the Chime row whose independent quote is the claimant's own sentence — an independence failure this check is not designed to catch.

`npm run relation-eval` runs the real verifier over the set and reports counts against the bar:

- **Negatives:** denies at least **24 of 30** (80%).
- **Positives:** admits at least **4 of 5**. Five positives is thin; a pass here is necessary, not sufficient, and more positives are the first thing to add as ledgers get labeled.
- **Stability:** a second full run agrees with the first on at least **90%** of verdicts.

A row whose verifier call fails (throws, is refused, or fails the schema) is reported as **unverified**, by id and count, and is not counted as a denial or an admission: it is a miss against whichever bar it belongs to, and the rest of the run carries on.

**This is an in-sample fit, not a held-out estimate.** The prompt's scope rule ("a single case can show that something exists … cannot establish a rate, an average, a trend or a claim about a whole population") was generalised from the labeler's rationales on these same 36 rows. The prompt quotes none of their wording, but the rule was shaped by them, so a pass on this set says the rule fits the cases it was drawn from, not how often it is right on rows it has not seen. The positives are also thinner than five: two of them are the same Downdetector "Chime is a fintech" pairing, so the positives amount to about four independent cases. A pass may still turn the check on by default — it is the best evidence available and the check fails closed — but the result must be re-measured on a held-out labeled set, drawn from ledgers labeled after this prompt was written, before it is relied on as an accuracy figure.

If the check passes, it ships on by default. If it misses, it ships **off** by default behind `--relation-check`, and the numbers are recorded in a Results section of this spec. An earlier model-judge sweep (GIN's framing work, 7B through Opus) failed its bar; this spec does not assume the verifier passes.

## Testing

Unit tests make no live model calls.

1. **Refactor equivalence:** `admitScreened(proposals.map(screen))` reproduces `admit()` on the whole existing `admit.test.ts` suite.
2. **`verifyMeasures` with a fake verifier:** both booleans true → admitted; either false → `NOT_SAME_MEASURE` with both properties in the detail; refusal, schema mismatch, thrown error → `RELATION_UNVERIFIED`; every call failing → throws; `unsupported` proposals never reach the verifier.
3. **Ordering:** a proposal the verifier denies does not block a later proposal with the same claim and type from being admitted.
4. **Isolation:** the verifier request body contains the two quotes and the relation and no `topic`, `statement`, `rationale`, document label or URL.
5. **Cache and replay:** a checked run stamps `relationCheck: { model, keys }` on the manifest; a replay served from the cache rebuilds an identical ledger; a manifest without `relationCheck` replays with no verifier.
6. **CLI and footer:** `--relation-check` / `--no-relation-check` parse and conflict; an unchecked ledger with relational rows renders "relations not verified"; a checked run without `ANTHROPIC_API_KEY` exits with a message naming `--no-relation-check`, including under `--client ollama`.
7. **Eval script:** reads `fixtures/relation-labels.json` and reports the three bar numbers; tested with a fake verifier.

## Out of scope

- Junk quotes: table cells and fragments in `isCoherentQuote`; chunks cut mid-word or mid-sentence in `src/assay/chunk/chunk.ts` (tracked separately).
- Judging whether the relation type is correct (2 of 5 bearing pairs labeled with the wrong type; a follow-up).
- An independent quote identical to the claimant's (after the same normalisation `admit.ts` uses for its text-duplicate key): a mechanical independence gate, a follow-up.
- `claim-record`'s engine copy.
- A local verifier model. Revisit only if the frontier verifier passes its bar and local-only runs matter.

# A SEAR-constrained local proposer for Receipts

**Date:** 2026-09-25
**Status:** approved design
**Repos:** `gin` (new sidecar service, reusing `sear/` unchanged), `receipts` (new client, one additive engine field, CLI flag), `claim-record` (engine sync only).

## Why

The committed Tesla showcase got thin because its proposer was downgraded, not because the engine regressed. Until 2026-09-16 `reports/tesla-fsd.json` was a `claude-opus-5` run (18 rows: 4 divergent, 8 unverified, 6 context_unverified). Commit `c62f612` restamped it with local `qwen2.5:7b` (5 rows); this week's engine changes trimmed that to 4. Restoring the showcase is a paid frontier run — an operational step, sequenced first, not part of this spec.

This spec is the second track: make local models produce stronger ledgers. The weakest part of a local run is quoting. Five of the current Tesla ledger's eleven denials are the model failing to reproduce source text faithfully (`ANCHOR_NOT_FOUND` ×3, `QUOTE_TOO_LONG`, `INCOHERENT_QUOTE`), and two more are side-role mistakes (`FROM_NOT_CLAIMANT` ×2). Every one of those is a proposal the model paid for and the gate threw away.

GIN already solves this for its own nodes. SEAR (`gin/sear/processor.py`, `ExtractiveCopyConstraint`) is a llama.cpp logits processor that tracks live `(doc, position)` cursors into a tokenized corpus and masks every token that is not a valid continuation to `-1e30`: an ungrounded quote is unreachable, not caught afterward. GIN_14 §8 already names the architecture this spec builds — SEAR and the Assay's post-hoc gate enforce one contract ("no claim without a span") at two enforcement points: SEAR where the model can be opened up, post-hoc where it cannot, chosen per query. Receipts today uses only the post-hoc point, even on local models it could open.

A cheaper alternative was probed first and set aside by the owner in favour of going straight to SEAR: Ollama's JSON-schema `format` grammar does enforce an `enum` of exact sentences at decode time (24/24 quotes exact across four runs, including three where the prompt explicitly instructed paraphrasing; a ~300-sentence enum cost nothing measurable). That result de-risks decode-time enforcement in general; it is not the mechanism chosen here.

## Decision

A SEAR-constrained proposer, running as a local HTTP sidecar in the `gin` repo, speaking Receipts' existing proposal contract. Receipts gains a `searClient()` beside `ollamaClient()` and a `--client sear` CLI option. The frontier path (Anthropic, post-hoc `admit()` only) is unchanged. `admit()` still runs on the SEAR path too — a second check, not the enforcement.

### Slot-by-slot decoding, not one JSON stream

GIN drives SEAR as one free-form stream (extracts, connectives, `[n]` cites). Receipts needs structured `RelationProposal` objects, and SEAR has no structured-output mode. One combined processor switching between a JSON grammar and copy mode inside quote strings was considered and rejected: corpus text containing `"` or `\` must be JSON-escaped, so a copy cursor over raw corpus tokens and the escaped JSON output disagree token for token.

Instead the sidecar drives the structure in Python and runs a short constrained decode per field, appending each slot's output to a growing assistant-turn scaffold so llama.cpp reuses the KV cache for the shared prefix (the excerpts are evaluated once per pass):

| Order | Slot | Constraint |
|---|---|---|
| 1 | `from.quote` | `ExtractiveCopyConstraint`, `focus_doc_indices` = claimant lines, `stop_after_first_extract=True` |
| 2 | `type` | `ChoiceConstraint`: `contradicts \| corroborates \| updates \| unsupported` |
| 3 | `to.quote` (skipped when `type` is `unsupported`) | `ExtractiveCopyConstraint`, `focus_doc_indices` = independent lines, `stop_after_first_extract=True` |
| 4 | `topic` | one line (stop at newline), capped length |
| 5 | `statement` | one line (stop at newline), capped length |
| 6 | `rationale` | one line (stop at newline), capped length |
| 7 | `confidence` | `ChoiceConstraint`: `0.05`, `0.10`, … `1.00` |
| 8 | continue? | `ChoiceConstraint`: `yes \| no`; after a per-pass cap, not asked |

`ChoiceConstraint` is a small logits processor in the same style as SEAR's (allow exactly one of a fixed set of token sequences, then EOS), used instead of llama.cpp's GBNF grammar so every constrained slot runs through the same logits-processor path — and so a word-level stand-in model can exercise all of them in tests without a GGUF.

Every constrained slot's prompt is counted the way llama.cpp's `create_completion` counts it — `tokenize(prompt, add_bos=True, special=True)`, since a chat template's control tokens are single special tokens — and a guard fails the decode loudly if the processor's first call sees a different length. SEAR treats every input id past `prompt_len` as generated, so an off-by-one would otherwise misattribute a quote silently.

`from` is chosen before `type` so the model decides a claim is `unsupported` before it is asked for evidence, rather than being forced to produce a `to` quote and then discard it.

Every constraint option this uses already exists in `ExtractiveCopyConstraint`: `focus_doc_indices`, `stop_after_first_extract`, `span_must_start_at_sentence`, `span_must_close_at_sentence_end`, `forbidden_starts`, `min_span_len`. **SEAR's processor and corpus modules are not modified.**

**`docId` is not generated.** It is read off the closed span's `Segment.sources` and mapped back to the Receipts `docId` of the line it came from, so the model cannot mislabel which document a quote is from. `FROM_NOT_CLAIMANT` and `TO_NOT_INDEPENDENT` become unreachable because each quote slot's focus set contains only lines of the right role. `SELF_PAIR` becomes unreachable for the same reason (claimant and independent lines are disjoint).

### Span rules

The sidecar builds a SEAR `Corpus` in which **each SEAR doc is one line of one candidate chunk** (`Corpus.from_chunks` over `(f"{docId}#{chunkIndex}:{lineIndex}", lineText)` pairs, blank lines dropped), with a side table mapping each SEAR doc index back to its Receipts `docId` and role.

- A span can never cross a line break, so `INCOHERENT_QUOTE` (layout-edge stitching) is unreachable by construction.
- `span_must_start_at_sentence=True`: a quote carries its subject, not a fragment like "than a human driver".
- `span_must_close_at_sentence_end=True` (a SEAR doc's last token counts as a sentence end, per `_cursor_at_sentence_end`).
- `forbidden_starts` = the start position of every sentence longer than 40 words, so `QUOTE_TOO_LONG` is unreachable.
- `min_span_len=4` tokens.

Quotes are therefore whole sentences within a line. That is a deliberate narrowing of SEAR's free spans, chosen because Receipts' own rules already require a quote to be a self-standing claim. Loosening to clause-level spans later is a configuration change, not a redesign.

Each quote's text is `detokenize(segment.token_ids).strip()`. Because the tokens are a contiguous slice of that line's own tokenization, the result is a substring of the line, which is a substring of the chunk, which `admit()`'s `findAnchor` locates in the pinned document.

### Sampling

The sidecar samples, it does not decode greedily. Receipts' two-sample provenance (`RowProvenance.class`: `stable` only when both samples produce the row) means something only if samples can differ; GIN's own scripts run SEAR at `temperature=0.0`, which would make both samples identical and mark every row `stable`. The sidecar samples at a configured temperature, default `0.8` (Ollama's default, so the provenance signal means the same thing on both local paths), with no pinned seed. Replay never re-runs the model — it reads the proposal cache — so live-run randomness does not affect reproducibility.

## Engine change (`src/assay/`, both repos)

`ProposalClient.propose`'s input gains one optional field, the structured form of the excerpts the prompt already contains:

```ts
export type ProposeExcerpt = { docId: string; role: SourceRole; label: string; text: string }

export interface ProposalClient {
  propose(input: { system: string; user: string; excerpts?: ProposeExcerpt[] }): Promise<{ ... }>
}
```

`proposeRelations` fills it with one entry per candidate chunk, in the same order `buildExcerpts` renders them. It is additive and optional: every existing client (`toAssayClient`, Claim/Record's `anthropic.ts` and `ollama.ts`, test stubs) ignores it and keeps compiling. This is an `src/assay/` change, so it is synced to Claim/Record byte-identically, as every engine change is.

The alternative — having the sidecar re-parse excerpts out of the prompt's `--- docId: … | role: … | source: …` header lines — was rejected: chunk text is scraped web content, and a page containing a header-shaped line would be misparsed as a new excerpt with a spoofed role.

## Receipts changes

**`src/cartographer/anthropic.ts` — `toAssayClient`** carries the excerpts into the parse body exactly when the model id starts with `sear/` (`SEAR_MODEL_PREFIX`). `toAssayClient` is constructed inside `analyzeLive` and inside `replay.ts`, never by the CLI, so keying the behaviour on the model id — which the manifest already stamps — makes a SEAR ledger replay with the same bodies it was recorded with, with no flag to thread through either. For any other model id — the Anthropic and Ollama paths — the body is **byte-identical to today**. `npm run replay` is what actually enforces that: the committed Tesla ledger replays only if every request body hashes to an existing cache key, so any stray field would turn replay into cache misses. (`anthropic.test.ts` checks individual body fields, not the exact key set, so a new test asserts the key set directly.) Because `withProposalCache` hashes the whole parse body, SEAR cache entries key on the excerpts and on the SEAR model id automatically; they can never collide with Anthropic or Ollama entries.

**`src/cartographer/sear.ts` — `searClient()`**, an `SdkProposalClient` like `ollamaClient()`:
- POSTs `{ model, system, messages, excerpts }` to `${SEAR_HOST}/v1/propose` (default host `http://127.0.0.1:8766`) with `node:http` rather than `fetch`. The sidecar decodes one request at a time while the engine sends passes three at a time, so a queued request can wait longer than `fetch`'s default 300-second headers timeout on a CPU rig; `node:http` sets no timeout. `SEAR_HOST` is therefore `http://` only — it is a localhost sidecar.
- Validates the response with `ProposalBatchSchema` — the same schema the Ollama path uses — and returns `{ stop_reason: "end_turn", parsed_output }`.
- Refuses a response whose `model` differs from the requested one (the sidecar serves exactly one model; a mismatch would stamp the wrong model into the cache and manifest).
- Refuses a body with no `excerpts` rather than guessing.

**`src/cli/index.ts`, `src/cli/args.ts`** — `--client sear`, mirroring `--client ollama`: requires `SEAR_MODEL` (the sidecar's model id, e.g. `sear/Qwen2.5-7B-Instruct-Q6_K`, which must start with `sear/`), stamps it on the manifest, and passes `{ client: searClient(), model: SEAR_MODEL }` to `analyzeLive` exactly as the Ollama path passes its client. Like `--client ollama`, it defaults the prompt tier to `small`. No Anthropic key is required for `--client sear`, same as `--client ollama`. Receipts never starts the sidecar; it expects one to be running.

The prompt tier is unchanged and independent (`--prompt-tier frontier|small`); its system prompt and user message are the sidecar's base context. The quoting rules those prompts contain become redundant on this path, not wrong.

## GIN changes (`gin` repo)

A new package, **`gin/assay_proposer/`** — named for the contract it serves, and kept separate from `gin/cartographer/`, whose "proposers" are GIN's own edge proposers:

- **`schema.py`** — pydantic models for the request (`model`, `system`, `messages`, `excerpts`) and the response (`model`, `proposals`, `stop_reason`), mirroring Receipts' `ProposalBatchSchema` field for field.
- **`corpus.py`** — builds the line-level SEAR `Corpus` and the index → `(docId, role)` side table from `excerpts`; computes each line's sentence spans, the claimant/independent focus sets, and the `forbidden_starts` for over-40-word sentences.
- **`slots.py`** — the slot orchestrator. Takes a duck-typed `llm` (the llama.cpp interface: `tokenize`, `detokenize`, `token_eos`, `create_completion`) exactly as `gin/corpus/generate.py`'s `decode_bundle` does, so tests run with a deterministic stand-in and no model. Renders `system` and the user message through the model's chat template once, then decodes slots in the table's order, appending each slot's output to the assistant turn. Stops at `continue? = no` or at the per-pass cap (default 8 proposals). SEAR permits EOS at a span boundary, so a quote slot can close with no span — either because the model chose to stop or because no permitted start remains. An empty `from` slot ends the pass cleanly with the proposals so far; an empty `to` slot after a relation type that needs one discards that one proposal and continues to the `continue?` gate.
- **`app.py`** — a FastAPI app factory, following `gin/federation/server.py`'s injection pattern: `create_app(propose_fn, model_id)`. Routes: `GET /v1/health` → `{ model }`; `POST /v1/propose` → runs `propose_fn`, returns `{ model, proposals, stop_reason: "end_turn" }`; a request naming a different `model` is refused with 409 before any decoding.
- **`runtime.py`** — `load_model(path, n_ctx, n_gpu_layers)` returning the `Llama`, a `render(system, user)` built from the GGUF's own `tokenizer.chat_template` via llama-cpp-python's `Jinja2ChatFormatter`, and the model id. Shared by the serve script and a real-model smoke script (`scripts/assay_proposer_smoke.py`), which runs one tiny pass on the GGUF and asserts every quote is an exact substring of the right-role document — the only check that the prompt-length accounting holds against a real tokenizer.
- **Environment.** gin's tests run on the system Python 3.14 (it has `llama_cpp` 0.3.30, `numpy`, `pytest`); the `.venv` has neither. FastAPI, uvicorn, httpx and pydantic are already in `requirements.txt` but not installed there, and are installed into that interpreter.
- **`scripts/assay_proposer_serve.py`** — loads the GGUF with `llama_cpp.Llama(model_path=…, n_ctx=…, n_gpu_layers=…)`, derives the model id as `sear/<GGUF file stem>`, and serves with uvicorn bound to `127.0.0.1` only (a local sidecar; unlike the federation node it has no peers and needs no mTLS). Flags: `--model`, `--port` (default 8766), `--n-gpu-layers` (default 0, GIN's convention; `-1` on a GPU rig), `--n-ctx`, `--temperature` (default 0.8), `--max-proposals` (default 8).

`sear/processor.py` and `sear/corpus.py` are imported, not changed.

## Documentation

- `gin/docs/GIN_15_Receipts.md` currently says Receipts gets the grounding guarantee "with post-hoc exact-substring verification — no constrained decoding, no local model." That becomes wrong: rewrite it to say Receipts holds both enforcement points and chooses per proposer, citing GIN_14 §8.
- `receipts/README.md` and `receipts/architecture.md`: document `--client sear`, `SEAR_HOST`, `SEAR_MODEL`, and the sidecar prerequisite, alongside the existing Ollama documentation.

## Testing

**GIN (`pytest`, no model required):**
- `corpus.py`: one SEAR doc per non-blank line; the side table maps every index back to the right `docId`/role; claimant and independent focus sets are disjoint; a sentence over 40 words contributes a `forbidden_starts` entry.
- `slots.py`, with a deterministic stand-in `llm` over a toy vocabulary (the pattern `scripts/sear_phase1.py --selftest` and `decode_bundle`'s duck typing already establish): every emitted quote is an exact substring of one line; `from.docId` is always a claimant doc and `to.docId` always independent, taken from `Segment.sources`; a quote never spans two lines; a forbidden (over-long) sentence is never quoted; `unsupported` skips the `to` slot and yields `to: null`; the per-pass cap stops the loop; an empty `from` slot ends the pass with the proposals so far; an empty `to` slot after `contradicts`/`corroborates`/`updates` drops only that proposal.
- `app.py`, with an injected fake `propose_fn`: health reports the model id; a mismatched `model` is refused with 409; the response shape matches the schema.

**Receipts (`vitest`):**
- Engine: `proposeRelations` passes `excerpts` matching the rendered excerpts one-for-one, in order.
- `toAssayClient`: for a `sear/` model id the body carries the excerpts; for any other model id, even when excerpts are offered, the body's key set is exactly `model`, `max_tokens`, `system`, `messages`, `output_format` — asserted directly, since the existing `anthropic.test.ts` checks fields individually and would not notice an extra key.
- `searClient()`, with an injected `fetch` (the pattern `ollama.test.ts` uses): posts model, system, messages and excerpts; validates the response through `ProposalBatchSchema`; rejects a mismatched `model`; rejects a body without `excerpts`.
- CLI: `--client sear` without `SEAR_MODEL` dies with a clear message; with it, no Anthropic key is required.
- `npm run typecheck`, `npx vitest run`, and `npm run replay` (`1 replayed, 3 not replayable`, unchanged — no committed report is regenerated) all clean.

**Claim/Record:** engine synced byte-identically (`diff -rq src/assay ../receipts/src/assay` empty); typecheck and suite clean.

## Measurement (owner-run, after implementation)

The comparison this track exists for, on the Tesla fixture and the §3 rig (the desktop RTX 4070, `--n-gpu-layers -1`), recorded in the README alongside the existing qwen caveat:

| Run | Proposer |
|---|---|
| Showcase | frontier (Opus), the paid restamp sequenced before this work |
| Baseline | `--client ollama`, `qwen2.5:7b` (the current committed ledger's proposer) |
| SEAR | `--client sear`, `Qwen2.5-7B-Instruct-Q6_K` |

Per run: proposals, admitted rows by status, denial breakdown by code, and provenance. The expected result is that the SEAR run's quote-fidelity and side-role denial counts (`ANCHOR_NOT_FOUND`, `QUOTE_TOO_LONG`, `INCOHERENT_QUOTE`, `FROM_NOT_CLAIMANT`, `TO_NOT_INDEPENDENT`, `SELF_PAIR`) are zero. Whether admitted rows and row quality move toward the showcase is the open question the run answers — the constraint guarantees quotes are real, not that the model pairs them well.

## What does not change

- `sear/processor.py`, `sear/corpus.py`.
- `admit()`, `assemble()`, `merge()`, retrieval, `planPasses`, the field profiles, the prompts.
- The Anthropic and Ollama proposer paths and their cache bodies.
- Every committed report.

## Out of scope

- Sub-sentence (clause-level) spans — a later configuration change if measurement shows sentence granularity is the binding limit.
- SEAR's divergent-mode steering (`required_doc_groups`, `divergence_starts`, cites, connectives) — Receipts' passes already isolate one independent source each.
- The SSA / attention-certificate stages of GIN_ENG_01.
- Starting or supervising the sidecar from Receipts.
- Regenerating any committed ledger; the Opus showcase restamp and the three-way measurement are owner-run follow-ups.
- Claim/Record using the SEAR client (it gains the engine field via sync; wiring a SEAR option into its server is a separate change).

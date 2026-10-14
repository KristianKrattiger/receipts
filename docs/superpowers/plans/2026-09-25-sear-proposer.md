# SEAR Proposer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run local models under GIN's SEAR decode-time copy constraint as a Receipts proposer, so a local model's quotes are real sentences of the right document by construction rather than denied afterwards.

**Architecture:** A local HTTP sidecar in the `gin` repo (`gin/assay_proposer/`) drives one proposal pass as a sequence of small constrained decodes — quote fields under SEAR's unchanged `ExtractiveCopyConstraint`, enumerated fields under a small `ChoiceConstraint`, free-text fields as single lines — over a SEAR corpus with one doc per line of page text. Receipts gains a `searClient()` (an SDK-shaped client like `ollamaClient()`), a `--client sear` flag, and one additive engine field (`excerpts` on `ProposalClient.propose`) so the sidecar receives the excerpts structured. `toAssayClient` puts the excerpts in the request body exactly when the model id starts with `sear/`, so the proposal cache and replay work unchanged.

**Tech Stack:** Python 3.14 (system interpreter), llama-cpp-python 0.3.30, numpy, FastAPI, pydantic v2, uvicorn, pytest (gin); TypeScript, Vitest, Zod, `node:http` (receipts, claim-record).

## Global Constraints

- Spec: `receipts/docs/superpowers/specs/2026-09-25-sear-proposer-design.md`.
- `gin/sear/processor.py` and `gin/sear/corpus.py` are imported, never modified.
- Model ids for this path start with `sear/` (`SEAR_MODEL_PREFIX`); the sidecar's id is `sear/<GGUF file stem>`.
- Quotes: one SEAR doc per line; `span_must_start_at_sentence=True`, `span_must_close_at_sentence_end=True`, `stop_after_first_extract=True`, `min_span_len=4`; sentences over 40 words are `forbidden_starts`.
- Slot order: `from.quote` → `type` → `to.quote` (skipped for `unsupported`) → `topic` → `statement` → `rationale` → `confidence` → continue?.
- Sampling temperature default `0.8`; per-pass proposal cap default `8`; sidecar port default `8766`, bound to `127.0.0.1` only.
- For any model id not starting with `sear/`, `toAssayClient`'s parse body must stay byte-identical to today: key set exactly `model`, `max_tokens`, `system`, `messages`, `output_format`. `npm run replay` must still print `1 replayed, 3 not replayable`.
- `src/assay/` stays byte-identical between `receipts` and `claim-record` (`diff -rq` empty).
- **gin git hygiene:** gin's working tree carries the owner's uncommitted edits to ~50 files (mostly `docs/`), including the *untracked* `docs/GIN_15_Receipts.md` and a modified `docs/GIN_14_Assay.md`. None belong to this plan. In gin, never `git add -A`, `git add .`, or `git commit -a`; stage exactly the files each task lists, and never stage anything under `docs/`.
- gin tests run with the system interpreter: `python -m pytest ...` from `C:\Users\krist\Projects\gin\GIN` (`python` is `C:\Python314\python.exe`; the repo's `.venv` has no `llama_cpp` or `pytest` and is not used).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Branches (controller creates before Task 1):** `sear-proposer` in each of `gin` (from `main`), `receipts` (from `main`), `claim-record` (from `master`). Creating the gin branch carries the owner's uncommitted edits along untouched in the working tree; that is expected.

---

## Task 1: Line-level SEAR corpus (gin)

**Files:**
- Create: `gin/assay_proposer/__init__.py`
- Create: `gin/assay_proposer/corpus.py`
- Test: `tests/test_assay_proposer_corpus.py`

**Interfaces:**
- Consumes: `sear.corpus.Corpus.from_chunks(chunks: list[tuple[str, str]], tokenize)`, `sear.corpus.SENTENCE_BOUNDARY`.
- Produces: `MAX_QUOTE_WORDS = 40`; `ExcerptLike` (Protocol: `docId: str`, `role: str`, `text: str`); `LineSource(doc_id: str, role: str)`; `LineCorpus(corpus: Corpus, sources: list[LineSource], claimant: frozenset[int], independent: frozenset[int], forbidden_starts: set[tuple[int, int]])`; `build_line_corpus(excerpts: Iterable[ExcerptLike], tokenize: Callable[[bytes], list[int]]) -> LineCorpus`. Task 2 uses all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_assay_proposer_corpus.py`:

```python
"""Tests for gin.assay_proposer.corpus — one SEAR doc per line, roles, over-long sentences."""
from dataclasses import dataclass

from gin.assay_proposer.corpus import MAX_QUOTE_WORDS, build_line_corpus

_VOCAB: dict[str, int] = {}


def _tok(b: bytes) -> list[int]:
    return [_VOCAB.setdefault(w, len(_VOCAB) + 2) for w in b.decode("utf-8").split()]


@dataclass
class Ex:
    docId: str
    role: str
    text: str
    label: str = "L"


def test_one_sear_doc_per_nonblank_line_mapped_back_to_its_excerpt():
    lc = build_line_corpus(
        [
            Ex("vendor", "claimant", "Acme is fast.\n\nAcme is cheap."),
            Ex("hn", "independent", "Acme was slow."),
        ],
        _tok,
    )
    assert len(lc.corpus.docs) == 3
    assert [(s.doc_id, s.role) for s in lc.sources] == [
        ("vendor", "claimant"),
        ("vendor", "claimant"),
        ("hn", "independent"),
    ]
    assert lc.claimant == frozenset({0, 1})
    assert lc.independent == frozenset({2})
    assert lc.claimant.isdisjoint(lc.independent)


def test_a_sentence_over_the_word_limit_cannot_start_a_quote():
    long = " ".join(["word"] * (MAX_QUOTE_WORDS + 1)) + "."
    lc = build_line_corpus([Ex("vendor", "claimant", f"Short one here. {long}")], _tok)
    # "Short one here. " is three tokens, so the long sentence starts at position 3 —
    # the same position sear.corpus records as that sentence's start.
    assert lc.forbidden_starts == {(0, 3)}
    assert (0, 3) in lc.corpus.sentence_starts


def test_a_sentence_at_the_limit_may_be_quoted():
    at_limit = " ".join(["word"] * MAX_QUOTE_WORDS) + "."
    lc = build_line_corpus([Ex("vendor", "claimant", at_limit)], _tok)
    assert lc.forbidden_starts == set()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_assay_proposer_corpus.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gin.assay_proposer'`.

- [ ] **Step 3: Write the implementation**

Create `gin/assay_proposer/__init__.py`:

```python
"""A SEAR-constrained proposer speaking the Assay's proposal contract (Receipts' ProposalBatch)."""
```

Create `gin/assay_proposer/corpus.py`:

```python
"""
gin.assay_proposer.corpus
-------------------------
Build SEAR's token index from the Assay's excerpts, one SEAR doc per line.

A span never leaves the SEAR doc it started in, so making each doc a single
line of page text makes a quote across a layout edge (a stat tile stitched
to the heading under it) unreachable rather than caught afterwards.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Protocol

from sear.corpus import SENTENCE_BOUNDARY, Corpus

MAX_QUOTE_WORDS = 40


class ExcerptLike(Protocol):
    docId: str
    role: str
    text: str


@dataclass(frozen=True)
class LineSource:
    doc_id: str
    role: str


@dataclass
class LineCorpus:
    corpus: Corpus
    sources: list[LineSource]
    claimant: frozenset[int]
    independent: frozenset[int]
    forbidden_starts: set[tuple[int, int]]


def _sentence_offsets(line: str) -> list[tuple[int, int]]:
    """(start, end) character offsets of each sentence, split as sear.corpus splits."""
    starts = [0] + [m.end() for m in SENTENCE_BOUNDARY.finditer(line)]
    return [
        (s, starts[i + 1] if i + 1 < len(starts) else len(line))
        for i, s in enumerate(starts)
    ]


def build_line_corpus(
    excerpts: Iterable[ExcerptLike],
    tokenize: Callable[[bytes], list[int]],
) -> LineCorpus:
    chunks: list[tuple[str, str]] = []
    sources: list[LineSource] = []
    for ci, ex in enumerate(excerpts):
        for li, line in enumerate(ex.text.split("\n")):
            if not line.strip():
                continue
            chunks.append((f"{ex.docId}#{ci}:{li}", line))
            sources.append(LineSource(ex.docId, ex.role))

    corpus = Corpus.from_chunks(chunks, tokenize=tokenize)

    forbidden: set[tuple[int, int]] = set()
    for d, (_name, line) in enumerate(chunks):
        for start, end in _sentence_offsets(line):
            if len(line[start:end].split()) > MAX_QUOTE_WORDS:
                # The same token position sear.corpus records as this sentence's start.
                pos = len(tokenize(line[:start].encode("utf-8"))) if start else 0
                forbidden.add((d, pos))

    return LineCorpus(
        corpus=corpus,
        sources=sources,
        claimant=frozenset(i for i, s in enumerate(sources) if s.role == "claimant"),
        independent=frozenset(i for i, s in enumerate(sources) if s.role == "independent"),
        forbidden_starts=forbidden,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_assay_proposer_corpus.py -v`
Expected: 3 passed.

- [ ] **Step 5: Run the SEAR suite to confirm nothing it depends on moved**

Run: `python -m pytest tests/test_processor.py -q`
Expected: 30 passed.

- [ ] **Step 6: Commit**

```bash
git add gin/assay_proposer/__init__.py gin/assay_proposer/corpus.py tests/test_assay_proposer_corpus.py
git commit -m "$(cat <<'EOF'
Build a line-level SEAR corpus from Assay excerpts

One SEAR doc per line of page text, so a quote can never cross a layout
edge; each doc maps back to its Receipts docId and role, and sentences
over 40 words are forbidden starts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Slot orchestration (gin)

**Files:**
- Create: `gin/assay_proposer/slots.py`
- Test: `tests/test_assay_proposer_slots.py`

**Interfaces:**
- Consumes: Task 1's `build_line_corpus`, `LineCorpus`, `ExcerptLike`; `sear.processor.ExtractiveCopyConstraint`, `NEG_INF`; `llama_cpp.LogitsProcessorList`.
- Produces: `RELATION_TYPES`, `CONFIDENCES`, `ChoiceConstraint(choices: list[list[int]], prompt_len: int, eos_id: int)`, `prompt_token_count(llm, prompt: str) -> int`, and `propose_pass(llm, render_prompt: Callable[[str, str], str], *, system: str, user: str, excerpts: Iterable[ExcerptLike], temperature: float = 0.8, max_proposals: int = 8) -> list[dict]`, where each dict is `{"type", "topic", "statement", "from": {"docId", "quote"}, "to": {"docId", "quote"} | None, "rationale", "confidence": float}`. Tasks 3 and 4 call `propose_pass`.
- `llm` is duck-typed to llama-cpp-python's `Llama`: `tokenize(text: bytes, add_bos: bool = True, special: bool = False) -> list[int]`, `detokenize(ids) -> bytes`, `token_eos() -> int`, `create_completion(prompt: str, *, max_tokens, temperature, logits_processor=None, stop=None) -> {"choices": [{"text": str, "finish_reason": "stop" | "length"}]}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_assay_proposer_slots.py`:

```python
"""Tests for gin.assay_proposer.slots, driven by a word-level stand-in for llama_cpp.Llama."""
from dataclasses import dataclass

import numpy as np
import pytest

from gin.assay_proposer.corpus import MAX_QUOTE_WORDS
from gin.assay_proposer.slots import ChoiceConstraint, propose_pass
from sear.processor import NEG_INF


class FakeLlm:
    """Word-level stand-in for llama_cpp.Llama.

    Each create_completion call has a 'wish': the text this fake model would
    write if nothing constrained it. At every step the next wished word scores
    highest, other tokens score 1 and EOS 0 (so a model whose wish is masked
    keeps writing rather than giving up); the logits processors mask the
    rest and the best survivor wins (lowest id on ties). A test scripts what
    the model wants and observes what the constraint lets through.
    """

    EOS = 1
    V = 4096

    def __init__(self, wishes: list[str]):
        self.wishes = list(wishes)
        self.vocab: dict[str, int] = {}
        self.inv: dict[int, str] = {}
        self.prompts: list[str] = []

    def _id(self, w: str) -> int:
        if w not in self.vocab:
            i = len(self.vocab) + 2
            self.vocab[w] = i
            self.inv[i] = w
        return self.vocab[w]

    def tokenize(self, b: bytes, add_bos: bool = True, special: bool = False) -> list[int]:
        return [self._id(w) for w in b.decode("utf-8").split()]

    def detokenize(self, ids) -> bytes:
        return " ".join(self.inv[i] for i in ids if i != self.EOS).encode("utf-8")

    def token_eos(self) -> int:
        return self.EOS

    def create_completion(self, prompt, max_tokens=16, temperature=0.8, logits_processor=None, stop=None, **_):
        self.prompts.append(prompt)
        wish_text = self.wishes.pop(0) if self.wishes else ""
        if stop and "\n" in stop:
            wish_text = wish_text.split("\n")[0]
        wish = self.tokenize(wish_text.encode("utf-8"))
        ids = self.tokenize(prompt.encode("utf-8"))
        out: list[int] = []
        finish = "length"
        for step in range(max_tokens):
            scores = np.ones(self.V, dtype=np.float32)
            scores[self.EOS] = 0.0
            scores[wish[step] if step < len(wish) else self.EOS] = 10.0
            if logits_processor is not None:
                scores = logits_processor(np.array(ids + out, dtype=np.intc), scores)
            tok = int(np.argmax(scores))
            if tok == self.EOS:
                finish = "stop"
                break
            out.append(tok)
        return {"choices": [{"text": self.detokenize(out).decode("utf-8"), "finish_reason": finish}]}


def _render(system: str, user: str) -> str:
    return f"SYSTEM {system} USER {user} ASSISTANT"


@dataclass
class Ex:
    docId: str
    role: str
    text: str
    label: str = "L"


EXCERPTS = [
    Ex("vendor", "claimant", "Acme uptime is 99.99% everywhere.\nAcme support answers in one hour."),
    Ex("status", "independent", "Acme reported four outages this quarter."),
]


def _run(wishes, excerpts=EXCERPTS, max_proposals=8):
    llm = FakeLlm(wishes)
    out = propose_pass(llm, _render, system="S", user="U", excerpts=excerpts, max_proposals=max_proposals)
    return llm, out


def test_a_full_proposal_comes_back_with_exact_quotes_and_docids_from_the_spans():
    llm, out = _run([
        "Acme uptime is 99.99% everywhere.", "contradicts", "Acme reported four outages this quarter.",
        "uptime", "uptime guarantee", "outages contradict it", "0.90", "no",
    ])
    assert out == [{
        "type": "contradicts",
        "topic": "uptime",
        "statement": "uptime guarantee",
        "from": {"docId": "vendor", "quote": "Acme uptime is 99.99% everywhere."},
        "to": {"docId": "status", "quote": "Acme reported four outages this quarter."},
        "rationale": "outages contradict it",
        "confidence": 0.9,
    }]
    assert llm.wishes == []


def test_a_paraphrase_the_model_wants_is_unreachable_it_can_only_copy():
    llm, out = _run([
        "Acme promises perfect uptime forever.", "unsupported", "t", "s", "r", "0.50", "no",
    ])
    assert out[0]["from"] == {"docId": "vendor", "quote": "Acme uptime is 99.99% everywhere."}
    assert out[0]["to"] is None


def test_unsupported_skips_the_independent_quote_slot():
    llm, _ = _run(["Acme uptime is 99.99% everywhere.", "unsupported", "t", "s", "r", "0.50", "no"])
    assert not any(p.endswith("Independent quote: ") for p in llm.prompts)
    assert len(llm.prompts) == 7


def test_each_quote_slot_only_reaches_its_own_role():
    _, out = _run([
        "Acme reported four outages this quarter.",   # wants the independent line as the claim
        "contradicts",
        "Acme uptime is 99.99% everywhere.",          # wants the claimant line as the evidence
        "t", "s", "r", "0.50", "no",
    ])
    assert out[0]["from"]["docId"] == "vendor"
    assert out[0]["to"] == {"docId": "status", "quote": "Acme reported four outages this quarter."}


def test_a_quote_never_crosses_a_line_break():
    excerpts = [
        Ex("vendor", "claimant", "Acme uptime is great\nAcme support is slow today"),
        Ex("status", "independent", "Acme reported four outages this quarter."),
    ]
    _, out = _run(
        ["Acme uptime is great Acme support is slow today", "unsupported", "t", "s", "r", "0.50", "no"],
        excerpts=excerpts,
    )
    assert out[0]["from"]["quote"] == "Acme uptime is great"


def test_an_over_long_sentence_is_never_quoted():
    long = " ".join(f"w{i}" for i in range(MAX_QUOTE_WORDS + 1)) + "."
    llm, out = _run([long], excerpts=[Ex("vendor", "claimant", long)])
    assert out == []
    assert len(llm.prompts) == 1


def test_an_empty_claim_slot_ends_the_pass():
    llm, out = _run([""])
    assert out == []
    assert len(llm.prompts) == 1


def test_a_missing_independent_quote_drops_only_that_proposal():
    only_claimant = [Ex("vendor", "claimant", "Acme uptime is 99.99% everywhere.\nAcme support answers in one hour.")]
    _, out = _run(
        [
            "Acme uptime is 99.99% everywhere.", "contradicts", "yes",
            "Acme support answers in one hour.", "unsupported", "t", "s", "r", "0.50", "no",
        ],
        excerpts=only_claimant,
    )
    assert [p["type"] for p in out] == ["unsupported"]
    assert out[0]["from"]["quote"] == "Acme support answers in one hour."


def test_the_per_pass_cap_stops_without_asking_to_continue():
    llm, out = _run(
        [
            "Acme uptime is 99.99% everywhere.", "unsupported", "t", "s", "r", "0.50", "yes",
            "Acme support answers in one hour.", "unsupported", "t", "s", "r", "0.50",
        ],
        max_proposals=2,
    )
    assert len(out) == 2
    assert llm.wishes == []
    assert llm.prompts[-1].endswith("Confidence: ")


def test_a_prompt_length_mismatch_fails_loudly_instead_of_misattributing():
    class OffByOne(FakeLlm):
        def tokenize(self, b, add_bos=True, special=False):
            ids = super().tokenize(b, add_bos, special)
            return ids + [2] if special else ids

    with pytest.raises(RuntimeError, match="prompt is"):
        propose_pass(OffByOne(["Acme uptime is 99.99% everywhere."]), _render,
                     system="S", user="U", excerpts=EXCERPTS)


def test_choice_constraint_allows_only_listed_sequences_then_eos():
    c = ChoiceConstraint([[5, 6], [5, 7], [8]], prompt_len=2, eos_id=1)

    def allowed(ids):
        scores = c(np.array(ids, dtype=np.intc), np.zeros(10, dtype=np.float32))
        return {t for t in range(10) if scores[t] > NEG_INF / 2}

    assert allowed([0, 0]) == {5, 8}
    assert allowed([0, 0, 5]) == {6, 7}
    assert allowed([0, 0, 5, 6]) == {1}
    assert allowed([0, 0, 8]) == {1}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_assay_proposer_slots.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gin.assay_proposer.slots'`.

- [ ] **Step 3: Write the implementation**

Create `gin/assay_proposer/slots.py`:

```python
"""
gin.assay_proposer.slots
------------------------
Drive one Assay proposal pass as a sequence of small constrained decodes.

SEAR has no structured-output mode, and one JSON stream would put its copy
cursor over raw corpus tokens while the output needed JSON-escaped text. So
the structure lives here: one decode per field, each appended to a growing
assistant turn so llama.cpp reuses the shared prompt prefix. Quote fields run
under SEAR's ExtractiveCopyConstraint; enumerated fields (relation type,
confidence, continue?) under ChoiceConstraint; free-text fields (topic,
statement, rationale) are single lines. A quote's docId is read off the span
SEAR closed, never generated, so the model cannot mislabel its source.
"""
from __future__ import annotations

from typing import Any, Callable, Iterable, Optional

import numpy as np

from sear.processor import NEG_INF, ExtractiveCopyConstraint

from .corpus import ExcerptLike, LineCorpus, build_line_corpus

RELATION_TYPES = ["contradicts", "corroborates", "updates", "unsupported"]
CONFIDENCES = [f"{i / 20:.2f}" for i in range(1, 21)]  # 0.05 .. 1.00
MIN_SPAN_TOKENS = 4
MAX_QUOTE_TOKENS = 96
FREE_TEXT_TOKENS = {"topic": 16, "statement": 32, "rationale": 64}

SCAFFOLD_NOTE = (
    "\n\nAnswer one proposal at a time by filling in the labelled fields. "
    "Quotes are copied from the excerpts above; the decoder only lets you "
    "copy text that is really there."
)

RenderPrompt = Callable[[str, str], str]


def prompt_token_count(llm: Any, prompt: str) -> int:
    """Tokens llama.cpp's create_completion evaluates for this prompt.

    create_completion tokenizes with special=True (a chat template's control
    tokens are single special tokens, not literal text) and prepends BOS only
    when the model asks for one; tokenize(add_bos=True, special=True) matches.
    """
    return len(llm.tokenize(prompt.encode("utf-8"), add_bos=True, special=True))


def _mask(scores, allowed: set[int]) -> np.ndarray:
    scores = np.asarray(scores, dtype=np.float32)
    out = np.full(scores.shape, NEG_INF, dtype=np.float32)
    idx = np.fromiter((t for t in allowed if t < scores.shape[0]), dtype=np.int64)
    out[idx] = scores[idx]
    return out


class ChoiceConstraint:
    """Allow exactly one of a fixed set of token sequences, then EOS."""

    def __init__(self, choices: list[list[int]], prompt_len: int, eos_id: int):
        self.choices = [c for c in choices if c]
        self.prompt_len = prompt_len
        self.eos_id = eos_id
        self.generated: list[int] = []

    def _allowed(self) -> set[int]:
        n = len(self.generated)
        allowed = {c[n] for c in self.choices if len(c) > n and c[:n] == self.generated}
        if self.generated in self.choices:
            allowed.add(self.eos_id)
        return allowed or {self.eos_id}

    def __call__(self, input_ids, scores):
        self.generated = list(input_ids)[self.prompt_len:]
        return _mask(scores, self._allowed())


class _PromptLengthGuard:
    """Fail loudly if llama.cpp's prompt token count differs from ours.

    SEAR treats every input id past prompt_len as generated; an off-by-one
    would feed it a prompt token as the first quoted token and silently
    misattribute the quote.
    """

    def __init__(self, inner, prompt_len: int):
        self.inner = inner
        self.prompt_len = prompt_len
        self.checked = False

    def __call__(self, input_ids, scores):
        if not self.checked:
            if len(input_ids) != self.prompt_len:
                raise RuntimeError(
                    f"assay_proposer: prompt is {len(input_ids)} tokens to llama.cpp "
                    f"but {self.prompt_len} to the constraint"
                )
            self.checked = True
        return self.inner(input_ids, scores)


def _complete(
    llm: Any,
    prompt: str,
    *,
    max_tokens: int,
    temperature: float,
    processor=None,
    stop: Optional[list[str]] = None,
) -> tuple[str, str]:
    kwargs: dict[str, Any] = {"max_tokens": max_tokens, "temperature": temperature}
    if processor is not None:
        from llama_cpp import LogitsProcessorList  # lazy, as gin/corpus/generate.py does

        kwargs["logits_processor"] = LogitsProcessorList([processor])
    if stop is not None:
        kwargs["stop"] = stop
    choice = llm.create_completion(prompt, **kwargs)["choices"][0]
    return choice["text"], choice.get("finish_reason") or "stop"


def _quote(
    llm: Any,
    lc: LineCorpus,
    prompt: str,
    focus: frozenset[int],
    temperature: float,
) -> Optional[tuple[str, str]]:
    """(docId, quote) for one span copied from the focus lines, or None if none was closed."""
    if not focus:
        return None
    n = prompt_token_count(llm, prompt)
    constraint = ExtractiveCopyConstraint(
        lc.corpus,
        prompt_len=n,
        eos_id=llm.token_eos(),
        delim_id=llm.tokenize(b"|", add_bos=False)[-1],
        min_span_len=MIN_SPAN_TOKENS,
        focus_doc_indices=focus,
        forbidden_starts=lc.forbidden_starts,
        span_must_start_at_sentence=True,
        span_must_close_at_sentence_end=True,
        stop_after_first_extract=True,
    )
    _text, finish = _complete(
        llm, prompt, max_tokens=MAX_QUOTE_TOKENS, temperature=temperature,
        processor=_PromptLengthGuard(constraint, n),
    )
    if finish == "length":
        return None  # cut off mid-span: a fragment, not a quote
    extracts = [s for s in constraint.finalize() if s.kind == "extract"]
    if not extracts or not extracts[0].sources or len(extracts[0].token_ids) < MIN_SPAN_TOKENS:
        return None
    seg = extracts[0]
    quote = llm.detokenize(seg.token_ids).decode("utf-8", errors="replace").strip()
    return lc.sources[seg.sources[0][0]].doc_id, quote


def _choose(llm: Any, prompt: str, choices: list[str], temperature: float) -> str:
    n = prompt_token_count(llm, prompt)
    seqs = [llm.tokenize(c.encode("utf-8"), add_bos=False) for c in choices]
    constraint = ChoiceConstraint(seqs, n, llm.token_eos())
    text, _finish = _complete(
        llm, prompt, max_tokens=max(len(s) for s in seqs) + 1, temperature=temperature,
        processor=_PromptLengthGuard(constraint, n),
    )
    text = text.strip()
    if text not in choices:
        raise RuntimeError(f"assay_proposer: choice decode produced {text!r}, not one of {choices}")
    return text


def _line(llm: Any, prompt: str, max_tokens: int, temperature: float) -> str:
    text, _finish = _complete(llm, prompt, max_tokens=max_tokens, temperature=temperature, stop=["\n"])
    return text.strip()


def propose_pass(
    llm: Any,
    render_prompt: RenderPrompt,
    *,
    system: str,
    user: str,
    excerpts: Iterable[ExcerptLike],
    temperature: float = 0.8,
    max_proposals: int = 8,
) -> list[dict]:
    lc = build_line_corpus(excerpts, lambda b: llm.tokenize(b, add_bos=False))
    base = render_prompt(system, user + SCAFFOLD_NOTE)
    turn = ""
    proposals: list[dict] = []
    for n in range(1, max_proposals + 1):
        turn += f"Proposal {n}\nClaimant quote: "
        claim = _quote(llm, lc, base + turn, lc.claimant, temperature)
        if claim is None:
            break
        from_doc, from_quote = claim
        turn += f"{from_quote}\nRelation: "
        rtype = _choose(llm, base + turn, RELATION_TYPES, temperature)
        turn += f"{rtype}\n"

        to: Optional[dict] = None
        if rtype != "unsupported":
            turn += "Independent quote: "
            evidence = _quote(llm, lc, base + turn, lc.independent, temperature)
            if evidence is None:
                turn += "none\n"
            else:
                to = {"docId": evidence[0], "quote": evidence[1]}
                turn += f"{evidence[1]}\n"

        if rtype == "unsupported" or to is not None:
            fields: dict[str, str] = {}
            for name in ("topic", "statement", "rationale"):
                turn += f"{name.capitalize()}: "
                fields[name] = _line(llm, base + turn, FREE_TEXT_TOKENS[name], temperature)
                turn += f"{fields[name]}\n"
            turn += "Confidence: "
            confidence = _choose(llm, base + turn, CONFIDENCES, temperature)
            turn += f"{confidence}\n"
            proposals.append({
                "type": rtype,
                "topic": fields["topic"],
                "statement": fields["statement"],
                "from": {"docId": from_doc, "quote": from_quote},
                "to": to,
                "rationale": fields["rationale"],
                "confidence": float(confidence),
            })

        if n == max_proposals:
            break
        turn += "Another proposal? "
        more = _choose(llm, base + turn, ["yes", "no"], temperature)
        turn += f"{more}\n\n"
        if more == "no":
            break
    return proposals
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_assay_proposer_slots.py tests/test_assay_proposer_corpus.py -v`
Expected: 14 passed.

- [ ] **Step 5: Run the SEAR suite**

Run: `python -m pytest tests/test_processor.py -q`
Expected: 30 passed.

- [ ] **Step 6: Commit**

```bash
git add gin/assay_proposer/slots.py tests/test_assay_proposer_slots.py
git commit -m "$(cat <<'EOF'
Drive an Assay proposal pass as SEAR-constrained slots

One decode per field on a growing assistant turn: quotes under SEAR's
unchanged copy constraint (docId read off the closed span), enumerated
fields under a choice processor, free text as single lines. A prompt
length llama.cpp counts differently fails loudly instead of misattributing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: HTTP app and request schema (gin)

**Files:**
- Create: `gin/assay_proposer/schema.py`
- Create: `gin/assay_proposer/app.py`
- Test: `tests/test_assay_proposer_app.py`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 directly (the app takes an injected `propose_fn`).
- Produces: pydantic `Excerpt(docId, role, label, text)`, `Message(role, content)`, `ProposeRequest(model, system, messages, excerpts)`, `Span`, `Proposal` (field `from_` aliased `from`), `ProposeResponse(model, proposals, stop_reason)`, `Health(model)`; `create_app(propose_fn: Callable[[ProposeRequest], list[dict]], model_id: str) -> FastAPI` with `GET /v1/health` and `POST /v1/propose`. Task 4 wires `propose_pass` into `propose_fn`; Receipts' `searClient` (Task 6) posts to `/v1/propose`.

- [ ] **Step 1: Install the web dependencies into the test interpreter**

They are already listed in `requirements.txt`; the system interpreter just doesn't have them.

Run: `python -m pip install "fastapi>=0.110" "uvicorn>=0.29" "httpx>=0.27" "pydantic>=2.5"`
Then: `python -c "import fastapi, uvicorn, httpx, pydantic; print('ok', pydantic.VERSION)"`
Expected: `ok 2.<something>`.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_assay_proposer_app.py`:

```python
"""Tests for gin.assay_proposer.app — contract shape, model pinning, validation. No model needed."""
from fastapi.testclient import TestClient

from gin.assay_proposer.app import create_app

PROPOSAL = {
    "type": "unsupported", "topic": "t", "statement": "s",
    "from": {"docId": "vendor", "quote": "q"}, "to": None,
    "rationale": "r", "confidence": 0.5,
}
BODY = {
    "model": "sear/test",
    "system": "S",
    "messages": [{"role": "user", "content": "U"}],
    "excerpts": [{"docId": "vendor", "role": "claimant", "label": "V", "text": "q"}],
}


def test_health_names_the_model():
    client = TestClient(create_app(lambda req: [], "sear/test"))
    assert client.get("/v1/health").json() == {"model": "sear/test"}


def test_propose_returns_the_contract_shape_and_passes_the_request_through():
    seen = []

    def propose_fn(req):
        seen.append(req)
        return [PROPOSAL]

    client = TestClient(create_app(propose_fn, "sear/test"))
    r = client.post("/v1/propose", json=BODY)
    assert r.status_code == 200
    assert r.json() == {"model": "sear/test", "proposals": [PROPOSAL], "stop_reason": "end_turn"}
    assert seen[0].excerpts[0].docId == "vendor"
    assert seen[0].messages[0].content == "U"


def test_a_request_for_another_model_is_refused_before_decoding():
    called = []
    client = TestClient(create_app(lambda req: called.append(req) or [], "sear/test"))
    r = client.post("/v1/propose", json={**BODY, "model": "sear/other"})
    assert r.status_code == 409
    assert called == []


def test_a_request_without_excerpts_is_rejected():
    client = TestClient(create_app(lambda req: [], "sear/test"))
    body = {k: v for k, v in BODY.items() if k != "excerpts"}
    assert client.post("/v1/propose", json=body).status_code == 422
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_assay_proposer_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gin.assay_proposer.app'`.

- [ ] **Step 4: Write the implementation**

Create `gin/assay_proposer/schema.py`:

```python
"""Request and response shapes for the proposer sidecar, mirroring Receipts' ProposalBatchSchema."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Excerpt(BaseModel):
    docId: str
    role: Literal["claimant", "independent"]
    label: str
    text: str


class Message(BaseModel):
    role: str
    content: str


class ProposeRequest(BaseModel):
    model: str
    system: str
    messages: list[Message] = Field(min_length=1)
    excerpts: list[Excerpt]


class Span(BaseModel):
    docId: str
    quote: str


class Proposal(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: Literal["contradicts", "corroborates", "updates", "unsupported"]
    topic: str
    statement: str
    from_: Span = Field(alias="from")
    to: Optional[Span]
    rationale: str
    confidence: float = Field(ge=0.0, le=1.0)


class ProposeResponse(BaseModel):
    model: str
    proposals: list[Proposal]
    stop_reason: Literal["end_turn"] = "end_turn"


class Health(BaseModel):
    model: str
```

Create `gin/assay_proposer/app.py`:

```python
"""
gin.assay_proposer.app
----------------------
FastAPI app factory for the SEAR proposer sidecar.

One model, one decode at a time: a llama.cpp model is not safe to drive from
two threads, and FastAPI runs sync endpoints on a thread pool, so every
propose call takes the same lock. Receipts sends passes three at a time; the
extra requests queue here. propose_fn is injected so tests run without a
model, as gin/federation/server.py does.
"""
from __future__ import annotations

import threading
from typing import Callable

from fastapi import FastAPI, HTTPException

from .schema import Health, Proposal, ProposeRequest, ProposeResponse

ProposeFn = Callable[[ProposeRequest], list[dict]]


def create_app(propose_fn: ProposeFn, model_id: str) -> FastAPI:
    app = FastAPI(title="gin assay proposer")
    lock = threading.Lock()

    @app.get("/v1/health", response_model=Health)
    def health() -> Health:
        return Health(model=model_id)

    @app.post("/v1/propose", response_model=ProposeResponse)
    def propose(req: ProposeRequest) -> ProposeResponse:
        if req.model != model_id:
            raise HTTPException(status_code=409, detail=f"this proposer serves {model_id}, not {req.model}")
        with lock:
            raw = propose_fn(req)
        return ProposeResponse(model=model_id, proposals=[Proposal.model_validate(p) for p in raw])

    return app
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_assay_proposer_app.py tests/test_assay_proposer_slots.py tests/test_assay_proposer_corpus.py -v`
Expected: 18 passed.

- [ ] **Step 6: Commit**

```bash
git add gin/assay_proposer/schema.py gin/assay_proposer/app.py tests/test_assay_proposer_app.py
git commit -m "$(cat <<'EOF'
Serve the SEAR proposer over a local HTTP contract

POST /v1/propose takes the Assay's system, messages and structured
excerpts and returns Receipts' proposal batch shape; a request for any
model but the one loaded is refused before decoding, and decodes run
one at a time under a lock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Model runtime, serve script, real-model smoke check (gin)

**Files:**
- Create: `gin/assay_proposer/runtime.py`
- Create: `scripts/assay_proposer_serve.py`
- Create: `scripts/assay_proposer_smoke.py`
- Test: `tests/test_assay_proposer_runtime.py`

**Interfaces:**
- Consumes: Task 2's `propose_pass`; Task 3's `create_app`, `Excerpt`.
- Produces: `SEAR_MODEL_PREFIX = "sear/"`, `model_id_for(model_path: str) -> str`, `load_model(model_path: str, *, n_ctx: int, n_gpu_layers: int) -> tuple[llm, render, model_id]`. The serve script is what Receipts' `--client sear` talks to.

- [ ] **Step 1: Write the failing test**

Create `tests/test_assay_proposer_runtime.py`:

```python
"""Tests for gin.assay_proposer.runtime's pure parts (loading a GGUF is the smoke script's job)."""
from gin.assay_proposer.runtime import SEAR_MODEL_PREFIX, model_id_for


def test_the_model_id_is_the_gguf_stem_under_the_sear_prefix():
    assert SEAR_MODEL_PREFIX == "sear/"
    assert model_id_for("models/Qwen2.5-7B-Instruct-Q6_K.gguf") == "sear/Qwen2.5-7B-Instruct-Q6_K"
    assert model_id_for(r"C:\models\Mistral-7B-Instruct-v0.3-Q6_K.gguf") == "sear/Mistral-7B-Instruct-v0.3-Q6_K"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_assay_proposer_runtime.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gin.assay_proposer.runtime'`.

- [ ] **Step 3: Write the runtime module**

Create `gin/assay_proposer/runtime.py`:

```python
"""
gin.assay_proposer.runtime
--------------------------
Load a GGUF for the proposer: the model, a renderer for its own chat
template, and the id Receipts stamps on its manifest.
"""
from __future__ import annotations

from pathlib import PureWindowsPath
from typing import Any, Callable

SEAR_MODEL_PREFIX = "sear/"


def model_id_for(model_path: str) -> str:
    # PureWindowsPath splits on both / and \, so the id is the same on either OS.
    return f"{SEAR_MODEL_PREFIX}{PureWindowsPath(model_path).stem}"


def load_model(
    model_path: str,
    *,
    n_ctx: int,
    n_gpu_layers: int,
) -> tuple[Any, Callable[[str, str], str], str]:
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import Jinja2ChatFormatter

    llm = Llama(model_path=model_path, n_ctx=n_ctx, n_gpu_layers=n_gpu_layers, verbose=False)
    template = llm.metadata.get("tokenizer.chat_template")
    if not template:
        raise RuntimeError(f"{model_path} carries no tokenizer.chat_template; the proposer cannot render its prompt")

    def piece(token: int) -> str:
        return llm.detokenize([token]).decode("utf-8", errors="ignore") if token >= 0 else ""

    formatter = Jinja2ChatFormatter(
        template=template,
        eos_token=piece(llm.token_eos()),
        bos_token=piece(llm.token_bos()),
        add_generation_prompt=True,
    )

    def render(system: str, user: str) -> str:
        return formatter(messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]).prompt

    return llm, render, model_id_for(model_path)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_assay_proposer_runtime.py -v`
Expected: 1 passed.

- [ ] **Step 5: Write the serve script**

Create `scripts/assay_proposer_serve.py`:

```python
#!/usr/bin/env python3
"""Serve the SEAR-constrained Assay proposer on localhost.

Usage:
    python scripts/assay_proposer_serve.py --model models/Qwen2.5-7B-Instruct-Q6_K.gguf
    python scripts/assay_proposer_serve.py --model ... --n-gpu-layers -1   # on a GPU rig

Receipts reaches it with --client sear, SEAR_HOST=http://127.0.0.1:8766 and
SEAR_MODEL set to the id printed at startup (sear/<gguf file stem>). Binds
127.0.0.1 only: a local sidecar with no peers, so no mTLS.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="path to a GGUF")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--n-gpu-layers", type=int, default=0, help="0 = CPU (GIN's default); -1 = all on GPU")
    ap.add_argument("--n-ctx", type=int, default=16384)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--max-proposals", type=int, default=8)
    args = ap.parse_args()

    import uvicorn

    from gin.assay_proposer.app import create_app
    from gin.assay_proposer.runtime import load_model
    from gin.assay_proposer.slots import propose_pass

    llm, render, model_id = load_model(args.model, n_ctx=args.n_ctx, n_gpu_layers=args.n_gpu_layers)

    def propose_fn(req):
        user = next(m.content for m in reversed(req.messages) if m.role == "user")
        return propose_pass(
            llm, render, system=req.system, user=user, excerpts=req.excerpts,
            temperature=args.temperature, max_proposals=args.max_proposals,
        )

    print(f"assay proposer: serving {model_id} on http://127.0.0.1:{args.port}", flush=True)
    uvicorn.run(create_app(propose_fn, model_id), host="127.0.0.1", port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Write the smoke script**

Create `scripts/assay_proposer_smoke.py`:

```python
#!/usr/bin/env python3
"""Run one real SEAR proposer pass and check every quote is copied from the right role.

    python scripts/assay_proposer_smoke.py --model models/Qwen2.5-7B-Instruct-Q6_K.gguf

This is the only check of slots.prompt_token_count against a real tokenizer:
if llama.cpp counts the prompt differently, the first constrained slot raises
instead of misattributing a quote. Exit 0 = every quote verified; 1 = a quote
failed; 2 = the model proposed nothing, so nothing was checked.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SYSTEM = "You compare a vendor's own claims against independent reports about that vendor."
EXCERPTS = [
    {
        "docId": "tesla", "role": "claimant", "label": "Tesla Vehicle Safety Report",
        "text": "Tesla vehicles with FSD (Supervised) engaged experience fewer collisions than those driven without.\n"
                "Eight external cameras provide a 360-degree view of the environment around the vehicle.",
    },
    {
        "docId": "hn", "role": "independent", "label": "Hacker News - FSD",
        "text": "Tesla Full Self Driving requires human intervention every 13 miles\n"
                "Tesla 'Full Self-Driving' crashed through railroad gate seconds before train",
    },
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True)
    ap.add_argument("--n-gpu-layers", type=int, default=0)
    ap.add_argument("--n-ctx", type=int, default=4096)
    args = ap.parse_args()

    from gin.assay_proposer.runtime import load_model
    from gin.assay_proposer.schema import Excerpt
    from gin.assay_proposer.slots import propose_pass

    llm, render, model_id = load_model(args.model, n_ctx=args.n_ctx, n_gpu_layers=args.n_gpu_layers)
    excerpts = [Excerpt(**e) for e in EXCERPTS]
    user = (
        "Subject: Tesla FSD\nTask: propose contradicts, corroborates and updates relations between the "
        "claimant excerpts and the independent excerpts below.\n\nExcerpts:\n\n"
        + "\n\n".join(f"--- docId: {e.docId} | role: {e.role} | source: {e.label}\n{e.text}" for e in excerpts)
    )

    t0 = time.time()
    proposals = propose_pass(llm, render, system=SYSTEM, user=user, excerpts=excerpts,
                             temperature=0.8, max_proposals=2)
    seconds = round(time.time() - t0, 1)
    print(json.dumps({"model": model_id, "seconds": seconds, "proposals": proposals}, indent=2))

    lines = {e.docId: e.text.split("\n") for e in excerpts}
    roles = {e.docId: e.role for e in excerpts}
    failures = []
    for p in proposals:
        if roles.get(p["from"]["docId"]) != "claimant":
            failures.append(f"from is not a claimant doc: {p['from']}")
        elif not any(p["from"]["quote"] in line for line in lines[p["from"]["docId"]]):
            failures.append(f"from quote not copied from its doc: {p['from']}")
        if p["to"] is not None:
            if roles.get(p["to"]["docId"]) != "independent":
                failures.append(f"to is not an independent doc: {p['to']}")
            elif not any(p["to"]["quote"] in line for line in lines[p["to"]["docId"]]):
                failures.append(f"to quote not copied from its doc: {p['to']}")

    if failures:
        print("FAIL:\n  " + "\n  ".join(failures))
        return 1
    if not proposals:
        print("the model proposed nothing; nothing was checked")
        return 2
    print(f"OK: {len(proposals)} proposal(s) in {seconds}s, every quote copied from a line of the right role")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 7: Run the smoke check on the real model (CPU; expect several minutes)**

Run: `python scripts/assay_proposer_smoke.py --model models/Qwen2.5-7B-Instruct-Q6_K.gguf`
Expected: a JSON block, then `OK: <n> proposal(s) in <s>s, every quote copied from a line of the right role`, exit 0.

If it raises `assay_proposer: prompt is N tokens to llama.cpp but M to the constraint`, the prompt-length accounting doesn't match this model's tokenizer — stop and report BLOCKED with the full traceback and both numbers; do not adjust the count to make it pass. If it exits 2 (nothing proposed), rerun once (sampling is random); if it exits 2 again, report DONE_WITH_CONCERNS with the JSON. Exit 1 is a real failure — report BLOCKED with the output.

- [ ] **Step 8: Run the serve script end to end**

Start it in the background: `python scripts/assay_proposer_serve.py --model models/Qwen2.5-7B-Instruct-Q6_K.gguf`
Wait for `assay proposer: serving sear/Qwen2.5-7B-Instruct-Q6_K on http://127.0.0.1:8766`, then:

Run: `curl -s http://127.0.0.1:8766/v1/health`
Expected: `{"model":"sear/Qwen2.5-7B-Instruct-Q6_K"}`

Run: `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8766/v1/propose -H "Content-Type: application/json" -d "{\"model\":\"sear/other\",\"system\":\"s\",\"messages\":[{\"role\":\"user\",\"content\":\"u\"}],\"excerpts\":[]}"`
Expected: `409`

Stop the server afterwards.

- [ ] **Step 9: Run all the new gin tests**

Run: `python -m pytest tests/test_assay_proposer_corpus.py tests/test_assay_proposer_slots.py tests/test_assay_proposer_app.py tests/test_assay_proposer_runtime.py tests/test_processor.py -q`
Expected: 49 passed.

- [ ] **Step 10: Commit**

```bash
git add gin/assay_proposer/runtime.py scripts/assay_proposer_serve.py scripts/assay_proposer_smoke.py tests/test_assay_proposer_runtime.py
git commit -m "$(cat <<'EOF'
Load a GGUF for the SEAR proposer; serve it and smoke-check it

The model id is sear/<gguf stem>; the prompt is rendered through the
GGUF's own chat template. The smoke script runs one real pass and
checks every quote was copied from a line of the right role -- the one
check of the prompt-length accounting against a real tokenizer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Structured excerpts on the proposal contract (receipts engine)

**Files:**
- Modify: `src/assay/cartographer/propose.ts` (the `ProposalClient` interface, `buildExcerpts`, `proposeRelations`)
- Test: `src/assay/cartographer/propose.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProposeExcerpt = { docId: string; role: SourceRole; label: string; text: string }`; `ProposalClient.propose(input: { system: string; user: string; excerpts?: ProposeExcerpt[] })`; `excerptsFor(docs: ProposeDoc[], candidates: Chunk[]): ProposeExcerpt[]`; `renderExcerpts(excerpts: ProposeExcerpt[]): string`. `buildExcerpts(docs, candidates)` keeps its signature and output. Task 6 reads `excerpts` in `toAssayClient`.

- [ ] **Step 1: Write the failing test**

In `src/assay/cartographer/propose.test.ts`, change the import on line 2 to:

```ts
import { buildExcerpts, excerptsFor, planPasses, proposeAcrossPasses, proposeRelations, renderExcerpts, type ProposalClient, type ProposeDoc } from "./propose.js"
```

and append at the end of the file:

```ts
describe("proposeRelations — structured excerpts", () => {
  it("hands the client the excerpts the prompt renders, one per candidate, in order", async () => {
    const docs: ProposeDoc[] = [
      { docId: "vendor", label: "Acme site", role: "claimant", text: "Acme guarantees 99.99% uptime. Support replies in an hour." },
      { docId: "status", label: "Status page", role: "independent", text: "Four outages this quarter." },
    ]
    const candidates: Chunk[] = [
      { chunkId: "vendor:0", docId: "vendor", start: 0, end: 30, text: "Acme guarantees 99.99% uptime." },
      { chunkId: "status:0", docId: "status", start: 0, end: 26, text: "Four outages this quarter." },
      { chunkId: "vendor:1", docId: "vendor", start: 31, end: 58, text: "Support replies in an hour." },
      { chunkId: "ghost:0", docId: "ghost", start: 0, end: 6, text: "orphan" },
    ]
    const seen: Parameters<ProposalClient["propose"]>[0][] = []
    const stub: ProposalClient = {
      propose: async (input) => {
        seen.push(input)
        return { proposals: [] }
      },
    }
    await proposeRelations("acme", docs, candidates, { client: stub, system: "s" })

    expect(seen[0]!.excerpts).toEqual([
      { docId: "vendor", role: "claimant", label: "Acme site", text: "Acme guarantees 99.99% uptime." },
      { docId: "status", role: "independent", label: "Status page", text: "Four outages this quarter." },
      { docId: "vendor", role: "claimant", label: "Acme site", text: "Support replies in an hour." },
    ])
    expect(excerptsFor(docs, candidates)).toEqual(seen[0]!.excerpts)
    expect(renderExcerpts(seen[0]!.excerpts!)).toBe(buildExcerpts(docs, candidates))
    expect(seen[0]!.user).toContain(buildExcerpts(docs, candidates))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/assay/cartographer/propose.test.ts`
Expected: FAIL — `excerptsFor` / `renderExcerpts` are not exported (TypeError: not a function), and `seen[0].excerpts` is undefined.

- [ ] **Step 3: Implement**

In `src/assay/cartographer/propose.ts`, replace the `ProposalClient` interface:

```ts
/** The one call Assay makes. Receipts adapts Anthropic onto this. */
export interface ProposalClient {
  propose(input: { system: string; user: string }): Promise<{
```

with:

```ts
/** One excerpt as the prompt renders it, for a client that needs it structured. */
export type ProposeExcerpt = { docId: string; role: SourceRole; label: string; text: string }

/** The one call Assay makes. Receipts adapts Anthropic onto this. */
export interface ProposalClient {
  propose(input: {
    system: string
    user: string
    /**
     * The excerpts `user` renders, one per candidate chunk in prompt order. A
     * decode-time constrained proposer copies quotes out of them, so it needs
     * them structured rather than re-parsed from `user` -- scraped page text
     * can contain a line shaped like an excerpt header. Clients that only
     * read `user` ignore it.
     */
    excerpts?: ProposeExcerpt[]
  }): Promise<{
```

(the rest of the interface — the return type's fields and closing braces — is unchanged).

Replace `buildExcerpts`:

```ts
export function buildExcerpts(docs: ProposeDoc[], candidates: Chunk[]): string {
  const byId = new Map(docs.map((d) => [d.docId, d]))
  return candidates
    .map((c) => {
      const doc = byId.get(c.docId)
      if (!doc) return null
      return `--- docId: ${c.docId} | role: ${doc.role} | source: ${doc.label}\n${c.text}`
    })
    .filter((s): s is string => s !== null)
    .join("\n\n")
}
```

with:

```ts
/** One excerpt per candidate whose document is known, in candidate order. */
export function excerptsFor(docs: ProposeDoc[], candidates: Chunk[]): ProposeExcerpt[] {
  const byId = new Map(docs.map((d) => [d.docId, d]))
  return candidates.flatMap((c) => {
    const doc = byId.get(c.docId)
    return doc ? [{ docId: c.docId, role: doc.role, label: doc.label, text: c.text }] : []
  })
}

export function renderExcerpts(excerpts: ProposeExcerpt[]): string {
  return excerpts
    .map((e) => `--- docId: ${e.docId} | role: ${e.role} | source: ${e.label}\n${e.text}`)
    .join("\n\n")
}

export function buildExcerpts(docs: ProposeDoc[], candidates: Chunk[]): string {
  return renderExcerpts(excerptsFor(docs, candidates))
}
```

In `proposeRelations`, replace:

```ts
  const excerpts = buildExcerpts(docs, candidates)
  const response = await opts.client.propose({
    system: opts.system,
    user: `Subject: ${subject}\n${TASK[opts.mode ?? "relational"]}\n\nExcerpts:\n\n${excerpts}`,
  })
```

with:

```ts
  const excerpts = excerptsFor(docs, candidates)
  const response = await opts.client.propose({
    system: opts.system,
    user: `Subject: ${subject}\n${TASK[opts.mode ?? "relational"]}\n\nExcerpts:\n\n${renderExcerpts(excerpts)}`,
    excerpts,
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/assay/cartographer/propose.test.ts`
Expected: PASS, including the existing `buildExcerpts` tests unchanged.

- [ ] **Step 5: Full suite, typecheck, and replay**

Run: `npm run typecheck && npx vitest run && npm run replay`
Expected: typecheck clean; all tests pass; replay prints `1 replayed, 3 not replayable` — proof the rendered prompt, and therefore every cache key, is byte-identical.

- [ ] **Step 6: Commit**

```bash
git add src/assay/cartographer/propose.ts src/assay/cartographer/propose.test.ts
git commit -m "$(cat <<'EOF'
Hand proposers the excerpts structured as well as rendered

ProposalClient.propose gains an optional excerpts field: the same
chunks the prompt renders, one per candidate in prompt order. A
decode-time constrained proposer needs them structured; re-parsing the
prompt would trust scraped text not to contain a header-shaped line.
Every existing client ignores it and the prompt is byte-identical.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `searClient()` and the `sear/` body rule (receipts)

**Files:**
- Create: `src/cartographer/sear.ts`
- Modify: `src/cartographer/anthropic.ts` (`ParseRequest`, `toAssayClient`)
- Test: `src/cartographer/sear.test.ts`, `src/cartographer/anthropic.test.ts`

**Interfaces:**
- Consumes: Task 5's `ProposeExcerpt` and `propose({ system, user, excerpts })`; the sidecar's `POST /v1/propose` contract (Task 3).
- Produces: `SEAR_MODEL_PREFIX = "sear/"`, `Post = (url: string, body: unknown) => Promise<{ status: number; text: string }>`, `postJson: Post`, `searClient(opts?: { host?: string; post?: Post }): SdkProposalClient`. Task 7 uses `searClient` and `SEAR_MODEL_PREFIX`.

- [ ] **Step 1: Write the failing tests**

Create `src/cartographer/sear.test.ts`:

```ts
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import { toAssayClient } from "./anthropic.js"
import { postJson, searClient } from "./sear.js"

const PROPOSAL = {
  type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime." },
  to: null, rationale: "nothing confirms it", confidence: 0.6,
}
const EXCERPTS = [{ docId: "a", role: "claimant" as const, label: "Acme", text: "Acme guarantees 99.99% uptime." }]
const MODEL_ID = "sear/Qwen2.5-7B-Instruct-Q6_K"

function fakePost(reply: { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const post = async (url: string, body: unknown) => {
    calls.push({ url, body: body as Record<string, unknown> })
    return { status: reply.status ?? 200, text: reply.text ?? JSON.stringify(reply.body) }
  }
  return { post, calls }
}

describe("searClient", () => {
  it("posts model, system, messages and the structured excerpts, and returns the validated batch", async () => {
    const { post, calls } = fakePost({ body: { model: MODEL_ID, proposals: [PROPOSAL], stop_reason: "end_turn" } })
    const client = toAssayClient(searClient({ host: "http://sear.test:8766/", post }), MODEL_ID)
    const out = await client.propose({ system: "Sys.", user: "Subject: acme", excerpts: EXCERPTS })
    expect(out.proposals).toEqual([PROPOSAL])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("http://sear.test:8766/v1/propose")
    expect(calls[0]!.body).toEqual({
      model: MODEL_ID,
      system: "Sys.",
      messages: [{ role: "user", content: "Subject: acme" }],
      excerpts: EXCERPTS,
    })
  })

  it("reads the host from SEAR_HOST when none is given", async () => {
    const { post, calls } = fakePost({ body: { model: MODEL_ID, proposals: [] } })
    const prev = process.env["SEAR_HOST"]
    process.env["SEAR_HOST"] = "http://env.test:1"
    try {
      await toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS })
    } finally {
      if (prev === undefined) delete process.env["SEAR_HOST"]
      else process.env["SEAR_HOST"] = prev
    }
    expect(calls[0]!.url).toBe("http://env.test:1/v1/propose")
  })

  it("refuses a reply from a different model", async () => {
    const { post } = fakePost({ body: { model: "sear/other", proposals: [] } })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow(`sear: asked for ${MODEL_ID}, the proposer answered as sear/other`)
  })

  it("refuses a request without excerpts, before posting", async () => {
    const { post, calls } = fakePost({ body: { model: MODEL_ID, proposals: [] } })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u" }))
      .rejects.toThrow("sear: request carries no excerpts")
    expect(calls).toHaveLength(0)
  })

  it("refuses a model id without the sear/ prefix, before posting", async () => {
    const { post, calls } = fakePost({ body: { model: "qwen2.5:7b", proposals: [] } })
    await expect(toAssayClient(searClient({ post }), "qwen2.5:7b").propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow("sear: model id must start with sear/")
    expect(calls).toHaveLength(0)
  })

  it("throws naming the status when the proposer refuses the request", async () => {
    const { post } = fakePost({ status: 409, text: "this proposer serves sear/x" })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow("sear: 409 this proposer serves sear/x")
  })

  it("throws when the reply does not match the proposal schema", async () => {
    const { post } = fakePost({ body: { model: MODEL_ID, proposals: [{ type: "bogus" }] } })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow(/sear: response did not match the proposal schema/)
  })
})

describe("postJson", () => {
  it("round-trips JSON through a real local HTTP server", async () => {
    const server = createServer((req, res) => {
      let data = ""
      req.on("data", (c) => (data += c))
      req.on("end", () => {
        res.writeHead(201, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ got: JSON.parse(data) }))
      })
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    try {
      const out = await postJson(`http://127.0.0.1:${port}/x`, { a: 1 })
      expect(out.status).toBe(201)
      expect(JSON.parse(out.text)).toEqual({ got: { a: 1 } })
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})
```

In `src/cartographer/anthropic.test.ts`, add inside `describe("toAssayClient", ...)`, after the existing `"sends the caller's model id ..."` test:

```ts
  const EXCERPTS = [{ docId: "vendor", role: "claimant" as const, label: "Acme", text: "Acme guarantees 99.99% uptime." }]

  it("sends exactly the cache-keyed fields for a non-SEAR model, even when excerpts are offered", async () => {
    const { stub, seen } = capturingSdk({ stop_reason: "end_turn", parsed_output: { proposals: [] } })
    await toAssayClient(stub, "qwen2.5:7b").propose({ system: "s", user: "u", excerpts: EXCERPTS })
    expect(Object.keys(seen[0] as object).sort()).toEqual(["max_tokens", "messages", "model", "output_format", "system"])
  })

  it("carries the excerpts for a sear/ model, which copies its quotes out of them", async () => {
    const { stub, seen } = capturingSdk({ stop_reason: "end_turn", parsed_output: { proposals: [] } })
    await toAssayClient(stub, "sear/Qwen2.5-7B-Instruct-Q6_K").propose({ system: "s", user: "u", excerpts: EXCERPTS })
    expect((seen[0] as Record<string, unknown>).excerpts).toEqual(EXCERPTS)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cartographer/sear.test.ts src/cartographer/anthropic.test.ts`
Expected: FAIL — `./sear.js` does not exist; the `sear/` body test finds no `excerpts`.

- [ ] **Step 3: Implement `sear.ts`**

Create `src/cartographer/sear.ts`:

```ts
import { request as httpRequest } from "node:http"
import { ProposalBatchSchema } from "../assay/cartographer/schema.js"
import type { SdkProposalClient } from "./anthropic.js"

/** Every SEAR proposer's model id starts with this; `toAssayClient` keys the excerpts on it. */
export const SEAR_MODEL_PREFIX = "sear/"

export type Post = (url: string, body: unknown) => Promise<{ status: number; text: string }>

/**
 * POST JSON with no timeout. The sidecar decodes one request at a time and
 * the engine sends passes three at a time, so a queued request can wait
 * longer than fetch's default 300-second headers timeout on a CPU rig.
 * http:// only -- the sidecar binds localhost.
 */
export const postJson: Post = (url, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = httpRequest(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    req.end(payload)
  })

/**
 * A parse-shaped client backed by gin's SEAR proposer sidecar
 * (gin/scripts/assay_proposer_serve.py). The sidecar copies every quote out
 * of the excerpts at decode time, so a quote that is not a sentence of the
 * right document is unreachable; admit() still checks every quote
 * afterwards, as it does for every proposer.
 */
export function searClient(opts: { host?: string; post?: Post } = {}): SdkProposalClient {
  const host = (opts.host ?? process.env["SEAR_HOST"] ?? "http://127.0.0.1:8766").replace(/\/$/, "")
  const post = opts.post ?? postJson
  return {
    beta: {
      messages: {
        parse: async (body) => {
          if (!body.model.startsWith(SEAR_MODEL_PREFIX)) {
            throw new Error(`sear: model id must start with ${SEAR_MODEL_PREFIX}, got ${body.model}`)
          }
          if (!body.excerpts) {
            throw new Error("sear: request carries no excerpts; the proposer copies its quotes out of them")
          }
          const response = await post(`${host}/v1/propose`, {
            model: body.model,
            system: body.system,
            messages: body.messages,
            excerpts: body.excerpts,
          })
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`sear: ${response.status} ${response.text}`)
          }
          let reply: { model?: unknown; proposals?: unknown }
          try {
            reply = JSON.parse(response.text) as { model?: unknown; proposals?: unknown }
          } catch {
            throw new Error("sear: response was not JSON")
          }
          if (reply.model !== body.model) {
            throw new Error(`sear: asked for ${body.model}, the proposer answered as ${String(reply.model)}`)
          }
          const batch = ProposalBatchSchema.safeParse({ proposals: reply.proposals })
          if (!batch.success) {
            throw new Error(`sear: response did not match the proposal schema: ${batch.error.issues[0]?.message ?? "unknown"}`)
          }
          return { stop_reason: "end_turn", parsed_output: batch.data }
        },
      },
    },
  }
}
```

- [ ] **Step 4: Implement the body rule in `anthropic.ts`**

In `src/cartographer/anthropic.ts`, change the import on line 4:

```ts
import type { ProposalClient } from "../assay/cartographer/propose.js"
```

to:

```ts
import type { ProposalClient, ProposeExcerpt } from "../assay/cartographer/propose.js"
import { SEAR_MODEL_PREFIX } from "./sear.js"
```

Add one field to `ParseRequest`, after `output_format`:

```ts
  output_format: ReturnType<typeof betaZodOutputFormat>
  /** Present only when the model id starts with sear/; see toAssayClient. */
  excerpts?: ProposeExcerpt[]
}
```

Replace the body of `toAssayClient`:

```ts
export function toAssayClient(sdk: SdkProposalClient, model: string = MODEL): ProposalClient {
  return {
    async propose({ system, user }) {
      const request: ParseRequest = {
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_format: betaZodOutputFormat(ProposalBatchSchema),
      }
```

with:

```ts
export function toAssayClient(sdk: SdkProposalClient, model: string = MODEL): ProposalClient {
  // A SEAR proposer copies its quotes out of the excerpts at decode time, so
  // only its requests carry them. Keyed on the model id -- which the manifest
  // stamps -- so a SEAR ledger replays with the bodies it was recorded with,
  // and every other body stays byte-identical to what the caches keyed on.
  const withExcerpts = model.startsWith(SEAR_MODEL_PREFIX)
  return {
    async propose({ system, user, excerpts }) {
      const request: ParseRequest = {
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_format: betaZodOutputFormat(ProposalBatchSchema),
        ...(withExcerpts && excerpts ? { excerpts } : {}),
      }
```

(the rest of `toAssayClient` is unchanged).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cartographer/sear.test.ts src/cartographer/anthropic.test.ts src/cartographer/ollama.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, and replay**

Run: `npm run typecheck && npx vitest run && npm run replay`
Expected: typecheck clean; all tests pass; replay prints `1 replayed, 3 not replayable`.

- [ ] **Step 7: Commit**

```bash
git add src/cartographer/sear.ts src/cartographer/sear.test.ts src/cartographer/anthropic.ts src/cartographer/anthropic.test.ts
git commit -m "$(cat <<'EOF'
Add searClient, and carry excerpts only on sear/ requests

An SDK-shaped client for gin's SEAR proposer sidecar, posting over
node:http (no timeout: requests queue behind one decoder). toAssayClient
adds the structured excerpts to the body exactly when the model id
starts with sear/, so SEAR ledgers replay with their recorded bodies and
every other cache key is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `--client sear` and documentation (receipts)

**Files:**
- Modify: `src/cli/args.ts` (client validation, tier default, `client` type)
- Modify: `src/cli/index.ts` (usage text, key checks, proposer)
- Modify: `README.md`, `architecture.md`
- Test: `src/cli/args.test.ts`, `src/cli/index.test.ts`

**Interfaces:**
- Consumes: Task 6's `searClient`, `SEAR_MODEL_PREFIX`.
- Produces: `CliOptions.client?: "anthropic" | "ollama" | "sear"`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/args.test.ts`, replace the body of the test `"selects the proposer client: anthropic by default, ollama on request, nothing else"` with:

```ts
    expect(parseArgs(["acme"]).client).toBeUndefined()
    expect(parseArgs(["acme", "--client", "ollama"]).client).toBe("ollama")
    expect(parseArgs(["acme", "--client", "sear"]).client).toBe("sear")
    expect(parseArgs(["acme", "--client", "anthropic"]).client).toBe("anthropic")
    expect(() => parseArgs(["acme", "--client", "openai"])).toThrow("receipts: --client must be anthropic, ollama, or sear")
    expect(() => parseArgs(["acme", "--replay", "r.json", "--client", "ollama"]))
      .toThrow("receipts: --client picks the proposer for a model call; this run makes none")
```

(keep any assertions that followed these lines in that test unchanged), and in the test `"selects the prompt tier: frontier by default, small with --client ollama, explicit wins"` add:

```ts
    expect(parseArgs(["acme", "--client", "sear"]).promptTier).toBe("small")
```

In `src/cli/index.test.ts`, append:

```ts
describe("--client sear needs a sear/ SEAR_MODEL (src/cli/index.ts)", () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cli-sear-"))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  function runSear(extraEnv: Record<string, string>) {
    return spawnSync(
      process.execPath,
      [TSX_CLI, CLI_ENTRY, "acme", "--from-fixture", FIXTURE, "--client", "sear"],
      {
        cwd,
        env: {
          // No ANTHROPIC_API_KEY: --client sear must not need one.
          PATH: process.env["PATH"] ?? "",
          SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "",
          ...extraEnv,
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
  }

  it("dies naming SEAR_MODEL, and not the Anthropic key, when it is unset", () => {
    const result = runSear({})
    expect(result.stderr).toContain("SEAR_MODEL is not set")
    expect(result.stderr).not.toContain("ANTHROPIC_API_KEY is not set")
    expect(result.status).not.toBe(0)
  }, 65_000)

  it("dies when SEAR_MODEL is not a sear/ id", () => {
    const result = runSear({ SEAR_MODEL: "qwen2.5:7b" })
    expect(result.stderr).toContain("SEAR_MODEL must start with sear/")
    expect(result.status).not.toBe(0)
  }, 65_000)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/args.test.ts src/cli/index.test.ts`
Expected: FAIL — `--client sear` is rejected by `args.ts`; the CLI never mentions `SEAR_MODEL`.

- [ ] **Step 3: Implement `args.ts`**

In `src/cli/args.ts`, change the `client` field's doc and type:

```ts
  /** Which proposer answers a model call. Absent means the Anthropic SDK; "ollama" needs OLLAMA_MODEL. */
  client?: "anthropic" | "ollama"
```

to:

```ts
  /** Which proposer answers a model call. Absent means the Anthropic SDK; "ollama" needs OLLAMA_MODEL; "sear" needs SEAR_MODEL. */
  client?: "anthropic" | "ollama" | "sear"
```

Change the validation:

```ts
    if (rawClient !== "anthropic" && rawClient !== "ollama") {
      throw new Error("receipts: --client must be anthropic or ollama")
    }
```

to:

```ts
    if (rawClient !== "anthropic" && rawClient !== "ollama" && rawClient !== "sear") {
      throw new Error("receipts: --client must be anthropic, ollama, or sear")
    }
```

Change the tier default:

```ts
  const promptTier: PromptTier = rawTier ?? (rawClient === "ollama" ? "small" : "frontier")
```

to:

```ts
  const promptTier: PromptTier = rawTier ?? (rawClient === "ollama" || rawClient === "sear" ? "small" : "frontier")
```

- [ ] **Step 4: Implement `index.ts`**

In `src/cli/index.ts`, add after the `ollamaClient` import (line 6):

```ts
import { searClient, SEAR_MODEL_PREFIX } from "../cartographer/sear.js"
```

In the usage text, replace:

```
  --client <name>         proposer for the model call: anthropic (default) or ollama
                          (a local server at OLLAMA_HOST answering as OLLAMA_MODEL;
                          the model id is stamped on the manifest and keys the cache)
  --prompt-tier <tier>    proposer prompt: frontier (default) or small (default with
                          --client ollama). Stamped on the manifest; replay uses the same.
```

with:

```
  --client <name>         proposer for the model call: anthropic (default), ollama
                          (a local server at OLLAMA_HOST answering as OLLAMA_MODEL), or
                          sear (gin's SEAR sidecar at SEAR_HOST answering as SEAR_MODEL,
                          quotes copied at decode time). The model id is stamped on
                          the manifest and keys the cache.
  --prompt-tier <tier>    proposer prompt: frontier (default) or small (default with
                          --client ollama or sear). Stamped on the manifest; replay uses the same.
```

and replace the two environment lines:

```
  ANTHROPIC_API_KEY  required unless --fetch-only, --render, --replay, --refresh without --rerun, or --client ollama
  OLLAMA_MODEL       required with --client ollama (OLLAMA_HOST defaults to http://127.0.0.1:11434)
```

with:

```
  ANTHROPIC_API_KEY  required unless --fetch-only, --render, --replay, --refresh without --rerun, or --client ollama|sear
  OLLAMA_MODEL       required with --client ollama (OLLAMA_HOST defaults to http://127.0.0.1:11434)
  SEAR_MODEL         required with --client sear: the sear/<model> id the sidecar prints at startup
                     (SEAR_HOST defaults to http://127.0.0.1:8766; start gin/scripts/assay_proposer_serve.py first)
```

Replace the key checks and proposer:

```ts
if (makesModelCall && opts.client !== "ollama" && !process.env.ANTHROPIC_API_KEY) {
  die(
    "ANTHROPIC_API_KEY is not set. Every run calls the model, unless " +
      "--fetch-only, --replay, --refresh without --rerun, or --client ollama.",
  )
}
if (makesModelCall && opts.client === "ollama" && !process.env.OLLAMA_MODEL) {
  die("OLLAMA_MODEL is not set. --client ollama sends every request to that model and stamps it on the manifest.")
}
// The proposer, chosen once: the Ollama adapter speaks the same parse-shaped
// contract as the SDK, so the cache and the manifest see one body either way.
const proposer = opts.client === "ollama"
  ? { client: ollamaClient(), model: process.env.OLLAMA_MODEL! }
  : {}
```

with:

```ts
const localProposer = opts.client === "ollama" || opts.client === "sear"
if (makesModelCall && !localProposer && !process.env.ANTHROPIC_API_KEY) {
  die(
    "ANTHROPIC_API_KEY is not set. Every run calls the model, unless " +
      "--fetch-only, --replay, --refresh without --rerun, or --client ollama|sear.",
  )
}
if (makesModelCall && opts.client === "ollama" && !process.env.OLLAMA_MODEL) {
  die("OLLAMA_MODEL is not set. --client ollama sends every request to that model and stamps it on the manifest.")
}
if (makesModelCall && opts.client === "sear") {
  const searModel = process.env.SEAR_MODEL
  if (!searModel) {
    die("SEAR_MODEL is not set. --client sear sends every request to gin's SEAR sidecar as that model and stamps it on the manifest.")
  }
  if (!searModel.startsWith(SEAR_MODEL_PREFIX)) {
    die(`SEAR_MODEL must start with ${SEAR_MODEL_PREFIX}: use the id the sidecar prints at startup, e.g. sear/Qwen2.5-7B-Instruct-Q6_K.`)
  }
}
// The proposer, chosen once: the local adapters speak the same parse-shaped
// contract as the SDK, so the cache and the manifest see one body either way.
const proposer = opts.client === "ollama"
  ? { client: ollamaClient(), model: process.env.OLLAMA_MODEL! }
  : opts.client === "sear"
    ? { client: searClient(), model: process.env.SEAR_MODEL! }
    : {}
```

If `die` in this file is not typed as returning `never`, `searModel` stays `string | undefined` after the first `if` and `searModel.startsWith` fails typecheck; in that case write the second check as `if (searModel && !searModel.startsWith(SEAR_MODEL_PREFIX))`.

- [ ] **Step 5: Document it**

In `README.md`, insert this paragraph immediately after the paragraph that ends "`and both are in the key.`" (the one beginning `` `--client ollama` sends every proposal pass``):

```markdown
`--client sear` sends every proposal pass to gin's SEAR proposer instead: a
local sidecar (`python scripts/assay_proposer_serve.py --model <gguf>` in the
gin repo, at `SEAR_HOST`, default `http://127.0.0.1:8766`) that runs the model
under SEAR's decode-time copy constraint, so a quote that is not a whole
sentence of the right document is unreachable rather than denied afterwards.
`SEAR_MODEL` must be the id the sidecar prints at startup
(`sear/<gguf file stem>`); it is stamped on the manifest and keys the cache like
any other model id, and SEAR requests also carry the excerpts, structured,
because the sidecar copies its quotes out of them. `admit()` still checks every
quote, as it does for every proposer. The design is
[`docs/superpowers/specs/2026-09-25-sear-proposer-design.md`](docs/superpowers/specs/2026-09-25-sear-proposer-design.md);
no committed ledger uses it yet.
```

In `architecture.md`, add this row to the module table immediately after the `` `src/cartographer/anthropic.ts` `` row:

```markdown
| `src/cartographer/ollama.ts`, `src/cartographer/sear.ts` | Local proposers. Ollama over HTTP; gin's SEAR sidecar, which copies quotes at decode time from the structured `excerpts` that `toAssayClient` sends only for `sear/` model ids. |
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/args.test.ts src/cli/index.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite, typecheck, and replay**

Run: `npm run typecheck && npx vitest run && npm run replay`
Expected: typecheck clean; all tests pass; replay prints `1 replayed, 3 not replayable`.

- [ ] **Step 8: Commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts src/cli/index.ts src/cli/index.test.ts README.md architecture.md
git commit -m "$(cat <<'EOF'
Add --client sear, backed by gin's SEAR proposer sidecar

Requires a sear/ SEAR_MODEL (the id the sidecar prints), needs no
Anthropic key, and defaults to the small prompt tier like --client
ollama. README and architecture describe the sidecar and the excerpts
it copies from.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Engine sync (claim-record)

**Files:**
- Modify: `claim-record/src/assay/` (full directory replace from receipts; never hand-edited)

**Interfaces:**
- Consumes: Task 5's engine change (`src/assay/cartographer/propose.ts`).
- Produces: nothing further tasks depend on. Claim/Record's own clients (`src/instance/anthropic.ts`, `src/instance/ollama.ts`) implement `propose({ system, user })` and keep compiling — the new field is optional.

- [ ] **Step 1: Sync**

From `C:\Users\krist\Projects\claim-record`:

```bash
rm -rf src/assay
cp -r ../receipts/src/assay src/assay
```

- [ ] **Step 2: Confirm byte-identity**

Run: `diff -rq src/assay ../receipts/src/assay`
Expected: no output.

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck && npx vitest run`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/assay
git commit -m "$(cat <<'EOF'
Sync the Assay engine: structured excerpts on the proposal contract

Byte-identical copy of receipts' src/assay. ProposalClient.propose gains
an optional excerpts field; Claim/Record's clients ignore it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Controller steps (not subagent tasks)

- **Before Task 1:** create the `sear-proposer` branch in `gin`, `receipts`, and `claim-record`.
- **After Task 4:** `docs/GIN_15_Receipts.md` in gin is the owner's *untracked* draft. It says Receipts gets the grounding guarantee "with post-hoc exact-substring verification — no constrained decoding, no local model." Edit that sentence in place to say Receipts now holds both enforcement points and chooses per proposer (SEAR via the `gin/assay_proposer` sidecar for local GGUF models, post-hoc `admit()` for API models), citing [[GIN_14_Assay]] §8 — and **leave the file uncommitted**, telling the owner it changed. Committing it would commit their whole draft.
- **Final check:** receipts `npm run typecheck && npx vitest run && npm run replay` (`1 replayed, 3 not replayable`); claim-record `npm run typecheck && npx vitest run` and `diff -rq src/assay ../receipts/src/assay` empty; gin `python -m pytest tests/test_assay_proposer_corpus.py tests/test_assay_proposer_slots.py tests/test_assay_proposer_app.py tests/test_assay_proposer_runtime.py tests/test_processor.py -q`; `git -C ../gin/GIN status --short` shows the owner's pre-existing edits still unstaged and nothing of theirs committed.
- **Owner-run afterwards (not in this plan):** the paid Opus showcase restamp, then the three-way Tesla measurement (Opus / `--client ollama` qwen2.5:7b / `--client sear` Qwen2.5-7B Q6_K) on the RTX 4070 with `--n-gpu-layers -1`, as the spec's Measurement section describes.

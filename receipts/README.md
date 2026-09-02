# Receipts

**What a vendor claims, what independent sources report, and which claims nothing corroborates.**

Receipts fans a set of cloud browsers across a vendor's own marketing and the places
users actually complain — status pages, Hacker News, Reddit, review sites — and
produces a claim ledger. Every quote in it is verified to be an exact substring of a
page that was actually fetched.

An LLM proposes which claims contradict which. A deterministic gate then re-derives
every quote's position from the bytes we fetched and **discards anything it cannot
find**. The model organises; the sources speak.

---

## A real ledger

This is unedited output from `npm run cli -- vercel --render reports/vercel.json`:

```
  vercel — claim ledger
  generated 2026-09-02T00:13:20.644Z

  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  platform described as secure by default  [security posture]
    vendor      vercel pricing
      "Ultra-fast, secure by default global application delivery."
    independent Hacker News
      "Vercel April 2026 security
      incident(https://www.bleepingcomputer.com/news/security/vercel-confirms-breach-as-hackers-claim-to-be-selling-stolen-data/)"

  CLI as a supported deployment path  [service availability]
    vendor      vercel docs
      "Deploy your app on Vercel in three steps: install the CLI, add agent
      support if you use an AI coding agent, and deploy."
    independent vercel status page
      "Failures logging in with Vercel CLI"

  UNVERIFIED — no independent source either way
  ---------------------------------------------

  Notion runs millions of daily agent conversations on Vercel  [customer scale claim]
    vendor      vercel homepage
      "Notion powers millions of agent conversations daily on Vercel."

  Service Requests priced at $0.50 per 1M with 1M included  [pricing rates]
    vendor      vercel pricing
      "Service Requests Beta 1M requests / month included Starting at $0.50
      per 1M"

  sources
    vendor      vercel docs  https://docs.vercel.com
    vendor      vercel homepage  https://vercel.com
    independent vercel status page  https://status.vercel.com
    independent Hacker News  https://hn.algolia.com/?q=vercel.com
    vendor      vercel pricing  https://vercel.com/pricing
    not read    G2 reviews  (empty)
    not read    Reddit  (blocked)

  audit: proposed 8 · admitted 4 · denied 4 (4 LOW_CONFIDENCE)

  Every quote above is an exact substring of the page text fetched at the
  time shown. Proposals whose quotes could not be found were denied.
```

Three things in that output are the whole design:

**The audit line.** Publishing the denial count is what makes the guarantee checkable
rather than a claim. A reader can see that four proposals were rejected and why.

**The `UNVERIFIED` section.** Every summariser silently drops claims it cannot check.
A vendor claim that no independent source corroborates is a *finding*, not an
absence, so it gets its own section and says so.

**`not read` sources.** Reddit blocked us and G2 returned nothing. Partial coverage
stated out loud beats a report that quietly looks complete.

---

## The guarantee

> **No quote in any report is absent from the bytes we fetched.**

The model can pair claims and characterise them. It **structurally cannot fabricate a
quote**, because the gate re-derives every span from the source text by exact
substring match — no fuzzy matching, no normalisation, no trimming. A paraphrase, a
single altered word, or different whitespace all fail to anchor and never reach the
report.

The test that proves it is a property test in
[`src/bookkeeper/admit.test.ts`](src/bookkeeper/admit.test.ts): it feeds the gate 200
proposals, half of them fabricated, and asserts no admitted span is ever absent from
its source. The adversarial cases live in
[`src/bookkeeper/anchor.test.ts`](src/bookkeeper/anchor.test.ts) — paraphrases,
one-word edits, whitespace variants, quotes stitched across documents.

**Measured, not assumed:** across two live runs and eighteen proposals against pages
the model had never seen, there were **zero `ANCHOR_NOT_FOUND` denials**. Every quote
it offered was byte-exact.

---

## Quickstart

```bash
cd receipts && npm install
```

Copy `.env.example` to `.env` and fill it in:

```
SOLARI_API_KEY=slr_live_...        # console.getsolari.com
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_WORKSPACE_ID=wrkspc_...  # only for identity-linked keys
```

**Read a saved report — free, no keys:**

```bash
npm run cli -- vercel --render reports/vercel.json
```

**Analyse a saved corpus — one model call, no browser time:**

```bash
npm run cli -- vercel --from-fixture fixtures/vercel.json
```

**Run it against a live vendor:**

```bash
npm run cli -- stripe --domain stripe.com --proxy smart
```

**Capture a corpus without analysing it** — needs only a Solari key, and lets you
iterate on the engine offline for free afterwards:

```bash
npm run cli -- stripe --domain stripe.com --fetch-only --proxy smart --snapshot fixtures/stripe.json
```

Run `npm run cli` with no arguments for the full flag list.

### As an MCP tool

```bash
npm run mcp
```

Exposes one tool, `diligence_vendor`, so an agent can run diligence and get the ledger
back as markdown. Point any MCP client at `receipts/src/mcp/server.ts`.

### As a web page

```bash
npm run site -- reports/vercel.json   # writes public/
npm run serve                         # serves it, plus a rate-limited /run
```

---

## How it works

```
sources/ → fetch/ → chunk/ → retrieve/ → cartographer/ → bookkeeper/ → report/
           [Solari]                       [Claude]        [pure]        [pure]
                                                                           │
                                                       cli/ · mcp/ · web/
```

Nothing imports upward. `bookkeeper/` never imports the cartographer's client — it
receives proposals as plain data, which is what keeps the layers independently
falsifiable.

| Stage | What it does |
|---|---|
| `sources/` | Resolves a vendor name to pages worth reading. Refuses to guess a domain it might get wrong. |
| `fetch/` | The browser fan — the only module that touches the network. Normalises text once; that output is the substrate every later check runs against. |
| `chunk/` | Splits documents into chunks carrying offsets, so a claim can cite `(docId, start, end)`. |
| `retrieve/` | IDF-weighted selection of what the model sees. The run's dominant cost. |
| `cartographer/` | Proposes typed relations. Carries verbatim quotes; may not assert offsets; never writes the report. |
| `bookkeeper/` | The gate. Sole writer of report content. Denials are kept and published. |
| `report/` | One canonical JSON, rendered to terminal, markdown, and HTML. |

A claim is admitted only if its quote anchors exactly, its span is at most 40 words,
both sides are relevant to the subject, confidence clears a floor, and it is not a
duplicate of something already admitted.

---

## Why cloud browsers

The sources worth reading are the ones that refuse automation. Measured against
`vercel.com` on a paid Solari plan with stealth and residential proxy egress:

| Source | Result |
|---|---|
| vendor docs, pricing, homepage | read |
| status page | read — 90 days of per-component incident history |
| Hacker News | read — 29k characters, 530 results |
| G2 | nothing at the product URL |
| Reddit | **blocked even through stealth + residential proxy** |

And on the **free plan**, where stealth is not available, the same run reads the
vendor's own three pages and **zero independent sources**. Reddit answers with
"You've been blocked by network security"; everything else returns nothing.

That is the honest shape of this problem: a tool that only reads what a company says
about itself is not a diligence tool. Stealth and proxy egress are not a nice-to-have
here — they are the difference between one side of the ledger and two.

---

## What it costs

| Component | Estimate |
|---|---|
| Browser fan, ~7 sources | a few cents |
| One Claude Opus call at 40 candidates | ~$0.14 |
| **Per full run** | **~$0.18** |

`--candidates` tunes how much of the corpus the model sees and is the main cost lever.
`--fetch-only` and `--render` cost nothing beyond browser time and nothing at all
respectively.

**One caveat worth stating plainly:** results vary between runs. The same fixture at
the same settings produced two rows on one run and four on another. An LLM proposer is
not deterministic, so a single run is not a reliable read of a vendor — treat it as a
lead, not a verdict.

---

## Lineage

The epistemic design is ported from **GIN**, a federated grounded-reasoning system.
Three ideas carry over:

- **Productive divergence.** When sources disagree, surface the disagreement rather
  than averaging it away. Divergent findings are rendered with both sides together,
  always.
- **Exact attribution by construction.** GIN's SEAR layer constrains generation to
  spans occurring verbatim in a corpus. Receipts gets the same guarantee with
  post-hoc exact-substring verification — no constrained decoding, no local model.
- **Layer separation.** Propose, admit, render are three modules with typed
  interfaces, so no layer can inflate its own record.

Deliberately *not* ported: the Postgres/pgvector corpus tier, embeddings, and the
learned frame detector — GIN's own measurements record that detector failing its
escalation bar, and vendor-claim-versus-user-report divergence is exactly the class it
failed on.

Full design: [`docs/superpowers/specs/2026-08-31-receipts-design.md`](../docs/superpowers/specs/2026-08-31-receipts-design.md).

---

## Browsers only

Solari offers browsers, sandboxes, and desktops. This uses browsers and nothing else.

Every honest use here is a browser use, and adding a sandbox to touch a second
primitive would be decoration — the kind of thing reviewers who build this
infrastructure spot immediately. The constraint is the point.

---

## Development

```bash
npm test        # 176 tests
npm run typecheck
```

Everything except `fetch/` is a pure function of a captured corpus, so the whole
engine is testable offline against committed fixtures — no key, no network, no cost.
`fixtures/` holds two real captures: `vercel.json` (both roles populated) and
`solari-free-plan.json` (a vendor with no third-party footprint, which the tool
correctly reports as an absence of coverage rather than a clean bill of health).

MIT licensed.

# Receipts

**What a vendor claims, what independent sources report, and which claims nothing corroborates.**

> Written for the Pinetree Research challenge, and built on
> [Solari](https://getsolari.com) cloud browsers. It started as a fork of the
> [Solari cookbook](https://github.com/solari-sdk/solari-cookbook) — the commit
> history begins there, and the MIT licence and copyright are carried forward. The
> cookbook's own examples are not redistributed here; everything in this repository
> apart from that history is original.

Receipts fans a set of cloud browsers across a vendor's own marketing and across
independent writing about it — status pages, Hacker News, Wikipedia, regulators,
review sites — and produces a claim ledger. Every quote in it is verified to be an
exact substring of a page that was actually fetched.

Reddit and G2 are in the source plan and usually refuse: Reddit blocks even stealth
plus a residential proxy, and G2 tends to return nothing. Those attempts are reported
as `not read`, with the reason, rather than quietly narrowing the ledger — the point
of naming them is that you can see what the coverage is missing.

An LLM proposes which claims contradict which. A deterministic gate then re-derives
every quote's position from the bytes we fetched and **discards anything it cannot
find**. The model organises; the sources speak.

---

## A real ledger

One row, from `npm run cli -- tesla --render reports/tesla-fsd.json`. Tesla's own
FSD page against a Hacker News thread:

```
  FSD drives almost anywhere with minimal intervention  [intervention frequency]
    tesla       Tesla FSD page
      "When enabled, your vehicle will drive you almost anywhere with your
      active supervision, requiring minimal intervention."
    independent Hacker News - FSD
      "Tesla Full Self Driving requires human intervention every 13 miles"
```

Both halves are verbatim. You can check either: open
[`reports/tesla-fsd.json`](reports/tesla-fsd.json), take the character offsets on
that row, and slice them out of the corresponding document in
[`fixtures/tesla-fsd.json`](fixtures/tesla-fsd.json). If a quote were paraphrased by
a word, the slice would not match — which is the point.

<details>
<summary>The full ledger (unedited)</summary>

```
  Tesla FSD — claim ledger
  generated 2026-09-04T17:52:19.398Z

  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  Advertised single $99/mo price is no longer the only tier  [FSD subscription price tiers]
    tesla       Tesla FSD page
      "Available for $99/mo1"
    independent Wikipedia - Tesla Autopilot
      "For EAP owners, the subscription price was reduced to $49 per month."

  FSD drives almost anywhere with minimal intervention  [intervention frequency]
    tesla       Tesla FSD page
      "When enabled, your vehicle will drive you almost anywhere with your
      active supervision, requiring minimal intervention."
    independent Hacker News - FSD
      "Tesla Full Self Driving requires human intervention every 13 miles"

  FSD makes roads safer for everyone  [road safety benefit]
    tesla       Tesla FSD page
      "Tesla uses billions of miles of anonymous real-world driving data to
      train Full Self-Driving (Supervised) to take care of the most stressful
      parts of daily driving while helping make the roads safer for you and
      others."
    independent Wikipedia - Tesla Autopilot
      "Industry experts and safety advocates have raised concerns about the
      deployment of the software to the general public, calling the practice
      risky and potentially irresponsible."

  CORROBORATED — independently confirmed
  --------------------------------------

  FSD (Supervised) is offered on subscription at $99/mo  [FSD subscription price]
    tesla       Tesla FSD page
      "Available for $99/mo1"
    independent Wikipedia - Tesla Autopilot
      "Tesla reduced the FSD subscription price to $99 per month for either
      new users or users who had already purchased EAP"

  sources
    independent NHTSA - automated vehicles  https://www.nhtsa.gov/vehicle-safety/automated-vehicles-safety
    independent Hacker News - FSD  https://hn.algolia.com/?q=tesla%20full%20self%20driving
    independent Wikipedia - Tesla Autopilot  https://en.wikipedia.org/wiki/Tesla_Autopilot
    independent IIHS - driver assistance  https://www.iihs.org/topics/advanced-driver-assistance
    independent Wikipedia - Criticism of Tesla  https://en.wikipedia.org/wiki/Criticism_of_Tesla,_Inc.
    tesla       Tesla FSD page  https://www.tesla.com/fsd
    independent Hacker News - crashes  https://hn.algolia.com/?q=tesla%20autopilot%20crash%20NHTSA

  audit: proposed 8 · admitted 4 · denied 4 (2 INCOHERENT_QUOTE, 2 LOW_CONFIDENCE)

  Every quote above is an exact substring of the page text fetched at the
  time shown. Proposals whose quotes could not be found were denied.
```

The two `INCOHERENT_QUOTE` denials in that audit line are the gate refusing bare
product names — an earlier run of this corpus evidenced "FSD available for $99 per
month" with the words `"Full Self-Driving (Supervised)"`, which names a product and
asserts nothing. Rejecting those forced the model onto the words that actually make
the claim, `"Available for $99/mo1"`, and turned up a finding the ragged version had
hidden: the advertised single price is not the only tier.

</details>

Three things in that output are the whole design:

**The audit line.** Publishing the denial count is what makes the guarantee checkable
rather than a claim. A reader can see that four proposals were rejected and why —
and `2 INCOHERENT_QUOTE` says the gate turned down spans that anchored perfectly and
still said nothing.

**The `UNVERIFIED` section.** Every summariser silently drops claims it cannot check.
A vendor claim that no independent source corroborates is a *finding*, not an
absence, so it gets its own section and says so.

**`not read` sources.** Coverage is always partial, and partial coverage stated out
loud beats a report that quietly looks complete. On the Tesla run every source read;
on Vercel below, two did not.

### A second vendor

Same engine, no per-vendor code, from
`npm run cli -- vercel --render reports/vercel.json`:

```
  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  secure by default delivery network  [security posture]
    vendor      vercel pricing
      "Ultra-fast, secure by default global application delivery."
    independent Hacker News
      "Vercel April 2026 security
      incident(https://www.bleepingcomputer.com/news/security/vercel-confirms-breach-as-hackers-claim-to-be-selling-stolen-data/)"

  UNVERIFIED — no independent source either way
  ---------------------------------------------

  Notion runs millions of daily agent conversations on Vercel  [customer scale]
    vendor      vercel homepage
      "Notion powers millions of agent conversations daily on Vercel."

  sources
    ...
    not read    G2 reviews  (empty)
    not read    Reddit  (blocked)

  audit: proposed 9 · admitted 2 · denied 7 (2 NOT_QUERY_RELEVANT, 5 LOW_CONFIDENCE)
```

Nine proposals, two rows. That ratio is the tool working: seven proposals were the
model reaching, and the gates said so out loud instead of padding the ledger.

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

**Measured, not assumed:** across seven live runs and seventy-five proposals — three
subjects (a SaaS vendor, an AI lab, and a decade-old public argument), pages the model
had never seen, one corpus containing two 160k-character Wikipedia articles — there
were **zero `ANCHOR_NOT_FOUND` denials**. Every quote it offered was byte-exact. The
denials were the *other* guards doing their jobs: low confidence, off-topic,
self-sourced, and incoherent-fragment.

### What the guarantee does not cover

It proves **provenance, not truth**. A quote is guaranteed to appear in the page it is
attributed to. It is not guaranteed to be *correct* — and an aggregator result is
itself a claim by whoever submitted it.

So a divergent row is a lead with exact provenance, not a verdict. The distinction
matters most on exactly the rows that look most damning.

The Vercel security row above was therefore checked by hand before publishing.
[Vercel's own bulletin](https://vercel.com/kb/bulletin/vercel-april-2026-security-incident),
19 April 2026, states: *"We've identified a security incident that involved
unauthorized access to certain internal Vercel systems."*
[BleepingComputer](https://www.bleepingcomputer.com/news/security/vercel-confirms-breach-as-hackers-claim-to-be-selling-stolen-data/)
reported the same on the same date. The finding holds, and is stronger than the ledger
shows — the incident is confirmed by the vendor, not merely alleged by a third party.

**That check is a human step this tool does not perform and does not claim to.** What
it does is make the check cheap: an exact quote and a live URL, rather than a summary
you would have to re-derive from scratch.

---

## Quickstart

```bash
git clone https://github.com/KristianKrattiger/receipts.git
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

**Point it at something other than a vendor:**

```bash
npm run cli -- claude --sources plans/ai-model-claims.json --proxy smart
```

Run `npm run cli` with no arguments for the full flag list.

### As an MCP tool

```bash
npm run mcp
```

Exposes one tool, `diligence_vendor`, so an agent can run diligence and get the ledger
back as markdown. Point any MCP client at `src/mcp/server.ts`.

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
| `sources/` | Resolves a subject to pages worth reading — vendor conventions by default, or a supplied plan. Refuses to guess a domain it might get wrong. |
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

## Not only vendors

Nothing in the engine is vendor-specific. The admission gate contains no role logic
at all: a document is either a `claimant` — whoever is making the claims — or
`independent`, and the only thing that differs between domains is what those two are
*called* in the output.

So a new domain is a JSON file, not a code change:

```json
{
  "subject": "claude",
  "labels": { "claimant": "Model card", "independent": "Independent" },
  "targets": [
    { "kind": "vendor_site", "role": "claimant",
      "url": "https://www.anthropic.com/claude", "label": "Claude product page" },
    { "kind": "forum", "role": "independent",
      "url": "https://hn.algolia.com/?q=anthropic.com", "label": "Hacker News" }
  ]
}
```

[`plans/ai-model-claims.json`](plans/ai-model-claims.json) is a worked example — a
model vendor's own product page, pricing and model docs against its status page and
Hacker News. The ledger then reads *Model card* where it would otherwise read
*Vendor*.

It reads **6 of 6 sources**, captured in [`fixtures/claude.json`](fixtures/claude.json):

```
read  Model overview docs        4825 chars   Model card
read  Claude product page        4691 chars   Model card
read  Anthropic pricing          5730 chars   Model card
read  Anthropic status page      6672 chars   Independent
read  Hacker News               39532 chars   Independent
read  Hacker News — benchmarks  26422 chars   Independent

6 read, 0 failed
```

No engine changes were involved — one JSON file, and the same pipeline that reads SaaS
vendors reads an AI lab. The ledger it produces is in
[`reports/claude.json`](reports/claude.json):

```
  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  Cowork lets users start a task and check in on it later to get finished
  deliverables  [Claude Cowork reliability]
    model card  Claude product page
      "With Claude Cowork, you can start a task at your desk, check in on it
      from your phone, and get a polished deck, document, or spreadsheet for
      review."
    independent Anthropic status page
      "Some sessions may fail to start or disconnect mid-task; affected
      sessions can be retried."

  Claude claims top-tier results in reasoning and image processing  [model performance claims]
    model card  Model overview docs
      "Performance: Top-tier results in reasoning, coding, multilingual tasks,
      long-context handling, honesty, and image processing."
    independent Hacker News — benchmarks
      "We have seen the best results with Gemini models for visual reasoning,
      achieving SOTA (beating Claude Fable) on the strongest grounded
      reasoning benchmark we have found (Databricks OfficeQA)."

  audit: proposed 9 · admitted 2 · denied 7 (1 DUPLICATE, 6 LOW_CONFIDENCE)
```

Nine proposals, two rows, and **no corroborations at all**. An earlier run of this
same corpus reported two, and both were bare model names — `"Claude Sonnet 5"` paired
with a benchmark link that also said "Claude Sonnet 5". The gate now refuses a span
that only names a product, and what survives is the pair of rows where an independent
source genuinely says something different: a status page reporting that Cowork
sessions fail to start, against a product page describing them completing; and a
practitioner on Hacker News reporting better visual reasoning from another model,
against a docs page claiming top-tier image processing.

That is the honest result and it is a thinner one. A ledger that loses rows when the
rules tighten was overstating before.

### The bug this domain exposed

Earlier still, before the check described here existed, the same corpus reported
*four* corroborations. Three cited Hacker News results whose links pointed back at
`anthropic.com` — the vendor's own announcements, labelled `Independent` because the
page containing them was an aggregator. (The fourth was the bare model name above,
which took a second gate and a later run to remove.)

**An aggregator is a conduit, not a source.** A press release does not become
third-party confirmation by being posted to Hacker News, and a report that says
otherwise is doing the exact thing this tool exists to prevent.

It is fixed at both ends, because they do different jobs. The prompt tells the
cartographer that an aggregator result linking to the claimant's own domain is not
corroboration — that stops the proposals. The gate enforces it independently: a span
from an independent document carrying a URL that points at a claimant domain is denied
`SELF_SOURCED`, with claimant domains derived from the claimant documents' own URLs.
A gate that only holds when the model complies is not a gate.

It is deliberately a *link* check, not a mention check: an independent commenter
writing "anthropic.com was down for an hour" is real testimony and still counts.
It also knows only the domains a plan actually names — there is a test asserting that
gap exists, so it is not mistaken for coverage.

The same shape fits anywhere one party makes checkable claims and independent sources
can be read against them — employer claims against Blind and Glassdoor, model
benchmark tables against independent evals, a product's spec sheet against teardowns.

One guard worth knowing about: a plan containing only one role is **refused before any
browser starts**. It would otherwise run, spend money, and produce a report where
everything is `UNVERIFIED` — not because the subject is unverifiable, but because
nothing was present that could contradict anything. That failure looks like a result,
which is worse than an error.

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

### Pick the proxy tier, not just the country

Solari offers three proxy tiers — `residential` (its default), `static` and
`mobile` — and `--proxy` reaches them as `country:tier`:

```bash
npm run cli -- stripe --proxy us:static     # a fixed ISP IP
npm run cli -- stripe --proxy gb            # country only; Solari's default tier
npm run cli -- stripe --proxy smart         # let Solari choose (the default here)
```

This matters more than a tuning knob should, because an unavailable tier does not
report itself as unavailable. It surfaces as `ERR_TUNNEL_CONNECTION_FAILED` on
`page.goto`, which this tool classifies as `proxy_error` against **every** source at
once — a report that reads as "nothing on the web will talk to us". Measured against
`tesla.com/fsd` on this account:

| `proxy` | Result |
|---|---|
| `us` (bare code → residential) | tunnel connection failed |
| `{ country: us, tier: residential }` | tunnel connection failed |
| `{ country: us, tier: mobile }` | tunnel connection failed |
| `{ country: gb }` | tunnel connection failed |
| `{ country: us, tier: static }` | **read, 3924 chars** |
| `smart` | **read, 3924 chars** |

Both US and GB residential failed while US static read the page, so the country was
never the variable. If a whole run comes back `proxy_error`, try another tier before
concluding the sources are hostile — and if the failures are uniform across every
host, they almost certainly are not about the hosts.

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

Full design: [`docs/superpowers/specs/2026-08-31-receipts-design.md`](docs/superpowers/specs/2026-08-31-receipts-design.md),
and the build plan it was executed from:
[`docs/superpowers/plans/2026-08-31-receipts.md`](docs/superpowers/plans/2026-08-31-receipts.md).

---

## Browsers only

Solari offers browsers, sandboxes, and desktops. This uses browsers and nothing else.

Every honest use here is a browser use, and adding a sandbox to touch a second
primitive would be decoration — the kind of thing reviewers who build this
infrastructure spot immediately. The constraint is the point.

---

## Development

```bash
npm test        # 218 tests
npm run typecheck
```

Everything except `fetch/` is a pure function of a captured corpus, so the whole
engine is testable offline against committed fixtures — no key, no network, no cost.
`fixtures/` holds real captures: `vercel.json` and `claude.json` (both roles
populated, and both with ledgers in `reports/`), plus `solari-free-plan.json` — a
vendor with no third-party footprint at all, which the tool correctly reports as an
absence of coverage rather than a clean bill of health.

MIT licensed.

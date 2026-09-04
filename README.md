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
  FSD requires minimal driver intervention  [intervention frequency]
    tesla       Tesla FSD page
      "your vehicle will drive you almost anywhere with your active
      supervision, requiring minimal intervention."
    independent Hacker News - FSD
      "Tesla Full Self Driving requires human intervention every 13 miles"
```

Both halves are verbatim. You can check either: open
[`reports/tesla-fsd.json`](reports/tesla-fsd.json), take the character offsets on
that row, and slice them out of the corresponding document in
[`fixtures/tesla-fsd.json`](fixtures/tesla-fsd.json). If a quote were paraphrased by
a word, the slice would not match — which is the point.

<details>
<summary>The divergent section in full (unedited)</summary>

```
  Tesla FSD — claim ledger
  generated 2026-09-04T18:53:14.951Z

  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  FSD-derived safety features reduce or prevent accidents  [accident prevention claim]
    tesla       "safety features powered by the same technology as our FSD software to
                 help reduce the severity of accidents or prevent them altogether"
    independent "US probes Tesla's Full Self-Driving software after fatal crash"

  FSD (Unsupervised) will make autonomous driving possible  [future unsupervised autonomy]
    tesla       "With Full Self-Driving (Unsupervised), autonomous driving will be made
                 possible, unlocking our fleet of robotaxis and making Cybercab a reality."
    independent "Tesla changes meaning of 'Full Self-Driving', gives up on promise of autonomy"

  FSD requires minimal driver intervention  [intervention frequency]
    tesla       "your vehicle will drive you almost anywhere with your active
                 supervision, requiring minimal intervention."
    independent "Tesla Full Self Driving requires human intervention every 13 miles"

  FSD completes driving maneuvers intelligently and accurately  [maneuver accuracy]
    tesla       "Full Self-Driving (Supervised) intelligently and accurately completes
                 driving maneuvers for you, including route navigation, steering, lane
                 changes, parking and more under your active supervision."
    independent "Tesla Full Self Driving uses bicycle lane in official Denmark approval video"

  Unsupervised FSD will unlock a robotaxi fleet  [path to unsupervised FSD]
    tesla       "With Full Self-Driving (Unsupervised), autonomous driving will be made
                 possible, unlocking our fleet of robotaxis and making Cybercab a reality."
    independent "In April 2026, Musk stated that, contrary to previous company promises,
                 HW3 cars do not have the capability for unsupervised full-self-driving.[55]"

  FSD helps make roads safer  [road safety benefit]
    tesla       "Tesla uses billions of miles of anonymous real-world driving data to
                 train Full Self-Driving (Supervised) ... while helping make the roads
                 safer for you and others."
    independent "Tesla recalls 360k vehicles, says full self-driving beta may cause crashes"

  [4 UNVERIFIED and 5 CORROBORATED rows follow — see the hosted page]

  audit: proposed 45 over 7 passes · admitted 15 · denied 30
         (15 LOW_CONFIDENCE, 11 DUPLICATE, 4 NOT_QUERY_RELEVANT)
```

The fifth row is the one worth pausing on. Tesla's page promises unsupervised autonomy;
the contradiction is Tesla's own CEO, saying HW3 cars cannot do it "contrary to previous
company promises". Both sides are the vendor, a year apart.

</details>

Three things in that output are the whole design:

**The audit line.** Publishing the denial count is what makes the guarantee checkable
rather than a claim. Thirty of forty-five proposals were rejected, and the reasons are
listed: fifteen below the confidence floor, eleven already-said, four off-topic.

**The `UNVERIFIED` section.** Every summariser silently drops claims it cannot check.
A vendor claim that no independent source corroborates is a *finding*, not an
absence, so it gets its own section and says so. "Our fleet collectively experiences a
lifetime of driving scenarios in 10 minutes" is not contradicted here — it is simply
uncheckable against anything that would talk to us.

**`not read` sources.** Coverage is always partial, and partial coverage stated out
loud beats a report that quietly looks complete. On the Tesla run every source read;
on Vercel, two did not.

### A second vendor

Same engine, no per-vendor code, from
`npm run cli -- vercel --render reports/vercel.json`:

```
  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  Vercel protects projects across access, application and infrastructure security
    vendor      "Vercel protects your projects across access, application, and
                 infrastructure security."
    independent "Vercel April 2026 security incident(https://www.bleepingcomputer.com/
                 news/security/vercel-confirms-breach-as-hackers-claim-to-be-selling-
                 stolen-data/)"

  sources
    ...
    not read    G2 reviews  (empty)
    not read    Reddit  (blocked)

  audit: proposed 19 over 4 passes · admitted 10 · denied 9 (8 LOW_CONFIDENCE, 1 SELF_SOURCED)
```

Nine of nineteen rejected, and one of them is worth naming: `SELF_SOURCED` is the gate
catching an "independent" source whose link pointed back at Vercel's own domain — a
press release being offered as third-party confirmation.

Vercel's ledger is the honest weak one. Nine of its ten rows are `UNVERIFIED`, because
its independent side is two documents against three vendor pages: there is very little
here to check Vercel's claims *against*. That is a coverage problem the report states
rather than hides, and the fix is more independent sources, not more tuning.


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

  Fable 5.1 is the model to use for demanding reasoning work  [Fable 5.1 for demanding reasoning]
    model card  Model overview docs
      "Use Claude Fable 5.1 for demanding reasoning and long-horizon agentic work"
    independent Hacker News — benchmarks
      "We have seen the best results with Gemini models for visual reasoning,
      achieving SOTA (beating Claude Fable) on the strongest grounded
      reasoning benchmark we have found (Databricks OfficeQA)."

  A production model (Mythos 5) not listed in the docs lineup is serving requests
    model card  Model overview docs
      "Claude is a family of state-of-the-art large language models developed
      by Anthropic. Compare the current lineup, find the model ID for every
      platform, and open each model's page for its full specs and resources."
    independent Anthropic status page
      "We are investigating elevated errors on requests to Claude Mythos 5,
      Claude Fable 5, Claude Opus 5, and Claude Opus 4.8."

  audit: proposed 18 over 5 passes · admitted 11 · denied 7 (4 LOW_CONFIDENCE, 3 DUPLICATE)
```

The second row is the kind of finding this shape is for, and no single page contains
it. The docs page offers to show you "the current lineup"; the status page, reporting
an incident, names a production model that is not in it. Neither source is making an
accusation — the ledger is, by putting them side by side.

Five of the eleven rows are `UNVERIFIED`: pricing, speed and modality claims that
nothing in this corpus corroborates either way.

### The bug this domain exposed

Earlier still, before the check described here existed, the same corpus reported
*four* corroborations. Three cited Hacker News results whose links pointed back at
`anthropic.com` — the vendor's own announcements, labelled `Independent` because the
page containing them was an aggregator. (The fourth was evidenced by the bare words
`"Claude Sonnet 5"`, which took a second gate — see [the guarantee](#the-guarantee) —
and a later run to remove.)

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
npm test        # 269 tests
npm run typecheck
```

Everything except `fetch/` is a pure function of a captured corpus, so the whole
engine is testable offline against committed fixtures — no key, no network, no cost.
`fixtures/` holds real captures: `vercel.json` and `claude.json` (both roles
populated, and both with ledgers in `reports/`), plus `solari-free-plan.json` — a
vendor with no third-party footprint at all, which the tool correctly reports as an
absence of coverage rather than a clean bill of health.

MIT licensed.

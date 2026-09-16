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

Reddit and G2 are in the source plan and both refuse. G2 sits behind a DataDome device
check that does not solve: zero successes in sixteen controlled attempts, spread across an
hour on each of two proxy tiers. Reddit's challenge does not solve either, and pressing it earns a rate
limit instead. Those attempts are reported as `not read`, with the reason, rather
than quietly narrowing the ledger; the point of naming them is that you can see what the
coverage is missing.

An LLM proposes which claims contradict which. A deterministic gate then re-derives
every quote's position from the bytes we fetched and **discards anything it cannot
find**. The model organises; the sources speak.

### Hosted ledgers

The committed reports are published at
[kristiankrattiger.github.io/receipts](https://kristiankrattiger.github.io/receipts/):

- [Tesla FSD](https://kristiankrattiger.github.io/receipts/tesla-fsd.html) — the showcase
- [Claude](https://kristiankrattiger.github.io/receipts/claude.html) — non-vendor domain
- [Vercel](https://kristiankrattiger.github.io/receipts/vercel.html) — the honest thin ledger
- [Chime](https://kristiankrattiger.github.io/receipts/chime.html) — the CFPB regulator source's first live pull

---

## A real ledger

![Tesla FSD claim ledger](docs/demo.gif)

One row, from `npm run cli -- tesla --render reports/tesla-fsd.json`. Tesla's own
safety report against a Hacker News headline — both halves word-for-word:

```
  engaging FSD lowers collision likelihood  [FSD safety claims]  provisional
    tesla       Tesla Vehicle Safety Report
      "When engaged and under your active supervision, your likelihood of
      being in a collision goes down."
    independent Hacker News - FSD
      "US probes Tesla's Full Self-Driving software in 2.4M cars after fatal
      crash"
```

Both halves are verbatim. You can check either: open
[`reports/tesla-fsd.json`](reports/tesla-fsd.json), take the character offsets on
that row, and slice them out of the snapshot named by that document's pin.
If a quote were paraphrased by a word, the slice would not match — which is
the point. The pages are the 2026-09-12 live `--refresh --rerun` snapshots.
The committed ledger was stamped 2026-09-14 under retrieval that mixed the
10-K's 385k characters into the query, so the 10-K's five candidate slots held
its cover page, signature page, and three financial tables and no FSD text;
the audit shows the holding gate denied nothing (`issueStatementDenied: 0`).
The profile changes retrieval, so that ledger is not replayable under it and
`npm run replay` says so. It is restamped, and this section rewritten from the
new ledger's audit, in the last step of
`docs/superpowers/plans/2026-09-15-field-profile.md`.

It is worth saying that this was **not** the predicted result of the
[density plan](docs/superpowers/plans/2026-09-04-density.md), which
hypothesised that the 10-K would contradict the marketing page directly.
It does not: zero rows pair two Tesla documents against each other. The
hypothesis was recorded in advance, so the null result is visible here
rather than quietly dropped. The further null — that the 10-K no longer
corroborates the critics either — traces to the retrieval bug described
above, not a quieter corpus; the restamp will say whether it still holds.

<details>
<summary>The divergent section in full (unedited)</summary>

```
  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  FSD completes driving maneuvers intelligently and accurately  [FSD maneuver accuracy]  provisional
    tesla       Tesla FSD page
      "Full Self-Driving (Supervised) intelligently and accurately completes
      driving maneuvers for you, including route navigation, steering, lane
      changes, parking and more under your act"
    independent Hacker News - FSD
      "Tesla 'Full Self-Driving' crashed through railroad gate seconds before
      train"

  FSD completes driving maneuvers intelligently and accurately  [FSD maneuver reliability]  provisional
    tesla       Tesla FSD page
      "Full Self-Driving (Supervised) intelligently and accurately completes
      driving maneuvers for you, including route navigation, steering, lane
      changes, parking and more under your act"
    independent Hacker News - FSD
      "Tesla 'Full Self-Driving' crashed through railroad gate seconds before
      train"

  engaging FSD lowers collision likelihood  [FSD safety claims]  provisional
    tesla       Tesla Vehicle Safety Report
      "When engaged and under your active supervision, your likelihood of
      being in a collision goes down."
    independent Hacker News - FSD
      "US probes Tesla's Full Self-Driving software in 2.4M cars after fatal
      crash"

  FSD helps make roads safer  [road safety benefit]  provisional
    tesla       Tesla FSD page
      "Tesla uses billions of miles of anonymous real-world driving data to
      train Full Self-Driving (Supervised) to take care of the most stressful
      parts of daily driving while helping ma"
    independent Hacker News - FSD
      "Tesla ‘full self-driving’ triggered an eight-car crash, a driver tells
      police"

  [8 UNVERIFIED and 6 CONTEXT UNVERIFIED rows follow — see the hosted page]

  audit: proposed 50 over 8 passes · admitted 18 · denied 15
         (9 LOW_CONFIDENCE, 6 DUPLICATE)
  provenance: 0 stable · 18 provisional (18 volatile-source, 15 single-proposer-run)
```

Full ledger:
[kristiankrattiger.github.io/receipts/tesla-fsd.html](https://kristiankrattiger.github.io/receipts/tesla-fsd.html).

The first two divergent rows cite the same Tesla sentence and the same HN
headline. Duplicate rows are collapsed *within* a document, not across
topics — two phrasings of one pairing is what two samples produced, and
suppressing the second would hide the proposer disagreement. It is listed
here as a judgement call rather than settled.

</details>

Four things in that output are the whole design:

**The audit line.** Publishing the denial count is what makes the guarantee checkable
rather than a claim. Fifteen of fifty proposals were rejected, and the
reasons are listed: nine below the confidence floor, six already-said. The
provenance line is the other half of that honesty: zero `stable` rows,
eighteen `provisional`, fifteen of them from a single proposer sample.

**The `UNVERIFIED` section.** Every summariser silently drops claims it cannot check.
A vendor claim that no independent source corroborates is a *finding*, not an
absence, so it gets its own section and says so. "Tesla vehicles are equipped
with exterior cameras that enable 360-degree visibility" is not contradicted
here — it is simply uncheckable against anything that would talk to us.

**The `CONTEXT UNVERIFIED` section.** An unmarked independent quote that still
admits is not confirmation. It sits between unverified and corroborated:
context-true, no holding competitor in the pile, residual curator work.
Painting those six rows green is the thing the gate exists to stop.

**`not read` sources.** Coverage is always partial, and partial coverage stated out
loud beats a report that quietly looks complete. This Tesla sample read all nine
of the report's sources (NHTSA is not among them — it was unread on the
previous refresh and a failure is not re-fetched). On Vercel, G2 returned a
challenge it did not solve that time, and Reddit rate-limited us.

### A second vendor

Same engine, no per-vendor code, from
`npm run cli -- vercel --render reports/vercel.json`:

```
  DIVERGENT — the vendor's claim is contradicted
  ----------------------------------------------

  Vercel positions itself as purpose-built for secure development  [security posture]
    vercel      Vercel security page
      "Purpose-built for secure development, Vercel allows you to build,
      deploy, and protect applications with our suite of security features."
    independent Wikipedia - Vercel
      "On April 19, 2026, Vercel disclosed a security breach in which certain
      internal systems were accessed by unauthorized actors."

  sources
    ...
    not read    G2 reviews  (empty)
    not read    Reddit - r/nextjs  (blocked)

  audit: proposed 22 over 7 passes · admitted 10 · denied 12 (11 LOW_CONFIDENCE, 1 DUPLICATE)
```

Vercel's ledger is the honest weak one, and worth keeping for that reason. Nine of its
ten rows are `UNVERIFIED`. Its source plan reads ten documents — a security page,
pricing, limits docs, changelog, status history, Wikipedia, two Hacker News searches
and a GitHub issue search — and still turns up **one** divergence.

That is not a tuning failure. Eleven proposals were denied below the confidence floor,
most of them under 0.35, meaning the model looked and did not find much. A ledger is
only as sharp as the independent record, and there is far less written about Vercel
than about Tesla. Reporting a thin result as a thin result is the whole point; the
alternative is a tool that always finds something.

## Not only vendors

Nothing in the engine is vendor-specific. The admission gate contains no role logic
at all: a document is either a `claimant` — whoever is making the claims — or
`independent`, and the only thing that differs between domains is what those two are
*called* in the output.

So a new domain is a JSON file, not a code change:

```json
{
  "subject": "Claude",
  "labels": { "claimant": "Model card", "independent": "Independent" },
  "targets": [
    { "kind": "vendor_site", "role": "claimant",
      "url": "https://www.anthropic.com/claude", "label": "Claude product page" },
    { "kind": "forum", "role": "independent",
      "url": "https://hn.algolia.com/?q=anthropic.com", "label": "Hacker News",
      "stability": "volatile" }
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
`vercel.com` on a paid Solari plan with stealth on and `--proxy smart`:

| Source | Result |
|---|---|
| vendor homepage, security, pricing, limits docs, changelog | read |
| status history | read |
| Wikipedia | read — 13k characters, including the April 2026 breach |
| Hacker News (two searches) | read — 36k characters |
| **GitHub issues** on `vercel/next.js` | read — practitioners, dated, specific |
| G2 | a DataDome device check; 0 reads in 16 controlled attempts across two tiers |
| Reddit | a challenge that does not solve; pressing it earns a rate limit |

GitHub issues are the entry that matters. Reddit and G2 were meant to be "where users
complain" and both refuse; a project's own issue tracker is the same complaints,
written by people who can reproduce them, on a site that answers a browser.

That run predates the egress measurement below, and used `--proxy smart`, which has
since been shown to attach no proxy. Its Reddit row in particular said "blocked" when
the truth was "we arrived from a datacenter IP".

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
| `{ country: us, tier: mobile }` | tunnel connection failed *(2026-09-04; mobile worked on 2026-09-05, see below)* |
| `{ country: gb }` | tunnel connection failed |
| `{ country: us, tier: static }` | **read, 3924 chars** |
| `smart` | **read, 3924 chars** |

Both US and GB residential failed while US static read the page, so the country was
never the variable. If a whole run comes back `proxy_error`, try another tier before
concluding the sources are hostile — and if the failures are uniform across every
host, they almost certainly are not about the hosts.

**Read the last two rows carefully: they do not say what they appear to.** Every cell
was measured against `tesla.com/fsd`, which blocks nothing and returns the same page
with no proxy at all. "Read, 3924 chars" therefore establishes that the page loaded and
nothing whatever about the route it took — which is exactly why `static` and `smart` are
indistinguishable here. The table separates *broken* from *working*; it cannot separate
*proxied* from *unproxied*, and it was used to pick a default as though it could.

The check that would have caught it is one line, and Solari's own documentation names
it: a proxied session comes back with `session.proxy` populated, so confirm that field
rather than a status code.

### What the egress actually is, measured

`npm run egress` reads `session.proxy` back on every cell. Run 2026-09-05, full results
in [`reports/measurements/egress-2026-09-05.json`](reports/measurements/egress-2026-09-05.json):

| host | `--proxy smart` | `--proxy us:static` | `--proxy off` |
|---|---|---|---|
| Wikipedia | proxy **NONE**, 200, 12,817 chars | proxy `us/static`, 200, 12,817 chars | proxy **NONE**, 200, 12,817 chars |
| `tesla.com/fsd` | proxy **NONE**, 200, 4,232 chars | proxy `us/static`, 200, 4,232 chars | proxy **NONE**, 200, 4,232 chars |
| G2 | proxy **NONE**, **403**, 0 chars | proxy `us/static`, **403**, 0 chars | proxy **NONE**, **403**, 0 chars |
| Reddit | proxy **NONE**, **403** blocked | proxy `us/static`, **200** — challenge | proxy **NONE**, **403** blocked |

**`smart` is `off`.** Not approximately — its rows are byte-identical to `off` on every
host, and the session confirmation came back `NONE` every time. The default that this
README previously recommended was no proxy at all, and the tesla.com table above is
precisely why nobody noticed. The default is now `us:static`.

**Reddit was never refusing us on the merits.** It was refusing an unproxied datacenter
IP. Behind a real proxy it answers `200` — and then asks us to prove we are human. That
is a different fact about Reddit than "blocked", and this repository asserted the wrong
one for a week.

**G2 is unchanged by the proxy.** `403` with a 2,638-character body, identical across all
three settings. A proxy is not the missing ingredient — a solver is, and only sometimes;
see the access stance below.

**`webBotAuth` does not exist here.** It is in the SDK's types, and the API rejects it:
`400 — "Web Bot Auth request signing is not available on this platform; requests were
never signed even when this option was accepted."` Worth knowing that it was previously
accepted and silently inert.

---

## Six more source classes, probed before committing

Reddit and G2 were never the only candidates. Six source classes were proposed for
this branch; each URL below was fetched and read before it was added anywhere, and a
rejection is recorded with its outcome rather than dropped quietly — the `not read`
column is the product.

| Source | Result |
|---|---|
| Downdetector | **added to every future subject's defaults.** Probed against Vercel, it read real subject-specific content: "User reports show no current problems with Vercel", plus a 24-hour report chart (2,330 chars). |
| BBB | **not added.** The URL shape works, but a vendor with no BBB profile returns "No results for" … "Vercel" (a line break sits between the two, not the joined sentence this once implied) wrapped in 1,841 characters of navigation chrome — not an independent source, a search page. |
| Tesla — NHTSA recalls API | **added to `plans/tesla-fsd.json`.** 5,835 characters of dated recall summaries filed with a federal regulator, verified on two model/year pairs before being committed. |
| Claude — LMArena leaderboard | **added to `plans/ai-model-claims.json`.** 41,500 characters, 88 mentions of Claude carrying comparative scores with confidence intervals — the independent counterweight a model card's own claims never have. |
| CourtListener | **not added.** Bot-challenged: "Let's confirm you are human" … "Complete the security check before continuing." (318 chars; a paragraph break sits between the two sentences, not the period this once implied). The spec argued for it over PACER because it is free and needs no login — true, and irrelevant: free access and machine-readable access are different properties. |
| Artificial Analysis | **not added.** The guessed benchmark-aggregator URL for Claude returned a 404. |
| Vercel — independent measurement source | **none found.** Inventing one to fill the slot is exactly the failure this tool exists to expose. |

The industry-regulator lookup table (`src/sources/regulators.ts`) is now reachable:
`--industry <name>` on the CLI, an enum-declared `industry` argument on the MCP
tool, `?industry=` on the web server. Each entry point refuses an unknown value by
name, because silently dropping it would spend a paid run and then report the
missing regulator as one that had nothing to say.

`automotive` still ships **empty**, and that is the measurement. Its seeded entry
pointed at `nhtsa.gov/recalls?make=<subject>`; the probe showed that parameter is
ignored outright — zero occurrences of "Tesla" in 8,452 characters of generic
landing page. The NHTSA URL that does carry recall text needs `make` **and**
`model` **and** `modelYear`; `make` alone returns `Count:0`. Two of those three
cannot be derived from a company name, so that URL lives in Tesla's plan file
instead of the table.

`fintech` carries the first regulator that genuinely is name-derivable: the **CFPB
consumer complaint database**. Probed against Chime — 14,372 complaints, 13,949 of
them attributed to Chime Financial Inc by the API's own aggregation, and 10 of 10
in the committed capture (`fixtures/probe-cfpb.json`) filed against it, with
narratives running ~3,000 characters of dated first-person account. Three properties of that URL are
load-bearing and **every one of them fails silently**, so all three are pinned by
tests:

| property | what happens without it |
|---|---|
| trailing `/` before `?` | the site serves its HTML search page instead of the API |
| no `format=json` | the endpoint answers `404 {"detail":"Not found."}` |
| no `sort=` | date order discards relevance: `search_term=Chime` then returns complaints against Ally, Netspend and Wells Fargo that merely mention the word |

That last one is the trap. Sorting by date looks like a neutral choice and is not:
it turns a vendor-specific source into a keyword feed, which is the same failure
this README already documents for Hacker News. It was caught by reading the
`company` field on the rows that came back, not by reading the query string.

```bash
npm run cli -- Chime --industry fintech
```

`--industry` is refused alongside `--sources`: a plan file replaces the built-in
plan wholesale, so there would be nothing for the flag to add to. Accepting both
and honouring one silently is the failure mode worth avoiding.

**What that run actually produced** is [committed](reports/chime.json) and
[hosted](https://kristiankrattiger.github.io/receipts/chime.html). The CFPB
document was fetched at 24,338 characters and the model proposed four
contradictions from it — Chime's "hassle free" and "quick and simple" marketing
language against complaint narratives. The confidence gate denied all four,
0.25 to 0.45, below the bar this project's own admitted rows clear. That is the
gate working as designed, not the source falling short: a regulator complaint
database is real independent evidence, and real evidence is not obligated to
yield a headline-grade contradiction on the first company anyone points it at.

**Two production defects, both found by these probes, both fixed here.** BBB's
"No results" page cleared the no-results gate because the bound was 600 characters
against its own 1,841 — entering the corpus as a readable independent source.
Raising the bound to 4,000 alone would have let a second defect back in: "0 results"
is a bare substring, so a *populated* search page reporting "20 results" or "1,240
results" would trip the same gate at that length. An earlier revision tried to
handle "no results" grammatically — flag it unless a verb follows — on the theory
that a search page says it of itself while prose adds a verb. Measured, that was
wrong in both directions: "No results were found for your search" is a search page
*with* the verb, and the commonest empty-search wording on the web, while "no
results whatsoever were found" is an article whose adverb slips past the lookahead.
The check is now what it always should have been: a list of phrasings that name a
page's own search, with the numeric one (`0 results`) anchored to a word boundary so
it cannot match inside a populated page's count. CourtListener's 318-character
challenge page matched none of the existing CAPTCHA markers — its "confirm you are
human" against the list's "verify you are human", its "complete the security check"
against "complete the challenge" — so it cleared the 200-character floor and
classified as a readable independent document. Both phrasings are now in the list.
These were the **fourth and fifth** instance of the same class of bug in
`src/fetch/fan.ts`: a refusal or emptiness page entering the corpus as if it were a
document. All five were found by a live run, never by reading the code — and then a
review of this very branch found a **sixth** by reading: the grammatical lookahead
above, which classified "No results were found for your search" as a readable
document. Five to one is still the ratio, but the sixth is the reason the claim is
now "runs find what reading misses" rather than "only runs find these".

---

## What this tool does to read a source that refuses

It solves challenges. Solari's managed captcha solving is on by default; `--no-captcha`
turns it off. That is a reversal of this project's original position, which was to refuse
on principle and report the source as `not read`.

**What changed the position was a measurement, and it is worth reading before you trust
either version.** The original rule was written believing Reddit and G2 refused us on the
merits. Neither did. Reddit was refusing an unproxied datacenter IP, because our own proxy
default silently attached no proxy at all. G2's "hard 403" was a challenge interstitial
that our extractor abandoned after 1.4 seconds. The rule was declining a remedy for a
condition nobody had diagnosed.

**What it bought, measured 2026-09-05:** nothing that survives repetition. The first run
read G2 once in four attempts. A controlled follow-up — eight attempts spaced across an
hour, all verified proxied, in
[`reports/measurements/captcha-probe-2026-09-05.json`](reports/measurements/captcha-probe-2026-09-05.json) — read it
**zero** times, and identified the obstacle: a DataDome device check in a cross-origin
iframe, which Solari covers only site-by-site. A second controlled run on `us:mobile`
([`reports/measurements/captcha-probe-2026-09-05-us-mobile.json`](reports/measurements/captcha-probe-2026-09-05-us-mobile.json))
read it zero times too, closing the one alternative the first run could not rule out — that
the exit IP's reputation, rather than the challenge, was what blocked us. Sixteen attempts,
two tiers, no reads. DataDome's own verdict was identical on both — same rule-set hash, same
bootstrap — and only our rendering of it differed, so this rules out neither the exit's
reputation nor the browser fingerprint, which was held fixed throughout. What it establishes
is narrower and sufficient: no lever this account has reads G2.
Reddit does not read either, and sustained attempts produce `429`-style rate limiting.

So the reversal bought no reliable coverage at all. The `not read` column was never the
reason coverage was thin, and the honest version of this section is that the constraint it
replaced was costing almost nothing.

**Reddit was also tried through its API — twice, not once.** An OAuth path
(`client_credentials`, no user account) was built and reviewed, on the theory that an
application token is Reddit's sanctioned way in and removes the account-automation risk a
login flow would carry. It has never been exercised: Reddit's script-app registration page
fails its own reCAPTCHA silently and consistently — across browsers, with and without
extensions and third-party cookies, no image challenge ever appearing. A known failure mode
of that page, not a configuration problem here.

Rather than leave Reddit unread while that stays broken, a second, credential-free path was
added: Reddit's public `/search.json` endpoint, the interface RSS readers and old API
clients have used for years. Measured 2026-09-06 against `plans/vercel.json`:
`www.reddit.com` — the same hostname the browser path could not get past — refused this one
too, though not from the same vantage point: this fetch is a bare, unproxied HTTP request, and
`fixtures/vercel.json`, which recorded the browser's own Reddit attempt, carries no egress
information for it at all. What that fixture does show is the same "You've been blocked by
network security... log in to your Reddit account or use your developer token" wording this
README already attributes elsewhere to an unproxied attempt — so both refusals plausibly came
from an unproxied vantage point, though neither run recorded its egress precisely enough to
say for certain.
`403`, `reddit refused the request (403)` — and that is the entire evidence: the 403 branch
throws before reading the response body, so nothing here observed what Reddit's response
actually said, only its status code. Two different requests against two different sub-paths of
the same host, refused in two different shapes: a rendered block page naming a login route,
and a bare 403 naming nothing. Neither path has
produced a single Reddit read. Reddit stays `not read`, and the OAuth path remains the one
worth returning to if the registration page ever stops failing.

**What has not changed, and will not:** a source that cannot be read still says why, in
the ledger, with the reason it actually returned. This tool's claim was never that it can
read everything — it is that it tells you exactly what it could and could not read, and
how. Reading a source without saying how is the thing that would break it.

---

## What it costs

| Component | Estimate |
|---|---|
| Browser fan, ~7 sources | a few cents |
| Claude Opus proposal passes over 40 candidates | ~$0.14 for one call; unmeasured since the pass fan-out |
| **Per full run** | **more than ~$0.18** |

The `~$0.14` was an estimate for a single model call, made before the
proposer was fanned into one call per pass on 2026-09-04, and it has not been
re-measured since — the proposer records no token usage, so nothing in this
repository has. Each pass carries its own system prompt, the claimant's
excerpts again, and one independent source's — the passes overlap, they do not
partition — and the Tesla run makes eight of them (NHTSA unread, so one
independent source contributed no candidates), so the true figure is a
multiple of the old one. Read the per-run total as a floor. Recording usage per pass and
printing it on the audit line is the fix, and is not done yet.

In general the model is not called once. It is called once per proposal pass:
one pass per independent source that contributed candidates, a claimant-only
pass when two or more claimant documents contributed candidates, and one pass
over everything for the unsupported-claim judgement — the Tesla ledger's audit
line says `8 passes`. (When no independent source contributed candidates there
is exactly one pass, over everything.) `--candidates` tunes how much of the
corpus those passes see and is the main cost lever. `--fetch-only` and `--render` cost nothing beyond browser time and
nothing at all respectively; `--refresh` without `--rerun` costs browser time
only.

**One caveat worth stating plainly:** results vary when the corpus or the settings
differ, or when `--no-cache` forces a fresh sample — the same fixture at the same
settings once produced two rows on one run and four on another. Over a byte-identical
corpus with the same settings, a run is now served from the proposal cache instead of
the model and produces an identical ledger (see [Replaying a
ledger](#replaying-a-ledger)). A new CLI run takes two proposer samples by default
and stamps each row `stable` or `provisional`. Tesla's committed ledger is two
samples; every row is still `provisional` because the cited pages are volatile.
Treat a single sample as a lead, not a verdict.

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

That constraint has a name in the series now. The GIN series document `GIN_14_Assay`
factors it out as the **Assay** — stated without the federation: a set of
documents and a query in; a cited answer, a divergence report, or a refusal out.
Receipts is a field instance of that contract, pointed at the live web and the
sources that refuse automation. GIN is the contract scaled and governed.

### The contract, extracted

`src/assay/` is that contract as code: a set of pinned documents and a query in,
a grounded ledger or a typed refusal out. It never fetches — the caller hands it
bytes, already pinned — and it has no opinion about where a document was before
it arrived. Files in the folder import only each other, `zod`, `vitest`, or
`node:`; they do not import Receipts fetch, snapshots, the Anthropic SDK, or
`src/types.ts`. Assay is in-repo constraint tooling, not a published package.
Receipts is the live-web field instance that fetches, pins, caches, and renders.
The folder layout and the admission table are in
[`architecture.md`](architecture.md).

Admission is extractive, and the engine knows no field. Every domain choice —
the proposer prompt, the discourse lexicon, the retrieval policy — arrives as
one `FieldProfile` from `src/instance/profile.ts`; `assay()` refuses to run
without one. Receipts' profile ranks chunks by the subject alone and does not
pin document ends (on a web page those are nav chrome); its lexicon marks a
source committing to its own test or measurement as `holding` and attributed
hearsay as `argument`. Claim/Record's profile, in that repo, carries the legal
lexicon and the opposite retrieval choices. Issue and argument sentences never
admit (`ISSUE_STATEMENT`); an unmarked span cannot corroborate, contradict, or
update a claim when a holding competes in the pile (`HOLDING_COMPETITOR`); an
unmarked corroboration with no competitor admits as `context_unverified`.
Receipts' calibration set under `src/instance/calibration/` proves each
outcome is reachable and checks the Tesla candidate set offline.

A refusal is a result, not a crash. A run that reads only one side, anchors
nothing, or clears no proposal returns a reason code (`CORPUS_INSUFFICIENT`,
`NO_GROUNDING`, `BELOW_THRESHOLD`), rather than an empty ledger that reads as
a clean bill of health. Every refusal carries `nearMiss`: whichever proposals
were denied `LOW_CONFIDENCE`, with the score each earned, regardless of which
reason code the run actually landed on — a corpus where every proposal
scores too low refuses `NO_GROUNDING` (nothing anchored), not
`BELOW_THRESHOLD`, and still lists them all in `nearMiss`. It is empty
whenever no `LOW_CONFIDENCE` denial fired — a run denied entirely on
relevance or duplication, say, refuses `BELOW_THRESHOLD` with nothing to
name — and always empty for `CORPUS_INSUFFICIENT`, which returns before
`admit` runs at all.
The CLI exits `0` for a ledger, `3` for a refusal and `1` for an operational
error, so the three are distinguishable by a script — except `--fetch-only`,
which never reaches this and exits `0` if anything was read, `2` if nothing was.

The confidence floor is caller-settable: `assay()`'s `threshold` option raises
or lowers the bar, and a higher bar buys more refusals. It defaults to 0.5 and
is not currently wired to a CLI flag — every run through `npm run cli` gets
the default.

Full design: [`docs/superpowers/specs/2026-08-31-receipts-design.md`](docs/superpowers/specs/2026-08-31-receipts-design.md),
and the build plan it was executed from:
[`docs/superpowers/plans/2026-08-31-receipts.md`](docs/superpowers/plans/2026-08-31-receipts.md).

---

## What a pin is, and what is actually stable

Every document that reaches a ledger now carries three more facts: a
**stability** (`stable` or `volatile`), a **pin** (how its bytes can be got
again), and a **drift hash** (whether the page changed meaningfully, as
distinct from a clock ticking). None of the three is guessed from what kind
of source the document is.

Bytes live in a content-addressed `snapshots/` store, keyed by the sha256 of
the content alone — two documents with identical text are one blob however
they were captured. It is committed to the repo, not gitignored.

A live **CLI, MCP, or web** run commits every fetched document's bytes to
the store before analysing them, and writes every model response to
`cache/proposals/`: all three go through `analyzeLive`, which calls
`storeCorpus`, wraps the proposer with the cache, then `analyzeCorpus` with
a record of what just got stored. Pins resolve to blobs that exist, and the
in-memory result carries `replay` when every response is on disk. MCP still
returns markdown and web still returns HTML; neither writes a committed
`reports/*.json`. An operator who wants a `--replay` file uses the CLI.
Tesla was the only committed replayable ledger — until the field profile; see above.

A pin is a `permalink` only when the URL is permanent by construction — an
SEC EDGAR accession path or a Wikipedia `oldid` revision link — because
permanence there follows from the URL's own shape and the issuer's contract,
not from anyone's claim about it. It is a `snapshot` when the run producing
this report committed the bytes to `snapshots/` itself, as a live CLI, MCP,
or web run does. Only when that run did not — including when some other run
already committed the same bytes — does a document get a plain content hash:
enough to catch drift, not enough to replay.

**A `snapshot` pin means replayable, not stable.** A committed blob says
nothing about whether the source will serve the same bytes tomorrow — only
that today's bytes are on disk now, and can be handed to anyone who asks.
Stability is a separate fact (below), and a `snapshot` pin does not confer it.

**Exactly one source across every committed plan earns a permalink today:
Tesla's FY2024 10-K**, filed at an EDGAR accession path that cannot be
reissued or edited. Wikipedia articles appear in more than one committed
plan, but none of the links carry an `oldid`, so don't read this as
Wikipedia being stable — no committed plan pins a revision, and the
recognizer's only coverage today is its own tests.

Stability is never inferred from a source's kind. `vendor_docs` holds that
immutable filing and two continuously edited documentation sites side by
side, and nothing about the kind tells them apart. Stability comes from a
plan author's explicit declaration, or is earned by a URL that is permanent
by construction, and a declaration always wins — a permalink promotes only a
document that arrives undeclared.

### Refreshing a ledger

`npm run cli -- <subject> --refresh reports/<file>.json` re-fetches a saved
ledger's sources and prints a drift report. The prior report is the source
of truth for what to fetch — its recorded urls and kinds — not the plan
file, so the comparison is like with like even if the plan has since
changed. A permalink-pinned document comes from the `snapshots/` store
instead of the network: a permanent url is permanent by construction, and
re-fetching an EDGAR accession can only fail. Everything else is re-fetched,
including a document declared stable that is not permalink-pinned — that is
exactly the misdeclaration the next outcome exists to catch. **It makes no
model call.** `--refresh` needs `SOLARI_API_KEY`, and, so long as `--rerun`
is not also given, does not need `ANTHROPIC_API_KEY`. Without `--rerun` it
exits `0` whether or not anything drifted — "nothing changed" is a finding
too — and the re-fetched bytes are committed to the store like any live
capture.

Each document lands in one of five outcomes, judged on the **drift hash** —
the hash over normalized text, so a page whose only change is a timestamp
comes back `unchanged`: `stability-violated` (declared stable, and its drift
hash changed), `unreadable` (read when the ledger was made, could not be
read now, with the failure's reason and its detail printed), `drifted`
(volatile, and its drift hash changed), `unchanged`, and `from-store`
(permalink-pinned, never re-fetched). The report's summary line reads
`N stability violated · N quote vanished · N unreadable · N drifted · N unchanged · N from store`,
and when the four loud counts are all zero it also prints a plain
`nothing drifted` line ahead of the unchanged list.

**`QUOTE VANISHED`** is not one of the five — it is a row-level finding, and
the single most valuable thing this command can say. Every span the ledger
cited is re-checked as an exact substring of the fresh text of the document
it was cut from (for a permalink-pinned document, the stored bytes — which
cannot have changed, so its quotes are checked but can never vanish); a
quote that is no longer there, even by one character, has
vanished as far as the guarantee is concerned, because the ledger's offsets
no longer slice out what they claim to. It is the admission gate's own
exact-substring check, run in reverse against fresh bytes — which is why it
costs no model call and why `--refresh` is free to run at all. A side whose
document came back unreadable is skipped, not reported vanished: "could not
check" is a different fact from "gone". It prints second, right after
stability violations and before everything else.

`--rerun` is the opt-in that, after printing the drift report, also runs the
analysis on the fresh bytes and writes a new ledger over the same report
path — the same analysis as a full run. That call goes through the same
proposal cache as any other run: a byte-identical corpus with the same
settings is served from the cache and costs no model call; a miss, or
`--no-cache`, samples live. The ledger it writes carries a `replay` block
and is replayable the same way, unless `--no-cache` was also given. Stdout carries exactly
one document: with `--rerun` the drift report goes to stderr as text, never
JSON, and stdout carries the new ledger instead. It reuses the corpus
`--refresh` just fetched rather than fetching it twice, and the exit code
then reflects the fresh analysis itself — `3` on a refusal — like any other
run. `--rerun` requires
`--refresh`; `--refresh` in turn cannot take `--from-fixture` (it re-fetches
the report's own sources, not a fixture's), `--render` or `--fetch-only`
(different modes entirely), or `--snapshot` (it commits its re-fetched bytes
to `snapshots/` itself). If the fresh analysis refuses, the refusal is printed and exits
`3` as usual, but the file is not touched: a refusal caused by a bad egress
day must not destroy the baseline the next `--refresh` needs.

`--refresh` refuses the report itself before touching the network, exit `1`,
in three cases:
a saved refusal, because a refusal has no rows to check; a report carrying
no provenance — any document missing `pin`, `driftHash`, or `kind` (today
that is `reports/chime.json`, which has no committed fixture and was never
backfilled; comparing it against nothing would be exactly the failure this
tool exists to catch); and a permalink-pinned document whose blob is missing
from `snapshots/` — `getSnapshot` throws, since the store is read relative
to the working directory. The other three committed reports carry full
provenance and can be refreshed.

`--refresh --rerun` has been run live twice against Tesla FSD, both on
2026-09-12. The second pass used `runs: 2` (the CLI default). 8 sources
re-fetched, the 10-K read from the store, 0 unread. Drift was 0 stability
violated, 0 quote vanished, 0 unreadable, 5 drifted, 3 unchanged, 1 from
store. The analysis wrote 16 cached responses (8 per sample) and overwrote
`reports/tesla-fsd.json`. On 2026-09-14 that ledger was restamped from the
same snapshots after Assay inherited extractive gates: retrieve and chunking
changed the proposer request, so the 2026-09-12 cache missed, sixteen new
responses were written, and `--replay` reproduced identically against
those — until the field profile changed retrieval and it stopped being
replayable at all; see above. Claude,
Vercel, and Chime have not been refreshed live. The comparison and the
renderer were also exercised offline against
fixture bytes before the first of those runs — a Tesla-vs-its-own-fixture
check reporting 1 from store, 9 unchanged, 0 vanished; deleting one cited
span from that fixture text making it report exactly that quote vanished —
plus the CLI's refusal paths and the no-Anthropic-key path, end to end.

### Replaying a ledger

Every model response a live CLI, MCP, or web run makes is written to
`cache/proposals/<sha256>.json`,
keyed by the request that produced it — model, system prompt, the excerpts,
`max_tokens`, the output schema — so a change to any of them is a miss, with no
version number to bump. The entry stores the request alongside the response,
because a cache you can read is a receipt and a bare response is not. It is
committed, like `snapshots/`.

A second run over byte-identical bytes with the same settings hits every key,
makes no model call, and produces an identical ledger. `--no-cache` forces fresh
samples instead — it neither reads the cache nor writes to it, and the report it
produces carries no `replay` block.

A report now carries `replay: { sample, keys, model, candidates, threshold,
conflictMode }`, stamped after analysis, and only when every response that
analysis made is actually on disk. A `--no-cache` run, a run with a cache write
that failed, and a run with a model call that threw all say so on stderr instead
and carry no `replay` block. A two-sample run also stamps `runs: 2` and
`samples`, the key list for each sample.

New CLI runs take two proposer samples (`--runs 2`, the default on a fresh run
or `--refresh --rerun`). A row that survives both and rests only on stable
documents is `stable`; otherwise it is `provisional`, with reasons
(`volatile-source`, `single-proposer-run`, `pass-failed`, `stability-violated`).
`--runs 1` is the previous single-sample shape. `--replay` reads `runs` from the
stamp, not from the flag.

`--replay <report.json>` rebuilds the report from committed bytes alone: it
rebuilds the corpus from `snapshots/` using the report's own pins, verifying
every blob against its own id, then runs the same assay over the recorded
settings with a client that reads `cache/proposals/` and calls nothing. No
fetch, no model, no key. It compares the reproduction to the saved report on
everything but `generatedAt` and `replay` itself. Identical exits `0`. Different
exits `1` with a path-per-line diff, such as
`rows[3].status: "divergent" → "unverified"` — a finding, not a failure. And a
report that cannot be replayed at all exits `1` with one sentence naming why: no
`replay` block, a hash-pinned document, a missing blob, a blob that no longer
matches its own id, or a cached response that has since been pruned.

`.github/workflows/ci.yml` runs typecheck, the test suite, and `npm run replay`
on every push and pull request; the replay step prints
`N replayed, M not replayable`.

**Tesla FSD is replayable from two samples.** — until the field profile; see
above. The 2026-09-14 restamp from the 2026-09-12 snapshots recorded sixteen
responses in `cache/proposals/`, and until the profile existed,
`npm run cli -- tesla --replay reports/tesla-fsd.json` exited 0 with
`replay: identical (16 responses from cache)`. Every row was `provisional`
(`18 volatile-source`, `15 single-proposer-run`); none was `stable`. The
profile changed retrieval, so that ledger no longer replays either: `--replay`
now exits `1` with `not replayable: no field profile recorded — generated
before the profile existed`. Claude, Vercel, and Chime already refused for a
different reason — `no proposal cache recorded — generated before the cache
existed, or with --no-cache` — so all four now share only the tally:
`npm run replay` prints `0 replayed, 4 not replayable`.
The mechanism was also proven end to end on a stub-driven corpus
(`src/cli/replay.test.ts`): a ledger and a refusal, each reproduced
identically; a mutated row, a missing blob, a tampered blob, and a pruned
cache entry, each caught by name. Do not read Tesla's replay as bitwise
identity with the *previous* Tesla ledger — live re-fetch is allowed to
drift; that is the point of `--refresh`.

`toPinnedCorpus` itself stays deliberately pure — it never touches the
filesystem, whether it is running inside a live CLI, MCP, or web call or
under a unit test. The store write happens one layer up, in `storeCorpus`,
which `analyzeLive` (and the CLI's fetch-only path) call before handing the
corpus to `analyzeCorpus`. That split keeps the adapter testable without a
filesystem, and it means committing bytes is done by the machinery that
fetches — a live CLI, MCP, or web analysis through `analyzeLive`, and CLI
`--fetch-only` and `--refresh` through `storeCorpus` — rather than by
whichever code path happens to construct a corpus. On `--refresh --rerun`
the fresh-run body calls `storeCorpus` a second time on the same corpus
(once from `--refresh`, once from `analyzeLive`); every blob already exists,
so it writes nothing.

---

## Browsers only

Solari offers browsers, sandboxes, and desktops. This uses browsers and nothing else.

Every honest use here is a browser use, and adding a sandbox to touch a second
primitive would be decoration — the kind of thing reviewers who build this
infrastructure spot immediately. The constraint is the point.

---

## Development

```bash
npm test        # 728 tests
npm run typecheck
npm run replay  # replays every committed report that carries a `replay` block
```

Everything except `fetch/` is a pure function of a captured corpus, so the whole
engine is testable offline against committed fixtures — no key, no network, no cost.
`fixtures/` holds real captures: `tesla-fsd.json` — the corpus behind the showcase
ledger — alongside `vercel.json` and `claude.json` (both roles populated, and all
three with ledgers in `reports/`), plus `solari-free-plan.json`, a vendor with no
third-party footprint at all, which the tool correctly reports as an absence of
coverage rather than a clean bill of health. The `probe-*.json` captures are the
source-class and regulator probes documented above. `snapshots/` sits alongside
`fixtures/`: the content-addressed store described above, holding 38 blobs today.
Twenty-six were populated by backfilling fixtures into the reports that
predate live snapshots, matched by `docId`; twelve more arrived from the
two 2026-09-12 Tesla `--refresh` runs of pages whose bytes had drifted. A report with
no matching fixture is left as it was, rather than backfilled from bytes it
does not have.
Running the CLI against a fixture (`--from-fixture`), or a live MCP or web
process started from the repo, still commits fetched bytes the same way a
CLI fetch does, and writes model responses to `cache/proposals/`, so a local
run can leave new untracked files in both trees — real captures, so this is
intended, but worth knowing before you wonder why `git status` is not clean.
`cache/proposals/` sits alongside `snapshots/`: the content-addressed response
cache described in [Replaying a ledger](#replaying-a-ledger). It holds the
sixteen Tesla responses from the 2026-09-14 restamp (the 2026-09-12 keys remain
on disk and no longer replay); any live
entry point creates the directory on first use. `npm run
replay` runs `src/cli/replay-all.ts` over every report in `reports/`, and
`.github/workflows/ci.yml` runs it on every push and pull request, alongside
`npm run typecheck` and `npm test`.

MIT licensed.

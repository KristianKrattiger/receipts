# Reddit via the Official API — Design Spec

**Date:** 2026-09-05
**Status:** approved
**Supersedes:** the browser-login route for Reddit specified in
`docs/superpowers/specs/2026-09-05-verified-egress-design.md`. That route was implemented
(`src/cli/login.ts`, `--profile`, `--proxy-session`) and never successfully exercised; see
*Why the browser route is abandoned* below.

## Summary

Reddit is in every source plan and has never once been read. This spec reads it through
Reddit's published API with an app-only token, rather than by driving a logged-in browser
session through a bot challenge.

The change is one new self-contained adapter plus a provenance field. No source plan changes,
and no citation link changes: a reader still clicks through to `reddit.com`.

## Why the browser route is abandoned

The earlier spec chose browser login with a pinned exit IP. Two measurements since have made
that route both unattractive and probably impossible:

1. **Reddit's gate behind a working proxy is a challenge, not a login form.**
   `reports/egress-2026-09-05-captcha.json` records Reddit answering `200` with 240 characters
   of *"Prove your humanity … Complete the challenge below and let us know you're a real
   person"*. The login form sits behind that same challenge, so the login script's first live
   step is the thing that does not work.
2. **Solari's solver does not clear it, and pressing harder makes it worse.** Forty-two
   seconds of solving produced no change, and sustained attempts moved Reddit to a
   `429`-style *"Too Many Requests — whoa there, pardner!"* page. G2's parallel investigation
   then established that Solari's DataDome coverage is site-by-site and does not extend to
   the sites we care about.

There is also a reason to prefer the API that has nothing to do with whether the browser route
could be made to work. **App-only API access is sanctioned; automating a logged-in account is
contrary to Reddit's user agreement.** The earlier spec recorded that as a known accepted risk.
It no longer needs accepting, so it should not be.

## Scope

**In scope:** one Reddit adapter using `client_credentials`; routing Reddit targets to it;
`via` provenance on documents, carried through the report and rendered; `sessionId` becoming
optional; three pure helpers with unit tests; a correction to the anchor gate's newline comment.

**Out of scope:** Reddit comments (search results only); non-search Reddit URLs; any second
API-backed source; a general `Fetcher` abstraction — this codebase has been burned specifically
by generalising ahead of measurement, and there is exactly one caller. Retiring
`src/cli/login.ts` is also out of scope; it is left in place, unused, and this spec's
supersession note is the record of why.

## Architecture

### The adapter — `src/fetch/reddit.ts`

Self-contained. Given a `SourceTarget` and credentials it returns the same `FetchedDoc` the
browser fan returns, or throws the same `FetchError`. It knows about Reddit; nothing else in
the codebase does.

`fetchCorpus`'s worker gains one routing decision: Reddit URLs go to the adapter, everything
else to `fetchOne` unchanged.

### Source plans do not change

The adapter parses the subreddit and query out of the plan's existing URL —
`https://www.reddit.com/r/nextjs/search/?q=vercel` — and issues
`GET https://oauth.reddit.com/r/nextjs/search?q=vercel&restrict_sr=1&limit=25`.

`restrict_sr=1` keeps the search inside the named subreddit, matching what the plan URL asks
for. `limit=25` is a fixed constant, not a parameter: the candidate selector downstream already
caps how much of any one document reaches the model, so a larger listing would add cost without
adding reach.

This is not only convenience. **`doc.url` stays the `reddit.com` link**, so every citation in a
published ledger remains clickable by a reader who wants to check it. The API endpoint is an
implementation detail that never reaches the output. A ledger whose links pointed at
`oauth.reddit.com` would be strictly worse for the person the ledger is written for.

### Auth: app-only, no user account

`POST https://www.reddit.com/api/v1/access_token` with `grant_type=client_credentials` and HTTP
Basic auth from `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`, plus the descriptive `User-Agent`
Reddit requires. The resulting bearer token is read-only and acts as an application, not as a
person.

One token is acquired per run and reused across Reddit targets. Credentials live in `.env`,
which is gitignored, and are never committed.

### Text synthesis, and why the anchor gate already handles it

Posts are flattened into `doc.text` as `title` then `selftext`, **with posts joined by
newlines**.

That join is load-bearing. `src/bookkeeper/anchor.ts` rejects any admitted quote containing a
`\n`, on the reasoning that a newline marks a block boundary in `innerText`. Joining posts with
newlines makes that existing rule do exactly the right thing here at no cost: **a quote can
never stitch two different Reddit posts into one apparent statement.** The rule was written for
rendered block edges and turns out to be precisely correct for post boundaries.

The gate's comment currently justifies the rule only in terms of `innerText` and browser
rendering. That justification is now incomplete, and the comment should say so — otherwise the
next person to read it will believe the rule does not apply to API-sourced text and may weaken
it.

**Accepted consequence:** a quote also cannot span two paragraphs within a single post, because
`selftext` markdown carries real newlines between paragraphs. That costs the occasional long
quote and buys no false stitching. It is the right trade for this project.

### Provenance

```ts
/** How a document was read. Absent means the browser fan, which is the default path. */
via?: "browser" | "api"
```

Added to `FetchedDoc` **and** to `DocSummary`, because `DocSummary` — not `FetchedDoc` — is what
reaches the report and the renderers. `src/report/build.ts` must copy it through; a field added
only to `FetchedDoc` would silently never render.

Optional, so every committed fixture still parses and every browser row renders exactly as it
does today.

**The annotation is specified here so three renderers do not invent three different ones.**
Each renderer already has a helper that turns a document into its display label
(`sourceLabel` in terminal, `label` in markdown, `sourceFor` in html). That helper appends
`" (via api)"` when `via === "api"` and is unchanged otherwise, so the annotation appears both
on a cited row and in the sources listing, from one rule per renderer.

This is required by the project's own stated position. The README's access stance says reading
a source without saying how is the thing that would break it. An API-read row is exactly a case
where *how* differs from every other row on the page.

### `sessionId` becomes optional

An API-fetched document has no browser session. `sessionId` is currently a required `string` on
`FetchedDoc`.

Making it optional is safe, and this was checked rather than assumed: `sessionId` is *written*
in one place (`src/fetch/fan.ts`) and declared in `src/types.ts`, and is **read nowhere in
`src/`**. No consumer depends on its presence. Test fixtures that set it stay valid.

`egress` is already optional and is simply absent for API documents, which is accurate — there
was no proxy.

## Error handling

The existing invariant holds: one refused source never fails a run.

| condition | reason |
|---|---|
| credentials absent from the environment | `auth_required` |
| `401` or `403` from Reddit | `auth_required` |
| `429` | `blocked` |
| anything else | `http_error` |

Credentials absent is deliberately not an error. A contributor without Reddit credentials runs
the tool and gets a ledger with Reddit reported as `not read (auth_required)` — which is the
honest statement of that run's coverage, and is how every other unreadable source already
behaves.

## Testing

Three pure functions carry the logic worth testing, following the pattern `fan.ts` already uses
for `classifyFailure` and `parseProxy`:

- **`isRedditTarget(url: string): boolean`** — routes on host. Table tests including that a
  non-Reddit URL merely containing the string "reddit" does not match.
- **`parseRedditSearchUrl(url: string): { subreddit: string; query: string }`** — table tests
  over the plan's real URL shape, plus a rejection case for a Reddit URL that is not a search.
- **`redditDocText(listing): string`** — the synthesis, table-tested against a captured JSON
  listing fixture. Must assert that posts are newline-separated, since that separation is what
  the anchor gate relies on to prevent cross-post stitching.

OAuth and HTTP are not unit-tested, the same standing decision as the browser path.

## Definition of done

- A Reddit target in a normal run either produces a `FetchedDoc` with `via: "api"`, or a
  failure whose reason names the actual condition.
- `doc.url` is a `reddit.com` link in every produced document.
- The ledger visibly marks API-read rows in all three renderers.
- `via` survives the trip through `report/build.ts` into `DocSummary`.
- No source plan file changes.
- The anchor gate's newline comment states both justifications.
- Committed fixtures still parse; existing browser rows render unchanged.

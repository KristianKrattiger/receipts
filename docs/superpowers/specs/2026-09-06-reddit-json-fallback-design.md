# Reddit Unauthenticated Fallback — Design Spec

**Date:** 2026-09-06
**Status:** approved
**Amends:** `docs/superpowers/specs/2026-09-05-reddit-api-design.md`, which specified OAuth as
the only Reddit access path. That path is implemented, reviewed, and merged (`main`,
commit `540cfa2`); it has never been exercised, because Reddit's script-app registration form
could not be completed — its reCAPTCHA fails silently and consistently, independent of
browser, extensions, or third-party-cookie settings. This spec does not replace the OAuth
path; it adds a path that needs no app registration at all, and keeps OAuth as the better
option when it is reachable.

## Summary

Reddit serves its search results as public JSON with no authentication —
`https://www.reddit.com/r/<sub>/search.json?q=...` — the same interface RSS readers and old
API clients have used for years. This spec adds a second Reddit fetcher that reads through
that endpoint, used automatically when no `RedditCreds` are configured. When credentials
are configured, OAuth is used as today, because it carries a higher rate-limit ceiling and
is Reddit's sanctioned path for sustained use.

Nothing about the ledger's output changes: `via` stays `"api"` for both, `doc.url` stays the
`reddit.com` citation link, and the anchor gate's newline-per-post guarantee is unaffected —
this spec adds a second way to fetch the same shape of text, not a new kind of text.

## Motivation

Three failed attempts to reach the script-app registration form, across browsers, with and
without extensions and third-party cookies enabled, all producing the same silent reCAPTCHA
failure with no image challenge and no error text — this is a known, reported failure mode of
Reddit's app-creation page, not a configuration problem on this end. The OAuth path this
project built is real and correct, but it cannot currently be turned on, and there is no
reason the entire Reddit source should stay `not read` while that stays true.

Reddit's public `.json` suffix is not a workaround or a scrape target found by inspecting
network traffic — it is a long-published, still-functioning interface with no authentication
requirement. Using it is not analogous to solving a captcha or automating a login; it is an
unauthenticated HTTP GET to an endpoint Reddit serves publicly, which is a materially
different thing from the browser-login route this project already rejected on ToS grounds.

## What is known, and what is not

**Known, from this project's own measurements:** `www.reddit.com` — the host `/search.json`
lives on — has already refused this project twice. The browser fan gets a "Prove your
humanity" challenge behind a working proxy (`reports/egress-2026-09-05-captcha.json`), and
sustained pressure on that same host produced a `429`-shaped "Too Many Requests" page
(`src/fetch/fan.ts`'s `BLOCK_MARKERS`, added from that exact measurement).

**Not known:** whether `/search.json` — a different, older, historically more permissive
interface on the same host — is gated the same way. This spec does not assume it is or is
not. It handles the failure defensively (see *Error handling*) and treats the first live run
as the measurement that actually answers the question, the same discipline this project
applied to the proxy tier and the captcha-solve rate before drawing any conclusion from a
single data point.

## Scope

**In scope:** `redditJsonUrl`; `fetchRedditDocViaJson`; renaming the current `fetchRedditDoc`
to `fetchRedditDocViaOAuth`; a `fetchRedditDoc` dispatcher choosing between them on whether
`creds` is present; `raw_json=1` on **both** the OAuth and JSON requests; removing
`fetchRedditDocOrExplain` and its now-false `auth_required` message from `fan.ts`; a README
rewrite of the access-stance section once the first live run reports.

**Out of scope:** any change to `via`, to `doc.url`, to the newline-join text synthesis, to
`isRedditTarget` or `parseRedditSearchUrl`, or to any renderer. Distinguishing an
authenticated read from an unauthenticated one in the ledger was considered and rejected —
a reader already learns the row was not browser-fetched, which is the distinction that
matters for trusting the quote; which credentials happened to be configured that day is not.

## Architecture

### `raw_json=1` — required by this project's own guarantee, not a nicety

Reddit's JSON API HTML-escapes characters (`&` → `&amp;`, `<` → `&lt;`) unless this parameter
is set. This project's admission gate re-derives every quote as an exact substring of fetched
bytes. If Reddit returns the escaped form and the model — reading a rendering a person would
actually see — proposes the unescaped form, the gate correctly rejects it, and Reddit rows
would fail to admit for a reason nobody could see from the ledger alone. Add it to the query
string of both the OAuth search request and the new JSON request.

### `redditJsonUrl` — pure, alongside the existing URL helpers

```ts
/**
 * Pure: the public, unauthenticated search endpoint for a target.
 *
 * `.json` rather than `oauth.reddit.com`: this is the interface Reddit serves
 * with no application and no token, the same one RSS readers have used for
 * years. `raw_json=1` matters here as much as on the OAuth path -- this
 * project's admission gate needs exact bytes, and Reddit HTML-escapes the
 * response without it.
 */
export function redditJsonUrl(target: SourceTarget): string {
  const { subreddit, query } = parseRedditSearchUrl(target.url)
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}&raw_json=1`
}
```

### `fetchRedditDocViaJson`

Plain `fetch`, no `Authorization` header, but a real `User-Agent` — Reddit's own API rules ask
unauthenticated callers to identify themselves too, and a missing or generic agent is one of
the most common reasons a request gets throttled. Uses `REDDIT_USER_AGENT` if set, falling
back to a built-in default string, so this path works with **zero** configuration.

### Error handling — defensive, because the host's history is not clean

This is where the JSON path earns being a separate function rather than a branch inside the
OAuth one: its failure surface is different, and guessing at it would repeat a mistake this
project has already made and corrected on the browser path.

| condition | reason | why |
|---|---|---|
| `429` | `blocked` | matches the marker this project already recorded for this host |
| `403` | `blocked` | no login route exists to name on an unauthenticated request, unlike the browser's auth-wall page |
| response `content-type` is not JSON, or `res.json()` throws | `blocked`, detail carries the status and a short body excerpt | the shape a challenge interstitial takes when JSON was expected — this is the exact failure mode G2's DataDome page and Reddit's own browser challenge both produced |
| any other non-`ok` status | `http_error` | |
| parses, but the listing is empty | `empty` | same floor-free reasoning as the OAuth path — a JSON listing has no chrome, so empty is genuinely empty |

### Dispatcher

```ts
/**
 * OAuth when credentials exist -- Reddit's sanctioned path, with the higher
 * rate-limit ceiling. The public `.json` endpoint otherwise, so Reddit is
 * readable with zero configuration rather than staying `not read` while no
 * script app can be registered.
 */
export async function fetchRedditDoc(
  target: SourceTarget,
  creds: RedditCreds | undefined,
): Promise<FetchedDoc> {
  return creds ? fetchRedditDocViaOAuth(target, creds) : fetchRedditDocViaJson(target)
}
```

The current `fetchRedditDoc` (OAuth) is renamed `fetchRedditDocViaOAuth`; its body,
comments, and error handling are otherwise untouched — that function is reviewed and correct,
and this spec does not reopen it beyond adding `raw_json=1` to its search URL.

**That addition is a latent correctness gap in the merged code, not new scope invented for
this spec.** The OAuth search request never carried `raw_json=1` either, so the escaping
problem described above has existed since Task 4 landed — it was simply never triggered,
because the OAuth path has never been run. Fixing it here, while touching the same line for
the JSON path, is the honest way to land it rather than filing it as a separate finding
against code that has not yet had a chance to fail.

### `fan.ts` — a wrapper is deleted, not replaced

`fetchRedditDocOrExplain` (`src/fetch/fan.ts:439-450`) exists to turn "no credentials" into an
honest `auth_required` failure. That framing is now false: absent credentials no longer mean
Reddit goes unread, they mean it is read through the other path. The wrapper is deleted, and
the worker calls `fetchRedditDoc(target, reddit)` directly, where `reddit` is `RedditCreds |
undefined` exactly as it is today — the dispatcher now owns the branch the wrapper used to.

`auth_required` remains reachable through `fetchRedditDocViaOAuth`'s own checks (a configured
but rejected token) — this removes only the missing-credentials case, which was the one case
that no longer describes reality.

## Testing

`redditJsonUrl` gets the same table-test treatment as `parseRedditSearchUrl`: the query shape
for a representative target, and an explicit assertion that `raw_json=1` is present — this is
the parameter a future edit is most likely to drop without a test to catch it, since its
absence produces no error, only silently-wrong quotes weeks later.

`fetchRedditDocViaJson`'s network behavior is not unit-tested, the same standing decision the
OAuth function and the browser fetcher both follow. Its response-shape defensiveness (non-JSON
`content-type`, a thrown `res.json()`) is exactly the kind of behavior that needs one real
fetch to confirm rather than a mock — recorded here as the first thing to check when the live
run happens, not deferred silently.

## Documentation

The README's access-stance section currently frames OAuth as the whole Reddit story. It is
rewritten, not appended to, once the first live run reports what the unauthenticated path
actually returns: what configuration is required (none, by default), what the authenticated
path adds (a higher rate-limit ceiling), and — if the run shows the `.json` endpoint gated the
same way the browser was — that finding, stated as plainly as every other measurement this
project has published.

## Definition of done

- `fetchRedditDoc` reads Reddit with no `.env` configuration at all.
- `raw_json=1` is present on every Reddit search request, OAuth and JSON alike.
- `fetchRedditDocOrExplain` no longer exists; the worker calls `fetchRedditDoc` directly.
- The `auth_required`-on-missing-credentials failure is gone; every other failure reason on
  both paths is reachable and correctly attributed.
- `via`, `doc.url`, and every renderer are unchanged from the merged OAuth-only state.
- The first live run's actual result — success, or a named failure — is recorded, not assumed.

# Reddit Unauthenticated Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reddit readable with zero configuration, by adding a public-JSON fetcher alongside the existing OAuth one and dispatching between them on whether credentials are present.

**Architecture:** `redditJsonUrl` (pure) and `fetchRedditDocViaJson` (network) join the existing `reddit.ts`. The current `fetchRedditDoc` is renamed `fetchRedditDocViaOAuth`; a new `fetchRedditDoc` becomes a two-line dispatcher. `fan.ts` loses a wrapper whose framing is now false.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, Node's global `fetch`, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-06-reddit-json-fallback-design.md`. Every task serves it.
- **`raw_json=1` goes on both search requests — OAuth and JSON.** This project's admission gate
  needs exact bytes; Reddit HTML-escapes the response without it. The OAuth request has never
  carried it; that gap is fixed here alongside the new path, not filed separately.
- **`via` stays `"api"` for both paths. `doc.url` stays the target's `reddit.com` link on both.**
  No renderer changes in this plan.
- **The JSON path's failure handling is written defensively, not by assumption.** `www.reddit.com`
  has already refused this project twice (a browser challenge, then rate limiting under
  pressure). Whether `/search.json` is gated the same way is unmeasured — do not write the error
  handling as though either answer is known, and do not weaken it after Task 3's live run without
  writing down what the run showed.
- Only `src/fetch/reddit.ts`, `src/fetch/reddit.test.ts`, `src/fetch/fan.ts`, and (Task 3 only)
  `README.md` may change.
- Tests: `npm test -- src/`. **This does not exclude the foreign directory** — vitest treats
  `src/` as a substring filter, not a path scope, so `solari-receipts/src/server/server.test.ts`
  still matches and still fails to load. Every "Expected" below names the real outcome: overall
  exit non-zero, one file failed, and **356 passed** — read the *Tests* count, not the exit code
  or the *Test Files* count, as this project's own result. Do not touch `solari-receipts/` to
  chase a clean exit code; it is a separate, unrelated project sharing this working tree. Types:
  `npm run typecheck`. Both checked before every commit.
- Commit after every task. Never `--no-verify`.
- Branch: create from `main` — name it `reddit-json-fallback`.

---

### Task 1: The pure URL builder

**Files:**
- Modify: `src/fetch/reddit.ts`
- Modify: `src/fetch/reddit.test.ts`

**Interfaces:**
- Consumes: `parseRedditSearchUrl` (already in the file), `SEARCH_LIMIT` (already a module
  constant, value `25`, declared later in the file — usable from anywhere in the module).
- Produces: `redditJsonUrl(target: SourceTarget): string`

- [ ] **Step 1: Write the failing tests**

In `src/fetch/reddit.test.ts`, widen the existing import line from:

```ts
import { isRedditTarget, parseRedditSearchUrl, redditDocText } from "./reddit.js"
```

to:

```ts
import { isRedditTarget, parseRedditSearchUrl, redditDocText, redditJsonUrl } from "./reddit.js"
```

Then append, after the `parseRedditSearchUrl` describe block and before the `listing` constant:

```ts
import type { SourceTarget } from "../types.js"

const target = (url: string): SourceTarget => ({
  kind: "forum", role: "independent", url, label: "Reddit",
})

describe("redditJsonUrl — the public search endpoint, built correctly", () => {
  it("builds the .json search URL for a plan target", () => {
    const url = redditJsonUrl(target("https://www.reddit.com/r/nextjs/search/?q=vercel"))
    expect(url).toBe(
      "https://www.reddit.com/r/nextjs/search.json?q=vercel&restrict_sr=1&limit=25&raw_json=1",
    )
  })

  // The parameter most likely to be dropped by a future edit with no test to
  // catch it: its absence produces no error, only silently wrong quotes weeks
  // later, once an admitted span happens to contain an escaped character.
  it("always includes raw_json=1", () => {
    expect(redditJsonUrl(target("https://www.reddit.com/r/aws/search/?q=s3%20outage")))
      .toContain("raw_json=1")
  })

  it("encodes a query with spaces and punctuation", () => {
    const url = redditJsonUrl(target("https://www.reddit.com/r/aws/search/?q=s3%20outage"))
    expect(url).toContain("q=s3%20outage")
  })

  it("rejects a reddit URL that is not a subreddit search, same as parseRedditSearchUrl", () => {
    expect(() => redditJsonUrl(target("https://www.reddit.com/r/nextjs/")))
      .toThrow(/not a subreddit search/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/fetch/reddit.test.ts`
Expected: FAIL — `redditJsonUrl is not a function` (import resolves, since it is a named import
of a non-existent export, which vitest reports as the value being `undefined`).

- [ ] **Step 3: Implement**

In `src/fetch/reddit.ts`, add immediately after `redditDocText` (before the
`import { docIdFor, FetchError } from "./common.js"` line that currently sits mid-file):

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

This references `SourceTarget` and `SEARCH_LIMIT`, both declared lower in the file —
`SourceTarget` in the `import type { FetchedDoc, SourceTarget } from "../types.js"` line, and
`SEARCH_LIMIT` as a module-level `const`. This compiles and runs correctly despite the textual
order: a function's body is evaluated only when the function is *called*, not when it is
*defined*, and by the time anything calls `redditJsonUrl` the whole module has already finished
its top-to-bottom initialization. (This is different from referencing a `const` directly at
module top level before its own declaration line, which throws — that case doesn't apply here,
because the reference sits inside a function body, not in code that runs at load time.) Do not
move the new function below those declarations — placing it near the other pure URL helpers,
ahead of the network code, is deliberate and matches where the test file's imports expect to
find "pure helper" functions grouped.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/fetch/reddit.test.ts`
Expected: PASS, all cases (14 existing + 4 new = 18).

- [ ] **Step 5: Verify the whole suite and typecheck**

Run: `npm test -- src/`
Expected: **356 passed** in the *Tests* line. The overall run still reports one failed file and
a non-zero exit — that is `solari-receipts/src/server/server.test.ts`, an unrelated foreign
project sharing this working tree, matched because `src/` is a substring filter and not a path
scope. Judge this step by the passed-test count, not the exit code.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/fetch/reddit.ts src/fetch/reddit.test.ts
git commit -m "feat(receipts): build the public search URL, with raw_json required

redditJsonUrl is the pure half of the unauthenticated fetch path: given a
plan's reddit.com/r/<sub>/search URL, it builds the .json endpoint Reddit
serves with no application and no token.

raw_json=1 is asserted by its own test, not left to be caught by accident --
its absence produces no error, only silently wrong quotes weeks later, once
an admitted span happens to contain a character Reddit would otherwise
HTML-escape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: The network path, the dispatcher, and the pre-existing `raw_json` gap

**Files:**
- Modify: `src/fetch/reddit.ts`
- Modify: `src/fetch/fan.ts`

**Interfaces:**
- Consumes: `redditJsonUrl` (Task 1), `docIdFor`, `FetchError` (from `./common.js`, already
  imported), `normalizeText` (already imported), `redditDocText` (already in the file).
- Produces: `fetchRedditDocViaJson(target: SourceTarget): Promise<FetchedDoc>`,
  `fetchRedditDocViaOAuth` (renamed from today's `fetchRedditDoc`),
  `fetchRedditDoc(target: SourceTarget, creds: RedditCreds | undefined): Promise<FetchedDoc>`.

This task adds no tests. The network path is not unit-tested, matching the standing decision
already made for the OAuth function and the browser fetcher — see the plan's Definition of Done
for what Task 3's live run must confirm instead.

- [ ] **Step 1: Add `raw_json=1` to the OAuth search URL**

In `src/fetch/reddit.ts`, inside the current `fetchRedditDoc` function (about to be renamed in
Step 2), find:

```ts
  const endpoint = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}`
```

Change it to:

```ts
  const endpoint = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}&raw_json=1`
```

This closes a gap that has existed since this function was written: it never carried
`raw_json=1`, so Reddit's HTML-escaping could have silently broken an admitted quote the first
time this path ran. It has never run, which is why the gap survived review — fixed now, in the
same file, rather than filed as a separate finding against code that hasn't yet had the chance
to fail.

- [ ] **Step 2: Rename the OAuth function**

In `src/fetch/reddit.ts`, rename `fetchRedditDoc` to `fetchRedditDocViaOAuth`:

```ts
export async function fetchRedditDocViaOAuth(
  target: SourceTarget,
  creds: RedditCreds,
): Promise<FetchedDoc> {
```

Its body, its doc comment, and its error handling are otherwise unchanged.

- [ ] **Step 3: Add the JSON fetcher**

Immediately below the renamed function, still in `src/fetch/reddit.ts`, add:

```ts
/** Sent whenever no application is configured, so Reddit sees a real identifier either way. */
const DEFAULT_USER_AGENT = "receipts/0.1 (unauthenticated; +https://github.com/KristianKrattiger/receipts)"

/**
 * Read one Reddit search target through the public, unauthenticated endpoint.
 *
 * The failure handling here is deliberately more defensive than the OAuth
 * function's. `www.reddit.com` has already refused this project twice -- a
 * browser challenge, then rate limiting under pressure -- and whether this
 * older, historically more permissive interface on the same host is gated the
 * same way is unmeasured. A 403 or a non-JSON response is treated as a refusal
 * rather than assumed to be an application error, because that is exactly the
 * shape a challenge interstitial takes when JSON was expected -- the same
 * failure mode G2's DataDome page and Reddit's own browser challenge produced.
 */
export async function fetchRedditDocViaJson(target: SourceTarget): Promise<FetchedDoc> {
  const userAgent = process.env["REDDIT_USER_AGENT"] ?? DEFAULT_USER_AGENT
  const res = await fetch(redditJsonUrl(target), { headers: { "user-agent": userAgent } })

  if (res.status === 429) {
    throw new FetchError("blocked", `${target.label}: reddit rate-limited us (429)`)
  }
  if (res.status === 403) {
    // No login route to name here, unlike the browser's auth-wall page --
    // this request carries no credentials to begin with.
    throw new FetchError("blocked", `${target.label}: reddit refused the request (403)`)
  }
  if (!res.ok) {
    throw new FetchError("http_error", `${target.label}: reddit returned ${res.status}`)
  }

  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim()
    throw new FetchError(
      "blocked",
      `${target.label}: reddit answered with ${contentType || "no content-type"} instead of JSON — ${body || "(empty)"}`,
    )
  }

  let listing: RedditListing
  try {
    listing = (await res.json()) as RedditListing
  } catch (err) {
    throw new FetchError(
      "blocked",
      `${target.label}: reddit's response could not be parsed as JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  const text = normalizeText(redditDocText(listing))
  if (text.length === 0) {
    throw new FetchError("empty", `${target.label}: reddit search matched no posts`)
  }

  return {
    docId: docIdFor(target),
    url: target.url,
    label: target.label,
    role: target.role,
    kind: target.kind,
    fetchedAt: new Date().toISOString(),
    title: target.label,
    text,
    via: "api",
  }
}
```

- [ ] **Step 4: Add the dispatcher**

Immediately below `fetchRedditDocViaJson`, add:

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

- [ ] **Step 5: Delete the now-false wrapper in `fan.ts`**

In `src/fetch/fan.ts`, delete this entire function:

```ts
  /** Missing credentials are a `not read` row with a reason, never a crash. */
  async function fetchRedditDocOrExplain(
    target: SourceTarget,
    creds: RedditCreds | undefined,
  ): Promise<FetchedDoc> {
    if (!creds) {
      throw new FetchError(
        "auth_required",
        `${target.label}: set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to read Reddit`,
      )
    }
    return fetchRedditDoc(target, creds)
  }
```

Its framing is now false: absent credentials no longer mean Reddit goes unread, they mean it is
read through the other path. In the `worker` function, change:

```ts
        docs.push(
          isRedditTarget(target.url)
            ? await fetchRedditDocOrExplain(target, reddit)
            : await fetchOne(solari, target, timeoutMs, proxyCountry, stealth, proxySession, profileId, captcha),
        )
```

to:

```ts
        docs.push(
          isRedditTarget(target.url)
            ? await fetchRedditDoc(target, reddit)
            : await fetchOne(solari, target, timeoutMs, proxyCountry, stealth, proxySession, profileId, captcha),
        )
```

`fan.ts` already imports `fetchRedditDoc` from `./reddit.js`; no import line changes.

- [ ] **Step 6: Verify**

Run: `npm test -- src/`
Expected: **356 passed** (this task adds none — see the note above the steps). As in every other
task, one foreign file (`solari-receipts/...`) still reports failed and the exit code is still
non-zero; that is expected and not a regression to chase.

Run: `npm run typecheck`
Expected: no output. This is the step that would catch a signature mismatch between the renamed
`fetchRedditDocViaOAuth` and any stale reference to the old `fetchRedditDoc` name — there should
be none outside `reddit.ts` itself, since `fan.ts` always called it through the name
`fetchRedditDoc`, which now refers to the new dispatcher with a compatible call shape.

- [ ] **Step 7: Confirm nothing here reaches the network**

Run: `npx tsx src/cli/index.ts`
Expected: usage text, exit 1. Confirms the import graph (including the new `fetchRedditDocViaJson`)
loads cleanly with no side effects at module load.

Do NOT run `npm run cli` with a real subject in this task — that is Task 3.

- [ ] **Step 8: Commit**

```bash
git add src/fetch/reddit.ts src/fetch/fan.ts
git commit -m "feat(receipts): read Reddit with no credentials at all

fetchRedditDoc is now a dispatcher: OAuth when credentials are configured,
the public .json endpoint otherwise. The wrapper that turned missing
credentials into an auth_required failure is deleted -- that framing was
true when the only Reddit path required an application, and it is false now.

The unauthenticated path treats a 403 or a non-JSON response as a refusal,
not an application error. www.reddit.com has already refused this project
twice, and whether /search.json is gated the same way is unmeasured; the
error handling does not assume either answer.

Also closes a gap in the OAuth request that predates this branch: it never
carried raw_json=1, so Reddit's HTML-escaping could have silently broken an
admitted quote the first time that path ran. It never had the chance to,
which is why review did not catch it -- fixed here, in the same file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Run it, and make the documentation true

This is the task that answers the question the spec named as genuinely open: whether Reddit's
public search endpoint is gated the way its browser-rendered pages are.

**Files:**
- Modify: `README.md`
- Create: a corpus snapshot under `fixtures/`

**No `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are required for this task.** The whole point of
Task 2 is that Reddit now reads with zero configuration. If those variables happen to be set,
remove or comment them out in `.env` before this task's fetch, so the run actually exercises
`fetchRedditDocViaJson` — otherwise it silently takes the OAuth path and this task answers the
wrong question.

- [ ] **Step 1: Confirm no Reddit credentials are active**

Run: `grep -c '^REDDIT_CLIENT_ID=' .env 2>/dev/null || echo 0`
Expected: `0`, or the line is absent/commented. If it prints `1`, comment that line and
`REDDIT_CLIENT_SECRET` out before continuing.

- [ ] **Step 2: Fetch a real corpus**

```bash
npm run cli -- vercel --fetch-only --sources plans/vercel.json --snapshot fixtures/vercel-reddit-json.json
```

Expected: the source listing on stderr shows a result for `Reddit - r/nextjs`. Three possible
outcomes, and each is informative:

- `read` with a non-trivial character count → the unauthenticated path works. Proceed to Step 3.
- `blocked` → the endpoint is gated the same way the browser path was. This is a real result,
  not a failed task — record it exactly as measured in Step 5, and skip Steps 3–4.
- `empty` → the search matched no posts. Try a different query in a scratch copy of the plan
  before concluding the path itself is broken.

- [ ] **Step 3: Confirm the guarantees on real data (only if Step 2 produced a read)**

In the snapshot, check:

1. `url` is a **`reddit.com`** link, not `www.reddit.com/.../search.json` or anything else — the
   citation a reader would click.
2. `via` is `"api"`.
3. `text` contains no `&amp;`, `&lt;`, or `&gt;` sequences where an unescaped `&`, `<`, or `>`
   would be expected — evidence `raw_json=1` actually took effect. If any appear, `raw_json=1` is
   not doing what this plan assumed; stop and report rather than continuing to Step 4.
4. `text` contains newlines separating posts, same as the OAuth path would produce.

- [ ] **Step 4: Render a ledger and confirm the annotation (only if Step 2 produced a read)**

```bash
npm run cli -- vercel --from-fixture fixtures/vercel-reddit-json.json
```

Expected: the sources listing shows the Reddit row annotated `(via api)` — this exercises the
Task 2 (prior branch) rendering path unchanged; if it does not appear, something in this branch
broke that wiring, and the fix belongs on this branch, not deferred.

- [ ] **Step 5: Rewrite the README's access-stance section with what was actually measured**

The current section frames OAuth as the whole Reddit story. Replace it with what Step 2 showed:

- If it read: state that Reddit now reads with **no configuration required**, through its public
  search JSON; that `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` are optional and raise the rate-limit
  ceiling when set; and name the actual character count and query from the run.
- If it was blocked: state plainly that the public endpoint is gated the same way the browser
  path is, name the exact failure reason and detail text recorded, and that OAuth (once a script
  app can be registered) remains the only path shown to work.

Either way, this is a measurement being reported, not a feature being announced — write it in the
register the rest of this README's access-stance section already uses.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- src/`
Expected: **356 passed** (unchanged from Task 2 — this task fetches and documents, it does not
add code). Same foreign-file caveat as every other task applies.

Run: `npm run typecheck`
Expected: no output.

```bash
git add README.md fixtures/vercel-reddit-json.json
git commit -m "run(receipts): read Reddit for the first time with no credentials

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If Step 2 resulted in `blocked`, note that explicitly in the commit body: what was blocked, on
what evidence, and that the OAuth path remains the recommended one pending script-app access.

---

## Definition of done

- `fetchRedditDoc` reads Reddit with `.env` carrying no Reddit variables at all.
- `raw_json=1` is present on every Reddit search request, OAuth and JSON alike, each guarded by
  its own test or its own confirmed-on-real-data check.
- `fetchRedditDocOrExplain` no longer exists in `src/fetch/fan.ts`.
- The `auth_required`-on-missing-credentials failure is gone from the Reddit path; every other
  failure reason on both paths remains reachable and correctly attributed.
- `via`, `doc.url`, and every renderer are unchanged from the merged OAuth-only state.
- The actual result of the first unauthenticated run — a read, or a named failure — is recorded
  in the README and in the commit that produced it, not assumed in either direction.

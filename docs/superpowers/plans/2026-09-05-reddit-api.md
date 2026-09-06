# Reddit API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Reddit through its official app-only API, and mark in the ledger that it was read that way.

**Architecture:** Provenance lands in the data model first, then in the renderers, then the adapter is built pure-first and wired in last. `src/fetch/reddit.ts` is self-contained: it knows Reddit, and nothing else in the codebase does.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, Node's global `fetch`, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-reddit-api-design.md`. Every task serves it.
- **`doc.url` must remain a `reddit.com` link on every produced document.** The `oauth.reddit.com`
  endpoint is internal and must never reach report output — a reader has to be able to click a
  citation and check it.
- **Posts are joined by newlines.** `src/bookkeeper/anchor.ts` rejects any quote containing `\n`,
  and that is what stops a quote stitching two different Reddit posts into one apparent
  statement. Do not join posts with spaces.
- **One refused source never fails a run.** Missing credentials are a `not read` row, not an error.
- `doc.text` is normalized exactly once, at the fetch boundary, by `normalizeText`.
- No source plan file (`plans/*.json`) may change.
- Tests: `npm test`. Types: `npm run typecheck`. Both pass before every commit.
- Commit after every task. Never `--no-verify`.
- Never commit credentials. `.env` is gitignored; `.env.example` carries placeholder names only.
- Branch: `reddit-auth`.

---

### Task 1: Provenance in the data model

`via` must reach `DocSummary`, not just `FetchedDoc` — `DocSummary` is what the report and the
renderers actually see, so a field added only to `FetchedDoc` would compile, pass tests, and
silently never render.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/report/build.ts`
- Test: `src/report/build.test.ts`

**Interfaces:**
- Produces: `FetchVia` (`"browser" | "api"`), `FetchedDoc.via?`, `DocSummary.via?`,
  `FetchedDoc.sessionId?` (now optional).

- [ ] **Step 1: Write the failing test**

Append to `src/report/build.test.ts`. It already builds corpora for other cases — follow the
shape of the nearest existing test for constructing a `Corpus`, and add:

```ts
describe("buildReport — provenance survives the trip to DocSummary", () => {
  it("carries via through to the report's docs", () => {
    const corpus = {
      subject: "acme",
      docs: [{
        docId: "d1", url: "https://www.reddit.com/r/x/search/?q=acme", label: "Reddit - r/x",
        role: "independent" as const, kind: "forum" as const,
        fetchedAt: "2026-09-05T00:00:00.000Z", title: "Reddit", text: "body text here",
        via: "api" as const,
      }],
      failures: [],
    }
    const report = buildReport(corpus, 0, { admitted: [], denied: [] })
    expect(report.docs[0]!.via).toBe("api")
  })

  // Absent means the browser fan. Every committed fixture predates this field.
  it("leaves via undefined for a document that did not set it", () => {
    const corpus = {
      subject: "acme",
      docs: [{
        docId: "d1", url: "https://acme.com", label: "Acme", role: "claimant" as const,
        kind: "vendor_site" as const, fetchedAt: "2026-09-05T00:00:00.000Z",
        title: "Acme", text: "body text here", sessionId: "s1",
      }],
      failures: [],
    }
    const report = buildReport(corpus, 0, { admitted: [], denied: [] })
    expect(report.docs[0]!.via).toBeUndefined()
  })
})
```

The signature is `buildReport(corpus, proposed, result, opts?)` — verified, not guessed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/report/build.test.ts`
Expected: FAIL — `via` is not a known property, or `report.docs[0].via` is `undefined` on the
first case.

- [ ] **Step 3: Add the type**

In `src/types.ts`, above `FetchedDoc`:

```ts
/**
 * How a document was read.
 *
 * Absent means the browser fan, which is the default path and the one every
 * committed fixture predates. Recorded because this tool's claim is that it
 * says how it read each source, and an API-read row is precisely a case where
 * the answer differs from every other row on the page.
 */
export type FetchVia = "browser" | "api"
```

In `FetchedDoc`, make `sessionId` optional and add `via`:

```ts
  /** Absent for documents not fetched through a browser. Written by the fan, read nowhere. */
  sessionId?: string
  via?: FetchVia
```

In `DocSummary`, add:

```ts
  via?: FetchVia
```

- [ ] **Step 4: Propagate it in the report build**

In `src/report/build.ts`, the `docs` mapping currently reads:

```ts
    docs: corpus.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
    })),
```

Replace with:

```ts
    docs: corpus.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
      // Spread rather than always-set: an absent `via` must stay absent, so
      // reports built from pre-existing fixtures do not sprout a field.
      ...(d.via !== undefined ? { via: d.via } : {}),
    })),
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/report/build.ts src/report/build.test.ts
git commit -m "feat(receipts): record how a document was read

via goes on DocSummary as well as FetchedDoc, because DocSummary is what
reaches the report and the renderers -- a field added only to FetchedDoc
would compile, pass, and silently never render.

Optional, so every committed fixture still parses and browser rows are
unchanged. sessionId becomes optional too: an API document has no browser
session, and nothing in src/ reads that field.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Provenance in the ledger

The spec asked for the annotation in both the cited row and the sources listing. Those are
separate code paths in all three renderers, so one shared helper is used rather than six
open-coded suffixes.

**Files:**
- Create: `src/report/render/via.ts`
- Create: `src/report/render/via.test.ts`
- Modify: `src/report/render/terminal.ts`, `src/report/render/markdown.ts`, `src/report/render/html.ts`
- Test: `src/report/render/render.test.ts` (terminal, markdown) and
  `src/report/render/html.test.ts` (html — it is a separate file with its own imports)

**Interfaces:**
- Consumes: `FetchVia`, `DocSummary.via` from Task 1.
- Produces: `viaSuffix(via: FetchVia | undefined): string`

- [ ] **Step 1: Write the failing tests**

Create `src/report/render/via.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { viaSuffix } from "./via.js"

describe("viaSuffix — a row says how it was read", () => {
  it("marks an API-read document", () => {
    expect(viaSuffix("api")).toBe(" (via api)")
  })

  // The browser fan is the default path and every existing row uses it.
  // Annotating those would add noise to every ledger this project has published.
  it("says nothing for a browser-read document", () => {
    expect(viaSuffix("browser")).toBe("")
  })

  it("says nothing when provenance was not recorded", () => {
    expect(viaSuffix(undefined)).toBe("")
  })
})
```

Append to `src/report/render/render.test.ts` — follow the existing tests in that file for how a
`Report` is constructed, and add one case per renderer asserting the annotation reaches output:

```ts
describe("renderers mark API-read sources", () => {
  const apiReport = {
    subject: "acme",
    generatedAt: "2026-09-05T00:00:00.000Z",
    docs: [{
      docId: "d1", url: "https://www.reddit.com/r/x/search/?q=acme", label: "Reddit - r/x",
      role: "independent" as const, fetchedAt: "2026-09-05T00:00:00.000Z", via: "api" as const,
    }],
    failures: [],
    rows: [],
    audit: { proposed: 0, admitted: 0, denied: [] },
  }

  it("terminal names the provenance in the sources listing", () => {
    expect(renderTerminal(apiReport)).toContain("(via api)")
  })

  it("markdown names the provenance in the sources listing", () => {
    expect(renderMarkdown(apiReport)).toContain("(via api)")
  })

})
```

**`render.test.ts` imports only `renderMarkdown` and `renderTerminal` — verified.** `renderHtml`
lives in its own file, so put the html case in `src/report/render/html.test.ts` instead, which
already imports `renderHtml`:

```ts
describe("renderHtml marks API-read sources", () => {
  it("names the provenance in the sources listing", () => {
    const apiReport = {
      ...REPORT,
      docs: [{
        docId: "d1", url: "https://www.reddit.com/r/x/search/?q=acme", label: "Reddit - r/x",
        role: "independent" as const, fetchedAt: "2026-09-05T00:00:00.000Z", via: "api" as const,
      }],
      rows: [],
    }
    expect(renderHtml(apiReport)).toContain("(via api)")
  })
})
```

`html.test.ts` already defines a `REPORT` constant to spread from.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/report/render/`
Expected: FAIL — cannot resolve `./via.js`, and the three renderer cases do not contain
`(via api)`. Note `renderIndex` in `html.test.ts` is untouched by this task.

- [ ] **Step 3: Implement the helper**

Create `src/report/render/via.ts`:

```ts
import type { FetchVia } from "../../types.js"

/**
 * Pure: the provenance suffix a document's label carries.
 *
 * One helper rather than six open-coded suffixes, because each renderer shows a
 * document's label in two separate places -- on a cited row and in the sources
 * listing -- and those drifting apart would mean a ledger that marks a source
 * in one place and not the other.
 *
 * Only `api` is annotated. The browser fan is the default path, and marking it
 * would add noise to every row of every ledger this project has published.
 */
export function viaSuffix(via: FetchVia | undefined): string {
  return via === "api" ? " (via api)" : ""
}
```

- [ ] **Step 4: Use it in all three renderers, in both places each**

In `src/report/render/terminal.ts`, import it and change `sourceLabel` to append it:

```ts
function sourceLabel(docs: DocSummary[], span: AdmittedSpan): string {
  const doc = docs.find((d) => d.docId === span.docId)
  const suffix = span.tag === "AMBIGUOUS" ? " (appears more than once)" : ""
  return `${doc?.label ?? span.docId}${suffix}${viaSuffix(doc?.via)}`
}
```

and in the sources listing loop, change the line that prints `doc.label` so it reads
`${doc.label}${viaSuffix(doc.via)}`.

In `src/report/render/markdown.ts`, change `label` to append it:

```ts
  return `[${doc.label}](${doc.url})${ambiguous}${viaSuffix(doc.via)}`
```

and likewise append `${viaSuffix(doc.via)}` where the sources listing prints a document's label.

In `src/report/render/html.ts`, append `esc(viaSuffix(doc.via))` after the link in `sourceFor`,
and likewise in its sources listing. The suffix is a static ASCII string, so escaping it is
belt-and-braces rather than necessary — do it anyway for consistency with the surrounding code.

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS, all suites. Existing renderer snapshots and assertions must be unchanged, since
no existing fixture sets `via`.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/report/render/ src/types.ts
git commit -m "feat(receipts): mark API-read sources in the ledger

Each renderer shows a document's label twice -- on a cited row and in the
sources listing -- so the annotation goes through one shared helper rather
than six open-coded suffixes that could drift into marking a source in one
place and not the other.

Only api is annotated; the browser fan is the default path and marking it
would add noise to every row of every ledger already published.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The Reddit adapter's pure core

Everything decidable without a network, built and tested first.

**Files:**
- Create: `src/fetch/reddit.ts`
- Create: `src/fetch/reddit.test.ts`

**Interfaces:**
- Produces: `isRedditTarget(url: string): boolean`,
  `parseRedditSearchUrl(url: string): { subreddit: string; query: string }`,
  `RedditListing`, `redditDocText(listing: RedditListing): string`

- [ ] **Step 1: Write the failing tests**

Create `src/fetch/reddit.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isRedditTarget, parseRedditSearchUrl, redditDocText } from "./reddit.js"

describe("isRedditTarget — route on the host, not on the string", () => {
  it("matches a reddit search URL", () => {
    expect(isRedditTarget("https://www.reddit.com/r/nextjs/search/?q=vercel")).toBe(true)
  })

  it("matches reddit without the www", () => {
    expect(isRedditTarget("https://reddit.com/r/nextjs/search/?q=vercel")).toBe(true)
  })

  // A host check, not a substring check: an article about Reddit is not Reddit.
  it("does not match another site that merely mentions reddit", () => {
    expect(isRedditTarget("https://news.example.com/2026/reddit-api-changes")).toBe(false)
  })

  it("does not match a lookalike domain", () => {
    expect(isRedditTarget("https://reddit.com.evil.example/r/x/search/?q=a")).toBe(false)
  })

  it("returns false for a malformed URL rather than throwing", () => {
    expect(isRedditTarget("not a url")).toBe(false)
  })
})

describe("parseRedditSearchUrl", () => {
  it("pulls the subreddit and query out of a plan URL", () => {
    expect(parseRedditSearchUrl("https://www.reddit.com/r/nextjs/search/?q=vercel"))
      .toEqual({ subreddit: "nextjs", query: "vercel" })
  })

  it("handles a query with spaces and punctuation", () => {
    expect(parseRedditSearchUrl("https://www.reddit.com/r/aws/search/?q=s3%20outage"))
      .toEqual({ subreddit: "aws", query: "s3 outage" })
  })

  it("refuses a reddit URL that is not a subreddit search", () => {
    expect(() => parseRedditSearchUrl("https://www.reddit.com/r/nextjs/"))
      .toThrow(/not a subreddit search/)
  })

  it("refuses a site-wide search, which names no subreddit", () => {
    expect(() => parseRedditSearchUrl("https://www.reddit.com/search/?q=vercel"))
      .toThrow(/not a subreddit search/)
  })
})

const listing = {
  data: {
    children: [
      { data: { title: "Vercel pricing changed overnight", selftext: "We saw a 4x increase." } },
      { data: { title: "Build times regressed after the update", selftext: "" } },
    ],
  },
}

describe("redditDocText — posts must not run together", () => {
  it("keeps every post's title", () => {
    const text = redditDocText(listing)
    expect(text).toContain("Vercel pricing changed overnight")
    expect(text).toContain("Build times regressed after the update")
  })

  it("keeps selftext where a post has it", () => {
    expect(redditDocText(listing)).toContain("We saw a 4x increase.")
  })

  // Load-bearing. anchor.ts rejects any quote containing a newline, which is
  // what stops a quote stitching two separate posts into one apparent
  // statement. Joining with anything else would silently defeat that gate.
  it("separates posts with a newline", () => {
    const text = redditDocText(listing)
    const between = text.slice(
      text.indexOf("We saw a 4x increase."),
      text.indexOf("Build times regressed"),
    )
    expect(between).toContain("\n")
  })

  it("separates a title from its own selftext with a newline", () => {
    const text = redditDocText(listing)
    const between = text.slice(
      text.indexOf("Vercel pricing changed overnight"),
      text.indexOf("We saw a 4x increase."),
    )
    expect(between).toContain("\n")
  })

  it("returns an empty string for a listing with no posts", () => {
    expect(redditDocText({ data: { children: [] } })).toBe("")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/fetch/reddit.test.ts`
Expected: FAIL — cannot resolve `./reddit.js`.

- [ ] **Step 3: Implement**

Create `src/fetch/reddit.ts`:

```ts
/**
 * Reddit, read through its published API rather than through a browser.
 *
 * Reddit is in every source plan and was never once read by the browser fan:
 * behind a working proxy it answers 200 with a "Prove your humanity" challenge
 * that Solari's solver does not clear, and pressing harder produces rate
 * limiting. App-only API access is the route Reddit publishes for this, and it
 * removes a risk rather than accepting one -- automating a logged-in account is
 * contrary to Reddit's user agreement; an application token is not.
 */

/** The shape of a search listing, narrowed to the fields this reads. */
export interface RedditListing {
  data?: { children?: { data?: { title?: string; selftext?: string } }[] }
}

/**
 * Pure: is this target Reddit's own site?
 *
 * A host check rather than a substring check. An article *about* Reddit is not
 * Reddit, and `reddit.com.evil.example` is not Reddit either -- the same
 * distinction the challenge fingerprinter draws by matching asset hosts rather
 * than vendor names.
 */
export function isRedditTarget(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === "reddit.com" || host.endsWith(".reddit.com")
}

/**
 * Pure: read the subreddit and query out of a plan's own URL.
 *
 * Plans keep the human `reddit.com/r/<sub>/search/?q=<query>` form, because
 * that URL is also the citation a reader clicks. This translates it; the API
 * endpoint never reaches the output.
 */
export function parseRedditSearchUrl(url: string): { subreddit: string; query: string } {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/^\/r\/([^/]+)\/search\/?$/)
  const query = parsed.searchParams.get("q")
  if (!match || !query) {
    throw new Error(`reddit: ${url} is not a subreddit search (want /r/<sub>/search/?q=...)`)
  }
  return { subreddit: match[1]!, query }
}

/**
 * Pure: flatten a listing into the document text the gate will anchor against.
 *
 * Every piece is joined by a newline, and that is load-bearing rather than
 * cosmetic. `anchor.ts` rejects any admitted quote containing a `\n`, so
 * newline-joining is what makes it impossible for a quote to stitch two
 * separate posts -- or a title and its own body -- into one apparent statement.
 * Joining with spaces would silently defeat that gate.
 */
export function redditDocText(listing: RedditListing): string {
  const pieces: string[] = []
  for (const child of listing.data?.children ?? []) {
    const title = child.data?.title?.trim()
    const selftext = child.data?.selftext?.trim()
    if (title) pieces.push(title)
    if (selftext) pieces.push(selftext)
  }
  return pieces.join("\n")
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/fetch/reddit.test.ts`
Expected: PASS, all fourteen cases.

Run: `npm test && npm run typecheck`
Expected: PASS, no output.

- [ ] **Step 5: Commit**

```bash
git add src/fetch/reddit.ts src/fetch/reddit.test.ts
git commit -m "feat(receipts): the pure half of reading Reddit

Routing is a host check, not a substring check -- an article about Reddit is
not Reddit, and reddit.com.evil.example is not either.

Plans keep the human reddit.com/r/<sub>/search URL because that is also the
citation a reader clicks; this translates it, and the API endpoint never
reaches the output.

Posts are joined by newlines, which is load-bearing rather than cosmetic:
anchor.ts rejects any quote containing a newline, so this is what stops a
quote stitching two separate posts into one apparent statement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The network path, and routing

**Files:**
- Create: `src/fetch/common.ts`
- Modify: `src/fetch/fan.ts` (remove the local `FetchError`, import it, add routing)
- Modify: `src/fetch/reddit.ts` (add `fetchRedditDoc`)
- Modify: `src/cli/index.ts` (pass credentials through)

**Interfaces:**
- Consumes: `isRedditTarget`, `parseRedditSearchUrl`, `redditDocText` (Task 3); `FetchVia` (Task 1).
- Produces: `FetchError` and `docIdFor` from `src/fetch/common.ts`;
  `fetchRedditDoc(target: SourceTarget, creds: RedditCreds): Promise<FetchedDoc>`;
  `FanOptions.reddit?: RedditCreds`.

- [ ] **Step 1: Extract what both fetchers need, so neither imports the other**

Two things are shared. `FetchError` is declared unexported in `src/fetch/fan.ts`, and the
adapter must throw the same type. `docIdFor` is exported from `fan.ts` but the adapter needs it
too — and **re-deriving the hash in the adapter would be worse than a duplication**: two
fetchers computing document ids independently can drift, and then the same URL produces
different ids depending on which path read it, silently breaking every anchor that cites it.

`fan.ts` will import `reddit.ts` for routing, so neither can live in a fetcher.

Create `src/fetch/common.ts`:

```ts
import { createHash } from "node:crypto"
import type { Egress, FailureReason, SourceTarget } from "../types.js"

/**
 * What both fetchers need, extracted so neither has to import the other.
 *
 * `fan.ts` imports the Reddit adapter to route to it, so anything the adapter
 * also needs cannot live in `fan.ts` without making the two modules circular.
 */

/** A fetch that failed in a way the ledger can name. */
export class FetchError extends Error {
  constructor(public reason: FailureReason, message: string, public egress?: Egress) {
    super(message)
    this.name = "FetchError"
  }
}

/**
 * Pure: stable per-URL document id.
 *
 * Shared rather than reimplemented per fetcher. Two fetchers hashing
 * independently can drift, and then one URL yields different ids depending on
 * which path read it -- which silently breaks every anchor citing that document.
 */
export function docIdFor(target: SourceTarget): string {
  return createHash("sha256").update(target.url).digest("hex").slice(0, 12)
}
```

In `src/fetch/fan.ts`: delete the local `class FetchError { ... }` declaration, delete the local
`docIdFor` function, and re-export `docIdFor` so existing importers of it from `fan.js` keep
working:

```ts
import { docIdFor, FetchError } from "./common.js"
export { docIdFor } from "./common.js"
```

Check what already imports `docIdFor` from `fan.js` before finishing this step:

Run: `grep -rn "docIdFor" src/ --include="*.ts"`

Every existing importer must still resolve. If the re-export makes `createHash` unused in
`fan.ts`, remove that import too.

Run `npm test && npm run typecheck` now — this step changes no behaviour, and both must pass
before continuing.

- [ ] **Step 2: Add the credentials type and the network path**

Append to `src/fetch/reddit.ts`:

```ts
import { docIdFor, FetchError } from "./common.js"
import { normalizeText } from "./normalize.js"
import type { FetchedDoc, SourceTarget } from "../types.js"

export interface RedditCreds {
  clientId: string
  clientSecret: string
  /** Reddit requires a descriptive agent and rate-limits generic ones harder. */
  userAgent: string
}

/** Fixed: the candidate selector already caps how much of one document reaches the model. */
const SEARCH_LIMIT = 25

async function accessToken(creds: RedditCreds): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": creds.userAgent,
    },
    body: "grant_type=client_credentials",
  })
  if (res.status === 401 || res.status === 403) {
    throw new FetchError("auth_required", `reddit: token refused (${res.status})`)
  }
  if (!res.ok) {
    throw new FetchError("http_error", `reddit: token request failed (${res.status})`)
  }
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new FetchError("auth_required", "reddit: no token in response")
  return body.access_token
}

/**
 * Read one Reddit search target through the API.
 *
 * `doc.url` stays the target's own reddit.com URL: the API endpoint is an
 * implementation detail, and a citation a reader cannot click is worse than no
 * citation.
 */
export async function fetchRedditDoc(
  target: SourceTarget,
  creds: RedditCreds,
): Promise<FetchedDoc> {
  const { subreddit, query } = parseRedditSearchUrl(target.url)
  const token = await accessToken(creds)
  const endpoint = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search`
    + `?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${SEARCH_LIMIT}`

  const res = await fetch(endpoint, {
    headers: { authorization: `Bearer ${token}`, "user-agent": creds.userAgent },
  })
  if (res.status === 401 || res.status === 403) {
    throw new FetchError("auth_required", `${target.label}: reddit refused the token (${res.status})`)
  }
  if (res.status === 429) {
    throw new FetchError("blocked", `${target.label}: reddit rate-limited us (429)`)
  }
  if (!res.ok) {
    throw new FetchError("http_error", `${target.label}: reddit returned ${res.status}`)
  }

  const text = normalizeText(redditDocText((await res.json()) as RedditListing))
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

- [ ] **Step 3: Route Reddit targets in the fan**

In `src/fetch/fan.ts`, add to the imports:

```ts
import { fetchRedditDoc, isRedditTarget, type RedditCreds } from "./reddit.js"
```

Add to `FanOptions`:

```ts
  /**
   * Reddit application credentials. Absent means Reddit reports `auth_required`
   * and the run continues -- a contributor without them still gets a ledger,
   * with Reddit named as unread, which is the honest coverage of that run.
   */
  reddit?: RedditCreds
```

In `fetchCorpus`, beside the other option reads:

```ts
  const reddit = opts.reddit
```

In the `worker` loop, replace the single `docs.push(...)` line with:

```ts
        docs.push(
          isRedditTarget(target.url)
            ? await fetchRedditDocOrExplain(target, reddit)
            : await fetchOne(solari, target, timeoutMs, proxyCountry, stealth, proxySession, profileId, captcha),
        )
```

and add this helper inside `fetchCorpus`, above `worker`:

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

- [ ] **Step 4: Pass credentials from the CLI**

In `src/cli/index.ts`, in the `fetchCorpus` call, add:

```ts
    ...(process.env["REDDIT_CLIENT_ID"] && process.env["REDDIT_CLIENT_SECRET"]
      ? {
          reddit: {
            clientId: process.env["REDDIT_CLIENT_ID"],
            clientSecret: process.env["REDDIT_CLIENT_SECRET"],
            userAgent: process.env["REDDIT_USER_AGENT"] ?? "receipts/0.1 (claim-ledger research)",
          },
        }
      : {}),
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: no output.

Run: `npx tsx src/cli/index.ts` (no arguments)
Expected: the usage text, exit 1 — confirming nothing at import time reaches the network.

Do NOT attempt a live Reddit fetch in this task; Task 5 covers running it.

- [ ] **Step 6: Commit**

```bash
git add src/fetch/common.ts src/fetch/fan.ts src/fetch/reddit.ts src/cli/index.ts
git commit -m "feat(receipts): read Reddit through its API, and say so

FetchError and docIdFor move to a shared module because both fetchers need
them and fan.ts imports the adapter -- leaving them in either would make the
two modules circular. Sharing docIdFor rather than reimplementing it matters:
two fetchers hashing independently can drift, and then one URL yields
different ids depending on which path read it, silently breaking every anchor
that cites that document.

Missing credentials are a not-read row with a reason, never a crash: a
contributor without Reddit credentials still gets a ledger, with Reddit named
as unread, which is the honest coverage of that run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Run it, and make the documentation true

**Files:**
- Modify: `.env.example`
- Modify: `src/bookkeeper/anchor.ts` (comment only)
- Modify: `README.md`
- Create: a corpus snapshot under `fixtures/`

- [ ] **Step 1: Document the credentials**

Append to `.env.example`:

```
# Reddit, read through its official API with an app-only token.
# Create a "script" app at https://www.reddit.com/prefs/apps to get these.
# App-only access is read-only and acts as an application, not as a person.
REDDIT_CLIENT_ID=your_reddit_app_client_id
REDDIT_CLIENT_SECRET=your_reddit_app_secret
REDDIT_USER_AGENT=receipts/0.1 (by /u/your_username)
```

- [ ] **Step 2: Correct the anchor gate's newline comment**

In `src/bookkeeper/anchor.ts`, the comment above `CROSSES_BLOCK_BOUNDARY` justifies the rule
purely in terms of `innerText` and browser rendering. That is now incomplete: a reader would
reasonably conclude the rule does not apply to API-sourced text and might weaken it. Append this
paragraph to that comment, immediately before its closing `*/`:

```
 *
 * The rule earns its keep a second way, on text that never came from a
 * renderer. Reddit documents are built by joining posts with newlines, so this
 * same check is what stops a quote stitching two separate posts -- written by
 * different people, about different things -- into one apparent statement.
 * Do not relax it to "only applies to browser text": it is load-bearing for
 * both.
```

- [ ] **Step 3: Fetch a real corpus**

```bash
npm run cli -- vercel --fetch-only --sources plans/vercel.json --snapshot fixtures/vercel-reddit.json
```

Expected: the source listing on stderr shows `read` for `Reddit - r/nextjs` with a non-trivial
character count. If it shows `auth_required`, the credentials are missing or wrong — fix that
before continuing. If it shows `empty`, the search matched no posts; try a different query in a
scratch copy of the plan before concluding the adapter is broken.

- [ ] **Step 4: Confirm the guarantees on real data**

In the snapshot, check:

1. The Reddit document's `url` is a **`reddit.com`** link, not `oauth.reddit.com`.
2. Its `via` is `"api"`.
3. Its `text` contains newlines between posts.
4. It has no `sessionId` and no `egress`.

- [ ] **Step 5: Render a ledger and confirm the annotation**

```bash
npm run cli -- vercel --from-fixture fixtures/vercel-reddit.json
```

Expected: a ledger whose sources listing shows the Reddit row annotated `(via api)`. If Reddit
contributes an admitted row, that row's source is annotated too.

- [ ] **Step 6: Update the README**

The README currently states that Reddit's challenge does not solve and that pressing it earns a
rate limit. That remains true of the browser path and should stay. Add that Reddit is now read
through its official API with an app-only token, that this is the sanctioned route rather than a
bypass, and that API-read rows are marked `(via api)` in the ledger. Update the source-results
table row for Reddit to what the run in Step 3 actually produced.

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: PASS, no output.

```bash
git add .env.example src/bookkeeper/anchor.ts README.md fixtures/vercel-reddit.json
git commit -m "run(receipts): read Reddit for the first time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- A Reddit target in a normal run produces a document with `via: "api"`, or a failure whose
  reason names the actual condition.
- Every produced Reddit document's `url` is a `reddit.com` link.
- The ledger shows `(via api)` on Reddit rows and in the sources listing, in all three renderers.
- Running without Reddit credentials still produces a ledger, with Reddit reported `not read`.
- No `plans/*.json` file changed.
- `anchor.ts`'s newline comment states both justifications.
- Committed fixtures still parse; existing browser rows render unchanged.

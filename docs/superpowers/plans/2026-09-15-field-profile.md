# Field Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every domain-specific thing the Assay engine ships — proposer prompt, discourse lexicon, retrieval policy — into one required `FieldProfile` value owned by each field instance, so the engine refuses to run without one and both instances are peers.

**Architecture:** `src/assay/` (the engine, byte-identical in `receipts` and `claim-record`) gains a `FieldProfile` type and consumes it at three points: `assayOnce` (prompt + retrieval), `discourseRole` (lexicon), `runReplay`'s manifest (name). Each repo gets `src/instance/profile.ts`. The 10(b) calibration corpus leaves the engine for `claim-record/src/instance/calibration/`; Receipts gains its own web-shaped calibration under `receipts/src/instance/calibration/`. Tasks 1–5 are engine work on a `field-profile` branch in `receipts`; Task 6 copies the engine to `claim-record` and wires that instance; Tasks 7–9 finish Receipts, docs, and the paid restamp.

**Tech Stack:** TypeScript (strict, nodenext), vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-field-profile-design.md` — read it first.

## Global Constraints

- Every `FieldProfile` field is required; the type has no `?` members.
- `assay()` without `opts.profile` throws exactly: `assay: no field profile — the engine has no lexicon, prompt, or retrieval policy of its own`.
- A sentence ending in `?` (after trim) is `issue` in every field; that rule stays in `discourseRole`, not in any lexicon.
- Admission terms remain `tokenize(query.subject)`; the profile does not change the relevance gate.
- `runReplay` refusals use the exact sentences in the spec's error table.
- `src/assay/` must stay importable only from itself, `zod`, `vitest`, `node:`; non-test engine files must not import `test-profile`.
- After Task 6, `diff -rq receipts/src/assay claim-record/src/assay` is empty and stays empty through Task 9.
- Receipts' `RECEIPTS.system` is the engine's current `SYSTEM` string byte-for-byte.
- Commit messages: imperative summary line, body explaining why, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run `npm run typecheck` and `npm test` before every commit; both must be clean.

## File Structure

**receipts (engine tasks):**
- `src/assay/types.ts` — `FieldProfile`, `AssayOptions.profile`, `ReplayManifest.profile`; `AssayOptions.system` removed
- `src/assay/test-profile.ts` — `TEST_PROFILE`, a minimal legal-shaped profile for engine tests only
- `src/assay/index.ts` — refuse without profile; `selectForRun(corpus, subject, retrieval, total)` exported; prompt from profile
- `src/assay/cartographer/propose.ts` — `SYSTEM` deleted; `system` required in `proposeRelations` / `proposeAcrossPasses`
- `src/assay/retrieve/idf.ts` — `queryTermsFor(mode, subject, claimantTexts)`
- `src/assay/retrieve/select.ts` — `pinEnds` option
- `src/assay/bookkeeper/discourse.ts` — regex constants deleted; `discourseRole(sentence, lexicon)`
- `src/assay/bookkeeper/admit.ts` — `admit(corpus, proposals, queryTerms, idf, threshold, lexicon)`
- `src/assay/isolation.test.ts` — `test-profile` rule
- `src/assay/calibration/` — deleted (moves to claim-record in Task 6)
- `src/instance/profile.ts` — `RECEIPTS`
- `src/instance/calibration/corpus.ts`, `calibration.test.ts`, `tesla-candidates.test.ts` — Receipts calibration
- `src/pipeline.ts`, `src/cli/replay.ts`, `src/cli/replay-all.ts`, `src/analyze-live.ts` — pass/stamp the profile
- `src/cli/replay.test.ts`, `src/cli/exit.test.ts` etc. — fixtures

**claim-record (instance task):**
- `src/assay/` — copied from receipts
- `src/instance/profile.ts` — `CLAIM_RECORD`
- `src/instance/run.ts` — passes the profile
- `src/instance/calibration/corpus.ts`, `calibration.test.ts` — moved from the engine

---

### Task 1: `FieldProfile` type, the refusal, and the prompt leaves the engine

**Files:**
- Modify: `src/assay/types.ts:188-204` (AssayOptions), add `FieldProfile` above it
- Create: `src/assay/test-profile.ts`
- Modify: `src/assay/index.ts:18-50, 91-100`
- Modify: `src/assay/cartographer/propose.ts:15-68` (delete `SYSTEM`), `:104-118`, `:225-240`
- Create: `src/instance/profile.ts`
- Modify: `src/pipeline.ts`, `src/cli/replay.ts:130-140`
- Test: `src/assay/index.test.ts`, `src/assay/cartographer/propose.test.ts`, `src/assay/isolation.test.ts`, `src/cli/replay.test.ts:60-66`

**Interfaces:**
- Produces: `FieldProfile` (spec shape), `AssayOptions.profile: FieldProfile` (required), `TEST_PROFILE: FieldProfile`, `RECEIPTS: FieldProfile`. `proposeRelations(subject, docs, candidates, opts: { client?; idPrefix?; mode?; system: string })`, `proposeAcrossPasses(subject, docs, candidates, opts: { client?; concurrency?; system: string })`.
- The engine consumes only `profile.system` and `profile.name` in this task; `lexicon` and `retrieval` are declared now and adopted in Tasks 3–4.

- [ ] **Step 1: Branch**

```bash
git checkout -b field-profile
```

- [ ] **Step 2: Write the failing tests**

In `src/assay/index.test.ts`, add at the top after the imports:

```ts
import { TEST_PROFILE } from "./test-profile.js"
```

and add this test inside the first `describe`:

```ts
  it("refuses to run without a field profile, before any model call", async () => {
    let calls = 0
    const client: ProposalClient = { propose: async () => { calls++; return { proposals: [] } } }
    const corpus: PinnedCorpus = {
      subject: "X",
      docs: [doc({ docId: "a", role: "claimant" }), doc({ docId: "b", role: "independent", text: "It was down." })],
      failures: [],
    }
    await expect(assay(corpus, { subject: "X" }, { client } as never)).rejects.toThrow(
      "assay: no field profile — the engine has no lexicon, prompt, or retrieval policy of its own",
    )
    expect(calls).toBe(0)
  })

  it("sends the profile's system prompt to the proposer", async () => {
    const seen: string[] = []
    const client: ProposalClient = { propose: async (body) => { seen.push(body.system); return { proposals: [] } } }
    const corpus: PinnedCorpus = {
      subject: "X",
      docs: [doc({ docId: "a", role: "claimant" }), doc({ docId: "b", role: "independent", text: "It was down." })],
      failures: [],
    }
    await assay(corpus, { subject: "X" }, { client, profile: { ...TEST_PROFILE, system: "Test prompt." } })
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen)).toEqual(new Set(["Test prompt."]))
  })
```

Then add `profile: TEST_PROFILE` to every other `assay(` call's options object in this file (five calls: lines 30, 42, 77, 86, 116 as of HEAD).

In `src/assay/cartographer/propose.test.ts`, change the test at line 74 to:

```ts
  it("sends the caller's system prompt and the subject in the user message", async () => {
    const stub = recordingClient()
    await proposeRelations("acme", DOCS, CANDIDATES, { client: stub, system: "Sys." })
    const body = seen[0]!
    expect(body.system).toBe("Sys.")
    expect(body.user).toContain("Subject: acme")
  })
```

(Keep whatever helper the file already uses to build `stub`; the point is `system` is now required and echoed verbatim. Delete the separate "uses an injected system prompt" test at line 82 — it is now the same test.) Add `system: "Sys."` to every other `proposeRelations(` / `proposeAcrossPasses(` call in the file.

In `src/assay/isolation.test.ts`, add a second `it` inside the describe:

```ts
  it("keeps test-profile out of non-test engine code", () => {
    const users: string[] = []
    for (const file of walk(ASSAY_ROOT)) {
      if (file.endsWith(".test.ts")) continue
      const src = readFileSync(file, "utf8")
      if (/["']\.\.?\/(?:[^"']*\/)?test-profile\.js["']/.test(src)) users.push(relative(ASSAY_ROOT, file))
    }
    expect(users).toEqual([])
  })
```

In `src/cli/replay.test.ts` `makeReplayable` (line 63), add `profile: RECEIPTS` to the `assay(` options and import `RECEIPTS` from `"../instance/profile.js"`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/assay/index.test.ts src/assay/cartographer/propose.test.ts src/assay/isolation.test.ts`
Expected: FAIL — `Cannot find module './test-profile.js'`, and propose tests fail on `system` typing once the module exists.

- [ ] **Step 4: Add the type**

In `src/assay/types.ts`, insert above `export interface AssayOptions`:

```ts
/**
 * Everything the engine is told about the field it works in. The engine
 * has no lexicon, prompt, or retrieval policy of its own: a field instance
 * (Receipts, Claim/Record) owns one of these and passes it on every call.
 * Every field is required so that no domain choice is ever a silent default.
 */
export interface FieldProfile {
  /** Names this field in the replay manifest and error messages: "receipts", "claim-record". */
  name: string
  /** Proposer system prompt, sent verbatim on every pass. */
  system: string
  /**
   * Closed cue lists, one RegExp per role, tested against a trimmed sentence.
   * holding: the source itself commits to a finding. issue: poses one.
   * argument: reports someone else's position. A sentence ending in "?" is
   * `issue` in every field; that rule lives in discourseRole, not here.
   */
  lexicon: { holding: RegExp; issue: RegExp; argument: RegExp }
  retrieval: {
    /** "subject": the query subject alone ranks chunks. "subject+claimant": every claimant token joins the query. */
    queryTerms: "subject" | "subject+claimant"
    /** Keep each document's first and last chunk regardless of rank. */
    pinEnds: boolean
  }
}
```

In `AssayOptions`, delete the `system?: string` member and its doc comment, and add:

```ts
  /** Required. See FieldProfile. assay() throws without it. */
  profile: FieldProfile
```

- [ ] **Step 5: Create the test profile**

`src/assay/test-profile.ts`:

```ts
import type { FieldProfile } from "./types.js"

/**
 * A profile for engine tests only. The admit and calibration fixtures were
 * written in legal vocabulary, so this lexicon is legal-shaped; the isolation
 * test forbids any non-test engine file from importing it.
 */
export const TEST_PROFILE: FieldProfile = {
  name: "test",
  system: "Test system prompt.",
  lexicon: {
    holding: /\bwe hold\b|\bheld:|\bwe conclude\b|\bwe reverse\b/i,
    issue: /\bgranted certiorari\b|\bquestion presented\b|\bwhether .{0,80} will lie\b|^["“']?whether\b/i,
    argument: /\bpetitioner argues\b|\brespondent (?:argues|contends)\b|\bsome courts have held\b|\bthe court below\b/i,
  },
  retrieval: { queryTerms: "subject+claimant", pinEnds: true },
}
```

- [ ] **Step 6: Make `system` required in propose.ts**

Delete the `const SYSTEM = \`...\`` constant (lines 15–68, ending at the line `  Use the whole range and use precise values. Do not cluster on one number.\``). Copy it first — Step 8 needs the exact string.

Change `proposeRelations`'s options type and body:

```ts
  opts: { client?: ProposalClient; idPrefix?: string; mode?: ProposalPass["mode"]; system: string },
): Promise<RelationProposal[]> {
  if (!opts.client) throw new Error("assay: ProposalClient is required")
  const excerpts = buildExcerpts(docs, candidates)
  const response = await opts.client.propose({
    system: opts.system,
```

Change `proposeAcrossPasses`:

```ts
  opts: { client?: ProposalClient; concurrency?: number; system: string },
): Promise<FannedProposals> {
  const passes = planPasses(docs, candidates)
  const failures: PassFailure[] = []

  const perPass = await mapWithLimit(passes, opts.concurrency ?? 3, async (pass) => {
    try {
      return await proposeRelations(subject, docs, pass.candidates, {
        ...(opts.client ? { client: opts.client } : {}),
        system: opts.system,
        idPrefix: `${pass.passId}:`,
        mode: pass.mode,
      })
```

- [ ] **Step 7: Refuse in `assay()` and pass the prompt**

In `src/assay/index.ts`, `assay()`:

```ts
export async function assay(
  corpus: PinnedCorpus,
  query: AssayQuery,
  opts: AssayOptions,
): Promise<AssayResult> {
  if (!opts?.profile) {
    throw new Error("assay: no field profile — the engine has no lexicon, prompt, or retrieval policy of its own")
  }
  const empty = { admitted: [], denied: [] }
```

(Drop the `= {}` default on `opts`.) In `assayOnce`, replace the `proposeAcrossPasses` call's options:

```ts
  const fanned = await proposeAcrossPasses(query.subject, corpus.docs, candidates, {
    ...(client ? { client } : {}),
    ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    system: opts.profile.system,
  })
```

- [ ] **Step 8: Create the Receipts profile**

`src/instance/profile.ts` (new directory):

```ts
import type { FieldProfile } from "../assay/types.js"

/**
 * Receipts: a vendor's live web claims against independent web sources.
 *
 * `system` is the string the engine shipped as its default until the field
 * profile existed, byte for byte — the Tesla proposal cache keys on it.
 *
 * The lexicon is a first draft. `holding` marks a source committing to its
 * own test or measurement; `argument` marks attributed hearsay. It is closed
 * and extractive like Claim/Record's, and corrected through
 * src/instance/calibration/, not by inference at run time.
 */
export const RECEIPTS: FieldProfile = {
  name: "receipts",
  system: `<paste the deleted SYSTEM string here, verbatim, including its final line>`,
  lexicon: {
    holding: /\b(?:we|our team) (?:tested|measured|benchmarked|confirmed|observed|verified)\b|\bour (?:tests?|testing|measurements?|benchmarks?) (?:found|show(?:ed)?|confirm(?:ed)?)\b|\bin our (?:tests?|testing|benchmarks?)\b/i,
    issue: /(?!)/,
    argument: /\bcritics (?:argue|say|claim)\b|\bproponents (?:argue|say|claim)\b|\bsome (?:say|argue|claim)\b|\breportedly\b|\ballegedly\b|\baccording to\b/i,
  },
  retrieval: { queryTerms: "subject", pinEnds: false },
}
```

`/(?!)/` is a regex that matches nothing; Receipts has no issue cues beyond the engine's `?` rule. Verify the prompt copy: `git show HEAD:src/assay/cartographer/propose.ts | sed -n 15,68p` must equal the template literal you pasted, character for character, ignoring the `const SYSTEM = ` prefix.

- [ ] **Step 9: Pass the profile from Receipts' callers**

`src/pipeline.ts` — import `RECEIPTS` from `"./instance/profile.js"` and add `profile: RECEIPTS,` to the `assay(` options (next to `client:`).

`src/cli/replay.ts` — import `RECEIPTS` from `"../instance/profile.js"` and add `profile: RECEIPTS,` to the `assay(` options at line ~136 (next to `runs,`).

- [ ] **Step 10: Typecheck and fix remaining callers**

Run: `npm run typecheck`
Expected: errors only in `src/assay/calibration/calibration.test.ts`? No — calibration calls `admit`, which is unchanged in this task. Expected: clean. If any other `assay(` or `proposeRelations(` caller errors, add `profile: TEST_PROFILE` (engine tests) or `system: "Sys."` (propose tests) as in Step 2.

- [ ] **Step 11: Run everything**

Run: `npm run typecheck && npx vitest run`
Expected: all pass. Then `npm run replay` — Expected: `1 replayed, 3 not replayable` (the prompt string is unchanged, so Tesla still replays).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Require a field profile; the proposer prompt leaves the engine.

FieldProfile carries everything domain-specific the engine used to ship.
assay() throws without one, before any model call. The vendor-vs-independent
system prompt moves verbatim to Receipts' profile, so Tesla's cache keys are
unchanged and the ledger still replays. Lexicon and retrieval are declared
here and adopted by the engine in the next tasks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The replay manifest names its profile

**Files:**
- Modify: `src/assay/types.ts:145-154` (ReplayManifest)
- Modify: `src/analyze-live.ts:95-106`
- Modify: `src/cli/replay.ts:36-58, 130-140`, `src/cli/replay-all.ts:24-30`
- Test: `src/cli/replay.test.ts`, `src/cli/replay-all.test.ts` (if present; else the replay-all block in `replay.test.ts`)

**Interfaces:**
- Consumes: `RECEIPTS` from Task 1.
- Produces: `ReplayManifest.profile: string`; `runReplay(reportPath, profile: FieldProfile, deps?)` — the profile is the **second positional parameter**; `replayAll` skips manifests without `profile`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/replay.test.ts`, `makeReplayable`: the manifest literal gains `profile: "receipts"`. Every `runReplay(path, deps)` call becomes `runReplay(path, RECEIPTS, deps)`. Add:

```ts
  it("refuses a report whose manifest names no profile", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay: Record<string, unknown> }
    delete saved.replay["profile"]
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: no field profile recorded — generated before the profile existed`,
    )
  })

  it("refuses a report stamped under a different profile, naming both", async () => {
    const { path, deps } = await makeReplayable()
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay: { profile: string } }
    saved.replay.profile = "claim-record"
    writeFileSync(path, JSON.stringify(saved))
    await expect(runReplay(path, RECEIPTS, deps)).rejects.toThrow(
      `receipts: ${path} is not replayable: stamped under profile "claim-record", replaying under "receipts"`,
    )
  })
```

Retarget the committed-Tesla test (the `spawnSync` one, line ~202) — the committed ledger has no `profile` until Task 9:

```ts
  it("refuses the committed Tesla ledger until it is restamped under a profile", () => {
    const r = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, "tesla", "--replay", join(REPO, "reports", "tesla-fsd.json")], {
      cwd: REPO,
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "" },
      encoding: "utf8",
      timeout: 60_000,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("no field profile recorded")
  })
```

In `src/cli/replay-all.test.ts`: the first test's expectations change because the committed Tesla ledger has no `profile` yet —

```ts
  it("skips every committed report until Tesla is restamped under a profile", async () => {
    let calls = 0
    const r = await replayAll(join(REPO, "reports"), async () => { calls++; return outcome(true) })
    expect(calls).toBe(0)
    expect(r.replayed).toEqual([])
    expect(r.skipped).toEqual(["chime.json", "claude.json", "tesla-fsd.json", "vercel.json"])
  })
```

and in the second test, the three `writeFileSync` manifests become `{ replay: { keys: [], profile: "receipts" } }`, plus one more file:

```ts
    writeFileSync(join(dir, "unprofiled.json"), JSON.stringify({ replay: { keys: [] } }))
```

with `expect(r.skipped).toEqual(["old.json", "unprofiled.json"])`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/cli`
Expected: FAIL — type error on `profile` in the manifest literal; refusal tests fail with the wrong message.

- [ ] **Step 3: Implement**

`src/assay/types.ts` `ReplayManifest` — add after `runs?: 1 | 2`:

```ts
  /** The field profile the ledger was stamped under. Absent on ledgers that predate profiles. */
  profile?: string
```

(Optional in the *type* because old ledgers on disk lack it; `runReplay` treats absence as a refusal.)

`src/analyze-live.ts` — both `result.replay = { ... }` literals gain `profile: RECEIPTS.name,`; import `RECEIPTS` from `"./instance/profile.js"`.

`src/cli/replay.ts`:

```ts
export async function runReplay(
  reportPath: string,
  profile: FieldProfile,
  deps: ReplayDeps = { ... unchanged ... },
): Promise<ReplayOutcome> {
  const saved = JSON.parse(readFileSync(reportPath, "utf8")) as Report | Refusal
  if (saved.replay === undefined) { ...unchanged... }
  if (saved.replay.profile === undefined) {
    throw new Error(
      `receipts: ${reportPath} is not replayable: no field profile recorded — generated before the profile existed`,
    )
  }
  if (saved.replay.profile !== profile.name) {
    throw new Error(
      `receipts: ${reportPath} is not replayable: stamped under profile "${saved.replay.profile}", replaying under "${profile.name}"`,
    )
  }
```

and `profile,` replaces `profile: RECEIPTS,` in the `assay(` call. Import `FieldProfile` from `"../assay/types.js"`; drop the `RECEIPTS` import here. Update the doc comment's "four refusals" to "six refusals". In `src/cli/index.ts:151`, `runReplay(opts.replay)` becomes `runReplay(opts.replay, RECEIPTS)` (import `RECEIPTS` from `"../instance/profile.js"`).

`src/cli/replay-all.ts`: the skip test becomes

```ts
    const saved = JSON.parse(readFileSync(path, "utf8")) as { replay?: { profile?: unknown } }
    if (saved.replay === undefined || saved.replay.profile === undefined) {
      out.skipped.push(file)
      continue
    }
```

and its default `run` becomes `(path) => runReplay(path, RECEIPTS)` with the import.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npx vitest run`
Expected: all pass. `npm run replay` — Expected: `0 replayed, 4 not replayable`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Stamp the field profile on the replay manifest and refuse a mismatch.

A ledger now records which profile produced it. Replay refuses a manifest
with no profile and one stamped under another name; replay-all counts both
as not replayable. The committed Tesla ledger predates the profile, so it is
not replayable until Task 9 restamps it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Retrieval policy from the profile

**Files:**
- Modify: `src/assay/retrieve/idf.ts` (add `queryTermsFor`), `src/assay/retrieve/select.ts:28-45, 125-135` (`pinEnds`), `src/assay/index.ts:24-40` (`selectForRun`)
- Test: `src/assay/retrieve/idf.test.ts`, `src/assay/retrieve/select.test.ts`, `src/assay/index.test.ts`

**Interfaces:**
- Produces: `queryTermsFor(mode: FieldProfile["retrieval"]["queryTerms"], subject: string, claimantTexts: readonly string[]): string[]`; `selectCandidates(..., opts: { perDoc?; total?; claimantDocIds?; pinEnds?: boolean })` (default `true`, today's behaviour); `selectForRun(corpus: PinnedCorpus, subject: string, retrieval: FieldProfile["retrieval"], total: number): Chunk[]` exported from `src/assay/index.ts`.

- [ ] **Step 1: Write the failing tests**

`src/assay/retrieve/idf.test.ts`, new describe:

```ts
describe("queryTermsFor", () => {
  it("uses the subject alone under \"subject\"", () => {
    expect(queryTermsFor("subject", "Tesla FSD", ["scienter purchaser abetting"])).toEqual(["tesla", "fsd"])
  })
  it("mixes in claimant terms under \"subject+claimant\"", () => {
    expect(queryTermsFor("subject+claimant", "10(b)", ["scienter purchaser"])).toEqual(["10", "b", "scienter", "purchaser"])
  })
})
```

`src/assay/retrieve/select.test.ts`, after the "keeps the first and last chunk" test:

```ts
  it("does not pin the ends when pinEnds is false", () => {
    const ends: Chunk[] = [
      chunk("d", 0, "intro unremarkable"),
      chunk("d", 1, "uptime uptime uptime"),
      chunk("d", 2, "uptime uptime uptime"),
      chunk("d", 3, "holding unremarkable"),
    ]
    const idf = buildIdf(ends.map((c) => ({ text: c.text })))
    const picked = selectCandidates(ends, ["uptime"], idf, { perDoc: 2, total: 50, pinEnds: false })
    expect(picked.map((c) => c.chunkId).sort()).toEqual(["d:1", "d:2"])
  })
```

`src/assay/index.test.ts`, new describe:

```ts
describe("selectForRun", () => {
  const corpus: PinnedCorpus = {
    subject: "Acme",
    docs: [
      doc({ docId: "vendor", role: "claimant", text: "Acme guarantees uptime.\n\nOur pricing page lists tiers.\n\nAcme support hours." }),
      doc({ docId: "forum", role: "independent", text: "Skip to content\n\nAcme went down twice.\n\nPricing tiers discussed.\n\n© forum" }),
    ],
    failures: [],
  }
  it("ranks by the subject alone and does not pin document ends under Receipts' policy", () => {
    const picked = selectForRun(corpus, "Acme", { queryTerms: "subject", pinEnds: false }, 2)
    expect(picked.map((c) => c.text)).not.toContain("© forum")
    expect(picked.every((c) => /acme/i.test(c.text))).toBe(true)
  })
  it("pins document ends under Claim/Record's policy", () => {
    const picked = selectForRun(corpus, "Acme", { queryTerms: "subject+claimant", pinEnds: true }, 8)
    expect(picked.map((c) => c.text)).toContain("© forum")
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/assay/retrieve src/assay/index.test.ts`
Expected: FAIL — `queryTermsFor`/`selectForRun` not exported; `pinEnds` ignored so `d:0` still appears.

- [ ] **Step 3: Implement**

`src/assay/retrieve/idf.ts`, after `retrieveQueryTerms`:

```ts
/** The profile's retrieval policy applied: which terms rank chunks for the model. */
export function queryTermsFor(
  mode: "subject" | "subject+claimant",
  subject: string,
  claimantTexts: readonly string[],
): string[] {
  return mode === "subject" ? tokenize(subject) : retrieveQueryTerms(subject, claimantTexts)
}
```

`src/assay/retrieve/select.ts` — `capDoc` takes `pinEnds`:

```ts
function capDoc(list: Scored[], perDoc: number, pinEnds: boolean): Scored[] {
  const byRank = (a: Scored, b: Scored) => b.score - a.score || a.chunk.start - b.chunk.start
  if (!pinEnds) return [...list].sort(byRank).slice(0, perDoc)
  const byStart = [...list].sort((a, b) => a.chunk.start - b.chunk.start)
  const pinned: Scored[] = []
  if (byStart[0]) pinned.push(byStart[0])
  const last = byStart[byStart.length - 1]
  if (last && last.chunk.chunkId !== pinned[0]?.chunk.chunkId) pinned.push(last)
  const pinnedIds = new Set(pinned.map((s) => s.chunk.chunkId))
  const rest = list.filter((s) => !pinnedIds.has(s.chunk.chunkId)).sort(byRank)
  return [...pinned, ...rest].slice(0, perDoc)
}
```

`rankByDoc` gains a trailing `pinEnds: boolean` parameter and passes it to `capDoc`. `selectCandidates`'s `opts` type gains `pinEnds?: boolean`; `const pinEnds = opts.pinEnds ?? true` and every `rankByDoc(` call passes it. Update `capDoc`'s doc comment: "Pinning is a field-profile choice: opinions keep their holdings at the ends, web pages keep their nav chrome there."

`src/assay/index.ts` — replace lines 27–40 of `assayOnce` with a call to a new exported function, and define it:

```ts
/** The chunks the proposer will see, under the profile's retrieval policy. Exported so an instance can audit its own candidate set offline. */
export function selectForRun(
  corpus: PinnedCorpus,
  subject: string,
  retrieval: FieldProfile["retrieval"],
  total: number,
): Chunk[] {
  const claimant = corpus.docs.filter((d) => d.role === "claimant")
  const terms = queryTermsFor(retrieval.queryTerms, subject, claimant.map((d) => d.text))
  const idf = buildIdf(corpus.docs)
  const chunks = chunkAll(corpus.docs)
  const perDoc = Math.max(8, Math.ceil(total / Math.max(corpus.docs.length, 1)))
  return selectCandidates(chunks, terms, idf, {
    perDoc, total, claimantDocIds: new Set(claimant.map((d) => d.docId)), pinEnds: retrieval.pinEnds,
  })
}
```

In `assayOnce`:

```ts
  const admitTerms = tokenize(query.subject)
  const idf = buildIdf(corpus.docs)
  const total = opts.candidates ?? 40
  const candidates = selectForRun(corpus, query.subject, opts.profile.retrieval, total)
```

(`idf` is still needed for `admit`.) Import `queryTermsFor` instead of `retrieveQueryTerms`, and `Chunk`, `FieldProfile` types.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npx vitest run`
Expected: all pass. `npm run replay` still `0 replayed, 4 not replayable`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Retrieval policy comes from the field profile.

queryTermsFor and pinEnds make the two 2026-09-14 retrieval choices
explicit per instance. Receipts ranks by the subject alone and does not pin
document ends: on the committed Tesla snapshots that lifts FSD-relevant
candidates from 16/40 to 25/40 and the 10-K's from 0/5 to 3/5. selectForRun
is exported so an instance can audit its candidate set offline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The lexicon comes from the profile

**Files:**
- Modify: `src/assay/bookkeeper/discourse.ts:1-10, 62-91`, `src/assay/bookkeeper/admit.ts:2, 92-125, 148-160, 288`, `src/assay/index.ts` (admit call)
- Test: `src/assay/bookkeeper/discourse.test.ts`, `src/assay/bookkeeper/admit.test.ts`, `src/assay/calibration/calibration.test.ts`

**Interfaces:**
- Produces: `discourseRole(sentence: string, lexicon: FieldProfile["lexicon"]): DiscourseRole`; `admit(corpus, proposals, queryTerms, idf, threshold, lexicon)` — `lexicon` is the sixth positional parameter, **required**; `threshold` keeps its default.

- [ ] **Step 1: Write the failing tests**

`src/assay/bookkeeper/discourse.test.ts`: import `TEST_PROFILE` from `"../test-profile.js"`; pass `TEST_PROFILE.lexicon` as the second argument to every `discourseRole(` call. Add:

```ts
  it("treats a trailing question mark as issue under any lexicon, and everything else as unmarked under an empty one", () => {
    const empty = { holding: /(?!)/, issue: /(?!)/, argument: /(?!)/ }
    expect(discourseRole("Whether the claim will lie?", empty)).toBe("issue")
    expect(discourseRole("We hold that the claim will lie.", empty)).toBe("unmarked")
    expect(discourseRole("Petitioner argues otherwise.", empty)).toBe("unmarked")
  })
```

`src/assay/bookkeeper/admit.test.ts`: import `TEST_PROFILE`; every `admit(` call gets `TEST_PROFILE.lexicon` as the sixth argument. Where a call omits `threshold`, pass `undefined` for it: `admit(corpus, proposals, TERMS, idf, undefined, TEST_PROFILE.lexicon)`. Same in `src/assay/calibration/calibration.test.ts`'s `run` helper.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/assay/bookkeeper src/assay/calibration`
Expected: FAIL — the new discourse test fails (`we hold` still matches the engine constant); typecheck complains about the extra argument.

- [ ] **Step 3: Implement**

`src/assay/bookkeeper/discourse.ts` — delete the `HOLDING`, `ISSUE`, `ARGUMENT` constants and replace `discourseRole`:

```ts
export type Lexicon = { holding: RegExp; issue: RegExp; argument: RegExp }

/**
 * Tag a sentence from the field's closed lexicon. Only the trailing "?" is
 * the engine's own rule: a question is not a holding in any field.
 */
export function discourseRole(sentence: string, lexicon: Lexicon): DiscourseRole {
  const t = sentence.trim()
  if (lexicon.holding.test(t)) return "holding"
  if (lexicon.issue.test(t) || /\?\s*$/.test(t)) return "issue"
  if (lexicon.argument.test(t)) return "argument"
  return "unmarked"
}
```

Update the file's header comment: "from a closed lexicon" → "from the field profile's closed lexicon; the engine ships none."

`src/assay/bookkeeper/admit.ts`: import `type Lexicon` from `"./discourse.js"`. `blocksNonHolding` and `unmarkedCorroboration` gain a trailing `lexicon: Lexicon` parameter and pass it to every `discourseRole(` call. `admit`:

```ts
export function admit(
  corpus: PinnedCorpus,
  proposals: RelationProposal[],
  queryTerms: string[],
  idf: Map<string, number>,
  threshold: number = CONFIDENCE_FLOOR,
  lexicon: Lexicon,
): AdmitResult {
```

(TypeScript allows a required parameter after a defaulted one; callers pass `undefined` for the default.) Pass `lexicon` at the two call sites inside `admit`. In `src/assay/index.ts`, the `admit(` call becomes `admit(corpus, fanned.proposals, admitTerms, idf, threshold, opts.profile.lexicon)`.

- [ ] **Step 4: Run**

Run: `npm run typecheck && npx vitest run`
Expected: all pass, including `src/assay/calibration` (still using `TEST_PROFILE.lexicon`, which carries the legal cues).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
The discourse lexicon comes from the field profile.

discourseRole takes the profile's closed cue lists; the engine keeps only
the trailing-question-mark rule. Engine tests use the legal-shaped
TEST_PROFILE because their fixtures are written in that vocabulary.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The 10(b) calibration leaves the engine

**Files:**
- Delete: `src/assay/calibration/corpus.ts`, `src/assay/calibration/calibration.test.ts` (they reappear in claim-record in Task 6 — copy them somewhere outside the repo first, e.g. the scratchpad, or rely on `git show HEAD~1:...` in Task 6)
- Modify: `src/assay/isolation.test.ts` (no change needed unless it lists directories), `README.md`, `architecture.md` mentions of `src/assay/calibration`

- [ ] **Step 1: Confirm nothing else imports it**

Run: `grep -rn "calibration" src --include=*.ts | grep -v "src/assay/calibration/"`
Expected: no output.

- [ ] **Step 2: Remove**

```bash
git rm -r src/assay/calibration
```

Then `grep -n "calibration" README.md architecture.md` and change each hit to say the 10(b) gold corpus lives in `claim-record/src/instance/calibration/` and Receipts' own set in `src/instance/calibration/` (created in Task 7).

- [ ] **Step 3: Run**

Run: `npm run typecheck && npx vitest run`
Expected: all pass; the test count drops by the calibration file's count.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -F - <<'EOF'
The 10(b) calibration corpus leaves the engine.

It exercises the legal lexicon, which is now Claim/Record's; it moves there
with that profile in the next task.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Claim/Record adopts the engine and owns its profile

**Repo:** `C:\Users\krist\Projects\claim-record`, branch `field-profile` off `master`.

**Files:**
- Replace: `src/assay/` with `receipts/src/assay/` at receipts' `field-profile` HEAD
- Create: `src/instance/profile.ts`, `src/instance/calibration/corpus.ts`, `src/instance/calibration/calibration.test.ts`
- Modify: `src/instance/run.ts:5, 43-50`, `architecture.md`, `README.md:50`
- Test: `src/instance/run.test.ts` (unchanged assertions), `src/instance/calibration/calibration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `CLAIM_RECORD: FieldProfile`.

- [ ] **Step 1: Branch and copy the engine**

```bash
cd C:/Users/krist/Projects/claim-record && git checkout -b field-profile
rm -rf src/assay && cp -r ../receipts/src/assay src/assay
diff -rq src/assay ../receipts/src/assay && echo IDENTICAL
```

- [ ] **Step 2: Write the failing test**

`src/instance/run.test.ts` — find the test that runs `runClaimRecord` with a stub client and add an assertion that the stub saw `CLAIM_RECORD_SYSTEM` as `body.system` (import `CLAIM_RECORD_SYSTEM` from `"./prompt.js"`). If the stub does not record bodies, add a `seen: { system: string }[]` array to it. Run `npx vitest run src/instance/run.test.ts` — Expected: FAIL with the `assay: no field profile` sentence (typecheck also fails on `system:` in `run.ts`).

- [ ] **Step 3: Create the profile**

`src/instance/profile.ts`:

```ts
import type { FieldProfile } from "../assay/types.js"
import { CLAIM_RECORD_SYSTEM } from "./prompt.js"

/**
 * Claim/Record: a party's checkable statements against a pile of opinions.
 *
 * The lexicon is the one the engine shipped until the field profile existed,
 * moved here verbatim minus the trailing-question-mark rule, which the engine
 * keeps as structure. Retrieval mixes claimant terms into the query because
 * "10(b)" tokenizes to nothing distinctive, and pins document ends because
 * holdings sit at the ends of opinions.
 */
export const CLAIM_RECORD: FieldProfile = {
  name: "claim-record",
  system: CLAIM_RECORD_SYSTEM,
  lexicon: {
    holding: /\bwe hold\b|\bheld:|\bwe conclude\b|\bwe reverse\b/i,
    issue: new RegExp(
      [
        String.raw`\bgranted certiorari\b`,
        String.raw`\bquestion presented\b`,
        String.raw`\bpetition for (?:a )?writ of certiorari\b`,
        String.raw`\bwe (?:must |now )?(?:decide|consider|resolve|determine) whether\b`,
        String.raw`\bthis case (?:requires us to consider|presents the question)\b`,
        String.raw`\bto resolve (?:the )?(?:question|conflict|issue)\b`,
        String.raw`\bthe (?:question|issue)(?: in this case| before (?:us|the court)| presented)? is whether\b`,
        String.raw`\bwhether .{0,80} will lie\b`,
        String.raw`^["“']?whether\b`,
      ].join("|"),
      "i",
    ),
    argument: /\bpetitioner argues\b|\brespondent (?:argues|contends)\b|\bsome courts have held\b|\bthe court below\b/i,
  },
  retrieval: { queryTerms: "subject+claimant", pinEnds: true },
}
```

Cross-check the regexes against `git -C ../receipts show field-profile~4:src/assay/bookkeeper/discourse.ts` (the version before Task 4 deleted them): identical except the dropped `\?\s*$` alternation.

- [ ] **Step 4: Wire `run.ts`**

Replace the import of `CLAIM_RECORD_SYSTEM` with `import { CLAIM_RECORD } from "./profile.js"` and the `assay(` options with:

```ts
  const result = await assay(corpus, { subject }, {
    client: input.client,
    profile: CLAIM_RECORD,
    runs: 1,
    candidates: Math.max(40, 8 * uploads.length),
  })
```

(keep the existing comment about the candidate budget.)

- [ ] **Step 5: Move the calibration corpus**

```bash
mkdir -p src/instance/calibration
git -C ../receipts show field-profile~1:src/assay/calibration/corpus.ts > src/instance/calibration/corpus.ts
git -C ../receipts show field-profile~1:src/assay/calibration/calibration.test.ts > src/instance/calibration/calibration.test.ts
```

(`field-profile~1` is the commit before Task 5's deletion; adjust if the branch has a different number of commits — `git -C ../receipts log --oneline field-profile` to check.) In `calibration.test.ts`, change the imports to `"../../assay/assemble.js"`, `"../../assay/bookkeeper/admit.js"`, `"../../assay/retrieve/idf.js"`, `"../../assay/types.js"`, and replace `import { TEST_PROFILE } from "../test-profile.js"` with `import { CLAIM_RECORD } from "../profile.js"`; in `run`, the `admit(` call's sixth argument becomes `CLAIM_RECORD.lexicon`. In `corpus.ts`, fix any `../types.js` import to `"../../assay/types.js"`.

- [ ] **Step 6: Run**

Run: `npm run typecheck && npx vitest run`
Expected: all pass, including the moved calibration suite and `run.test.ts` with the new assertion. `diff -rq src/assay ../receipts/src/assay` prints nothing.

- [ ] **Step 7: Docs**

`README.md:50`: `src/assay/calibration/` → `src/instance/calibration/`. `architecture.md`: add `src/instance/profile.ts  the field profile: prompt, lexicon, retrieval policy — the engine's only source of domain knowledge` to the layout block; change the `**Discourse role**` paragraph to say the lexicon is `CLAIM_RECORD.lexicon`, not the engine's; line 66 `src/assay/calibration/` → `src/instance/calibration/`; add a sentence under the engine description: "`src/assay/` knows no domain: it refuses to run without a `FieldProfile`."

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Own the Claim/Record field profile; pull the domain-neutral engine.

src/assay/ copied from Receipts field-profile (byte-identical). The legal
lexicon, the prompt, and the subject+claimant / pin-ends retrieval policy
now live in src/instance/profile.ts; the 10(b) calibration corpus moves
beside them. Behaviour is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Receipts calibration and the Tesla candidate check

**Repo:** `receipts`, branch `field-profile`.

**Files:**
- Create: `src/instance/calibration/corpus.ts`, `src/instance/calibration/calibration.test.ts`, `src/instance/calibration/tesla-candidates.test.ts`

**Interfaces:**
- Consumes: `RECEIPTS`, `admit`, `assemble`, `NOT_ANCHORING_EVIDENCE`, `selectForRun`, `getSnapshot`, `toPinnedCorpus`.

- [ ] **Step 1: Write the corpus**

`src/instance/calibration/corpus.ts`:

```ts
import type { PinnedCorpus, PinnedDoc } from "../../assay/types.js"

export const SUBJECT = "Acme uptime"

function doc(docId: string, role: PinnedDoc["role"], text: string): PinnedDoc {
  return {
    docId, url: `https://example.test/${docId}`, label: docId, role, kind: role === "claimant" ? "vendor_site" : "forum",
    fetchedAt: "2026-09-15T00:00:00.000Z", title: docId, text, stability: "volatile",
    pin: { kind: "hash", sha256: docId.padEnd(64, "0") }, driftHash: "00",
  }
}

/** The vendor page: one true claim and one false one about the same product. */
export const CLAIM = doc("vendor", "claimant",
  "Acme uptime is 99.99% across every region.\n\nAcme uptime failover completes in under one second.")

/** A reviewer committing to its own measurement — a web "holding". */
export const REVIEWER = doc("reviewer", "independent",
  "We measured Acme uptime at 99.99% over ninety days across four regions.\n\nIn our tests Acme uptime failover took eleven seconds.")

/** A forum poster, unmarked: no commitment marker. */
export const FORUM = doc("forum", "independent",
  "Acme uptime has been fine for me, basically 99.99% since I switched.")

/** Hearsay: an aggregator attributing a claim to others. */
export const AGGREGATOR = doc("aggregator", "independent",
  "Critics say Acme uptime failover is much slower than advertised.")

export function goldCorpus(independents: PinnedDoc[]): PinnedCorpus {
  return { subject: SUBJECT, docs: [CLAIM, ...independents], failures: [] }
}
```

(Check `PinnedDoc.kind`'s union in `src/assay/types.ts` and use two members that exist; `"vendor_site"`/`"forum"` are the names used in `src/assay/index.test.ts` at HEAD.)

- [ ] **Step 2: Write the failing calibration tests**

`src/instance/calibration/calibration.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { assemble, NOT_ANCHORING_EVIDENCE } from "../../assay/assemble.js"
import { admit } from "../../assay/bookkeeper/admit.js"
import { buildIdf, tokenize } from "../../assay/retrieve/idf.js"
import type { PinnedDoc, RelationProposal } from "../../assay/types.js"
import { RECEIPTS } from "../profile.js"
import { AGGREGATOR, FORUM, goldCorpus, REVIEWER, SUBJECT } from "./corpus.js"

function proposal(over: Partial<RelationProposal> & Pick<RelationProposal, "proposalId" | "type" | "from" | "to">): RelationProposal {
  return { topic: "uptime", statement: over.statement ?? "uptime", rationale: "calibration", confidence: 0.9, ...over }
}

function run(independents: PinnedDoc[], proposals: RelationProposal[]) {
  const corpus = goldCorpus(independents)
  const result = admit(corpus, proposals, tokenize(SUBJECT), buildIdf(corpus.docs), undefined, RECEIPTS.lexicon)
  const anchoredCount = result.admitted.length
    + result.denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code)).length
  const assembled = assemble(corpus, proposals.length, result, { conflictMode: "report", anchoredCount })
  return { result, assembled }
}

const TRUE_TWIN = proposal({
  proposalId: "true", type: "corroborates",
  from: { docId: "vendor", quote: "Acme uptime is 99.99% across every region" },
  to: { docId: "reviewer", quote: "We measured Acme uptime at 99.99% over ninety days" },
})
const FALSE_TWIN = proposal({
  proposalId: "false", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "reviewer", quote: "In our tests Acme uptime failover took eleven seconds" },
})
const RESIDUAL = proposal({
  proposalId: "residual", type: "corroborates",
  from: { docId: "vendor", quote: "Acme uptime is 99.99% across every region" },
  to: { docId: "forum", quote: "Acme uptime has been fine for me, basically 99.99%" },
})
const HEARSAY = proposal({
  proposalId: "hearsay", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "aggregator", quote: "Critics say Acme uptime failover is much slower than advertised" },
})

describe("Receipts calibration — a web lexicon can fire", () => {
  it("corroborates a true claim against a reviewer's own measurement", () => {
    const { assembled } = run([REVIEWER], [TRUE_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("corroborated")
  })
  it("marks a false claim divergent against a reviewer's own test", () => {
    const { assembled } = run([REVIEWER], [FALSE_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("divergent")
  })
  it("labels an unmarked forum corroboration context_unverified when nothing competes", () => {
    const { assembled } = run([FORUM], [RESIDUAL])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("context_unverified")
  })
  it("denies the same forum corroboration when a reviewer's measurement competes", () => {
    const { result, assembled } = run([FORUM, REVIEWER], [RESIDUAL])
    expect(result.denied[0]!.code).toBe("HOLDING_COMPETITOR")
    expect(assembled.audit.holdingCompetitorDenied).toBe(1)
  })
  it("denies attributed hearsay as argument", () => {
    const { result } = run([AGGREGATOR], [HEARSAY])
    expect(result.denied[0]!.code).toBe("ISSUE_STATEMENT")
  })
})
```

- [ ] **Step 3: Write the failing Tesla candidate check**

`src/instance/calibration/tesla-candidates.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { selectForRun } from "../../assay/index.js"
import { toPinnedCorpus } from "../../provenance/adapt.js"
import { getSnapshot } from "../../provenance/snapshots.js"
import type { Report } from "../../types.js"
import { RECEIPTS } from "../profile.js"

/**
 * The 2026-09-14 Tesla restamp shipped with a candidate set in which the
 * 10-K's five slots held no FSD text at all, and nothing said so until a
 * reviewer counted. This reads the committed snapshots and counts.
 */
describe("Tesla candidate set under the Receipts profile", () => {
  it("gives the 10-K at least one FSD-relevant candidate", () => {
    const saved = JSON.parse(readFileSync("reports/tesla-fsd.json", "utf8")) as Report
    const docs = saved.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind!,
      fetchedAt: d.fetchedAt, title: d.label, text: getSnapshot(d.pin!.sha256).content,
    }))
    const corpus = toPinnedCorpus({ subject: saved.subject, docs, failures: [] }, { isStored: () => true })
    const tenK = corpus.docs.find((d) => /10-K/.test(d.label))
    expect(tenK).toBeDefined()
    const picked = selectForRun(corpus, saved.subject, RECEIPTS.retrieval, 40)
    const fromTenK = picked.filter((c) => c.docId === tenK!.docId)
    expect(fromTenK.length).toBeGreaterThan(0)
    expect(fromTenK.some((c) => /full self-driving|driver assist/i.test(c.text))).toBe(true)
  })
})
```

If `saved.docs[].kind` / `pin` typing differs from `Report`, mirror the mapping in `src/cli/replay.ts:63-88`.

- [ ] **Step 4: Run to see them fail, then pass**

Run: `npx vitest run src/instance`
Expected first: FAIL on the calibration tests only if the lexicon draft does not match the fixture sentences — adjust the *fixture sentences* to the draft's cue phrases, not the other way round, unless a cue is plainly wrong (then change `RECEIPTS.lexicon` and note it in the commit body). The Tesla check must pass as written (Task 3's measurement: 3 of 5). If it fails, `console.log` the five 10-K candidates' first 90 chars and stop — that is a finding for the owner, not something to tune away.

Run: `npm run typecheck && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Receipts gets a calibration set and a Tesla candidate check.

Four web-shaped cases prove the Receipts lexicon can produce corroborated,
divergent, context_unverified, and HOLDING_COMPETITOR, and one hearsay case
proves argument. The Tesla check reads the committed snapshots and asserts
the 10-K receives an FSD-relevant candidate — the test that would have
caught the 2026-09-14 showcase before it was paid for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Documentation in both repos

**Files:**
- Modify (receipts): `README.md` (Assay section ~:676-700; Tesla narrative :62-99; the replay paragraph :902; test count :946), `architecture.md` (layout, admission list, denial table)
- Modify (claim-record): already done in Task 6; re-read for consistency.

- [ ] **Step 1: Receipts README**

In the Assay section (search "Admission is extractive"), replace the paragraph that begins "Admission is extractive." through "how the 2026-09-14 restamp was forced." with:

```markdown
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
```

Tesla narrative (:62-99) — replace the paragraphs from "The ledger itself was restamped 2026-09-14" through the coverage sentence with:

```markdown
The committed ledger was stamped 2026-09-14 under retrieval that mixed the
10-K's 385k characters into the query, so the 10-K's five candidate slots held
its cover page, signature page, and three financial tables and no FSD text;
the audit shows the holding gate denied nothing (`issueStatementDenied: 0`).
The profile changes retrieval, so that ledger is not replayable under it and
`npm run replay` says so. It is restamped, and this section rewritten from the
new ledger's audit, in the last step of
`docs/superpowers/plans/2026-09-15-field-profile.md`.
```

Replay paragraph (:902): after "Tesla FSD is replayable from two samples." add "— until the field profile; see above." Test count (:946): update to the number `npx vitest run` prints.

- [ ] **Step 2: Receipts architecture.md**

Layout block: add `src/instance/profile.ts` and `src/instance/calibration/` lines. Admission item 5: "from a closed lexicon (`discourse.ts`)" → "from the field profile's closed lexicon". Add before the admission list: "`src/assay/` refuses to run without a `FieldProfile` (prompt, lexicon, retrieval policy). Receipts' is `RECEIPTS` in `src/instance/profile.ts`."

- [ ] **Step 3: Check and commit**

Run: `grep -n "src/assay/calibration\|closed lexicon (\`discourse" README.md architecture.md` — Expected: no output. `npm run typecheck && npx vitest run` clean.

```bash
git add -A
git commit -F - <<'EOF'
Document the field profile in Receipts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Merge, then the paid Tesla restamp (owner-triggered)

**Files:**
- Modify: `reports/tesla-fsd.json` (rewritten by the run), `cache/proposals/` (new keys), `snapshots/` (re-fetched bytes), `src/cli/replay.test.ts` (retarget), `README.md` Tesla narrative

- [ ] **Step 1: Final review and merge both branches**

Run the whole-branch review (subagent-driven-development's final reviewer) on receipts `field-profile` and claim-record `field-profile`. Fix findings. Then:

```bash
cd C:/Users/krist/Projects/receipts && git checkout main && git merge --no-ff field-profile && git branch -d field-profile
cd C:/Users/krist/Projects/claim-record && git checkout master && git merge --no-ff field-profile && git branch -d field-profile
diff -rq C:/Users/krist/Projects/receipts/src/assay C:/Users/krist/Projects/claim-record/src/assay && echo IDENTICAL
```

Do not push yet.

- [ ] **Step 2: The owner runs the restamp**

This step is the owner's — it spends Solari and Anthropic credit. With `.env` holding `SOLARI_API_KEY` and `ANTHROPIC_API_KEY`:

```bash
npm run cli -- tesla --refresh reports/tesla-fsd.json --rerun
```

Expected on stderr: the drift report; on stdout: the new ledger. `reports/tesla-fsd.json` is overwritten with a manifest carrying `profile: "receipts"`, `runs: 2`, and 16 new keys (8 per sample).

- [ ] **Step 3: Verify replay**

Run: `npm run replay`
Expected: `1 replayed, 3 not replayable`, exit 0.

Retarget `src/cli/replay.test.ts`'s committed-Tesla test back to:

```ts
  it("replays the committed Tesla ledger identically from two samples", () => {
    const r = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, "tesla", "--replay", join(REPO, "reports", "tesla-fsd.json")], {
      cwd: REPO,
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "" },
      encoding: "utf8",
      timeout: 60_000,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("replay: identical (16 responses from cache)")
    const tesla = JSON.parse(readFileSync(join(REPO, "reports", "tesla-fsd.json"), "utf8")) as { replay?: { runs?: number; profile?: string } }
    expect(tesla.replay?.runs).toBe(2)
    expect(tesla.replay?.profile).toBe("receipts")
  })
```

- [ ] **Step 4: Rewrite the Tesla narrative from the ledger**

Read the new `reports/tesla-fsd.json`. From `audit` take `proposed`, `admitted`, `issueStatementDenied`, `holdingCompetitorDenied`, `contextUnverified`, `independentDocsAdmitted / independentDocsTotal`, `claimantCovered / claimantChunks`, and count rows by `status`. From `selectForRun` (the Tesla candidate test's console output, or a one-off `npx tsx` script) take how many of the 40 candidates came from the 10-K and how many mention FSD. Replace the README paragraph written in Task 8 Step 1 with those numbers stated plainly: what the gate denied and why (the two counters), whether any row is `corroborated` (the lexicon can fire now — say whether it did), and which 10-K passages the model saw. Quote divergent rows only by pasting `npm run cli -- tesla --render reports/tesla-fsd.json` output verbatim. Update the test count.

- [ ] **Step 5: Commit and push both repos**

```bash
cd C:/Users/krist/Projects/receipts
git add -A
git commit -F - <<'EOF'
Restamp Tesla under the Receipts profile and describe the ledger it made.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin main
cd C:/Users/krist/Projects/claim-record && git push origin master
```

Expected: `npm run typecheck && npx vitest run` clean in both repos before each push; `diff -rq` of `src/assay/` empty.

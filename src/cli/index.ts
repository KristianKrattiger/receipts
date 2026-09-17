#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { analyzeLive } from "../analyze-live.js"
import { isRefusal } from "../assay/types.js"
import type { Refusal } from "../assay/types.js"
import { ollamaClient } from "../cartographer/ollama.js"
import { fetchCorpus } from "../fetch/fan.js"
import { receiptsFor } from "../instance/profile.js"
import { CACHE_DIR } from "../provenance/proposal-cache.js"
import { SNAPSHOT_DIR } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
import { renderDriftReport } from "../report/render/drift.js"
import { renderTerminal } from "../report/render/terminal.js"
import { buildSourcePlan, readSourcePlan } from "../sources/plan.js"
import { parseArgs, readCorpusFile, type CliOptions } from "./args.js"
import { exitCodeFor } from "./exit.js"
import { runRefresh } from "./refresh.js"
import { runReplay } from "./replay.js"
import type { Report } from "../types.js"

const USAGE = `usage: receipts <vendor> [options]

  --from-fixture <path>   analyze a saved corpus instead of fetching (free, offline).
                          Still commits every read document's bytes to snapshots/.
  --snapshot <path>       write the fetched corpus to a fixture file
  --domain <host>         vendor's domain, when it is not <vendor>.com
  --concurrency <n>       parallel browsers (default 3, the free-tier cap)
  --json                  print the report as JSON instead of a ledger
  --fetch-only            fetch and save a corpus, then stop (no model call).
                          Still commits every read document's bytes to snapshots/.
  --proxy <mode>          proxy egress: country:tier as in "us:static" (default),
                          a bare country code such as "gb", "off", or "smart".
                          Tiers are residential (Solari's default), static, mobile.
                          NB "smart" measured as no proxy at all on 2026-09-05.
  --proxy-session <label> pin one exit IP across sessions (needs a country)
  --profile <id>          attach a stored profile from "npm run login"
  --candidates <n>        chunks shown to the model (default 40; drives cost)
  --render <report.json>  re-print a saved report (no fetch, no model, no key)
  --sources <plan.json>   use a source plan instead of the vendor defaults
  --industry <name>       add the regulator sources probed for that industry
                          (fintech: the CFPB complaint database). Not with --sources.
  --refresh <report.json> re-fetch that report's sources and print what changed
                          (drifted, stability violated, unreadable, quotes vanished).
                          Makes no model call. Commits the new bytes to snapshots/.
  --rerun                 with --refresh: also run the analysis on the fresh bytes
                          and write a new ledger (served from the proposal cache
                          when bytes and settings match; a miss or --no-cache
                          samples live). The drift report then goes to stderr;
                          stdout carries the new ledger.
  --replay <report.json>  rebuild that report from snapshots/ and cache/proposals/
                          and say whether the result is identical. No fetch, no
                          model, no key. Exit 0 identical, 1 different or not replayable.
  --client <name>         proposer for the model call: anthropic (default) or ollama
                          (a local server at OLLAMA_HOST answering as OLLAMA_MODEL;
                          the model id is stamped on the manifest and keys the cache)
  --prompt-tier <tier>    proposer prompt: frontier (default) or small (default with
                          --client ollama). Stamped on the manifest; replay uses the same.
  --runs <1|2>            proposer samples on a fresh run or --refresh --rerun
                          (default 2). --replay reads the stamp instead.
  --no-cache              neither read nor write the proposal cache; fresh samples,
                          and a report that cannot be replayed.
  --no-captcha            do not solve challenges; a challenged source reports
                          as not read (see the access stance in the README)
  --no-stealth            skip stealth + proxy (required on the Solari free plan,
                          but bot-hostile sources will refuse you)

  SOLARI_API_KEY     required unless --from-fixture, --render or --replay   console.getsolari.com
  ANTHROPIC_API_KEY  required unless --fetch-only, --render, --replay, --refresh without --rerun, or --client ollama
  OLLAMA_MODEL       required with --client ollama (OLLAMA_HOST defaults to http://127.0.0.1:11434)
`

// A plan rejection fails every source identically and has nothing to do with
// the vendor. Saying so beats letting it read as "this company is unreadable".
// Printed from two sites: the fresh-fetch path below, and the --refresh
// dispatch, which has its own failures (the re-fetch's) to check.
const PLAN_REQUIRED_ADVICE =
  "\nSolari refused a feature this plan does not include. Stealth is paid-only;" +
  "\nre-run with --no-stealth to read what is reachable without it, or upgrade" +
  "\nat console.getsolari.com. Bot-hostile sources will still refuse a" +
  "\nnon-stealth browser, so expect the vendor's own pages and little else."

function die(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

// Shared by every fetchCorpus call site (fresh run and --refresh alike) so a
// refreshed Reddit source keeps its OAuth instead of silently going anonymous.
function redditFromEnv(): { reddit: { clientId: string; clientSecret: string; userAgent: string } } | {} {
  const clientId = process.env["REDDIT_CLIENT_ID"]
  const clientSecret = process.env["REDDIT_CLIENT_SECRET"]
  if (!clientId || !clientSecret) return {}
  return {
    reddit: {
      clientId,
      clientSecret,
      userAgent: process.env["REDDIT_USER_AGENT"] ?? "receipts/0.1 (claim-ledger research)",
    },
  }
}

let opts: CliOptions
try {
  opts = parseArgs(process.argv.slice(2))
} catch (err) {
  die(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
}

// Re-render a report that already exists. No fetch, no model call, no key —
// a saved run should be readable again without paying to reproduce it.
if (opts.render) {
  try {
    const saved = JSON.parse(readFileSync(opts.render, "utf8")) as Report | Refusal
    // A legacy ledger (predates `outcome`) needs `rows`; a refusal needs
    // `reason` instead. Either way `audit` is common to both shapes.
    const looksValid = saved.audit !== undefined &&
      (isRefusal(saved) ? typeof saved.reason === "string" : Array.isArray((saved as Report).rows))
    if (!looksValid) {
      die(`receipts: ${opts.render} is not a report (did you mean --from-fixture?)`)
    }
    const output = opts.asJson ? JSON.stringify(saved, null, 2) : renderTerminal(saved)
    // Re-rendering must report the same exit code producing it did — the same
    // artifact should not mean two different things depending on how it is read.
    const code = exitCodeFor(saved)
    // Same truncation risk as the analyze path's comment below describes.
    // `write` returns false when the data did not fully flush synchronously.
    // Unlike the analyze path below, this one cannot just fall off the end of
    // the script and let `process.exitCode` do the work — the module body
    // keeps running past this `if` into the paid fetch/analyze path, and a
    // listener that fires later without blocking here would let that happen.
    // So this `await`s the drain (module scope is top-level `await`-capable)
    // before exiting, with a bounded fallback timer so a drain that never
    // arrives cannot hang the process.
    if (!process.stdout.write(`${output}\n`)) {
      await new Promise<void>((resolve) => {
        const onDrain = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          process.stdout.removeListener("drain", onDrain)
          resolve()
        }, 5000)
        process.stdout.once("drain", onDrain)
      })
    }
    process.exit(code)
  } catch (err) {
    die(`receipts: could not read ${opts.render}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Rebuild a saved report from committed bytes alone. No fetch, no model, no
// key. Output is one line or a diff, small enough to fall off the end
// of the module and let stdout flush; the fresh-run body below is guarded
// on !opts.replay.
if (opts.replay) {
  try {
    const { identical, diff, replayed } = await runReplay(opts.replay, receiptsFor)
    if (identical) {
      console.log(`replay: identical (${replayed} response${replayed === 1 ? "" : "s"} from cache)`)
      process.exitCode = 0
    } else {
      console.error(`replay: ${opts.replay} differs from its reproduction in ${diff.length} place(s) -- a finding, not a failure`)
      for (const line of diff) console.log(line)
      process.exitCode = 1
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
}

// Checked before any paid work: the fixture path needs it just as much as the
// fetch path, and discovering it missing after a browser fan has run costs
// real money for nothing. Exemptions, all because they make no model call:
// --fetch-only (capturing a corpus is useful on its own), a plain --refresh
// without --rerun (comparison-only, by design free to run), and --replay,
// which reads the cache instead of the model.
const makesModelCall = !opts.replay && !opts.fetchOnly && !(opts.refresh && !opts.rerun)
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

// Declared at module top level (not inside the `if (opts.refresh)` block below)
// so the fresh-run body further down -- reached on `--refresh --rerun` -- can
// read the fresh corpus this assigns without fetching it a second time.
let result: Awaited<ReturnType<typeof runRefresh>> | undefined
if (opts.refresh) {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) die("SOLARI_API_KEY is not set. --refresh re-fetches the report's sources.")
  try {
    result = await runRefresh(opts.refresh, {
      apiKey, concurrency: opts.concurrency, stealth: opts.stealth,
      proxyCountry: opts.proxy, captcha: opts.captcha,
      ...(opts.proxySession !== undefined ? { proxySession: opts.proxySession } : {}),
      ...(opts.profileId !== undefined ? { profileId: opts.profileId } : {}),
      ...redditFromEnv(),
    })
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
  // Stdout carries exactly one document. Without --rerun, the drift report is
  // that document (JSON on --json, same as any other report). With --rerun, a
  // second document -- the new ledger -- is still to come on stdout below, so
  // the drift report goes to stderr instead, always as text: it is on its way
  // out of the machine-readable channel, not into a second JSON shape there.
  if (opts.rerun) {
    console.error(renderDriftReport(result.drift))
  } else {
    console.log(opts.asJson ? JSON.stringify(result.drift, null, 2) : renderDriftReport(result.drift))
  }
  // With --rerun the fresh-run body prints this for the same failures (its
  // corpus is `result.fresh`), so print it here only when that body is skipped.
  if (!opts.rerun && result.fresh.failures.some((f) => f.reason === "plan_required")) {
    console.error(PLAN_REQUIRED_ADVICE)
  }
  if (!opts.rerun) {
    // A drift report is a result. Exit 0 whether or not anything drifted:
    // "nothing changed" is a finding too, and a script can read the summary.
    process.exitCode = 0
    // Fall through to the end of the module. The fresh-run body below is
    // guarded on `!opts.refresh || opts.rerun`, so nothing else runs.
  }
  // With --rerun, the fresh-run body picks up `result.fresh` as its corpus.
}

if (!opts.replay && (!opts.refresh || opts.rerun)) {
  let corpus
  if (opts.refresh && opts.rerun) {
    // The refresh dispatch above already fetched and stored these bytes --
    // `result` is guaranteed assigned here (the only way past that block
    // without it is `die()`, which exits the process). Re-fetching would
    // double the cost and risk comparing a different capture than the drift
    // report above just described.
    corpus = result!.fresh
  } else if (opts.fromFixture) {
    try {
      corpus = readCorpusFile(readFileSync(opts.fromFixture, "utf8"), opts.fromFixture)
    } catch (err) {
      die(err instanceof Error ? err.message : String(err))
    }
  } else {
    const apiKey = process.env.SOLARI_API_KEY
    if (!apiKey) {
      die("SOLARI_API_KEY is not set. Get one at console.getsolari.com, or pass --from-fixture.")
    }

    let plan
    try {
      // A supplied plan replaces the vendor conventions wholesale. It carries its
      // own subject and role labels, so pointing this at AI model claims or
      // employer claims is a file, not a code change.
      plan = opts.sources
        ? readSourcePlan(readFileSync(opts.sources, "utf8"), opts.sources)
        : buildSourcePlan(opts.subject, {
            ...(opts.domain ? { domain: opts.domain } : {}),
            ...(opts.industry ? { industry: opts.industry } : {}),
          })
    } catch (err) {
      // buildSourcePlan refuses to guess a domain it might get wrong. Its advice
      // is only actionable because --domain exists; keep the two in step.
      die(err instanceof Error ? err.message : String(err))
    }

    console.error(`fetching ${plan.targets.length} sources (concurrency ${opts.concurrency})...`)
    corpus = await fetchCorpus(plan.subject, plan.targets, {
      apiKey,
      concurrency: opts.concurrency,
      stealth: opts.stealth,
      proxyCountry: opts.proxy,
      ...(opts.proxySession !== undefined ? { proxySession: opts.proxySession } : {}),
      ...(opts.profileId !== undefined ? { profileId: opts.profileId } : {}),
      captcha: opts.captcha,
      ...(plan.labels ? { labels: plan.labels } : {}),
      ...redditFromEnv(),
    })

    if (opts.snapshot) {
      // The fetch is the expensive half. A bad path must not throw it away.
      try {
        writeFileSync(opts.snapshot, `${JSON.stringify(corpus, null, 2)}\n`)
        console.error(`snapshot: ${opts.snapshot}`)
      } catch (err) {
        console.error(`could not write ${opts.snapshot}: ${err instanceof Error ? err.message : String(err)}`)
        console.error("continuing with the fetched corpus in memory")
      }
    }
  }

  // Always report what was and was not read. Partial coverage is a legitimate
  // result, and on a fetch-only run this listing is the entire output.
  for (const doc of corpus.docs) {
    console.error(`  read       ${doc.label}  (${doc.text.length} chars)`)
  }
  for (const f of corpus.failures) {
    console.error(`  ${f.reason.padEnd(13)} ${f.label}`)
  }

  if (corpus.failures.some((f) => f.reason === "plan_required")) {
    console.error(PLAN_REQUIRED_ADVICE)
  }

  // Fetch-only still commits bytes and still makes no model call. analyzeLive
  // is the analyse path; this path must not reach it.
  if (opts.fetchOnly) {
    let storedIds = new Set<string>()
    try {
      storedIds = new Set(storeCorpus(corpus))
    } catch (err) {
      console.error(`could not commit to ${SNAPSHOT_DIR}/: ${err instanceof Error ? err.message : String(err)}`)
      console.error("continuing with nothing committed -- pins will read hash, not snapshot")
    }
    console.error(`  snapshots  ${corpus.docs.length} doc(s), ${storedIds.size} blob(s) in ${SNAPSHOT_DIR}/`)
    console.error(`\n${corpus.docs.length} read, ${corpus.failures.length} failed`)
    process.exit(corpus.docs.length === 0 ? 2 : 0)
  }

  // The corpus is already in hand and may have cost real money to fetch. An
  // unhandled rejection here would end the run in a stack trace with nothing to
  // show for it, so say what failed and point at the usual cause.
  let report
  try {
    const live = await analyzeLive(corpus, {
      candidates: opts.candidates,
      runs: opts.runs,
      noCache: opts.noCache,
      tier: opts.promptTier,
      ...proposer,
    })
    report = live.result
    if (opts.noCache) {
      console.error("not replayable: --no-cache")
    } else if (live.writeFailures + live.callFailures > 0) {
      console.error(
        `not replayable: ${live.writeFailures + live.callFailures} response(s) not on disk in ${CACHE_DIR}/ ` +
          `(${live.writeFailures} could not be written, ${live.callFailures} calls failed)`,
      )
    } else {
      console.error(`  cache      ${live.cacheKeys} response(s) in ${CACHE_DIR}/`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes("anthropic-workspace-id")) {
      die(
        [
          "This Anthropic key is identity-linked and must name a workspace.",
          "Add ANTHROPIC_WORKSPACE_ID to receipts/.env — find it in the Anthropic",
          "Console under Settings > Workspaces (the id starts with wrkspc_).",
        ].join("\n"),
      )
    }
    die(`The model call failed: ${message}`)
  }

  console.log(opts.asJson ? JSON.stringify(report, null, 2) : renderTerminal(report))
  if (opts.refresh && opts.rerun) {
    if (isRefusal(report)) {
      console.error(`not written: the analysis refused (${report.reason}); ${opts.refresh} keeps the prior ledger`)
    } else {
      // The analysis is the expensive half. A bad path must not throw it away.
      try {
        writeFileSync(opts.refresh, `${JSON.stringify(report, null, 2)}\n`, "utf8")
        console.error(`wrote ${opts.refresh}`)
      } catch (err) {
        console.error(`could not write ${opts.refresh}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  // Not process.exit(): stdout to a pipe is asynchronous on POSIX, and exiting
  // immediately after a large console.log can truncate it before it flushes
  // (e.g. `--json | jq`). Setting exitCode and falling off the end of the
  // script lets Node flush normally. `--render` above cannot do the same —
  // the module body would continue into the paid path — so it drains and
  // exits on its own write.
  process.exitCode = exitCodeFor(report)
}

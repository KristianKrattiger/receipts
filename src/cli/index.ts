#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { fetchCorpus } from "../fetch/fan.js"
import { analyzeCorpus } from "../pipeline.js"
import { SNAPSHOT_DIR } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
import { renderDriftReport } from "../report/render/drift.js"
import { renderTerminal } from "../report/render/terminal.js"
import { buildSourcePlan, readSourcePlan } from "../sources/plan.js"
import { parseArgs, readCorpusFile, type CliOptions } from "./args.js"
import { exitCodeFor } from "./exit.js"
import { runRefresh } from "./refresh.js"
import { isRefusal } from "../assay/types.js"
import type { Refusal } from "../assay/types.js"
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
                          and write a new ledger (the same model calls, and cost, as a full run).
  --no-captcha            do not solve challenges; a challenged source reports
                          as not read (see the access stance in the README)
  --no-stealth            skip stealth + proxy (required on the Solari free plan,
                          but bot-hostile sources will refuse you)

  SOLARI_API_KEY     required unless --from-fixture   console.getsolari.com
  ANTHROPIC_API_KEY  required unless --fetch-only, or --refresh without --rerun
`

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
    // Same truncation risk as the analyze path's comment below describes, and
    // this is the actual path `docs/replay.ts`'s own pipeline reads from
    // (`npm run cli -- tesla --render reports/tesla-fsd.json | npx tsx
    // docs/replay.ts`). `write` returns false when the data did not fully
    // flush synchronously. Unlike the analyze path below, this one cannot
    // just fall off the end of the script and let `process.exitCode` do the
    // work — the module body keeps running past this `if` into the paid
    // fetch/analyze path, and a listener that fires later without blocking
    // here would let that happen. So this `await`s the drain (module scope
    // is top-level `await`-capable) before exiting, with a bounded fallback
    // timer so a drain that never arrives cannot hang the process.
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

// Checked before any paid work: the fixture path needs it just as much as the
// fetch path, and discovering it missing after a browser fan has run costs
// real money for nothing. Two exemptions, both because they make no model
// call: --fetch-only (capturing a corpus is useful on its own), and a plain
// --refresh without --rerun (comparison-only, by design free to run).
if (!opts.fetchOnly && !(opts.refresh && !opts.rerun) && !process.env.ANTHROPIC_API_KEY) {
  die(
    "ANTHROPIC_API_KEY is not set. Every run calls the model, unless " +
      "--fetch-only or --refresh without --rerun.",
  )
}

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
  console.log(opts.asJson ? JSON.stringify(result.drift, null, 2) : renderDriftReport(result.drift))
  if (!opts.rerun) {
    // A drift report is a result. Exit 0 whether or not anything drifted:
    // "nothing changed" is a finding too, and a script can read the summary.
    process.exitCode = 0
    // Fall through to the end of the module. The fresh-run body below is
    // guarded on `!opts.refresh || opts.rerun`, so nothing else runs.
  }
  // With --rerun, the fresh-run body picks up `result.fresh` as its corpus.
}

if (!opts.refresh || opts.rerun) {
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

  // A plan rejection fails every source identically and has nothing to do with
  // the vendor. Saying so beats letting it read as "this company is unreadable".
  if (corpus.failures.some((f) => f.reason === "plan_required")) {
    console.error(
      "\nSolari refused a feature this plan does not include. Stealth is paid-only;" +
        "\nre-run with --no-stealth to read what is reachable without it, or upgrade" +
        "\nat console.getsolari.com. Bot-hostile sources will still refuse a" +
        "\nnon-stealth browser, so expect the vendor's own pages and little else.",
    )
  }

  // Commit the bytes before analysing, so the pins the report carries resolve to
  // blobs that exist. This is the machinery's job, not the adapter's: it is what
  // makes a published ledger checkable by anyone with the repo, and without it a
  // run emits hashes pointing at nothing.
  //
  // The fetch above is the expensive half -- Solari has already been paid by the
  // time this runs. A bad path here (read-only workdir, full disk, `snapshots`
  // already existing as a plain file) must not throw that away: warn and carry
  // on as though nothing were committed, the same shape as the `--snapshot`
  // write above. That is the conservative fact even when `storeCorpus` failed
  // partway through and some blobs before the failing one were in fact
  // written -- `storedIds` is still empty, because the thrown `.map` discards
  // whatever it had accumulated. The report that follows is still honest about
  // it -- with storedIds empty, every pin falls back to `hash` rather than
  // falsely claiming `snapshot`.
  let storedIds = new Set<string>()
  try {
    storedIds = new Set(storeCorpus(corpus))
  } catch (err) {
    console.error(`could not commit to ${SNAPSHOT_DIR}/: ${err instanceof Error ? err.message : String(err)}`)
    console.error("continuing with nothing committed -- pins will read hash, not snapshot")
  }
  console.error(`  snapshots  ${corpus.docs.length} doc(s), ${storedIds.size} blob(s) in ${SNAPSHOT_DIR}/`)

  if (opts.fetchOnly) {
    console.error(`\n${corpus.docs.length} read, ${corpus.failures.length} failed`)
    process.exit(corpus.docs.length === 0 ? 2 : 0)
  }

  // The corpus is already in hand and may have cost real money to fetch. An
  // unhandled rejection here would end the run in a stack trace with nothing to
  // show for it, so say what failed and point at the usual cause.
  let report
  try {
    report = await analyzeCorpus(corpus, {
      candidates: opts.candidates,
      isStored: (sha) => storedIds.has(sha),
    })
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
  // script lets Node flush normally. `docs/replay.ts`'s own pipeline does not
  // reach this path at all — its documented invocation goes through --render
  // above, which guards the same truncation risk on its own write.
  process.exitCode = exitCodeFor(report)
}

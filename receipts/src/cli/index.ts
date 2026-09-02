#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { fetchCorpus } from "../fetch/fan.js"
import { analyzeCorpus } from "../pipeline.js"
import { renderTerminal } from "../report/render/terminal.js"
import { buildSourcePlan } from "../sources/plan.js"
import { parseArgs, readCorpusFile, type CliOptions } from "./args.js"

const USAGE = `usage: receipts <vendor> [options]

  --from-fixture <path>   analyze a saved corpus instead of fetching (free, offline)
  --snapshot <path>       write the fetched corpus to a fixture file
  --domain <host>         vendor's domain, when it is not <vendor>.com
  --concurrency <n>       parallel browsers (default 3, the free-tier cap)
  --json                  print the report as JSON instead of a ledger
  --fetch-only            fetch and save a corpus, then stop (no model call)
  --proxy <mode>          proxy egress: a country code, or "smart" (default us)
  --candidates <n>        chunks shown to the model (default 40; drives cost)
  --no-stealth            skip stealth + proxy (required on the Solari free plan,
                          but bot-hostile sources will refuse you)

  SOLARI_API_KEY     required unless --from-fixture   console.getsolari.com
  ANTHROPIC_API_KEY  required unless --fetch-only
`

function die(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

let opts: CliOptions
try {
  opts = parseArgs(process.argv.slice(2))
} catch (err) {
  die(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
}

// Checked before any paid work: the fixture path needs it just as much as the
// fetch path, and discovering it missing after a browser fan has run costs
// real money for nothing. --fetch-only makes no model call, so it does not
// need one — capturing a corpus is useful on its own.
if (!opts.fetchOnly && !process.env.ANTHROPIC_API_KEY) {
  die("ANTHROPIC_API_KEY is not set. Every run makes one model call, unless --fetch-only.")
}

let corpus
if (opts.fromFixture) {
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
    plan = buildSourcePlan(opts.subject, opts.domain ? { domain: opts.domain } : {})
  } catch (err) {
    // buildSourcePlan refuses to guess a domain it might get wrong. Its advice
    // is only actionable because --domain exists; keep the two in step.
    die(err instanceof Error ? err.message : String(err))
  }

  console.error(`fetching ${plan.targets.length} sources (concurrency ${opts.concurrency})...`)
  corpus = await fetchCorpus(opts.subject, plan.targets, {
    apiKey,
    concurrency: opts.concurrency,
    stealth: opts.stealth,
    proxyCountry: opts.proxy,
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

if (opts.fetchOnly) {
  console.error(`\n${corpus.docs.length} read, ${corpus.failures.length} failed`)
  process.exit(corpus.docs.length === 0 ? 2 : 0)
}

if (corpus.docs.length === 0) {
  console.error("no sources could be read; nothing to analyze")
  process.exit(2)
}

// The corpus is already in hand and may have cost real money to fetch. An
// unhandled rejection here would end the run in a stack trace with nothing to
// show for it, so say what failed and point at the usual cause.
let report
try {
  report = await analyzeCorpus(corpus, { candidates: opts.candidates })
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

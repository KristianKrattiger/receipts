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

  SOLARI_API_KEY     required unless --from-fixture   console.getsolari.com
  ANTHROPIC_API_KEY  always required
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
// real money for nothing.
if (!process.env.ANTHROPIC_API_KEY) {
  die("ANTHROPIC_API_KEY is not set. Every run makes one model call.")
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
  corpus = await fetchCorpus(opts.subject, plan.targets, { apiKey, concurrency: opts.concurrency })

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

if (corpus.docs.length === 0) {
  console.error("no sources could be read; nothing to analyze")
  for (const f of corpus.failures) console.error(`  ${f.reason.padEnd(10)} ${f.label}`)
  process.exit(2)
}

const report = await analyzeCorpus(corpus)
console.log(opts.asJson ? JSON.stringify(report, null, 2) : renderTerminal(report))

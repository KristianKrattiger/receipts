#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { fetchCorpus } from "../fetch/fan.js"
import { analyzeCorpus } from "../pipeline.js"
import { renderTerminal } from "../report/render/terminal.js"
import { buildSourcePlan } from "../sources/plan.js"
import type { Corpus } from "../types.js"

const USAGE = `usage: receipts <vendor> [options]

  --from-fixture <path>   analyze a saved corpus instead of fetching (free, offline)
  --snapshot <path>       write the fetched corpus to a fixture file
  --concurrency <n>       parallel browsers (default 3, the free-tier cap)
  --json                  print the report as JSON instead of a ledger
`

const args = process.argv.slice(2)
if (args.length === 0 || args[0]?.startsWith("-")) {
  console.error(USAGE)
  process.exit(1)
}

function flag(name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

const subject = args[0]!
const fromFixture = flag("--from-fixture")
const snapshot = flag("--snapshot")
const concurrency = Number(flag("--concurrency") ?? 3)
const asJson = args.includes("--json")

let corpus: Corpus
if (fromFixture) {
  corpus = JSON.parse(readFileSync(fromFixture, "utf8")) as Corpus
} else {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) {
    console.error("SOLARI_API_KEY is not set. Get one at console.getsolari.com, or pass --from-fixture.")
    process.exit(1)
  }
  const plan = buildSourcePlan(subject)
  console.error(`fetching ${plan.targets.length} sources (concurrency ${concurrency})...`)
  corpus = await fetchCorpus(subject, plan.targets, { apiKey, concurrency })
  if (snapshot) writeFileSync(snapshot, `${JSON.stringify(corpus, null, 2)}\n`)
}

if (corpus.docs.length === 0) {
  console.error("no sources could be read; nothing to analyze")
  for (const f of corpus.failures) console.error(`  ${f.reason.padEnd(10)} ${f.label}`)
  process.exit(2)
}

const report = await analyzeCorpus(corpus)
console.log(asJson ? JSON.stringify(report, null, 2) : renderTerminal(report))

#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { backfillFromCorpus } from "./backfill.js"

const [corpusPath, reportPath] = process.argv.slice(2)
if (!corpusPath || !reportPath) {
  console.error("usage: backfill <fixture.json> <report.json>")
  process.exit(2)
}

const { report, snapshots, unmatched } = backfillFromCorpus(
  readFileSync(corpusPath, "utf8"),
  readFileSync(reportPath, "utf8"),
)
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
console.error(`${reportPath}: ${snapshots} snapshot(s), ${unmatched} document(s) left untouched`)

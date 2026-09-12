#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { backfillFromCorpus } from "./backfill.js"

/**
 * Refuse to stamp a report with bytes read from a different subject's corpus.
 *
 * `backfillFromCorpus` matches fixture to report by `docId` alone (see its
 * own doc comment) and has no way to know the two files were ever meant to
 * go together. Without this check, `backfill fixtures/vercel.json
 * reports/tesla-fsd.json` would silently stamp any docId that happens to
 * collide across subjects with foreign bytes -- an unearned integrity
 * baseline of exactly the kind the chime.json exclusion was reasoned around.
 */
export function assertMatchingSubjects(
  corpus: { subject: string },
  report: { subject: string },
  corpusPath: string,
  reportPath: string,
): void {
  if (corpus.subject !== report.subject) {
    throw new Error(
      `receipts: refusing to backfill — ${corpusPath} is about "${corpus.subject}" `
      + `but ${reportPath} is about "${report.subject}"`,
    )
  }
}

// Guarded the same way src/web/build.ts guards its main body: the assertion
// above needs to be importable by a test without running this script.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const [corpusPath, reportPath] = process.argv.slice(2)
  if (!corpusPath || !reportPath) {
    console.error("usage: backfill <fixture.json> <report.json>")
    process.exit(2)
  }

  const corpusJson = readFileSync(corpusPath, "utf8")
  const reportJson = readFileSync(reportPath, "utf8")

  // Both refusals -- a foreign subject, and a same-subject fixture whose text
  // does not contain a span the ledger cites -- print their reason and exit 1
  // before the report is written.
  let result: ReturnType<typeof backfillFromCorpus>
  try {
    assertMatchingSubjects(
      JSON.parse(corpusJson) as { subject: string },
      JSON.parse(reportJson) as { subject: string },
      corpusPath,
      reportPath,
    )
    result = backfillFromCorpus(corpusJson, reportJson)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  const { report, snapshots, unmatched } = result
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.error(`${reportPath}: ${snapshots} snapshot(s), ${unmatched} document(s) left untouched`)
}

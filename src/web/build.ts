/**
 * Render committed report JSON into static pages.
 *
 *   npx tsx src/web/build.ts reports/*.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import { renderHtml, renderIndex } from "../report/render/html.js"
import type { Report } from "../types.js"

/**
 * Refuse a file that is not a claim-ledger Report, by name, before it reaches
 * a renderer that assumes the shape.
 *
 * A diagnostic file landing directly under `reports/` -- an egress probe, a
 * captcha probe -- has its own `rows`, of its own shape, and `renderHtml`
 * calling `.filter` on one of those rows crashed with a bare TypeError naming
 * neither the file nor the reason. That crash silently failed every Pages
 * deploy on this repo for two days: the workflow globs `reports/*.json`
 * unconditionally, so any file placed there is a page the site promises to
 * render. Diagnostic runs belong in `reports/measurements/`, outside that
 * glob; this check is what stops the next one from repeating it quietly.
 */
export function assertReport(value: unknown, path: string): asserts value is Report {
  const r = value as Record<string, unknown> | null
  if (typeof r !== "object" || r === null) {
    throw new Error(`receipts: ${path} is not a JSON object`)
  }
  if (typeof r["subject"] !== "string") {
    throw new Error(`receipts: ${path} has no "subject" string — is this a claim-ledger report?`)
  }
  if (!Array.isArray(r["docs"])) throw new Error(`receipts: ${path} has no "docs" array`)
  if (!Array.isArray(r["rows"])) throw new Error(`receipts: ${path} has no "rows" array`)
  if (typeof r["audit"] !== "object" || r["audit"] === null) {
    throw new Error(`receipts: ${path} has no "audit" object`)
  }
}

// Guarded the same way src/eval/captcha.ts guards its main(): assertReport
// above needs to be importable by a test without running this script body,
// which an unconditional top-level block -- the shape this file had before --
// does not allow.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const inputs = process.argv.slice(2)
  if (inputs.length === 0) {
    console.error("usage: tsx src/web/build.ts <report.json...>")
    process.exit(1)
  }

  mkdirSync("public", { recursive: true })
  const entries: { name: string; report: Report }[] = []

  for (const path of inputs) {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    assertReport(parsed, path)
    const report = parsed
    const name = basename(path, ".json")
    writeFileSync(`public/${name}.html`, renderHtml(report))
    entries.push({ name, report })
    console.log(`public/${name}.html`)
  }

  // The index is built by renderIndex rather than inlined here, so it shares
  // the page renderer's escaping instead of quietly interpolating report data raw.
  writeFileSync("public/index.html", renderIndex(entries))
  console.log("public/index.html")
}

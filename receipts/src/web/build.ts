/**
 * Render committed report JSON into static pages.
 *
 *   npx tsx src/web/build.ts reports/*.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { renderHtml, renderIndex } from "../report/render/html.js"
import type { Report } from "../types.js"

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error("usage: tsx src/web/build.ts <report.json...>")
  process.exit(1)
}

mkdirSync("public", { recursive: true })
const entries: { name: string; report: Report }[] = []

for (const path of inputs) {
  const report = JSON.parse(readFileSync(path, "utf8")) as Report
  const name = basename(path, ".json")
  writeFileSync(`public/${name}.html`, renderHtml(report))
  entries.push({ name, report })
  console.log(`public/${name}.html`)
}

// The index is built by renderIndex rather than inlined here, so it shares the
// page renderer's escaping instead of quietly interpolating report data raw.
writeFileSync("public/index.html", renderIndex(entries))
console.log("public/index.html")

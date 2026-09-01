/**
 * Render committed report JSON into static pages.
 *
 *   npx tsx src/web/build.ts reports/*.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { renderHtml } from "../report/render/html.js"
import type { Report } from "../types.js"

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error("usage: tsx src/web/build.ts <report.json...>")
  process.exit(1)
}

mkdirSync("public", { recursive: true })
const reports: Report[] = []

for (const path of inputs) {
  const report = JSON.parse(readFileSync(path, "utf8")) as Report
  const name = basename(path, ".json")
  writeFileSync(`public/${name}.html`, renderHtml(report))
  reports.push(report)
  console.log(`public/${name}.html`)
}

const links = reports
  .map((r, i) => {
    const divergent = r.rows.filter((row) => row.status === "divergent").length
    const unverified = r.rows.filter((row) => row.status === "unverified").length
    const name = basename(inputs[i]!, ".json")
    return `<li><a href="${name}.html">${r.subject}</a> — ${divergent} divergent, ${unverified} unverified</li>`
  })
  .join("")

writeFileSync(
  "public/index.html",
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipts</title></head>
<body><main style="max-width:40rem;margin:3rem auto;font:16px/1.6 system-ui,sans-serif">
<h1>Receipts</h1>
<p>What a vendor claims, what independent sources report, and which claims nothing corroborates. Every quote is verified to be an exact substring of the page it was fetched from.</p>
<ul>${links}</ul>
</main></body></html>
`,
)
console.log("public/index.html")

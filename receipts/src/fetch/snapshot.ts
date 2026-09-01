/**
 * Capture a real corpus to a fixture file.
 *
 * Run once per vendor; everything downstream then develops offline against the
 * fixture with zero credits and zero latency.
 *
 *   npx tsx src/fetch/snapshot.ts acme fixtures/acme.json
 */
import { writeFileSync } from "node:fs"
import { fetchCorpus } from "./fan.js"
import type { SourceTarget } from "../types.js"

// Hardcoded while sources/ does not exist yet (Task 10 replaces this).
const TARGETS: SourceTarget[] = [
  { kind: "vendor_pricing", role: "vendor_claim", url: "https://www.getsolari.com/pricing", label: "Solari pricing" },
  { kind: "vendor_docs", role: "vendor_claim", url: "https://docs.getsolari.com", label: "Solari docs" },
  { kind: "changelog", role: "vendor_claim", url: "https://changelog.getsolari.com", label: "Solari changelog" },
  { kind: "forum", role: "independent", url: "https://hn.algolia.com/?q=solari", label: "Hacker News" },
  { kind: "forum", role: "independent", url: "https://www.reddit.com/search/?q=solari%20browser", label: "Reddit" },
]

const [subject, out] = process.argv.slice(2)
if (!subject || !out) {
  console.error("usage: tsx src/fetch/snapshot.ts <subject> <out.json>")
  process.exit(1)
}

const apiKey = process.env.SOLARI_API_KEY
if (!apiKey) {
  console.error("SOLARI_API_KEY is not set")
  process.exit(1)
}

const corpus = await fetchCorpus(subject, TARGETS, { apiKey, concurrency: 3 })
writeFileSync(out, `${JSON.stringify(corpus, null, 2)}\n`)
console.log(`docs: ${corpus.docs.length}  failures: ${corpus.failures.length}  -> ${out}`)
for (const f of corpus.failures) console.log(`  ${f.reason.padEnd(10)} ${f.label}`)

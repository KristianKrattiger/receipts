import { readFileSync } from "node:fs"
import { defaultClient, MODEL } from "../cartographer/anthropic.js"
import { toMeasureVerifier } from "../cartographer/measure.js"
import { agreement, BAR, meetsBar, runEval, score, type LabeledRelation } from "./relation-labels.js"

/**
 * Run the real verifier twice over the labeled set and report against the
 * bar. Uncached on purpose: the second run measures stability, which a cache
 * would hide. Exit 0 when the bar is met, 1 when not.
 */
if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY is not set. relation-eval calls the frontier model.")
  process.exit(2)
}
const rows = (JSON.parse(readFileSync("fixtures/relation-labels.json", "utf8")) as { rows: LabeledRelation[] }).rows
const verifier = toMeasureVerifier(defaultClient(), MODEL)
const first = await runEval(rows, verifier)
const second = await runEval(rows, verifier)
const s = score(rows, first)
const agree = agreement(first, second)
console.log(`model       ${MODEL}`)
console.log(`negatives   denied ${s.negativesDenied}/${s.negatives}  (bar ${BAR.negatives})`)
console.log(`positives   admitted ${s.positivesAdmitted}/${s.positives}  (bar ${BAR.positives})`)
console.log(`stability   ${(agree * 100).toFixed(0)}% agreement  (bar ${BAR.agreement * 100}%)`)
console.log(`unverified   ${s.unverified}  (${first.unverified.join(", ")})`)
for (const r of rows.filter((x) => x.expect !== "exclude" && (first.admitted[x.id] === true) !== (x.expect === "admit"))) {
  console.log(`  miss ${r.id} ${r.subject} ${r.relation} expected ${r.expect}`)
}
const pass = meetsBar(s, agree)
console.log(pass ? "PASS" : "FAIL")
process.exitCode = pass ? 0 : 1

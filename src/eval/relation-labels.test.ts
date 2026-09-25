import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { MeasureVerifier } from "../assay/bookkeeper/measure.js"
import { agreement, expectationOf, meetsBar, runEval, score, type LabeledRelation } from "./relation-labels.js"

const rows = (JSON.parse(readFileSync("fixtures/relation-labels.json", "utf8")) as { rows: LabeledRelation[] }).rows
const verdict = (ok: boolean) => ({
  claim_property: "a", claim_scope: "b", evidence_property: "c", evidence_scope: "d",
  same_property: ok, comparable_scope: ok,
})
const oracle: MeasureVerifier = {
  verify: async (input) => verdict(rows.find((r) => r.claim.text === input.claim && r.evidence.text === input.evidence)!.expect === "admit"),
}
const denyAll: MeasureVerifier = { verify: async () => verdict(false) }

describe("relation labels", () => {
  it("holds 30 to deny, 5 to admit, 1 excluded", () => {
    expect(rows.map((r) => r.expect).sort()).toEqual([...Array(5).fill("admit"), ...Array(30).fill("deny"), "exclude"])
  })
  it("maps verdicts to expectations", () => {
    expect(expectationOf("no_relation")).toBe("deny")
    expect(expectationOf("holds")).toBe("admit")
    expect(expectationOf("wrong_relation", "updates")).toBe("admit")
    expect(expectationOf("wrong_relation", "unsupported")).toBe("exclude")
  })
  it("scores an oracle at the top of the bar, and deny-all fails on positives", async () => {
    const good = await runEval(rows, oracle)
    expect(score(rows, good)).toEqual({ negativesDenied: 30, negatives: 30, positivesAdmitted: 5, positives: 5 })
    expect(meetsBar(score(rows, good), agreement(good, good))).toBe(true)
    const bad = await runEval(rows, denyAll)
    expect(meetsBar(score(rows, bad), 1)).toBe(false)
  })
  it("never sends an excluded row to the verifier", async () => {
    const seen: string[] = []
    await runEval(rows, { verify: async (i) => { seen.push(i.claim); return verdict(true) } })
    expect(seen).toHaveLength(35)
  })
  it("measures agreement over the rows both runs judged", () => {
    expect(agreement({ admitted: { a: true, b: false } }, { admitted: { a: true, b: true } })).toBe(0.5)
  })
})

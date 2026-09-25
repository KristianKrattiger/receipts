import type { MeasureVerifier } from "../assay/bookkeeper/measure.js"

export interface LabeledRelation {
  id: string
  subject: string
  relation: "contradicts" | "corroborates" | "updates"
  claim: { source: string; text: string }
  evidence: { source: string; text: string }
  verdict: "holds" | "wrong_relation" | "no_relation"
  should?: string
  note?: string
  expect: "admit" | "deny" | "exclude"
}

/**
 * No relation must be denied. A relation that holds must be admitted, and so
 * must a wrong-type pairing whose quotes still bear on each other: the check
 * judges bearing, not type. A pairing that should have been `unsupported` is
 * an independence failure this check is not built to catch.
 */
export function expectationOf(verdict: LabeledRelation["verdict"], should?: string): LabeledRelation["expect"] {
  if (verdict === "no_relation") return "deny"
  if (verdict === "holds") return "admit"
  return should === "contradicts" || should === "corroborates" || should === "updates" ? "admit" : "exclude"
}

export interface EvalRun {
  /** Row id to whether the verifier admitted it. Excluded rows are absent. */
  admitted: Record<string, boolean>
}

export async function runEval(rows: LabeledRelation[], verifier: MeasureVerifier): Promise<EvalRun> {
  const admitted: Record<string, boolean> = {}
  for (const r of rows) {
    if (r.expect === "exclude") continue
    const v = await verifier.verify({ claim: r.claim.text, evidence: r.evidence.text, relation: r.relation })
    admitted[r.id] = v.same_property && v.comparable_scope
  }
  return { admitted }
}

export function score(rows: LabeledRelation[], run: EvalRun) {
  const deny = rows.filter((r) => r.expect === "deny")
  const admit = rows.filter((r) => r.expect === "admit")
  return {
    negativesDenied: deny.filter((r) => run.admitted[r.id] === false).length,
    negatives: deny.length,
    positivesAdmitted: admit.filter((r) => run.admitted[r.id] === true).length,
    positives: admit.length,
  }
}

export function agreement(a: EvalRun, b: EvalRun): number {
  const ids = Object.keys(a.admitted).filter((id) => id in b.admitted)
  if (ids.length === 0) return 0
  return ids.filter((id) => a.admitted[id] === b.admitted[id]).length / ids.length
}

/** From the spec: deny >= 24 of 30, admit >= 4 of 5, runs agree on >= 90%. */
export const BAR = { negatives: 24, positives: 4, agreement: 0.9 } as const

export function meetsBar(s: ReturnType<typeof score>, agree: number): boolean {
  return s.negativesDenied >= BAR.negatives && s.positivesAdmitted >= BAR.positives && agree >= BAR.agreement
}

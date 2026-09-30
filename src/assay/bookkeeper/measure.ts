import type { Admission, RelationType } from "../types.js"
import type { Screened, ScreenedOk } from "./admit.js"

export type RelationalType = Exclude<RelationType, "unsupported">

/** Everything the verifier is allowed to see. No topic, statement, rationale, label or URL. */
export interface MeasureInput {
  claim: string
  evidence: string
  relation: RelationalType
}

export interface MeasureVerdict {
  claim_property: string
  claim_scope: string
  evidence_property: string
  evidence_scope: string
  same_property: boolean
  comparable_scope: boolean
}

/**
 * Judges whether the evidence can bear on the claim at all: the same property,
 * at a scope from which a conclusion about the claim follows. Not whether the
 * relation type is right. See
 * docs/superpowers/specs/2026-09-25-relation-measure-check-design.md.
 */
export interface MeasureVerifier {
  verify(input: MeasureInput): Promise<MeasureVerdict>
}

export function measureDetail(v: MeasureVerdict): string {
  return `${v.claim_property} (${v.claim_scope}) vs ${v.evidence_property} (${v.evidence_scope})`
}

/**
 * Put every screened relational proposal to the verifier and replace the ones
 * it fails with denials, keeping order. Runs before duplicate detection, so a
 * pairing it denies never blocks a later pairing of the same claim.
 *
 * A call that throws denies RELATION_UNVERIFIED -- fail closed, like every
 * other gate. So does a relational proposal with no evidence side, without a
 * call. Every call failing is our outage, not a finding: it throws.
 */
export async function verifyMeasures(
  screened: Screened[],
  verifier: MeasureVerifier,
  opts: { concurrency?: number } = {},
): Promise<Screened[]> {
  const out = [...screened]
  const deny = (s: ScreenedOk, code: Admission["code"], detail: string): Screened =>
    ({ ok: false, denial: { proposalId: s.proposal.proposalId, code, detail } })

  // A relational proposal with no evidence side cannot be checked, so it is
  // not admitted as checked: deny it without a call. It is no call's failure,
  // so it does not count toward the outage tally below.
  const targets: number[] = []
  out.forEach((s, i) => {
    if (!s.ok || s.proposal.type === "unsupported") return
    if (s.toSpan) targets.push(i)
    else out[i] = deny(s, "RELATION_UNVERIFIED", "no evidence side")
  })
  if (targets.length === 0) return out

  let failures = 0
  let firstError: string | undefined
  let next = 0

  const worker = async () => {
    for (let n = next++; n < targets.length; n = next++) {
      const i = targets[n]!
      const s = out[i] as ScreenedOk
      try {
        const v = await verifier.verify({
          claim: s.fromSpan.text,
          evidence: s.toSpan!.text,
          relation: s.proposal.type as RelationalType,
        })
        if (!(v.same_property && v.comparable_scope)) out[i] = deny(s, "NOT_SAME_MEASURE", measureDetail(v))
      } catch (err) {
        failures++
        const message = err instanceof Error ? err.message : String(err)
        firstError ??= message
        out[i] = deny(s, "RELATION_UNVERIFIED", message.slice(0, 120))
      }
    }
  }
  const limit = Math.min(Math.max(opts.concurrency ?? 3, 1), targets.length)
  await Promise.all(Array.from({ length: limit }, worker))

  if (failures === targets.length) {
    throw new Error(`every relation check failed (${failures}/${targets.length}); first: ${firstError}`)
  }
  return out
}

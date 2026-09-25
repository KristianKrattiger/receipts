import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import type { MeasureInput, MeasureVerdict, MeasureVerifier } from "../assay/bookkeeper/measure.js"
import { MODEL, type SdkProposalClient } from "./anthropic.js"

/** Whether a run checks relations when neither --relation-check nor --no-relation-check is given. Set by the relation-eval bar. */
export const RELATION_CHECK_DEFAULT = false

export const MeasureVerdictSchema = z.object({
  claim_property: z.string(),
  claim_scope: z.string(),
  evidence_property: z.string(),
  evidence_scope: z.string(),
  same_property: z.boolean(),
  comparable_scope: z.boolean(),
})

/**
 * The rule only, in general terms. No example may come from
 * fixtures/relation-labels.json or its notes: the eval would then measure
 * recall of its own answers.
 */
export const MEASURE_SYSTEM = [
  "You check whether a piece of evidence can bear on a claim at all.",
  "You are given a claim quoted from a vendor's own materials, a quote from an independent source, and the relation someone proposed between them.",
  "Do not judge whether the proposed relation is the right one. Judge only whether the evidence could bear on the claim.",
  "First state what property the claim asserts and about what scope: which products, people, period or population it covers.",
  "Then state what the evidence measures or reports, and about what scope.",
  "same_property is true only when both are about the same property: the same capability, metric, feature or fact.",
  "Sharing a subject, a product name or a topic is not enough.",
  "comparable_scope is true when a conclusion about the claim can follow from the evidence at the evidence's scope.",
  "Scope is not size. A single case can show that something exists or can happen, so it can bear on a claim that something exists or is possible.",
  "A single case cannot establish or refute a rate, an average, a trend or a claim about a whole population.",
  "Evidence about part of a population bears on a claim about the whole only when the claim is about every member.",
].join(" ")

export function measureUserMessage(input: MeasureInput): string {
  return [
    "Claim, quoted from the vendor's own materials:",
    `"${input.claim}"`,
    "",
    "Evidence, quoted from an independent source:",
    `"${input.evidence}"`,
    "",
    `Proposed relation: the evidence ${input.relation} the claim.`,
  ].join("\n")
}

type ParseBody = Parameters<SdkProposalClient["beta"]["messages"]["parse"]>[0]

/**
 * The relation measure verifier over the parse-shaped client, so it can be
 * wrapped by the proposal cache and replayed like any proposal.
 */
export function toMeasureVerifier(sdk: SdkProposalClient, model: string = MODEL): MeasureVerifier {
  return {
    async verify(input: MeasureInput): Promise<MeasureVerdict> {
      const response = await sdk.beta.messages.parse({
        model,
        max_tokens: 1024,
        system: MEASURE_SYSTEM,
        messages: [{ role: "user", content: measureUserMessage(input) }],
        output_format: betaZodOutputFormat(MeasureVerdictSchema) as unknown as ParseBody["output_format"],
      })
      if (response.stop_reason === "refusal") throw new Error("refused")
      const parsed = MeasureVerdictSchema.safeParse(response.parsed_output)
      if (!parsed.success) throw new Error("schema")
      return parsed.data
    },
  }
}

import { z } from "zod"

export const SpanProposalSchema = z.object({
  docId: z.string(),
  quote: z.string(),
})

export const RelationProposalSchema = z.object({
  type: z.enum(["contradicts", "corroborates", "updates", "unsupported"]),
  topic: z.string(),
  statement: z.string(),
  from: SpanProposalSchema,
  to: SpanProposalSchema.nullable(),
  rationale: z.string(),
  confidence: z.number(),
})

export const ProposalBatchSchema = z.object({
  proposals: z.array(RelationProposalSchema),
})

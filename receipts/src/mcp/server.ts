#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { fetchCorpus } from "../fetch/fan.js"
import { analyzeCorpus } from "../pipeline.js"
import { renderMarkdown } from "../report/render/markdown.js"
import { buildSourcePlan } from "../sources/plan.js"

export const toolDefinition = {
  name: "diligence_vendor",
  description:
    "Research a software vendor by reading its own marketing alongside independent sources " +
    "(status page, forums, review sites), and return a claim ledger. Every quote is verified " +
    "to be an exact substring of the fetched page text; claims with no independent " +
    "corroboration are reported as unverified rather than dropped.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Vendor or product name, e.g. 'Solari'" },
      domain: { type: "string", description: "Vendor domain if it is not <name>.com" },
      concurrency: { type: "number", description: "Parallel browsers (default 3)" },
    },
    required: ["name"],
  },
}

export async function runDiligence(input: {
  name: string
  domain?: string
  concurrency?: number
}): Promise<string> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) throw new Error("SOLARI_API_KEY is not set")

  const plan = buildSourcePlan(input.name, { domain: input.domain })
  const corpus = await fetchCorpus(input.name, plan.targets, {
    apiKey,
    concurrency: input.concurrency ?? 3,
  })
  if (corpus.docs.length === 0) {
    const failed = corpus.failures.map((f) => `${f.label} (${f.reason})`).join(", ")
    return `No sources could be read for ${input.name}. Attempted: ${failed}`
  }
  return renderMarkdown(await analyzeCorpus(corpus))
}

const server = new Server(
  { name: "receipts", version: "0.1.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [toolDefinition] }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== toolDefinition.name) {
    throw new Error(`unknown tool: ${request.params.name}`)
  }
  const args = request.params.arguments as { name: string; domain?: string; concurrency?: number }
  try {
    return { content: [{ type: "text", text: await runDiligence(args) }] }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Diligence failed: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    }
  }
})

await server.connect(new StdioServerTransport())

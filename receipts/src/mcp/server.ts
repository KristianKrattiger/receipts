#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { pathToFileURL } from "node:url"
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
  // The declared inputSchema is advisory: the SDK validates the request
  // envelope, not `arguments` against a tool's schema. Without this, a missing
  // `name` reaches slugify and surfaces as "Cannot read properties of
  // undefined (reading 'toLowerCase')" — technically caught, but it tells the
  // caller nothing about what they got wrong.
  if (typeof input?.name !== "string" || input.name.trim() === "") {
    throw new Error('diligence_vendor requires a non-empty "name"')
  }

  // Both keys are checked up front, for the same reason the CLI does it: the
  // model call happens after every page has been fetched, so a missing
  // ANTHROPIC_API_KEY would otherwise surface a minute in, having already spent
  // the Solari budget on a corpus nothing can read. Reported together so a
  // caller fixes their environment once.
  const missing = ["SOLARI_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k])
  if (missing.length > 0) throw new Error(`${missing.join(" and ")} not set`)
  const apiKey = process.env.SOLARI_API_KEY!

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

/**
 * Only bind stdio when this file is the entrypoint.
 *
 * At top level, `connect()` attaches a listener to process.stdin and switches
 * it to flowing mode — on every import, including a test importing
 * `toolDefinition`. It happens not to hang the current runner, but nothing in
 * the module prevented it, and a different vitest pool, a real TTY, or an SDK
 * that resumes stdin would turn it into a hang.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  await server.connect(new StdioServerTransport())
}

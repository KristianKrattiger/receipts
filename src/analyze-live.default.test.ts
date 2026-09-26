import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SdkProposalClient } from "./cartographer/anthropic.js"
import type { Corpus, FetchedDoc, ReceiptsManifest } from "./types.js"
import { analyzeLive } from "./analyze-live.js"

// The MCP and web servers call analyzeLive(corpus) with no options; they must
// follow RELATION_CHECK_DEFAULT. Flip it here to see that they would.
vi.mock("./cartographer/measure.js", async (orig) => ({
  ...(await orig<typeof import("./cartographer/measure.js")>()),
  RELATION_CHECK_DEFAULT: true,
}))

let cwd: string
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "analyze-live-default-")) })
afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

function doc(over: Partial<FetchedDoc>): FetchedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z", title: "T", text: "", ...over,
  }
}
const CORPUS: Corpus = {
  subject: "Acme",
  labels: { claimant: "acme", independent: "independent" },
  docs: [
    doc({ docId: "a", url: "https://acme.example/", label: "Acme site", role: "claimant",
      text: "Acme guarantees 99.99% uptime for every account." }),
    doc({ docId: "b", url: "https://forum.example/t/1", label: "Forum", role: "independent",
      text: "Acme has run without incident for the past year." }),
  ],
  failures: [],
}
const RELATION = {
  type: "corroborates", topic: "uptime", statement: "s",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
  to: { docId: "b", quote: "Acme has run without incident for the past year." },
  rationale: "r", confidence: 0.9,
}
const relationStub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals: [RELATION] } }) as never } },
}
const verdictStub: SdkProposalClient = {
  beta: { messages: { parse: async () => ({
    stop_reason: "end_turn",
    parsed_output: {
      claim_property: "uptime", claim_scope: "every account", evidence_property: "incidents",
      evidence_scope: "one year", same_property: true, comparable_scope: true,
    },
  }) as never } },
}

describe("analyzeLive without relationCheck", () => {
  it("follows RELATION_CHECK_DEFAULT", async () => {
    const out = await analyzeLive(CORPUS, {
      client: relationStub, verifierClient: verdictStub, runs: 1,
      snapshotDir: join(cwd, "snapshots"), cacheDir: join(cwd, "cache"),
    })
    expect(out.result.audit.relationCheck).toBe(true)
    expect((out.result.replay as ReceiptsManifest | undefined)?.relationCheck?.keys.length).toBeGreaterThan(0)
  })
})

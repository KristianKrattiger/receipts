import { afterEach, describe, expect, it } from "vitest"
import { runDiligence, toolDefinition } from "./server.js"

describe("diligence_vendor tool definition", () => {
  it("is named for the job it does", () => {
    expect(toolDefinition.name).toBe("diligence_vendor")
  })

  it("requires a vendor name", () => {
    expect(toolDefinition.inputSchema.required).toEqual(["name"])
  })

  it("accepts an optional domain override", () => {
    expect(toolDefinition.inputSchema.properties).toHaveProperty("domain")
  })

  it("describes what the tool returns", () => {
    expect(toolDefinition.description).toMatch(/ledger|quote|verif/i)
  })

  it("tells an agent that unverified claims are reported, not dropped", () => {
    expect(toolDefinition.description).toMatch(/unverified rather than dropped/)
  })
})

// Importing this module must not start the server. If the entrypoint guard
// regresses, connect() binds process.stdin on import and this file is where
// the runner starts hanging.
describe("runDiligence — rejects before doing any paid work", () => {
  const KEYS = ["SOLARI_API_KEY", "ANTHROPIC_API_KEY"] as const
  const saved = KEYS.map((k) => [k, process.env[k]] as const)
  const setBoth = () => KEYS.forEach((k) => { process.env[k] = "test_value" })
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("names the missing key rather than failing inside a fetch", async () => {
    setBoth()
    await expect(runDiligence({ name: "" })).rejects.toThrow(/requires a non-empty "name"/)
  })

  for (const bad of [undefined, null, 42, "   "]) {
    it(`rejects a name of ${JSON.stringify(bad)} with an actionable message`, async () => {
      setBoth()
      await expect(
        runDiligence({ name: bad as unknown as string }),
      ).rejects.toThrow(/requires a non-empty "name"/)
    })
  }

  for (const key of KEYS) {
    it(`reports a missing ${key} by name`, async () => {
      setBoth()
      delete process.env[key]
      await expect(runDiligence({ name: "acme" })).rejects.toThrow(new RegExp(key))
    })
  }

  // The Anthropic key is only read after every page has been fetched. Checking
  // it late would spend the Solari budget before the run could possibly finish,
  // so both keys are named in one message.
  it("names both keys at once when neither is set", async () => {
    KEYS.forEach((k) => { delete process.env[k] })
    await expect(runDiligence({ name: "acme" }))
      .rejects.toThrow(/SOLARI_API_KEY and ANTHROPIC_API_KEY/)
  })
})

describe("diligence_vendor — industry", () => {
  it("publishes the known industries as an enum on the schema", () => {
    const industry = (toolDefinition.inputSchema.properties as Record<string, { enum?: string[] }>)["industry"]
    expect(industry?.enum).toContain("fintech")
  })

  // The declared enum is advisory -- the SDK validates the envelope, not
  // `arguments` -- and this refusal must land before the environment check, so
  // a typo reads as a typo rather than as a missing API key.
  it("refuses an unknown industry before checking for API keys", async () => {
    await expect(runDiligence({ name: "acme", industry: "banking" }))
      .rejects.toThrow(/unknown industry "banking".*fintech/s)
  })
})

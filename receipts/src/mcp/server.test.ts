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
  const savedKey = process.env["SOLARI_API_KEY"]
  afterEach(() => {
    if (savedKey === undefined) delete process.env["SOLARI_API_KEY"]
    else process.env["SOLARI_API_KEY"] = savedKey
  })

  it("names the missing key rather than failing inside a fetch", async () => {
    process.env["SOLARI_API_KEY"] = "slr_live_test"
    await expect(runDiligence({ name: "" })).rejects.toThrow(/requires a non-empty "name"/)
  })

  for (const bad of [undefined, null, 42, "   "]) {
    it(`rejects a name of ${JSON.stringify(bad)} with an actionable message`, async () => {
      process.env["SOLARI_API_KEY"] = "slr_live_test"
      await expect(
        runDiligence({ name: bad as unknown as string }),
      ).rejects.toThrow(/requires a non-empty "name"/)
    })
  }

  it("reports a missing SOLARI_API_KEY by name", async () => {
    delete process.env["SOLARI_API_KEY"]
    await expect(runDiligence({ name: "acme" })).rejects.toThrow(/SOLARI_API_KEY/)
  })
})

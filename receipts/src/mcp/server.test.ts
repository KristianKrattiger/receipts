import { describe, expect, it } from "vitest"
import { toolDefinition } from "./server.js"

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
})

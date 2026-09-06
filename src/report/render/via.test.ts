import { describe, expect, it } from "vitest"
import { viaSuffix } from "./via.js"

describe("viaSuffix — a row says how it was read", () => {
  it("marks an API-read document", () => {
    expect(viaSuffix("api")).toBe(" (via api)")
  })

  // The browser fan is the default path and every existing row uses it.
  // Annotating those would add noise to every ledger this project has published.
  it("says nothing for a browser-read document", () => {
    expect(viaSuffix("browser")).toBe("")
  })

  it("says nothing when provenance was not recorded", () => {
    expect(viaSuffix(undefined)).toBe("")
  })
})

import { describe, expect, it } from "vitest"
import { INDUSTRIES, isIndustry, regulatorTargets } from "./regulators.js"

describe("regulatorTargets", () => {
  // automotive is present in the union and absent from the table, on purpose.
  // NHTSA's name-only URL was measured and does not work; the URL that does
  // needs make, model and modelYear, so it lives in plans/tesla-fsd.json.
  it("returns no targets for an industry the table has no entry for", () => {
    expect(regulatorTargets("automotive", "Tesla")).toEqual([])
  })

  it("returns a CFPB complaint search for a fintech subject", () => {
    const targets = regulatorTargets("fintech", "Chime")
    expect(targets).toHaveLength(1)
    expect(targets[0]!.url).toContain("consumerfinance.gov")
  })

  it("marks regulator targets independent and labelled", () => {
    const targets = regulatorTargets("fintech", "Chime")
    expect(targets[0]!.role).toBe("independent")
    expect(targets[0]!.label.length).toBeGreaterThan(0)
  })

  // The subject reaches the query string. "Bread Financial" must not arrive as
  // two parameters, and "AT&T" must not truncate the term at the ampersand --
  // the encoding bug this project already fixed once, in the NHTSA probe.
  it("percent-encodes a subject containing a space and an ampersand", () => {
    const url = regulatorTargets("fintech", "Block & Bread Financial")[0]!.url
    expect(url).toContain("search_term=Block%20%26%20Bread%20Financial")
    expect(url).not.toContain("search_term=Block & Bread")
  })

  // Measured 2026-09-06: `format=json` makes this endpoint answer 404, and
  // dropping the trailing slash serves the HTML page instead of the API.
  // Both are silent -- neither throws -- so they are pinned here.
  it("keeps the trailing slash and sends no format parameter", () => {
    const url = regulatorTargets("fintech", "Chime")[0]!.url
    expect(url).toContain("/api/v1/?")
    expect(url).not.toContain("format=")
  })

  // Relevance order is load-bearing. Adding sort=created_date_desc returns the
  // most recent complaints mentioning the term anywhere, which for "Chime"
  // meant complaints filed against Ally, Netspend and Wells Fargo. In the
  // default order 25/25 were against Chime Financial Inc.
  it("does not sort, so the API answers in relevance order", () => {
    expect(regulatorTargets("fintech", "Chime")[0]!.url).not.toContain("sort=")
  })
})

describe("isIndustry", () => {
  it("accepts every member of the published list", () => {
    expect(INDUSTRIES.length).toBeGreaterThan(0)
    for (const name of INDUSTRIES) expect(isIndustry(name)).toBe(true)
  })

  it("rejects a name that is not an industry", () => {
    expect(isIndustry("banking")).toBe(false)
    expect(isIndustry("")).toBe(false)
  })
})

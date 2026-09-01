import { describe, expect, it } from "vitest"
import { buildIdf, DIVERGENCE_IDF_FLOOR, idfRelevance, tokenize } from "./idf.js"

const DOCS = [
  { text: "the platform provides uptime and support" },
  { text: "the platform provides support and billing" },
  { text: "the platform provides billing and wildfire" },
]

describe("tokenize", () => {
  it("lowercases and keeps alphanumeric runs", () => {
    expect(tokenize("Acme's 99.99% Uptime!")).toEqual(["acme", "s", "99", "99", "uptime"])
  })
})

describe("buildIdf", () => {
  it("scores a rare term above a ubiquitous one", () => {
    const idf = buildIdf(DOCS)
    expect(idf.get("wildfire")!).toBeGreaterThan(idf.get("platform")!)
  })
})

describe("idfRelevance", () => {
  const idf = buildIdf(DOCS)

  it("scores 0 when no query term is present", () => {
    expect(idfRelevance("entirely unrelated prose", ["wildfire"], idf)).toBe(0)
  })

  it("scores 1 when every query term is present", () => {
    expect(idfRelevance("wildfire and billing", ["wildfire", "billing"], idf)).toBeCloseTo(1)
  })

  it("clears the divergence floor on one distinctive shared term", () => {
    const score = idfRelevance("a report about wildfire", ["wildfire", "platform"], idf)
    expect(score).toBeGreaterThanOrEqual(DIVERGENCE_IDF_FLOOR)
  })

  it("scores 0 for an empty query", () => {
    expect(idfRelevance("anything", [], idf)).toBe(0)
  })
})

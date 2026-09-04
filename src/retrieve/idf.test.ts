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

  it("keeps accented Latin and non-Latin scripts intact", () => {
    expect(tokenize("Café Kraków 東京")).toEqual(["café", "kraków", "東京"])
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

  // The discriminating half: the floor exists to REJECT generic-only overlap,
  // and that rejection sits only ~9% below the line. Without this the floor
  // could drift above a generic match and every test would still pass.
  it("keeps a generic-only shared term below the divergence floor", () => {
    const score = idfRelevance("we run a platform", ["wildfire", "platform"], idf)
    expect(score).toBeLessThan(DIVERGENCE_IDF_FLOOR)
  })

  it("scores 0 for an empty query", () => {
    expect(idfRelevance("anything", [], idf)).toBe(0)
  })
})

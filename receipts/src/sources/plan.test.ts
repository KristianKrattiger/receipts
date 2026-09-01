import { describe, expect, it } from "vitest"
import { buildSourcePlan, slugify } from "./plan.js"

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Cloud")).toBe("acme-cloud")
  })
  it("strips punctuation", () => {
    expect(slugify("Acme, Inc.")).toBe("acme-inc")
  })
})

describe("buildSourcePlan", () => {
  it("includes both vendor and independent roles", () => {
    const roles = new Set(buildSourcePlan("acme").targets.map((t) => t.role))
    expect(roles).toEqual(new Set(["vendor_claim", "independent"]))
  })

  it("derives vendor urls from an explicit domain", () => {
    const plan = buildSourcePlan("acme", { domain: "acme.dev" })
    expect(plan.targets.some((t) => t.url.includes("acme.dev"))).toBe(true)
  })

  it("guesses a .com domain when none is given", () => {
    expect(buildSourcePlan("acme").targets.some((t) => t.url.includes("acme.com"))).toBe(true)
  })

  it("appends extra targets", () => {
    const extra = {
      kind: "review_site", role: "independent",
      url: "https://g2.com/acme", label: "G2",
    } as const
    expect(buildSourcePlan("acme", { extra: [extra] }).targets).toContainEqual(extra)
  })

  it("produces unique urls", () => {
    const urls = buildSourcePlan("acme").targets.map((t) => t.url)
    expect(new Set(urls).size).toBe(urls.length)
  })
})

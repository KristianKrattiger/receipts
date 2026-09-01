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

  // A vendor name is often a common word; the domain is not. Searching the
  // name filled the corpus with off-topic results the relevance gate could not
  // reject, because they did lexically contain it.
  it("searches forums by domain rather than by vendor name", () => {
    const forums = buildSourcePlan("solari", { domain: "getsolari.com" }).targets
      .filter((target) => target.kind === "forum")
    expect(forums.length).toBeGreaterThan(0)
    for (const target of forums) {
      expect(target.url).toContain("getsolari.com")
    }
  })

  it("produces unique urls", () => {
    const urls = buildSourcePlan("acme").targets.map((t) => t.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  // The generated URLs are already all-distinct, so the assertion above passes
  // even with the dedup filter deleted. This is the case that needs it.
  it("drops an extra target that collides with a generated url", () => {
    const collision = {
      kind: "vendor_pricing", role: "vendor_claim",
      url: "https://acme.com/pricing", label: "duplicate of the generated one",
    } as const
    const targets = buildSourcePlan("acme", { extra: [collision] }).targets
    const matching = targets.filter((t) => t.url === "https://acme.com/pricing")
    expect(matching).toHaveLength(1)
    // First occurrence wins, so the generated target survives, not the extra.
    expect(matching[0]!.label).toBe("acme pricing")
  })

  // The design guarantee is that a plan can always yield a contradiction, which
  // needs both roles. Overrides are the paths most likely to break it.
  it("keeps both roles under every override path", () => {
    const extra = {
      kind: "forum", role: "independent",
      url: "https://example.com/thread", label: "thread",
    } as const
    for (const plan of [
      buildSourcePlan("acme"),
      buildSourcePlan("acme", { domain: "acme.dev" }),
      buildSourcePlan("acme", { extra: [extra] }),
      buildSourcePlan("acme", { domain: "acme.dev", extra: [extra] }),
    ]) {
      expect(new Set(plan.targets.map((t) => t.role))).toEqual(
        new Set(["vendor_claim", "independent"]),
      )
    }
  })
})

describe("buildSourcePlan — refuses an unsafe domain guess", () => {
  // "systems.com" and "cafcloud.com" are real registrable domains belonging to
  // someone else. Fetching one and filing it as this vendor's own claim is a
  // false attribution, not a visible bad guess.
  for (const subject of ["東京 Systems", "Café Cloud", "東京"]) {
    it(`throws rather than guess a domain for ${JSON.stringify(subject)}`, () => {
      expect(() => buildSourcePlan(subject)).toThrow(/cannot guess a domain/)
    })
  }

  it("proceeds once the domain is supplied explicitly", () => {
    const plan = buildSourcePlan("東京 Systems", { domain: "tokyo-systems.jp" })
    expect(plan.targets.some((t) => t.url === "https://tokyo-systems.jp")).toBe(true)
  })

  it("still guesses for a name whose punctuation is merely dropped", () => {
    expect(buildSourcePlan("Acme, Inc.").targets[0]!.url).toBe("https://acmeinc.com")
  })
})

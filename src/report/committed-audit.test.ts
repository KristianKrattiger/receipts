import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Refusal } from "../assay/types.js"
import type { Report } from "../types.js"

const REPORTS = fileURLToPath(new URL("../../reports/", import.meta.url))

// The published audit line is proposed · admitted · merged · denied, and a
// reader should be able to add it up. It once could not: proposed summed both
// samples while denied and passes were sample 0's, and Tesla's line left 48
// proposals unaccounted for. Every committed report, every time.
describe("committed reports", () => {
  const files = readdirSync(REPORTS).filter((f) => f.endsWith(".json")).sort()

  it("finds the reports the site publishes", () => {
    expect(files).toEqual(expect.arrayContaining(["chime.json", "claude.json", "tesla-fsd.json", "vercel.json"]))
  })

  for (const file of files) {
    it(`${file}: proposed = admitted + merged + denied`, () => {
      const { audit } = JSON.parse(readFileSync(join(REPORTS, file), "utf8")) as Report | Refusal
      expect(audit.proposed).toBe(audit.admitted + (audit.merged ?? 0) + audit.denied.length)
    })
  }
})

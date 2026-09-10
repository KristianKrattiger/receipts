import { describe, expect, it } from "vitest"
import { assertMatchingSubjects } from "./backfill-cli.js"

describe("assertMatchingSubjects — a fixture must belong to the report it backfills", () => {
  it("passes silently when both subjects match", () => {
    expect(() =>
      assertMatchingSubjects(
        { subject: "Tesla" }, { subject: "Tesla" },
        "fixtures/tesla.json", "reports/tesla-fsd.json",
      ),
    ).not.toThrow()
  })

  // The failure this guards: `backfill fixtures/vercel.json reports/tesla-fsd.json`
  // would otherwise stamp any docId that collides across subjects with foreign
  // bytes -- an unearned integrity baseline.
  it("refuses a mismatched subject, naming both subjects and both paths", () => {
    expect(() =>
      assertMatchingSubjects(
        { subject: "Vercel" }, { subject: "Tesla" },
        "fixtures/vercel.json", "reports/tesla-fsd.json",
      ),
    ).toThrow(/fixtures\/vercel\.json.*"Vercel".*reports\/tesla-fsd\.json.*"Tesla"/s)
  })
})

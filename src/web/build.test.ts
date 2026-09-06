import { describe, expect, it } from "vitest"
import { assertReport } from "./build.js"

describe("assertReport — a diagnostic file is not a claim-ledger report", () => {
  // The failure this guards: a probe file with its own "rows" of a different
  // shape crashed renderHtml with a bare TypeError naming neither the file
  // nor the reason, which silently broke every Pages deploy for two days.
  it("refuses an egress probe file by name", () => {
    const egressProbe = { measuredAt: "2026-09-05T00:00:00Z", rows: [{ host: "acme", status: 200 }] }
    expect(() => assertReport(egressProbe, "reports/egress-2026-09-05.json"))
      .toThrow(/reports\/egress-2026-09-05\.json.*"subject"/s)
  })

  it("refuses a captcha probe file, which has no rows at all", () => {
    const captchaProbe = { measuredAt: "2026-09-05T00:00:00Z", target: "https://g2.com", attempts: [] }
    expect(() => assertReport(captchaProbe, "reports/captcha-probe-2026-09-05.json")).toThrow()
  })

  it("refuses invalid JSON shapes without a name to blame", () => {
    expect(() => assertReport(null, "x.json")).toThrow(/not a JSON object/)
    expect(() => assertReport("just a string", "x.json")).toThrow(/not a JSON object/)
  })

  it("accepts a real report shape", () => {
    const report = { subject: "Acme", generatedAt: "2026-09-06T00:00:00Z", docs: [], failures: [], rows: [], audit: { proposed: 0, admitted: 0, denied: [] } }
    expect(() => assertReport(report, "reports/acme.json")).not.toThrow()
  })
})

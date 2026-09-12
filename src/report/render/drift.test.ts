import { describe, expect, it } from "vitest"
import type { DriftReport } from "../../types.js"
import { renderDriftReport } from "./drift.js"

const base: DriftReport = {
  subject: "Acme", priorGeneratedAt: "2026-09-01T00:00:00.000Z", checkedAt: "2026-09-11T00:00:00.000Z",
  docs: [
    { docId: "s", label: "Stable-declared docs", url: "https://a", stability: "stable", outcome: "stability-violated", priorDriftHash: "1", freshDriftHash: "2" },
    { docId: "d", label: "Status page", url: "https://b", stability: "volatile", outcome: "drifted", priorDriftHash: "3", freshDriftHash: "4" },
    { docId: "x", label: "G2", url: "https://c", stability: "volatile", outcome: "unreadable", priorDriftHash: "5", reason: "blocked" },
    { docId: "u", label: "Homepage", url: "https://d", stability: "volatile", outcome: "unchanged", priorDriftHash: "6", freshDriftHash: "6" },
    { docId: "p", label: "10-K", url: "https://e", stability: "stable", outcome: "from-store", priorDriftHash: "7" },
  ],
  vanished: [
    { topic: "uptime", statement: "claims 99.9%", docId: "d", label: "Status page", text: "we guarantee 99.9% uptime" },
  ],
  summary: { fromStore: 1, unchanged: 1, drifted: 1, stabilityViolated: 1, unreadable: 1, vanished: 1 },
}

describe("renderDriftReport", () => {
  it("leads with the subject, both timestamps and the summary line", () => {
    const out = renderDriftReport(base)
    expect(out).toContain("Acme — drift since 2026-09-01T00:00:00.000Z")
    expect(out).toContain("checked 2026-09-11T00:00:00.000Z")
    expect(out).toMatch(/1 stability violated · 1 quote vanished · 1 unreadable · 1 drifted · 1 unchanged · 1 from store/)
  })

  it("puts a stability violation before everything else", () => {
    const out = renderDriftReport(base)
    expect(out.indexOf("STABILITY VIOLATED")).toBeLessThan(out.indexOf("QUOTE VANISHED"))
    expect(out.indexOf("QUOTE VANISHED")).toBeLessThan(out.indexOf("UNREADABLE"))
    expect(out.indexOf("UNREADABLE")).toBeLessThan(out.indexOf("DRIFTED"))
  })

  it("prints the vanished quote verbatim with its topic and source", () => {
    const out = renderDriftReport(base)
    expect(out).toContain("uptime")
    expect(out).toContain("Status page")
    expect(out).toContain('"we guarantee 99.9% uptime"')
  })

  it("names the fetch reason for an unreadable document", () => {
    expect(renderDriftReport(base)).toMatch(/G2.*blocked/)
  })

  it("prints the fetch's detail under an unreadable document when it has one", () => {
    const withDetail: DriftReport = {
      ...base,
      docs: base.docs.map((d) =>
        d.docId === "x" ? { ...d, detail: "G2: DataDome challenge served [0 chars text, 2669 chars html]" } : d,
      ),
    }
    const out = renderDriftReport(withDetail)
    expect(out).toMatch(/G2  \(blocked\)\n[ \t]+G2: DataDome challenge served/)
    // Absent detail prints nothing extra: the reason line stands alone.
    expect(renderDriftReport(base)).not.toMatch(/\(blocked\)\n[ \t]+\S/)
  })

  it("omits a section entirely when it is empty", () => {
    const quiet: DriftReport = {
      ...base,
      docs: base.docs.filter((d) => d.outcome === "unchanged"),
      vanished: [],
      summary: { fromStore: 0, unchanged: 1, drifted: 0, stabilityViolated: 0, unreadable: 0, vanished: 0 },
    }
    const out = renderDriftReport(quiet)
    expect(out).not.toContain("STABILITY VIOLATED")
    expect(out).not.toContain("QUOTE VANISHED")
    expect(out).toContain("nothing drifted")
  })
})

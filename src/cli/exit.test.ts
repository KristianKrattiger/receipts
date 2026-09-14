import { describe, expect, it } from "vitest"
import { exitCodeFor } from "./exit.js"
import type { Ledger, Refusal } from "../assay/types.js"
import type { Report } from "../types.js"

const ledger: Ledger = {
  outcome: "ledger",
  subject: "Acme",
  generatedAt: "2026-01-01T00:00:00.000Z",
  docs: [],
  failures: [],
  rows: [],
  audit: {
    proposed: 0, admitted: 0, denied: [],
    claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [],
    independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, contextUnverified: 0,
  },
}

const refusal: Refusal = {
  outcome: "refusal",
  subject: "Acme",
  generatedAt: "2026-01-01T00:00:00.000Z",
  reason: "CORPUS_INSUFFICIENT",
  detail: "no independent source was read",
  docs: [],
  failures: [],
  nearMiss: [],
  audit: {
    proposed: 0, admitted: 0, denied: [],
    claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [],
    independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, contextUnverified: 0,
  },
}

// A legacy report from disk predates `outcome` entirely — the field is not
// even optional on `Report`. This is exactly what `--render` loads from
// reports/*.json, so exitCodeFor must accept it without a cast.
const legacyReport: Report = {
  subject: "Acme",
  generatedAt: "2026-01-01T00:00:00.000Z",
  docs: [],
  failures: [],
  rows: [],
  audit: { proposed: 0, admitted: 0, denied: [] },
}

describe("exitCodeFor", () => {
  it("returns 0 for a ledger", () => {
    expect(exitCodeFor(ledger)).toBe(0)
  })
  it("returns 3 for a refusal", () => {
    expect(exitCodeFor(refusal)).toBe(3)
  })
  it("treats a legacy report with no outcome as a ledger", () => {
    expect(exitCodeFor(legacyReport)).toBe(0)
  })
})

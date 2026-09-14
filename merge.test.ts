import { describe, expect, it } from "vitest"
import { mergeRuns, passIdOf, rowKey, type MergeMeta } from "./merge.js"
import type { AssayResult, LedgerRow, PinnedDoc } from "./types.js"

function span(docId: string, start = 0): LedgerRow["sides"][0] {
  return { docId, start, end: start + 5, text: "quote", tag: "EXACT" }
}

function row(over: Partial<LedgerRow> & Pick<LedgerRow, "topic">): LedgerRow {
  return {
    statement: over.statement ?? `${over.topic} claim`,
    status: over.status ?? "unverified",
    relation: over.relation ?? "unsupported",
    sides: over.sides ?? [span("a")],
    ...over,
  }
}

function pdoc(over: Partial<PinnedDoc> = {}): PinnedDoc {
  const text = over.text ?? "hello"
  return {
    docId: "a", url: "https://a.example", label: "A", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-12T00:00:00.000Z", title: "T",
    text, stability: "stable", pin: { kind: "permalink", url: "https://a.example", sha256: "aa" },
    driftHash: "drift", ...over,
  }
}

const docs: PinnedDoc[] = [
  pdoc({ docId: "a", role: "claimant", stability: "stable" }),
  pdoc({ docId: "b", role: "independent", stability: "stable" }),
]

function ledger(rows: LedgerRow[], over: Partial<Extract<AssayResult, { outcome: "ledger" }>> = {}): AssayResult {
  return {
    outcome: "ledger",
    subject: "Acme",
    generatedAt: "2026-09-12T00:00:00.000Z",
    docs: docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
      kind: d.kind, stability: d.stability, pin: d.pin, driftHash: d.driftHash,
    })),
    failures: [],
    rows,
    audit: { proposed: rows.length, admitted: rows.length, denied: [], passes: 2, claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [], independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, contextUnverified: 0 },
    ...over,
  }
}

function refusal(): AssayResult {
  return {
    outcome: "refusal",
    subject: "Acme",
    generatedAt: "2026-09-12T00:00:00.000Z",
    reason: "BELOW_THRESHOLD",
    detail: "none cleared",
    docs: [],
    failures: [],
    nearMiss: [],
    audit: { proposed: 3, admitted: 0, denied: [], passes: 2, claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [], independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, contextUnverified: 0 },
  }
}

const uptime = row({ topic: "uptime", sides: [span("a", 10)] })
const safety = row({ topic: "safety", sides: [span("a", 20), span("b", 3)] })

function meta(rows: LedgerRow[], passIds: string[]): MergeMeta[] {
  return rows.map((r, i) => ({ rowKey: rowKey(r), passId: passIds[i]! }))
}

describe("rowKey", () => {
  it("ignores side order and ignores statement", () => {
    const a = row({ topic: "t", sides: [span("b", 2), span("a", 1)] })
    const b = row({ topic: "t", statement: "other", sides: [span("a", 1), span("b", 2)] })
    expect(rowKey(a)).toBe(rowKey(b))
  })

  it("changes with topic, docId, or start", () => {
    const base = rowKey(uptime)
    expect(rowKey(row({ topic: "other", sides: uptime.sides }))).not.toBe(base)
    expect(rowKey(row({ topic: "uptime", sides: [span("a", 11)] }))).not.toBe(base)
    expect(rowKey(row({ topic: "uptime", sides: [span("z", 10)] }))).not.toBe(base)
  })
})

describe("passIdOf", () => {
  it("reads the prefix before the first colon, or all", () => {
    expect(passIdOf("b:p0")).toBe("b")
    expect(passIdOf("unsupported:p3")).toBe("unsupported")
    expect(passIdOf("p0")).toBe("all")
  })
})

describe("mergeRuns", () => {
  const bothMeta = {
    admittedA: meta([uptime, safety], ["b", "unsupported"]),
    admittedB: meta([uptime, safety], ["b", "unsupported"]),
    failuresA: [] as { passId: string }[],
    failuresB: [] as { passId: string }[],
    docs,
  }

  it("stamps a row present in both runs stable", () => {
    const r = mergeRuns(ledger([uptime, safety]), ledger([uptime, safety]), bothMeta)
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows.every((row) => row.provenance?.class === "stable")).toBe(true)
    expect(r.rows.every((row) => row.provenance?.reasons.length === 0)).toBe(true)
  })

  it("stamps a row present in one run provisional + single-proposer-run", () => {
    const r = mergeRuns(
      ledger([uptime, safety]),
      ledger([uptime]),
      {
        ...bothMeta,
        admittedB: meta([uptime], ["b"]),
      },
    )
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const safetyRow = r.rows.find((x) => x.topic === "safety")!
    expect(safetyRow.provenance).toEqual({ class: "provisional", reasons: ["single-proposer-run"] })
    const uptimeRow = r.rows.find((x) => x.topic === "uptime")!
    expect(uptimeRow.provenance?.class).toBe("stable")
  })

  it("downgrades a stable row whose side is volatile", () => {
    const volatileDocs = [pdoc({ docId: "a", stability: "volatile" }), pdoc({ docId: "b", stability: "stable" })]
    const r = mergeRuns(ledger([uptime]), ledger([uptime]), {
      admittedA: meta([uptime], ["b"]),
      admittedB: meta([uptime], ["b"]),
      failuresA: [],
      failuresB: [],
      docs: volatileDocs,
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows[0]!.provenance).toEqual({ class: "provisional", reasons: ["volatile-source"] })
  })

  it("adds stability-violated from the caller-supplied set", () => {
    const r = mergeRuns(ledger([uptime]), ledger([uptime]), {
      ...bothMeta,
      admittedA: meta([uptime], ["b"]),
      admittedB: meta([uptime], ["b"]),
      stabilityViolated: new Set(["a"]),
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows[0]!.provenance?.class).toBe("provisional")
    expect(r.rows[0]!.provenance?.reasons).toContain("stability-violated")
  })

  it("tags a pass that failed in the other run as pass-failed, not single-proposer-run", () => {
    const r = mergeRuns(
      ledger([uptime, safety]),
      ledger([uptime]),
      {
        admittedA: meta([uptime, safety], ["b", "unsupported"]),
        admittedB: meta([uptime], ["b"]),
        failuresA: [],
        failuresB: [{ passId: "unsupported" }],
        docs,
      },
    )
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    const safetyRow = r.rows.find((x) => x.topic === "safety")!
    expect(safetyRow.provenance).toEqual({ class: "provisional", reasons: ["pass-failed"] })
  })

  it("keeps the ledger and sets runDisagreement when the other sample is BELOW_THRESHOLD", () => {
    const r = mergeRuns(ledger([uptime]), refusal(), {
      admittedA: meta([uptime], ["b"]),
      admittedB: [],
      failuresA: [],
      failuresB: [],
      docs,
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.audit.runDisagreement).toBe(true)
    expect(r.rows[0]!.provenance?.class).toBe("provisional")
  })

  it("is deterministic: two merges of the same inputs are strictly equal", () => {
    const a = ledger([safety, uptime])
    const b = ledger([uptime, safety])
    const first = mergeRuns(a, b, bothMeta)
    const second = mergeRuns(a, b, bothMeta)
    expect(first).toEqual(second)
  })

  it("recounts context_unverified from the union, not sample 0's audit", () => {
    const marked = row({
      topic: "uptime", status: "corroborated", relation: "corroborates",
      sides: [span("a", 10), span("b", 1)],
    })
    const unmarked = row({
      topic: "safety", status: "context_unverified", relation: "corroborates",
      sides: [span("a", 20), span("b", 3)],
    })
    const r = mergeRuns(
      ledger([marked]),
      ledger([marked, unmarked]),
      {
        admittedA: meta([marked], ["b"]),
        admittedB: meta([marked, unmarked], ["b", "unsupported"]),
        failuresA: [],
        failuresB: [],
        docs,
      },
    )
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows.filter((x) => x.status === "context_unverified")).toHaveLength(1)
    expect(r.audit.contextUnverified).toBe(1)
  })
})

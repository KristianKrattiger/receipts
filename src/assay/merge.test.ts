import { describe, expect, it } from "vitest"
import { mergeRuns, passIdOf, rowKey, type MergeMeta } from "./merge.js"
import type { Admission, AssayResult, LedgerRow, PinnedDoc } from "./types.js"

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
    audit: { proposed: rows.length, admitted: rows.length, denied: [], passes: 2, claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [], independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0, disputed: 0 },
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
    audit: { proposed: 3, admitted: 0, denied: [], passes: 2, claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [], independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0, disputed: 0 },
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

  // The topic is model-written, like the statement. On the 2026-09-30 Tesla
  // run the two samples labeled the same quote pair "FSD pricing" and "FSD
  // subscription price", and keying on topic split one finding into two rows.
  it("ignores topic", () => {
    expect(rowKey(row({ topic: "FSD pricing", sides: uptime.sides })))
      .toBe(rowKey(row({ topic: "FSD subscription price", sides: uptime.sides })))
  })

  it("changes with relation, docId, or start", () => {
    const base = rowKey(uptime)
    expect(rowKey(row({ topic: "uptime", relation: "contradicts", sides: uptime.sides }))).not.toBe(base)
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

  it("merges the same quotes and relation under different topics into one stable row, sample 0's body", () => {
    const priced = row({ topic: "FSD pricing", sides: [span("a", 40)] })
    const relabeled = row({ topic: "FSD subscription price", statement: "reworded", sides: [span("a", 40)] })
    const r = mergeRuns(ledger([priced]), ledger([relabeled]), {
      ...bothMeta,
      admittedA: meta([priced], ["unsupported"]),
      admittedB: meta([relabeled], ["unsupported"]),
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.topic).toBe("FSD pricing")
    expect(r.rows[0]!.provenance?.class).toBe("stable")
  })

  it("keeps two rows when the samples pair the same quotes under different relations", () => {
    const against = row({ topic: "t", relation: "contradicts", status: "divergent", sides: [span("a", 20), span("b", 3)] })
    const agrees = row({ topic: "t", relation: "corroborates", status: "corroborated", sides: [span("a", 20), span("b", 3)] })
    const r = mergeRuns(ledger([against]), ledger([agrees]), {
      ...bothMeta,
      admittedA: meta([against], ["b"]),
      admittedB: meta([agrees], ["b"]),
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows).toHaveLength(2)
    expect(r.rows.every((x) => x.provenance?.reasons.includes("single-proposer-run"))).toBe(true)
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

  it("recounts disputed from the union, not sample 0's audit", () => {
    const marked = row({
      topic: "uptime", status: "divergent", relation: "contradicts",
      sides: [span("a", 10), span("b", 1)],
    })
    const unmarked = row({
      topic: "safety", status: "disputed", relation: "contradicts",
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
    expect(r.rows.filter((x) => x.status === "disputed")).toHaveLength(1)
    expect(r.audit.disputed).toBe(1)
  })

  it("recounts independentDocsAdmitted and claimantCoverage from the union", () => {
    const corpDocs: PinnedDoc[] = [
      pdoc({
        docId: "a", role: "claimant",
        text: "First claim paragraph.\n\nSecond claim paragraph.",
      }),
      pdoc({ docId: "b", role: "independent", text: "status quote" }),
      pdoc({ docId: "c", role: "independent", text: "forum quote" }),
    ]
    const first = "First claim paragraph."
    const second = "Second claim paragraph."
    const onlyA = row({
      topic: "uptime", status: "corroborated", relation: "corroborates",
      sides: [
        { docId: "a", start: 0, end: first.length, text: first, tag: "EXACT" },
        { docId: "b", start: 0, end: 6, text: "status", tag: "EXACT" },
      ],
    })
    const onlyB = row({
      topic: "safety", status: "corroborated", relation: "corroborates",
      sides: [
        {
          docId: "a",
          start: first.length + 2,
          end: first.length + 2 + second.length,
          text: second,
          tag: "EXACT",
        },
        { docId: "c", start: 0, end: 5, text: "forum", tag: "EXACT" },
      ],
    })
    const sample0 = ledger([onlyA], {
      docs: corpDocs.map((d) => ({
        docId: d.docId, url: d.url, label: d.label, role: d.role, fetchedAt: d.fetchedAt,
        kind: d.kind, stability: d.stability, pin: d.pin, driftHash: d.driftHash,
      })),
      audit: {
        proposed: 1, admitted: 1, denied: [], passes: 2,
        claimantChunks: 2, claimantCovered: 1, claimantOmitted: 1,
        claimantOmittedPreviews: [second],
        independentDocsTotal: 2, independentDocsAdmitted: 1,
        issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0, disputed: 0,
      },
    })
    const sample1 = ledger([onlyA, onlyB], {
      docs: sample0.outcome === "ledger" ? sample0.docs : [],
      audit: {
        proposed: 2, admitted: 2, denied: [], passes: 2,
        claimantChunks: 2, claimantCovered: 2, claimantOmitted: 0,
        claimantOmittedPreviews: [],
        independentDocsTotal: 2, independentDocsAdmitted: 2,
        issueStatementDenied: 0, holdingCompetitorDenied: 0, contextUnverified: 0, disputed: 0,
      },
    })
    const r = mergeRuns(sample0, sample1, {
      admittedA: meta([onlyA], ["b"]),
      admittedB: meta([onlyA, onlyB], ["b", "c"]),
      failuresA: [],
      failuresB: [],
      docs: corpDocs,
    })
    expect(r.outcome).toBe("ledger")
    if (r.outcome !== "ledger") return
    expect(r.rows).toHaveLength(2)
    expect(r.audit.independentDocsTotal).toBe(2)
    expect(r.audit.independentDocsAdmitted).toBe(2)
    expect(r.audit.claimantChunks).toBe(2)
    expect(r.audit.claimantCovered).toBe(2)
    expect(r.audit.claimantOmitted).toBe(0)
    expect(r.audit.claimantOmittedPreviews).toEqual([])
  })
})

describe("mergeRuns audit", () => {
  const deny = (proposalId: string): Admission => ({ proposalId, code: "LOW_CONFIDENCE", detail: "0.2 — hedge", confidence: 0.2 })
  function addsUp(r: AssayResult): void {
    expect(r.audit.proposed).toBe(r.audit.admitted + (r.audit.merged ?? 0) + r.audit.denied.length)
  }
  function sampleLedger(rows: LedgerRow[], denied: Admission[]): AssayResult {
    const base = ledger(rows)
    return { ...base, audit: { ...base.audit, proposed: rows.length + denied.length, denied, passes: 2 } }
  }
  function sampleRefusal(denied: Admission[]): AssayResult {
    const base = refusal()
    return { ...base, audit: { ...base.audit, proposed: denied.length, denied, passes: 2 } }
  }

  it("sums proposed, denied and passes across both samples and counts a row both admitted as merged", () => {
    const a = sampleLedger([uptime, safety], [deny("b:p1"), deny("b:p2")])
    const b = sampleLedger([uptime], [deny("b:p1"), deny("all:p0")])
    const r = mergeRuns(a, b, {
      admittedA: meta([uptime, safety], ["b", "b"]), admittedB: meta([uptime], ["b"]),
      failuresA: [], failuresB: [], docs,
    })
    expect(r.audit).toMatchObject({ proposed: 7, admitted: 2, merged: 1, passes: 4 })
    expect(r.audit.denied.map((d) => [d.proposalId, d.sample])).toEqual([
      ["b:p1", 0], ["b:p2", 0], ["b:p1", 1], ["all:p0", 1],
    ])
    addsUp(r)
  })

  it("still adds up when one sample refuses", () => {
    const a = sampleLedger([uptime], [deny("b:p1")])
    const b = sampleRefusal([deny("b:p0"), deny("b:p1"), deny("all:p0")])
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const r = mergeRuns(x, y, { admittedA: meta([uptime], ["b"]), admittedB: [], failuresA: [], failuresB: [], docs })
      expect(r.outcome).toBe("ledger")
      expect(r.audit).toMatchObject({ proposed: 5, admitted: 1, merged: 0, passes: 4 })
      addsUp(r)
    }
  })

  it("still adds up when both samples refuse", () => {
    const r = mergeRuns(sampleRefusal([deny("b:p0")]), sampleRefusal([deny("b:p0"), deny("b:p1")]), {
      admittedA: [], admittedB: [], failuresA: [], failuresB: [], docs,
    })
    expect(r.outcome).toBe("refusal")
    expect(r.audit).toMatchObject({ proposed: 3, admitted: 0, merged: 0, passes: 4 })
    addsUp(r)
  })
})

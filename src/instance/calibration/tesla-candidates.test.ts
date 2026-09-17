import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { selectForRun } from "../../assay/index.js"
import { toPinnedCorpus } from "../../provenance/adapt.js"
import { getSnapshot } from "../../provenance/snapshots.js"
import type { Report } from "../../types.js"
import { receipts } from "../profile.js"

/**
 * The 2026-09-14 Tesla restamp shipped with a candidate set in which the
 * 10-K's five slots held no FSD text at all, and nothing said so until a
 * reviewer counted. This reads the committed snapshots and counts.
 */
describe("Tesla candidate set under the Receipts profile", () => {
  it("gives the 10-K at least one FSD-relevant candidate", () => {
    const saved = JSON.parse(readFileSync("reports/tesla-fsd.json", "utf8")) as Report
    const docs = saved.docs.map((d) => ({
      docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind!,
      fetchedAt: d.fetchedAt, title: d.label, text: getSnapshot(d.pin!.sha256).content,
    }))
    const corpus = toPinnedCorpus({ subject: saved.subject, docs, failures: [] }, { isStored: () => true })
    const tenK = corpus.docs.find((d) => /10-K/.test(d.label))
    expect(tenK).toBeDefined()
    const picked = selectForRun(corpus, saved.subject, receipts("frontier").retrieval, 40)
    const fromTenK = picked.filter((c) => c.docId === tenK!.docId)
    expect(fromTenK.length).toBeGreaterThan(0)
    expect(fromTenK.some((c) => /full self-driving|driver assist/i.test(c.text))).toBe(true)
  })
})

import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getSnapshot } from "./snapshots.js"
import { storeCorpus } from "./store.js"
import type { Corpus, FetchedDoc } from "../types.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "store-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://a.example", label: "A", role: "claimant",
    kind: "vendor_site", fetchedAt: "2026-09-11T00:00:00.000Z", title: "A",
    text: "hello world", ...over,
  }
}

const corpus = (docs: FetchedDoc[]): Corpus => ({ subject: "X", docs, failures: [] })

describe("storeCorpus", () => {
  it("writes one blob per document and returns the ids in order", () => {
    const ids = storeCorpus(corpus([doc({ docId: "a" }), doc({ docId: "b", text: "second" })]), dir)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it("stores each document's own url and fetchedAt with its bytes", () => {
    const ids = storeCorpus(corpus([doc({ url: "https://z.example", fetchedAt: "2027-01-01T00:00:00.000Z" })]), dir)
    expect(getSnapshot(ids[0]!, dir)).toEqual({
      url: "https://z.example", fetchedAt: "2027-01-01T00:00:00.000Z", content: "hello world",
    })
  })

  it("deduplicates two documents with identical text into one blob", () => {
    const ids = storeCorpus(corpus([doc({ docId: "a" }), doc({ docId: "b" })]), dir)
    expect(ids[0]).toBe(ids[1])
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it("returns an empty list and writes nothing for an empty corpus", () => {
    expect(storeCorpus(corpus([]), dir)).toEqual([])
    expect(readdirSync(dir)).toHaveLength(0)
  })

  it("returns ids that are the sha256 of each document's own text", () => {
    const ids = storeCorpus(corpus([doc({ text: "hello world" })]), dir)
    expect(getSnapshot(ids[0]!, dir).content).toBe("hello world")
  })
})

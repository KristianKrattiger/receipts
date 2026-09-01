import { describe, expect, it } from "vitest"
import { chunkAll, chunkDoc } from "./chunk.js"
import type { FetchedDoc } from "../types.js"

function doc(text: string, docId = "d1"): FetchedDoc {
  return {
    docId, url: "https://example.com", label: "Example",
    role: "vendor_claim", kind: "vendor_site",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: "Example",
    text, sessionId: "s1",
  }
}

describe("chunkDoc", () => {
  it("splits on paragraph breaks", () => {
    const chunks = chunkDoc(doc("first para\n\nsecond para"))
    expect(chunks.map((c) => c.text)).toEqual(["first para", "second para"])
  })

  it("produces offsets that round-trip against the source text", () => {
    const d = doc("alpha beta\n\ngamma delta\n\nepsilon")
    for (const c of chunkDoc(d)) {
      expect(d.text.slice(c.start, c.end)).toBe(c.text)
    }
  })

  it("round-trips when a paragraph repeats verbatim", () => {
    const d = doc("repeated\n\nunique\n\nrepeated")
    const chunks = chunkDoc(d)
    expect(chunks).toHaveLength(3)
    for (const c of chunks) {
      expect(d.text.slice(c.start, c.end)).toBe(c.text)
    }
    expect(chunks[0]!.start).not.toBe(chunks[2]!.start)
  })

  it("hard-splits paragraphs longer than maxChars", () => {
    const d = doc("x".repeat(250))
    const chunks = chunkDoc(d, 100)
    expect(chunks).toHaveLength(3)
    for (const c of chunks) {
      expect(d.text.slice(c.start, c.end)).toBe(c.text)
    }
  })

  it("skips blank paragraphs", () => {
    expect(chunkDoc(doc("a\n\n\n\nb"))).toHaveLength(2)
  })

  it("assigns chunk ids namespaced by doc", () => {
    expect(chunkDoc(doc("a\n\nb"))[1]!.chunkId).toBe("d1:1")
  })
})

describe("chunkAll", () => {
  it("chunks every document", () => {
    const chunks = chunkAll([doc("a\n\nb", "d1"), doc("c", "d2")])
    expect(chunks.map((c) => c.docId)).toEqual(["d1", "d1", "d2"])
  })
})

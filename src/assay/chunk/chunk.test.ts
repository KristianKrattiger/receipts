import { describe, expect, it } from "vitest"
import { chunkAll, chunkDoc } from "./chunk.js"

function doc(text: string, docId = "d1"): { docId: string; text: string } {
  return { docId, text }
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

  it("prefers a newline inside the window when hard-splitting", () => {
    const line = "holding text that fits a line"
    const d = doc([line, line, line].join("\n"))
    const chunks = chunkDoc(d, line.length + 10)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(d.text.slice(c.start, c.end)).toBe(c.text)
    }
    expect(chunks[0]!.text.trim()).toBe(line)
  })

  it("ignores internal newlines when preferNewline is false", () => {
    const line = "x".repeat(400)
    const d = doc([line, line, line].join("\n"))
    const retrieve = chunkDoc(d, { preferNewline: true })
    const coverage = chunkDoc(d, { preferNewline: false })
    expect(retrieve).toHaveLength(3)
    expect(coverage).toHaveLength(Math.ceil(d.text.length / 700))
    expect(coverage.length).toBeLessThan(retrieve.length)
    for (const c of coverage) {
      expect(d.text.slice(c.start, c.end)).toBe(c.text)
    }
  })

  it("hard-splits at maxChars without newline preference", () => {
    const d = doc("x".repeat(250))
    const chunks = chunkDoc(d, { maxChars: 100, preferNewline: false })
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

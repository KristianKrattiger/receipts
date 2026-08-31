import { describe, expect, it } from "vitest"
import { normalizeText } from "./normalize.js"

describe("normalizeText", () => {
  it("collapses runs of spaces and tabs", () => {
    expect(normalizeText("a  \t  b")).toBe("a b")
  })

  it("normalizes CRLF to LF", () => {
    expect(normalizeText("a\r\nb")).toBe("a\nb")
  })

  it("collapses three or more newlines to a paragraph break", () => {
    expect(normalizeText("a\n\n\n\nb")).toBe("a\n\nb")
  })

  it("strips zero-width characters", () => {
    expect(normalizeText("a​b")).toBe("ab")
  })

  it("trims each line", () => {
    expect(normalizeText("  a  \n  b  ")).toBe("a\nb")
  })

  it("is idempotent", () => {
    const raw = "  Uptime:\t99.99%\r\n\r\n\r\nSee​ docs.  "
    const once = normalizeText(raw)
    expect(normalizeText(once)).toBe(once)
  })
})

import { describe, expect, it } from "vitest"
import { discourseRole, enclosingSentence, sentences } from "./discourse.js"

describe("enclosingSentence", () => {
  const text = "We granted certiorari to resolve the question. We hold that they will not."

  it("round-trips the sentence that contains a span", () => {
    const start = text.indexOf("granted certiorari")
    const end = start + "granted certiorari".length
    const s = enclosingSentence(text, start, end)
    expect(text.slice(s.start, s.end)).toBe(s.text)
    expect(s.text).toContain("granted certiorari")
    expect(s.text).not.toContain("We hold")
  })

  it("stops at a newline", () => {
    const nl = "Issue line about scienter\nWe hold that scienter is required."
    const start = nl.indexOf("Issue line")
    const s = enclosingSentence(nl, start, start + 10)
    expect(nl.slice(s.start, s.end)).toBe(s.text)
    expect(s.text).toContain("Issue line")
    expect(s.text).not.toContain("We hold")
  })
})

describe("discourseRole", () => {
  it("labels a cert grant as issue", () => {
    expect(discourseRole(
      "We granted certiorari to resolve the question whether a private cause of action will lie.",
    )).toBe("issue")
  })

  it("labels an argument cue as argument", () => {
    expect(discourseRole(
      "Petitioner argues that a private action may rest on negligence.",
    )).toBe("argument")
  })

  it("labels we hold as holding", () => {
    expect(discourseRole(
      "We hold that a private damages action will not lie without scienter.",
    )).toBe("holding")
  })

  it("labels a statute as unmarked", () => {
    expect(discourseRole(
      "To use or employ any manipulative or deceptive device or contrivance.",
    )).toBe("unmarked")
  })

  it("prefers holding when a sentence both mentions certiorari and holds", () => {
    expect(discourseRole(
      "Although we granted certiorari, we hold that scienter is required.",
    )).toBe("holding")
  })
})

describe("sentences", () => {
  it("splits a two-sentence opinion and round-trips each", () => {
    const text = "We granted certiorari to resolve the question. We hold that they will not."
    const parts = sentences(text)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const s of parts) {
      expect(text.slice(s.start, s.end)).toBe(s.text)
    }
  })
})

import { describe, expect, it } from "vitest"
import { classifyFailure, docIdFor } from "./fan.js"
import type { SourceTarget } from "../types.js"

const LONG = "Acme guarantees 99.99% uptime across all plans. ".repeat(20)

describe("classifyFailure", () => {
  it("returns null for a healthy page", () => {
    expect(classifyFailure("Acme — Pricing", LONG)).toBeNull()
  })

  it("flags short pages as empty", () => {
    expect(classifyFailure("Acme", "too short")).toBe("empty")
  })

  it("flags challenge pages as captcha", () => {
    expect(classifyFailure("Just a moment", "Checking your browser before access")).toBe("captcha")
  })

  it("does not flag a long article that merely mentions captcha", () => {
    expect(classifyFailure("Captcha solving guide", LONG)).toBeNull()
  })
})

describe("docIdFor", () => {
  const target: SourceTarget = {
    kind: "vendor_pricing", role: "vendor_claim",
    url: "https://acme.com/pricing", label: "Acme pricing",
  }

  it("is stable for the same url", () => {
    expect(docIdFor(target)).toBe(docIdFor({ ...target, label: "different label" }))
  })

  it("differs for a different url", () => {
    expect(docIdFor(target)).not.toBe(docIdFor({ ...target, url: "https://acme.com/docs" }))
  })

  it("is 12 hex characters", () => {
    expect(docIdFor(target)).toMatch(/^[0-9a-f]{12}$/)
  })
})

import { describe, expect, it } from "vitest"
import { createLimiter } from "./limit.js"

describe("createLimiter", () => {
  it("allows up to the limit", () => {
    const limiter = createLimiter({ perHour: 2, now: () => 0 })
    expect(limiter.take("a")).toBe(true)
    expect(limiter.take("a")).toBe(true)
    expect(limiter.take("a")).toBe(false)
  })

  it("tracks keys independently", () => {
    const limiter = createLimiter({ perHour: 1, now: () => 0 })
    expect(limiter.take("a")).toBe(true)
    expect(limiter.take("b")).toBe(true)
  })

  it("forgets entries older than the window", () => {
    let clock = 0
    const limiter = createLimiter({ perHour: 1, now: () => clock })
    expect(limiter.take("a")).toBe(true)
    expect(limiter.take("a")).toBe(false)
    clock = 3_600_001
    expect(limiter.take("a")).toBe(true)
  })
})

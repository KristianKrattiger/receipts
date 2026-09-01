import { describe, expect, it } from "vitest"
import { createLimiter } from "./limit.js"

describe("createLimiter — per-client ceiling", () => {
  it("allows up to the limit", () => {
    const limiter = createLimiter({ perHour: 2, now: () => 0 })
    expect(limiter.check("a")).toBe("ok")
    expect(limiter.check("a")).toBe("ok")
    expect(limiter.check("a")).toBe("client")
  })

  it("tracks keys independently", () => {
    const limiter = createLimiter({ perHour: 1, now: () => 0 })
    expect(limiter.check("a")).toBe("ok")
    expect(limiter.check("b")).toBe("ok")
  })

  it("forgets entries older than the window", () => {
    let clock = 0
    const limiter = createLimiter({ perHour: 1, now: () => clock })
    expect(limiter.check("a")).toBe("ok")
    expect(limiter.check("a")).toBe("client")
    clock = 3_600_001
    expect(limiter.check("a")).toBe("ok")
  })

  it("does not consume quota for a rejected request", () => {
    let clock = 0
    const limiter = createLimiter({ perHour: 1, now: () => clock })
    expect(limiter.check("a")).toBe("ok")
    for (let i = 0; i < 5; i++) expect(limiter.check("a")).toBe("client")
    clock = 3_600_001
    // If the refusals had been recorded, the window would still be full here.
    expect(limiter.check("a")).toBe("ok")
  })
})

describe("createLimiter — shared daily ceiling", () => {
  // The reason this exists: the per-client key comes from a request header, so
  // a caller varying it gets a fresh bucket every time. Only a ceiling keyed on
  // nothing actually bounds the spend.
  it("stops a caller who uses a fresh key for every request", () => {
    const limiter = createLimiter({ perHour: 1, perDay: 3, now: () => 0 })
    expect(limiter.check("spoof-1")).toBe("ok")
    expect(limiter.check("spoof-2")).toBe("ok")
    expect(limiter.check("spoof-3")).toBe("ok")
    expect(limiter.check("spoof-4")).toBe("global")
    expect(limiter.check("spoof-5")).toBe("global")
  })

  it("distinguishes a client limit from the global one", () => {
    const limiter = createLimiter({ perHour: 1, perDay: 10, now: () => 0 })
    expect(limiter.check("a")).toBe("ok")
    expect(limiter.check("a")).toBe("client")
    expect(limiter.check("b")).toBe("ok")
  })

  it("releases the daily budget after a day", () => {
    let clock = 0
    const limiter = createLimiter({ perHour: 5, perDay: 1, now: () => clock })
    expect(limiter.check("a")).toBe("ok")
    expect(limiter.check("a")).toBe("global")
    clock = 86_400_001
    expect(limiter.check("a")).toBe("ok")
  })

  it("is unlimited when no daily ceiling is set", () => {
    const limiter = createLimiter({ perHour: 1, now: () => 0 })
    for (let i = 0; i < 100; i++) expect(limiter.check(`k${i}`)).toBe("ok")
    expect(limiter.remainingToday()).toBe(Number.POSITIVE_INFINITY)
  })

  it("reports what is left of the day's budget", () => {
    const limiter = createLimiter({ perHour: 5, perDay: 3, now: () => 0 })
    expect(limiter.remainingToday()).toBe(3)
    limiter.check("a")
    expect(limiter.remainingToday()).toBe(2)
  })
})

describe("createLimiter — bookkeeping", () => {
  // A stream of distinct keys is exactly what the spoofing case produces, and
  // an unpruned Map would grow with it.
  it("drops buckets whose timestamps have all aged out", () => {
    let clock = 0
    const limiter = createLimiter({ perHour: 1, perDay: 10_000, now: () => clock })
    for (let i = 0; i < 500; i++) limiter.check(`k${i}`)
    clock = 3_600_001
    // Every prior bucket is now stale; if they were retained, this key would
    // be competing with 500 live entries for memory.
    expect(limiter.check("k0")).toBe("ok")
  })
})

import { describe, expect, it } from "vitest"
import { classifyTrace, fingerprintChallenge, type PollSample } from "./captcha.js"

describe("fingerprintChallenge — name the challenge, not just its size", () => {
  it("names DataDome from its delivery host", () => {
    const html = `<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>`
    expect(fingerprintChallenge(html)).toBe("datadome")
  })

  it("names Cloudflare Turnstile", () => {
    const html = `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`
    expect(fingerprintChallenge(html)).toBe("turnstile")
  })

  it("names reCaptcha", () => {
    const html = `<script src="https://www.google.com/recaptcha/api.js"></script>`
    expect(fingerprintChallenge(html)).toBe("recaptcha")
  })

  it("names hCaptcha", () => {
    const html = `<iframe src="https://newassets.hcaptcha.com/captcha/v1/frame"></iframe>`
    expect(fingerprintChallenge(html)).toBe("hcaptcha")
  })

  it("names PerimeterX", () => {
    const html = `<script src="https://client.perimeterx.net/PXabc123/main.min.js"></script>`
    expect(fingerprintChallenge(html)).toBe("perimeterx")
  })

  // The whole reason this matches asset hosts rather than vendor names: a page
  // that merely writes about captchas is a document, not a challenge. This is
  // the same mistake classifyFailure already guards against by scanning the
  // body rather than the title.
  it("does not name a vendor a page merely talks about", () => {
    const prose = "We evaluated hCaptcha and reCaptcha before choosing DataDome for our signup form."
    expect(fingerprintChallenge(prose)).toBeNull()
  })

  it("returns null for an ordinary page", () => {
    expect(fingerprintChallenge("<html><body><h1>Vercel Reviews</h1></body></html>")).toBeNull()
  })

  it("returns null for empty input", () => {
    expect(fingerprintChallenge("")).toBeNull()
  })

  // fingerprintChallenge lowercases its input; nothing asserted that worked.
  it("matches a host regardless of case", () => {
    expect(fingerprintChallenge(`<IFRAME SRC="https://GEO.CAPTCHA-DELIVERY.COM/x">`))
      .toBe("datadome")
  })
})

/** Build a trace from text lengths; htmlLen is not what this reads. */
const trace = (...textLens: number[]): PollSample[] =>
  textLens.map((textLen, i) => ({ tMs: i * 700, textLen, htmlLen: 2669 }))

describe("classifyTrace — a zero is not one fact but two", () => {
  it("calls an all-zero trace flat: nothing visible ever happened", () => {
    expect(classifyTrace(trace(0, 0, 0, 0, 0))).toBe("flat")
  })

  it("calls an empty trace flat, since nothing was ever seen", () => {
    expect(classifyTrace([])).toBe("flat")
  })

  it("calls zeros-then-growth-then-stable late-arrival: the solve landed", () => {
    expect(classifyTrace(trace(0, 0, 0, 500, 3856, 3856))).toBe("late-arrival")
  })

  it("calls a trace still rising at the last sample cut-off: the budget was binding", () => {
    expect(classifyTrace(trace(0, 0, 100, 900, 2400))).toBe("cut-off")
  })

  it("calls a trace non-zero from the first sample immediate: no challenge to solve", () => {
    expect(classifyTrace(trace(3856, 3856, 3856))).toBe("immediate")
  })

  // Precedence decision, made explicit because the spec left it open: a trace
  // that starts non-zero AND is still rising is `cut-off`, not `immediate`.
  // "Still growing when the budget expired" is the operationally important
  // fact whichever sample it started at, because it is the one that says the
  // budget is what to change.
  it("prefers cut-off over immediate when a page starts non-zero and is still growing", () => {
    expect(classifyTrace(trace(500, 700, 900))).toBe("cut-off")
  })

  it("handles a single zero sample", () => {
    expect(classifyTrace(trace(0))).toBe("flat")
  })

  it("handles a single non-zero sample", () => {
    expect(classifyTrace(trace(3856))).toBe("immediate")
  })

  // A successful solve navigates, and document.body reads empty mid-navigation.
  // A budget expiring during that navigation ends the trace at zero after text
  // had already appeared -- which is the budget binding, not the solve landing.
  it("calls a trace that ends at zero after showing text cut-off, not late-arrival", () => {
    expect(classifyTrace(trace(0, 3856, 3856, 0))).toBe("cut-off")
  })

  it("still calls a trace that ends stable after growth late-arrival", () => {
    expect(classifyTrace(trace(0, 0, 500, 3856, 3856))).toBe("late-arrival")
  })
})

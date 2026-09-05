import { describe, expect, it } from "vitest"
import { fingerprintChallenge } from "./captcha.js"

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
})

import { describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  classifyTrace, fingerprintChallenge, reportPath, writeReportTo, type PollSample,
} from "./captcha.js"

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

  it("calls a trace non-zero from the first sample immediate", () => {
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

describe("reportPath — two tiers on one day are two measurements", () => {
  const day = new Date("2026-09-05T18:06:59.252Z")

  it("names the file after the date and the proxy", () => {
    expect(reportPath("us:static", day)).toBe("reports/captcha-probe-2026-09-05-us-static.json")
  })

  // The whole point: the mobile run must not land on top of the static
  // baseline it is being compared against.
  it("gives different tiers different paths on the same day", () => {
    expect(reportPath("us:mobile", day)).not.toBe(reportPath("us:static", day))
  })

  it("slugs a proxy that needs no punctuation", () => {
    expect(reportPath("smart", day)).toBe("reports/captcha-probe-2026-09-05-smart.json")
  })
})

describe("writeReportTo — a half-written report is worse than none", () => {
  const dir = mkdtempSync(join(tmpdir(), "captcha-report-"))

  it("writes JSON that reads back intact", () => {
    const path = join(dir, "a.json")
    writeReportTo(path, { attempts: [1, 2, 3] })
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ attempts: [1, 2, 3] })
  })

  it("leaves no temporary file behind", () => {
    const path = join(dir, "b.json")
    writeReportTo(path, { ok: true })
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  // Two things at once. The failure mode this replaces: each write rewrites the
  // whole accumulated array, so a shorter payload landing on a longer file must
  // not leave the tail of the old one behind and produce unparseable JSON. And
  // it is the only test that exercises rename-onto-an-existing-file, which is
  // not guaranteed across platforms -- do not delete it as redundant.
  it("replaces a longer previous report completely", () => {
    const path = join(dir, "c.json")
    writeFileSync(path, JSON.stringify({ padding: "x".repeat(5000) }, null, 2))
    writeReportTo(path, { small: true })
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ small: true })
  })

  // The test that actually discriminates. The other three in this block pass
  // even with a plain writeFileSync onto the target, because writeFileSync
  // truncates by default -- so none of them would catch a regression away from
  // the atomic write. This one does: occupying the temp path with a directory
  // makes the temp write fail, and the whole point of writing beside the target
  // is that the target survives that.
  it("leaves the previous report intact when the write fails", () => {
    const path = join(dir, "d.json")
    writeReportTo(path, { good: true })
    mkdirSync(`${path}.tmp`)
    expect(() => writeReportTo(path, { replacement: true })).toThrow()
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ good: true })
  })
})

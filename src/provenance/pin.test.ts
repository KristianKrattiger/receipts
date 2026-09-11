import { describe, expect, it } from "vitest"
import { isPermanentUrl, resolvePin } from "./pin.js"

const H = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
const TESLA_10K =
  "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm"

describe("permanent by construction — SEC EDGAR accession paths", () => {
  it("recognizes the committed Tesla 10-K url", () => {
    expect(isPermanentUrl(TESLA_10K)).toBe(true)
  })

  it("pins it as a permalink carrying the same hash", () => {
    expect(resolvePin(TESLA_10K, H)).toEqual({ kind: "permalink", url: TESLA_10K, sha256: H })
  })

  it("does not recognize sec.gov pages outside the accession archive", () => {
    expect(isPermanentUrl("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany")).toBe(false)
    expect(isPermanentUrl("https://www.sec.gov/")).toBe(false)
  })

  it("does not recognize a lookalike host", () => {
    expect(isPermanentUrl("https://sec.gov.evil.example/Archives/edgar/data/1/2/x.htm")).toBe(false)
  })
})

describe("permanent by construction — Wikipedia oldid revisions", () => {
  it("recognizes an oldid revision link", () => {
    expect(isPermanentUrl("https://en.wikipedia.org/w/index.php?title=Tesla_Autopilot&oldid=1234567")).toBe(true)
  })

  it("does not recognize a bare article url", () => {
    expect(isPermanentUrl("https://en.wikipedia.org/wiki/Tesla_Autopilot")).toBe(false)
  })

  it("does not recognize oldid on a non-wikipedia host", () => {
    expect(isPermanentUrl("https://example.com/page?oldid=1234567")).toBe(false)
  })
})

describe("everything else stays a plain hash pin", () => {
  it("pins a vendor marketing page by hash", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H)).toEqual({ kind: "hash", sha256: H })
  })

  it("pins a Hacker News search by hash", () => {
    expect(resolvePin("https://hn.algolia.com/?q=tesla", H)).toEqual({ kind: "hash", sha256: H })
  })

  it("returns a hash pin for a malformed url instead of throwing", () => {
    expect(resolvePin("not a url", H)).toEqual({ kind: "hash", sha256: H })
  })
})

describe("a stored blob earns a snapshot pin", () => {
  it("pins an ordinary url as snapshot when its blob is committed", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H, true))
      .toEqual({ kind: "snapshot", sha256: H })
  })

  it("still pins an ordinary url as hash when the blob is not committed", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H, false))
      .toEqual({ kind: "hash", sha256: H })
  })

  it("defaults to hash when the caller says nothing about storage", () => {
    expect(resolvePin("https://www.tesla.com/fsd", H))
      .toEqual({ kind: "hash", sha256: H })
  })

  it("keeps permalink ahead of snapshot when a permanent url is also stored", () => {
    expect(resolvePin(TESLA_10K, H, true))
      .toEqual({ kind: "permalink", url: TESLA_10K, sha256: H })
  })
})

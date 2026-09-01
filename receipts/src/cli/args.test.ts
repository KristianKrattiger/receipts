import { describe, expect, it } from "vitest"
import { parseArgs, readCorpusFile } from "./args.js"

describe("parseArgs — accepts well-formed invocations", () => {
  it("takes the vendor name and applies defaults", () => {
    expect(parseArgs(["acme"]))
      .toEqual({ subject: "acme", concurrency: 3, asJson: false, fetchOnly: false, stealth: true })
  })

  it("accepts --fetch-only with a snapshot target", () => {
    const opts = parseArgs(["acme", "--fetch-only", "--snapshot", "f.json"])
    expect(opts.fetchOnly).toBe(true)
    expect(opts.snapshot).toBe("f.json")
  })

  it("reads every value flag", () => {
    expect(
      parseArgs([
        "acme",
        "--from-fixture", "f.json",
        "--domain", "acme.dev",
        "--concurrency", "20",
        "--json",
      ]),
    ).toEqual({
      subject: "acme",
      fromFixture: "f.json",
      domain: "acme.dev",
      concurrency: 20,
      asJson: true,
      fetchOnly: false,
      stealth: true,
    })
  })
})

describe("parseArgs — refuses rather than guesses", () => {
  // The bug this exists to stop: a full paid browser fan that writes nothing.
  it("rejects a value flag given as the final argument", () => {
    expect(() => parseArgs(["acme", "--snapshot"])).toThrow(/--snapshot needs a value/)
  })

  // Would otherwise write a file literally named "--json".
  it("rejects a value flag whose value is another flag", () => {
    expect(() => parseArgs(["acme", "--snapshot", "--json"])).toThrow(/--snapshot needs a value/)
  })

  it("rejects a non-numeric concurrency instead of passing NaN downstream", () => {
    expect(() => parseArgs(["acme", "--concurrency", "abc"]))
      .toThrow(/--concurrency needs a positive whole number/)
  })

  for (const bad of ["0", "-1", "2.5"]) {
    it(`rejects --concurrency ${bad}`, () => {
      expect(() => parseArgs(["acme", "--concurrency", bad])).toThrow(/positive whole number/)
    })
  }

  it("rejects an unknown option rather than ignoring it", () => {
    expect(() => parseArgs(["acme", "--verbose"])).toThrow(/unknown option/)
  })

  it("rejects a repeated flag", () => {
    expect(() => parseArgs(["acme", "--domain", "a.com", "--domain", "b.com"]))
      .toThrow(/given more than once/)
  })

  it("rejects a flag where the vendor name should be", () => {
    expect(() => parseArgs(["--json"])).toThrow(/expected a vendor name/)
  })

  it("rejects no arguments at all", () => {
    expect(() => parseArgs([])).toThrow(/no vendor given/)
  })

  it("rejects --snapshot combined with --from-fixture", () => {
    expect(() => parseArgs(["acme", "--from-fixture", "f.json", "--snapshot", "s.json"]))
      .toThrow(/means nothing with --from-fixture/)
  })

  // Fetching without saving spends money and leaves nothing behind.
  it("rejects --fetch-only without a snapshot target", () => {
    expect(() => parseArgs(["acme", "--fetch-only"])).toThrow(/needs --snapshot/)
  })

  it("rejects --fetch-only combined with --from-fixture", () => {
    expect(() => parseArgs(["acme", "--fetch-only", "--from-fixture", "f.json"]))
      .toThrow(/means nothing with --from-fixture/)
  })
})

describe("readCorpusFile", () => {
  const good = JSON.stringify({
    subject: "acme",
    docs: [{
      docId: "d1", url: "https://acme.com", label: "Acme", role: "vendor_claim",
      kind: "vendor_site", fetchedAt: "2026-08-31T00:00:00.000Z",
      title: "Acme", text: "body", sessionId: "s1",
    }],
    failures: [],
  })

  it("returns a corpus unchanged", () => {
    expect(readCorpusFile(good, "f.json").subject).toBe("acme")
  })

  // Each of these produced a raw SyntaxError or a TypeError from deep inside
  // the pipeline, naming nothing the user could act on.
  it("names the file when the JSON is malformed", () => {
    expect(() => readCorpusFile("{not json", "f.json")).toThrow(/f\.json is not valid JSON/)
  })

  it("rejects a shape that is not a corpus", () => {
    expect(() => readCorpusFile('{"subject":"acme"}', "f.json")).toThrow(/no "docs" array/)
  })

  it("rejects a corpus whose document is missing text", () => {
    const noText = JSON.stringify({
      subject: "acme",
      docs: [{ docId: "d1", url: "u", label: "l", role: "vendor_claim" }],
      failures: [],
    })
    expect(() => readCorpusFile(noText, "f.json")).toThrow(/docs\[0\] has no "text" string/)
  })
})

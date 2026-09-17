import { describe, expect, it } from "vitest"
import { parseArgs, readCorpusFile } from "./args.js"

describe("parseArgs — accepts well-formed invocations", () => {
  it("takes the vendor name and applies defaults", () => {
    expect(parseArgs(["acme"]))
      .toEqual({ subject: "acme", concurrency: 3, asJson: false, fetchOnly: false, stealth: true, captcha: true, proxy: "us:static", candidates: 40, rerun: false, noCache: false, runs: 2, promptTier: "frontier" })
  })

  it("turns captcha solving off on request", () => {
    expect(parseArgs(["acme", "--no-captcha"]).captcha).toBe(false)
  })

  // Solari requires stealth for captcha solving, so without it the flag could
  // only ever be a lie. Reporting false is the honest answer, not an error --
  // captcha defaults on, and erroring would make --no-stealth unusable.
  it("reports captcha off when stealth is off, since Solari requires stealth", () => {
    expect(parseArgs(["acme", "--no-stealth"]).captcha).toBe(false)
  })

  it("takes a stored profile id", () => {
    expect(parseArgs(["acme", "--profile", "prof_123"]))
      .toEqual({
        subject: "acme", concurrency: 3, asJson: false, fetchOnly: false, stealth: true, captcha: true,
        proxy: "us:static", profileId: "prof_123", candidates: 40, rerun: false, noCache: false, runs: 2,
        promptTier: "frontier",
      })
  })

  it("takes a proxy session label", () => {
    expect(parseArgs(["acme", "--proxy", "us:static", "--proxy-session", "warm-1"]))
      .toEqual({
        subject: "acme", concurrency: 3, asJson: false, fetchOnly: false, stealth: true, captcha: true,
        proxy: "us:static", proxySession: "warm-1", candidates: 40, rerun: false, noCache: false, runs: 2,
        promptTier: "frontier",
      })
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
      captcha: true,
      proxy: "us:static",
      candidates: 40,
      rerun: false,
      noCache: false,
      runs: 2,
      promptTier: "frontier",
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

  it("rejects a non-numeric candidate count", () => {
    expect(() => parseArgs(["acme", "--candidates", "lots"]))
      .toThrow(/--candidates needs a positive whole number/)
  })

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
      docId: "d1", url: "https://acme.com", label: "Acme", role: "claimant",
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
      docs: [{ docId: "d1", url: "u", label: "l", role: "claimant" }],
      failures: [],
    })
    expect(() => readCorpusFile(noText, "f.json")).toThrow(/docs\[0\] has no "text" string/)
  })
})

describe("parseArgs — --industry", () => {
  it("accepts a known industry", () => {
    expect(parseArgs(["Chime", "--industry", "fintech"]).industry).toBe("fintech")
  })

  it("leaves industry absent when the flag is not passed", () => {
    expect(parseArgs(["Chime"]).industry).toBeUndefined()
  })

  // A typo must not read as a regulator that had nothing to say.
  it("refuses an unknown industry, and names the known ones", () => {
    expect(() => parseArgs(["Chime", "--industry", "banking"]))
      .toThrow(/unknown --industry "banking".*fintech/s)
  })

  it("refuses --industry without a value", () => {
    expect(() => parseArgs(["Chime", "--industry"])).toThrow(/--industry needs a value/)
  })

  // --sources replaces the built-in plan wholesale, so there is nothing for
  // --industry to add to. Accepting both would honour exactly one, silently.
  it("refuses --industry alongside --sources", () => {
    expect(() => parseArgs(["Chime", "--industry", "fintech", "--sources", "plans/x.json"]))
      .toThrow(/means nothing with --sources/)
  })
})

describe("--refresh and --rerun", () => {
  it("accepts --refresh with a report path", () => {
    expect(parseArgs(["x", "--refresh", "reports/tesla-fsd.json"]).refresh).toBe("reports/tesla-fsd.json")
  })

  it("defaults rerun to false", () => {
    expect(parseArgs(["x", "--refresh", "r.json"]).rerun).toBe(false)
  })

  it("accepts --rerun alongside --refresh", () => {
    expect(parseArgs(["x", "--refresh", "r.json", "--rerun"]).rerun).toBe(true)
  })

  it("refuses --rerun without --refresh", () => {
    expect(() => parseArgs(["x", "--rerun"])).toThrow(/--rerun requires --refresh/)
  })

  it("refuses --refresh together with --from-fixture", () => {
    expect(() => parseArgs(["x", "--refresh", "r.json", "--from-fixture", "f.json"])).toThrow(/--refresh/)
  })

  it("refuses --refresh together with --render", () => {
    expect(() => parseArgs(["x", "--refresh", "r.json", "--render", "r.json"])).toThrow(/--refresh/)
  })

  // --fetch-only without --snapshot already throws earlier ("needs --snapshot"),
  // so all three flags are needed to reach this exclusion at all.
  it("refuses --refresh together with --fetch-only", () => {
    expect(() => parseArgs(["x", "--fetch-only", "--snapshot", "s.json", "--refresh", "r.json"]))
      .toThrow("receipts: --refresh and --fetch-only are different modes; pass one")
  })

  it("refuses --refresh together with --snapshot", () => {
    expect(() => parseArgs(["x", "--snapshot", "s.json", "--refresh", "r.json"]))
      .toThrow("receipts: --snapshot saves a fresh fetch; --refresh commits its re-fetched bytes to snapshots/ itself")
  })
})

describe("--replay and --no-cache", () => {
  it("parses --replay as a path and --no-cache as a switch", () => {
    expect(parseArgs(["x", "--replay", "r.json"]).replay).toBe("r.json")
    expect(parseArgs(["x", "--replay", "r.json"]).noCache).toBe(false)
    expect(parseArgs(["x", "--no-cache"]).noCache).toBe(true)
    expect(parseArgs(["x"]).replay).toBeUndefined()
  })

  it("refuses --replay with every other mode and with --no-cache", () => {
    expect(() => parseArgs(["x", "--replay", "r.json", "--from-fixture", "f.json"]))
      .toThrow("receipts: --replay rebuilds the report's corpus from snapshots/; it cannot take --from-fixture")
    expect(() => parseArgs(["x", "--replay", "r.json", "--refresh", "s.json"]))
      .toThrow("receipts: --replay and --refresh are different modes; pass one")
    expect(() => parseArgs(["x", "--replay", "r.json", "--render", "s.json"]))
      .toThrow("receipts: --replay and --render are different modes; pass one")
    expect(() => parseArgs(["x", "--replay", "r.json", "--fetch-only", "--snapshot", "s.json"]))
      .toThrow("receipts: --replay and --fetch-only are different modes; pass one")
    expect(() => parseArgs(["x", "--replay", "r.json", "--snapshot", "s.json"]))
      .toThrow("receipts: --snapshot saves a fresh fetch; --replay fetches nothing")
    expect(() => parseArgs(["x", "--replay", "r.json", "--no-cache"]))
      .toThrow("receipts: --replay reads the proposal cache; it means nothing with --no-cache")
  })

  it("refuses --no-cache on a run that makes no model call", () => {
    const msg = "receipts: --no-cache skips the proposal cache on a model call; this run makes none"
    expect(() => parseArgs(["x", "--no-cache", "--render", "r.json"])).toThrow(msg)
    expect(() => parseArgs(["x", "--no-cache", "--fetch-only", "--snapshot", "s.json"])).toThrow(msg)
    expect(() => parseArgs(["x", "--no-cache", "--refresh", "r.json"])).toThrow(msg)
    expect(parseArgs(["x", "--no-cache", "--refresh", "r.json", "--rerun"]).noCache).toBe(true)
  })
})

describe("--runs", () => {
  it("defaults to 2", () => {
    expect(parseArgs(["acme"]).runs).toBe(2)
  })

  it("accepts 1 or 2", () => {
    expect(parseArgs(["acme", "--runs", "1"]).runs).toBe(1)
    expect(parseArgs(["acme", "--runs", "2"]).runs).toBe(2)
  })

  it("refuses any other value", () => {
    expect(() => parseArgs(["acme", "--runs", "3"])).toThrow("receipts: --runs must be 1 or 2")
  })

  it("selects the proposer client: anthropic by default, ollama on request, nothing else", () => {
    expect(parseArgs(["acme"]).client).toBeUndefined()
    expect(parseArgs(["acme", "--client", "ollama"]).client).toBe("ollama")
    expect(parseArgs(["acme", "--client", "anthropic"]).client).toBe("anthropic")
    expect(() => parseArgs(["acme", "--client", "openai"])).toThrow("receipts: --client must be anthropic or ollama")
    expect(() => parseArgs(["acme", "--replay", "r.json", "--client", "ollama"]))
      .toThrow("receipts: --client picks the proposer for a model call; this run makes none")
    expect(() => parseArgs(["acme", "--runs", "0"])).toThrow("receipts: --runs must be 1 or 2")
  })

  it("selects the prompt tier: frontier by default, small with --client ollama, explicit wins", () => {
    expect(parseArgs(["acme"]).promptTier).toBe("frontier")
    expect(parseArgs(["acme", "--client", "ollama"]).promptTier).toBe("small")
    expect(parseArgs(["acme", "--client", "ollama", "--prompt-tier", "frontier"]).promptTier).toBe("frontier")
    expect(parseArgs(["acme", "--prompt-tier", "small"]).promptTier).toBe("small")
    expect(() => parseArgs(["acme", "--prompt-tier", "huge"])).toThrow("receipts: --prompt-tier must be frontier or small")
    expect(() => parseArgs(["acme", "--replay", "r.json", "--prompt-tier", "small"]))
      .toThrow("receipts: --prompt-tier picks the proposer prompt for a model call; this run makes none")
  })

  it("refuses --runs with --replay", () => {
    expect(() => parseArgs(["x", "--replay", "r.json", "--runs", "2"]))
      .toThrow("receipts: --replay reads runs from the report; do not pass --runs")
  })

  it("refuses --runs on a run that makes no model call", () => {
    const msg = "receipts: --runs takes proposer samples on a model call; this run makes none"
    expect(() => parseArgs(["x", "--runs", "2", "--render", "r.json"])).toThrow(msg)
    expect(() => parseArgs(["x", "--runs", "2", "--fetch-only", "--snapshot", "s.json"])).toThrow(msg)
    expect(() => parseArgs(["x", "--runs", "2", "--refresh", "r.json"])).toThrow(msg)
    expect(parseArgs(["x", "--runs", "1", "--refresh", "r.json", "--rerun"]).runs).toBe(1)
  })
})

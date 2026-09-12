import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ProposalClient } from "../assay/cartographer/propose.js"
import { cacheKeyFor, cacheOnlyClient, canonicalJson, withProposalCache, type CacheEntry } from "./proposal-cache.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "proposal-cache-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// The shape proposeRelations builds: model, max_tokens, system, one user
// message, and an output_format whose `parse` is a function (dropped by JSON).
const body = {
  model: "claude-opus-5", max_tokens: 16000, system: "S",
  messages: [{ role: "user" as const, content: "Subject: Acme\n\nExcerpts:\n\n[a] hello" }],
  output_format: { type: "json_schema", schema: { type: "object", properties: {} }, parse: () => null },
}

describe("canonicalJson", () => {
  it("sorts object keys at every depth and drops functions and undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined, f: () => 1 } }))
      .toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}')
  })
})

describe("cacheKeyFor", () => {
  it("is 64 hex characters", () => {
    expect(cacheKeyFor(body, 0)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("ignores key order at every depth", () => {
    const a = { model: "m", messages: [{ role: "user", content: "x" }], system: "S" }
    const b = { system: "S", messages: [{ content: "x", role: "user" }], model: "m" }
    expect(cacheKeyFor(a, 0)).toBe(cacheKeyFor(b, 0))
  })

  it("changes with every field of the request, and with the sample", () => {
    const base = cacheKeyFor(body, 0)
    expect(cacheKeyFor({ ...body, system: "S2" }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, model: "other" }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, max_tokens: 16001 }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, messages: [{ role: "user", content: "Subject: Acme\n\nExcerpts:\n\n[a] hello!" }] }, 0)).not.toBe(base)
    expect(cacheKeyFor({ ...body, output_format: { ...body.output_format, schema: { type: "array" } } }, 0)).not.toBe(base)
    expect(cacheKeyFor(body, 1)).not.toBe(base)
  })

  it("is blind to a function-valued property", () => {
    expect(cacheKeyFor({ ...body, output_format: { ...body.output_format, parse: () => 42 } }, 0)).toBe(cacheKeyFor(body, 0))
  })
})

function counting(response: object): { client: ProposalClient; calls: () => number } {
  let n = 0
  return {
    calls: () => n,
    client: { beta: { messages: { parse: async () => { n++; return response as never } } } },
  }
}
const RESPONSE = { stop_reason: "end_turn", parsed_output: { proposals: [] }, usage: { input_tokens: 5, output_tokens: 2 } }
const parse = (c: ProposalClient) => c.beta.messages.parse(body as never)

describe("withProposalCache", () => {
  it("calls through on a miss, writes the entry with request and response, and records the key", async () => {
    const { client, calls } = counting(RESPONSE)
    const cached = withProposalCache(client, { dir })
    const r = await parse(cached)
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    const key = cacheKeyFor(body, 0)
    expect(cached.keys).toEqual([key])
    expect(cached.writeFailures).toEqual([])
    const entry = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as CacheEntry
    expect(entry.key).toBe(key)
    expect(entry.sample).toBe(0)
    expect(entry.request).toEqual(JSON.parse(JSON.stringify(body)))
    expect(entry.response).toEqual(RESPONSE)
    expect(typeof entry.createdAt).toBe("string")
  })

  it("serves a hit from disk without calling through", async () => {
    const { client, calls } = counting(RESPONSE)
    const cached = withProposalCache(client, { dir })
    await parse(cached)
    const r = await parse(cached)
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    expect(cached.keys).toHaveLength(2)
  })

  it("keys the sample: sample 1 misses what sample 0 wrote", async () => {
    const { client, calls } = counting(RESPONSE)
    await parse(withProposalCache(client, { dir, sample: 0 }))
    await parse(withProposalCache(client, { dir, sample: 1 }))
    expect(calls()).toBe(2)
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it("treats an unparseable entry as a miss and overwrites it", async () => {
    const { client, calls } = counting(RESPONSE)
    const key = cacheKeyFor(body, 0)
    writeFileSync(join(dir, `${key}.json`), "{not json")
    const r = await parse(withProposalCache(client, { dir }))
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    expect(() => JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8"))).not.toThrow()
  })

  it("survives a write failure: returns the live response and records the key as unwritten", async () => {
    const { client, calls } = counting(RESPONSE)
    // A regular file where the cache directory should be: mkdir fails on every platform.
    const blocked = join(dir, "not-a-dir")
    writeFileSync(blocked, "x")
    const cached = withProposalCache(client, { dir: join(blocked, "proposals") })
    const r = await parse(cached)
    expect(calls()).toBe(1)
    expect(r).toEqual(RESPONSE)
    expect(cached.keys).toEqual([cacheKeyFor(body, 0)])
    expect(cached.writeFailures).toEqual([cacheKeyFor(body, 0)])
  })

  it("records a call failure and rethrows when the live call throws, writing nothing", async () => {
    const error = new Error("network boom")
    const client: ProposalClient = { beta: { messages: { parse: async () => { throw error } } } }
    const cached = withProposalCache(client, { dir })
    const key = cacheKeyFor(body, 0)
    await expect(parse(cached)).rejects.toThrow(error)
    expect(cached.keys).toEqual([key])
    expect(cached.callFailures).toEqual([key])
    expect(existsSync(join(dir, `${key}.json`))).toBe(false)
  })

  it("stores no usage key when the client returned none", async () => {
    const { client } = counting({ stop_reason: "end_turn", parsed_output: { proposals: [] } })
    await parse(withProposalCache(client, { dir }))
    const entry = JSON.parse(readFileSync(join(dir, `${cacheKeyFor(body, 0)}.json`), "utf8")) as CacheEntry
    expect("usage" in entry.response).toBe(false)
  })
})

describe("cacheOnlyClient", () => {
  it("serves a hit and records the key", async () => {
    const { client } = counting(RESPONSE)
    await parse(withProposalCache(client, { dir }))
    const only = cacheOnlyClient({ dir })
    expect(await parse(only)).toEqual(RESPONSE)
    expect(only.keys).toEqual([cacheKeyFor(body, 0)])
  })

  it("throws on a miss, naming the key", async () => {
    const key = cacheKeyFor(body, 0)
    await expect(parse(cacheOnlyClient({ dir }))).rejects.toThrow(`replay: no cached response for ${key}`)
  })

  it("throws on an unparseable entry, naming the file", async () => {
    const key = cacheKeyFor(body, 0)
    writeFileSync(join(dir, `${key}.json`), "{not json")
    await expect(parse(cacheOnlyClient({ dir }))).rejects.toThrow(`${key}.json`)
  })

  it("keys the sample, so sample 1 misses a sample-0 file", async () => {
    const { client } = counting(RESPONSE)
    await parse(withProposalCache(client, { dir }))
    await expect(parse(cacheOnlyClient({ dir, sample: 1 })))
      .rejects.toThrow(`replay: no cached response for ${cacheKeyFor(body, 1)}`)
    expect(await parse(cacheOnlyClient({ dir, sample: 0 }))).toEqual(RESPONSE)
  })
})

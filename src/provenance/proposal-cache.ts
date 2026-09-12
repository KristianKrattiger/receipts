import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ProposalClient } from "../assay/cartographer/propose.js"

/** Where model responses live. Relative to the working directory, like SNAPSHOT_DIR. */
export const CACHE_DIR = "cache/proposals"

type ParseBody = Parameters<ProposalClient["beta"]["messages"]["parse"]>[0]
type ParseResult = Awaited<ReturnType<ProposalClient["beta"]["messages"]["parse"]>>

/** The part of a response the proposer reads, plus what the SDK said it cost. */
export interface CachedResponse {
  parsed_output?: unknown
  stop_reason?: string | null
  stop_details?: { category?: string | null } | null
  /** Recorded when the SDK returned it. Read by nothing yet. */
  usage?: unknown
}

/**
 * One file per model response, named by the key of the request that produced
 * it. The request is stored too: a cache you can read is a receipt, a bare
 * response is not.
 */
export interface CacheEntry {
  key: string
  createdAt: string
  sample: number
  request: unknown
  response: CachedResponse
}

export interface CachedProposalClient extends ProposalClient {
  /** Every key served, in call order -- hits and misses alike. */
  keys: string[]
  /** Keys whose entry could not be written. A run with any is not replayable. */
  writeFailures: string[]
}

/**
 * JSON with object keys sorted at every depth, so equal values serialise
 * equal whatever order their keys were built in. Functions and undefined
 * vanish, as they do in JSON.stringify -- which is what lets an
 * `output_format` carry its `parse` function without touching the key.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const v = record[key]
      if (v !== undefined && typeof v !== "function") out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/**
 * The key is the request itself: model, system prompt, the user message with
 * every excerpt, max_tokens, the JSON schema. Any change to any of them is a
 * miss, with no version constant to forget to bump. `sample` distinguishes
 * deliberate re-samples of one request (Phase 3b's second run); it is 0 for
 * every ordinary call.
 */
export function cacheKeyFor(body: object, sample: number): string {
  return createHash("sha256").update(canonicalJson({ ...body, sample }), "utf8").digest("hex")
}

function pathFor(dir: string, key: string): string {
  return join(dir, `${key}.json`)
}

function readEntry(file: string): CacheEntry | undefined {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CacheEntry
  } catch {
    return undefined
  }
}

/**
 * The subset the proposer reads. The SDK's parsed message also carries content
 * blocks, ids and headers that nothing reads; they are not kept.
 */
function toCached(response: ParseResult): CachedResponse {
  const r = response as CachedResponse
  return {
    parsed_output: r.parsed_output,
    ...(r.stop_reason !== undefined ? { stop_reason: r.stop_reason } : {}),
    ...(r.stop_details !== undefined ? { stop_details: r.stop_details } : {}),
    ...(r.usage !== undefined ? { usage: r.usage } : {}),
  }
}

/**
 * Read-through cache around a real client. A hit returns the stored response
 * with no call; a miss calls through, writes the entry, and returns. An entry
 * that cannot be parsed is a miss and is overwritten. A write that fails is
 * reported on stderr and in `writeFailures`, and the response still comes
 * back -- the run continues, it just cannot be stamped replayable.
 */
export function withProposalCache(
  inner: ProposalClient,
  opts: { dir?: string; sample?: number } = {},
): CachedProposalClient {
  const dir = opts.dir ?? CACHE_DIR
  const sample = opts.sample ?? 0
  const keys: string[] = []
  const writeFailures: string[] = []
  return {
    keys,
    writeFailures,
    beta: {
      messages: {
        parse: async (body: ParseBody) => {
          const key = cacheKeyFor(body, sample)
          keys.push(key)
          const hit = readEntry(pathFor(dir, key))
          if (hit !== undefined) return hit.response as ParseResult
          const response = await inner.beta.messages.parse(body)
          const entry: CacheEntry = {
            key, createdAt: new Date().toISOString(), sample,
            request: JSON.parse(JSON.stringify(body)) as unknown,
            response: toCached(response),
          }
          try {
            mkdirSync(dir, { recursive: true })
            writeFileSync(pathFor(dir, key), `${JSON.stringify(entry, null, 2)}\n`, "utf8")
          } catch (err) {
            writeFailures.push(key)
            console.error(`could not write ${pathFor(dir, key)}: ${err instanceof Error ? err.message : String(err)}`)
          }
          return response
        },
      },
    },
  }
}

/**
 * A client that never calls anything: a hit is served, a miss is an error
 * naming the key, and an entry that cannot be parsed is an error naming the
 * file -- a miss is already fatal here, so nothing is silently a miss.
 */
export function cacheOnlyClient(opts: { dir?: string } = {}): CachedProposalClient {
  const dir = opts.dir ?? CACHE_DIR
  const keys: string[] = []
  return {
    keys,
    writeFailures: [],
    beta: {
      messages: {
        parse: async (body: ParseBody) => {
          const key = cacheKeyFor(body, 0)
          keys.push(key)
          const file = pathFor(dir, key)
          if (!existsSync(file)) throw new Error(`replay: no cached response for ${key}`)
          let entry: CacheEntry
          try {
            entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry
          } catch (err) {
            throw new Error(`replay: ${file} is not a cache entry: ${err instanceof Error ? err.message : String(err)}`)
          }
          return entry.response as ParseResult
        },
      },
    },
  }
}

import type { Corpus } from "../types.js"

export interface CliOptions {
  subject: string
  fromFixture?: string
  snapshot?: string
  domain?: string
  concurrency: number
  asJson: boolean
}

const VALUE_FLAGS = ["--from-fixture", "--snapshot", "--domain", "--concurrency"] as const
const BOOL_FLAGS = ["--json"] as const

/**
 * Parse argv, refusing anything ambiguous rather than guessing.
 *
 * The naive form — `args[args.indexOf(name) + 1]` — reads the next token
 * whatever it is. `receipts acme --snapshot` then silently yields `undefined`
 * and the run does a full paid browser fan and writes nothing; `--snapshot
 * --json` writes a file named "--json". A flag that takes a value and does not
 * get one is a mistake worth stopping for, not defaulting past.
 */
export function parseArgs(args: string[]): CliOptions {
  if (args.length === 0) throw new Error("receipts: no vendor given")

  const subject = args[0]!
  if (subject.startsWith("-")) {
    throw new Error(`receipts: expected a vendor name, got the flag ${JSON.stringify(subject)}`)
  }

  const values = new Map<string, string>()
  const seen = new Set<string>()

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if ((BOOL_FLAGS as readonly string[]).includes(arg)) {
      seen.add(arg)
      continue
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(arg)) {
      throw new Error(`receipts: unknown option ${JSON.stringify(arg)}`)
    }
    const value = args[i + 1]
    // A leading "-" usually means the next flag arrived instead of a value —
    // but a negative number is a value, and rejecting it here would report
    // "--concurrency needs a value" for `--concurrency -1`, hiding the real
    // complaint that the number is out of range.
    const nextFlagInstead =
      value !== undefined && value.startsWith("-") && Number.isNaN(Number(value))
    if (value === undefined || nextFlagInstead) {
      throw new Error(`receipts: ${arg} needs a value`)
    }
    if (values.has(arg)) throw new Error(`receipts: ${arg} given more than once`)
    values.set(arg, value)
    i++
  }

  const raw = values.get("--concurrency")
  let concurrency = 3
  if (raw !== undefined) {
    concurrency = Number(raw)
    // Number("abc") is NaN, and NaN survives Math.max(1, NaN) downstream to
    // produce zero workers and an empty corpus — which the CLI would then
    // report as "no sources could be read", blaming the network for a typo.
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`receipts: --concurrency needs a positive whole number, got ${JSON.stringify(raw)}`)
    }
  }

  const fromFixture = values.get("--from-fixture")
  const snapshot = values.get("--snapshot")
  if (fromFixture !== undefined && snapshot !== undefined) {
    throw new Error("receipts: --snapshot writes what a fetch returned; it means nothing with --from-fixture")
  }

  return {
    subject,
    ...(fromFixture !== undefined ? { fromFixture } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(values.get("--domain") !== undefined ? { domain: values.get("--domain")! } : {}),
    concurrency,
    asJson: seen.has("--json"),
  }
}

/**
 * Parse a fixture file into a Corpus, saying what is wrong with it if it isn't.
 *
 * A cast alone turns a stale or hand-edited file into a `TypeError` from
 * somewhere deep in the pipeline, which tells the user nothing about the file
 * they actually passed.
 */
export function readCorpusFile(text: string, path: string): Corpus {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`receipts: ${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})`)
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`receipts: ${path} is not a corpus object`)
  }
  const c = parsed as Record<string, unknown>
  if (typeof c["subject"] !== "string") throw new Error(`receipts: ${path} has no "subject" string`)
  if (!Array.isArray(c["docs"])) throw new Error(`receipts: ${path} has no "docs" array`)
  if (!Array.isArray(c["failures"])) throw new Error(`receipts: ${path} has no "failures" array`)

  for (const [i, doc] of (c["docs"] as unknown[]).entries()) {
    const record = doc as Record<string, unknown> | null
    for (const field of ["docId", "text", "url", "label", "role"] as const) {
      if (typeof record?.[field] !== "string") {
        throw new Error(`receipts: ${path} docs[${i}] has no "${field}" string`)
      }
    }
  }

  return parsed as Corpus
}

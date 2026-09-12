import { readFileSync } from "node:fs"
import { toPinnedCorpus } from "../assay/adapt.js"
import type { ProposalClient } from "../assay/cartographer/propose.js"
import { assay } from "../assay/index.js"
import type { AssayResult, Refusal } from "../assay/types.js"
import { cacheOnlyClient, canonicalJson, type CachedProposalClient } from "../provenance/proposal-cache.js"
import { getSnapshot, sha256Of } from "../provenance/snapshots.js"
import type { Corpus, FetchedDoc, Report } from "../types.js"

/** The disk and the model, injected: the CLI passes the real store and a cache-only client. */
export interface ReplayDeps {
  snapshot: typeof getSnapshot
  client: CachedProposalClient
}

export interface ReplayOutcome {
  identical: boolean
  /** One line per differing leaf, `path: before → after`. Empty when identical. */
  diff: string[]
  result: AssayResult
  /** Responses served from the cache. */
  replayed: number
}

/**
 * Rebuild a saved report from committed bytes alone and say whether the
 * reproduction is the report. No network, no model call, no key.
 *
 * The report is the manifest: its documents' pins name the blobs, its
 * `replay` block names the settings, and the cache holds the responses. The
 * four refusals below are the four ways a report can fail to be that
 * manifest, checked before any other work.
 */
export async function runReplay(
  reportPath: string,
  deps: ReplayDeps = { snapshot: getSnapshot, client: cacheOnlyClient() },
): Promise<ReplayOutcome> {
  const saved = JSON.parse(readFileSync(reportPath, "utf8")) as Report | Refusal
  if (saved.replay === undefined) {
    throw new Error(
      `receipts: ${reportPath} is not replayable: no proposal cache recorded — ` +
        `generated before the cache existed, or with --no-cache`,
    )
  }
  const uncommitted = saved.docs.filter((d) => d.pin === undefined || d.pin.kind === "hash" || d.kind === undefined)
  if (uncommitted.length > 0) {
    const n = uncommitted.length
    throw new Error(
      `receipts: ${reportPath} is not replayable: ${n} document${n === 1 ? "'s" : "s'"} bytes were never committed ` +
        `(${uncommitted.map((d) => d.label).join(", ")})`,
    )
  }

  // Every field of the rebuilt document comes from the report, not the blob:
  // a blob's own fetchedAt is its first capture's, which can predate the run
  // that produced this report if an earlier run committed the same bytes.
  const docs: FetchedDoc[] = saved.docs.map((d) => {
    const sha = d.pin!.sha256
    let entry
    try {
      entry = deps.snapshot(sha)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // getSnapshot's missing-file sentence contains "is not in"; anything else
      // (unparseable JSON, a present file that is not an entry) is a blob that
      // exists and cannot be trusted — the spec's corrupt case, not a miss.
      if (message.includes("is not in")) {
        throw new Error(`receipts: ${reportPath} is not replayable: "${d.label}" snapshot ${sha} is not in the store`)
      }
      throw new Error(`receipts: snapshot ${sha} does not match its own id — the store is corrupt`)
    }
    const actual = sha256Of(entry.content)
    if (actual !== sha) {
      throw new Error(`receipts: snapshot ${sha} does not match its own id (${actual}) — the store is corrupt`)
    }
    return {
      docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind!,
      fetchedAt: d.fetchedAt, title: d.label, text: entry.content,
      ...(d.stability !== undefined ? { stability: d.stability } : {}),
      ...(d.via !== undefined ? { via: d.via } : {}),
    }
  })
  const corpus: Corpus = {
    subject: saved.subject, docs, failures: saved.failures,
    ...(saved.labels ? { labels: saved.labels } : {}),
  }

  // A live run tolerates one failed pass among several -- a partial ledger beats
  // losing the rest to it (see proposeAcrossPasses's per-pass try/catch). A
  // replay has no such excuse: every pass it runs is a cache read that either
  // reproduces the original call or does not, so any pass failing here means
  // the reproduction itself failed, even though `assay` would otherwise still
  // hand back a (different) ledger built from whichever passes hit. Wrapping
  // the client to remember the first such failure, and raising it once `assay`
  // returns, is the only way to surface that without assay itself learning
  // replay has different failure semantics than a live run.
  let failure: Error | undefined
  const client: ProposalClient = {
    beta: {
      messages: {
        parse: async (body) => {
          try {
            return await deps.client.beta.messages.parse(body)
          } catch (err) {
            failure ??= err instanceof Error ? err : new Error(String(err))
            throw err
          }
        },
      },
    },
  }

  const { candidates, threshold, conflictMode } = saved.replay
  let result: AssayResult
  try {
    result = await assay(
      toPinnedCorpus(corpus, { isStored: () => true }),
      { subject: saved.subject },
      { client, candidates, threshold, conflictMode },
    )
  } catch (err) {
    // assay throws "every proposal pass failed" when every pass is a miss.
    // The cache-only client's sentence is the one the spec names; keep it.
    throw failure ?? err
  }
  if (failure) throw failure

  const diff = diffJson(comparable(saved), comparable(result))
  return { identical: diff.length === 0, diff, result, replayed: deps.client.keys.length }
}

/** The report minus the two fields a reproduction cannot share: when it ran, and what replays it. */
function comparable(r: Report | Refusal | AssayResult): unknown {
  const { generatedAt: _when, replay: _how, ...rest } = r as unknown as Record<string, unknown>
  return JSON.parse(canonicalJson(rest))
}

/**
 * Every leaf that differs, as `path: before → after`. Arrays are compared
 * index by index after one line for a length change, so a dropped row reads
 * as `rows.length: 26 → 25` and not as twenty-five shifted rows.
 */
export function diffJson(before: unknown, after: unknown, path = ""): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: string[] = []
    if (before.length !== after.length) out.push(`${path}.length: ${before.length} → ${after.length}`)
    const n = Math.min(before.length, after.length)
    for (let i = 0; i < n; i++) out.push(...diffJson(before[i], after[i], `${path}[${i}]`))
    return out
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((k) => diffJson(before[k], after[k], path === "" ? k : `${path}.${k}`))
  }
  if (canonicalJson(before) === canonicalJson(after)) return []
  return [`${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

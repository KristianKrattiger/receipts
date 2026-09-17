import { defaultClient, MODEL, toAssayClient, type SdkProposalClient } from "./cartographer/anthropic.js"
import { DEFAULT_THRESHOLD } from "./assay/types.js"
import type { AssayResult } from "./assay/types.js"
import type { ProposalClient } from "./assay/cartographer/propose.js"
import { RECEIPTS } from "./instance/profile.js"
import { analyzeCorpus } from "./pipeline.js"
import { CACHE_DIR, withProposalCache, type CachedProposalClient } from "./provenance/proposal-cache.js"
import { SNAPSHOT_DIR } from "./provenance/snapshots.js"
import { storeCorpus } from "./provenance/store.js"
import type { Corpus } from "./types.js"

export interface AnalyzeLiveOpts {
  runs?: 1 | 2
  noCache?: boolean
  candidates?: number
  /** Parse-shaped SDK client; wrapped with the cache then adapted to Assay. */
  client?: SdkProposalClient
  /** Model id sent in every request and stamped on the manifest. Default MODEL. */
  model?: string
  snapshotDir?: string
  cacheDir?: string
}

export interface AnalyzeLiveOutcome {
  result: AssayResult
  docs: number
  blobs: number
  cacheKeys: number
  writeFailures: number
  callFailures: number
}

/**
 * The machinery every live entry point shares: commit bytes, decorate the
 * proposer with the cache, analyse, stamp `replay` when every response is on
 * disk. The Assay itself never sees a filesystem.
 *
 * Must not write to stdout — MCP speaks JSON-RPC on stdio.
 */
export async function analyzeLive(
  corpus: Corpus,
  opts: AnalyzeLiveOpts = {},
): Promise<AnalyzeLiveOutcome> {
  const snapshotDir = opts.snapshotDir ?? SNAPSHOT_DIR
  const cacheDir = opts.cacheDir ?? CACHE_DIR
  const runs = opts.runs ?? 2
  const candidates = opts.candidates ?? 40
  const inner = opts.client ?? defaultClient()
  const model = opts.model ?? MODEL

  // Commit the bytes before analysing, so the pins the report carries resolve
  // to blobs that exist. A bad path here (read-only workdir, full disk, the
  // snapshot dir already existing as a plain file) must not throw the corpus
  // away: warn and carry on as though nothing were committed. That is the
  // conservative fact even when storeCorpus failed partway through and some
  // blobs before the failing one were in fact written -- storedIds is still
  // empty, because the thrown `.map` discards whatever it had accumulated.
  // The report that follows is still honest: with storedIds empty, every pin
  // falls back to `hash` rather than falsely claiming `snapshot`.
  let storedIds = new Set<string>()
  try {
    storedIds = new Set(storeCorpus(corpus, snapshotDir))
  } catch (err) {
    console.error(`could not commit to ${snapshotDir}/: ${err instanceof Error ? err.message : String(err)}`)
    console.error("continuing with nothing committed -- pins will read hash, not snapshot")
  }
  console.error(`  snapshots  ${corpus.docs.length} doc(s), ${storedIds.size} blob(s) in ${snapshotDir}/`)

  const cached0 = opts.noCache ? undefined : withProposalCache(inner, { dir: cacheDir, sample: 0 })
  const cached1 = opts.noCache || runs === 1 ? undefined : withProposalCache(inner, { dir: cacheDir, sample: 1 })
  const clientForSample = (sample: number): ProposalClient => {
    if (opts.noCache) return toAssayClient(inner, model)
    if (sample === 0) return toAssayClient(cached0!, model)
    return toAssayClient(cached1 ?? cached0!, model)
  }

  const result = await analyzeCorpus(corpus, {
    candidates,
    isStored: (sha) => storedIds.has(sha),
    runs,
    client: clientForSample(0),
    clientForSample,
  })

  const clients: CachedProposalClient[] = opts.noCache
    ? []
    : (runs === 2 ? [cached0!, cached1!] : [cached0!])
  const writeFailures = clients.reduce((n, c) => n + c.writeFailures.length, 0)
  const callFailures = clients.reduce((n, c) => n + c.callFailures.length, 0)
  const cacheKeys = clients.reduce((n, c) => n + c.keys.length, 0)

  // The stamp makes the result replayable, so it is only written when every
  // response is on disk. A noCache run, a run with a failed cache write, and
  // a run with a call that threw all carry none. `threshold` and `conflictMode`
  // are the values `analyzeCorpus` defaults to today; if a later flag ever
  // sets them, this stamp must read the same source.
  if (!opts.noCache && writeFailures + callFailures === 0) {
    if (runs === 2) {
      result.replay = {
        sample: 0, keys: cached0!.keys,
        samples: [{ sample: 0, keys: cached0!.keys }, { sample: 1, keys: cached1!.keys }],
        model, candidates,
        threshold: DEFAULT_THRESHOLD, conflictMode: "report", runs: 2,
        profile: RECEIPTS.name,
      }
    } else {
      result.replay = {
        sample: 0, keys: cached0!.keys, model, candidates,
        threshold: DEFAULT_THRESHOLD, conflictMode: "report",
        profile: RECEIPTS.name,
      }
    }
  }

  return {
    result, docs: corpus.docs.length, blobs: storedIds.size,
    cacheKeys, writeFailures, callFailures,
  }
}

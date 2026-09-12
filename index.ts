import { admit, type AdmitResult } from "./bookkeeper/admit.js"
import { proposeAcrossPasses, type PassFailure, type ProposalClient } from "./cartographer/propose.js"
import { chunkAll } from "./chunk/chunk.js"
import { buildIdf, tokenize } from "./retrieve/idf.js"
import { selectCandidates } from "./retrieve/select.js"
import { assemble, NOT_ANCHORING_EVIDENCE } from "./assemble.js"
import { mergeRuns, passIdOf, rowKey } from "./merge.js"
import { DEFAULT_THRESHOLD, type AssayOptions, type AssayQuery, type AssayResult, type PinnedCorpus } from "./types.js"

export type { AssayResult, PinnedCorpus, AssayQuery, AssayOptions } from "./types.js"

interface SampleRun {
  result: AssayResult
  admitted: AdmitResult
  failures: PassFailure[]
}

async function assayOnce(
  corpus: PinnedCorpus,
  query: AssayQuery,
  opts: AssayOptions,
  client: ProposalClient | undefined,
): Promise<SampleRun> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const conflictMode = opts.conflictMode ?? "report"

  const queryTerms = tokenize(query.subject)
  const idf = buildIdf(corpus.docs)
  const chunks = chunkAll(corpus.docs)

  const total = opts.candidates ?? 40
  const perDoc = Math.max(8, Math.ceil(total / Math.max(corpus.docs.length, 1)))
  const claimantDocIds = new Set(
    corpus.docs.filter((d) => d.role === "claimant").map((d) => d.docId),
  )
  const candidates = selectCandidates(chunks, queryTerms, idf, { perDoc, total, claimantDocIds })

  const fanned = await proposeAcrossPasses(query.subject, corpus.docs, candidates, {
    ...(client ? { client } : {}),
    ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
  })
  for (const f of fanned.failures) {
    console.error(`  pass ${f.passId} failed: ${f.message}`)
  }

  // Every pass failing is our outage, not a finding about the subject. It stays
  // a thrown error rather than becoming a refusal: a refusal is a statement
  // about the corpus, and this is a statement about us.
  if (fanned.failures.length > 0 && fanned.failures.length === fanned.passes) {
    throw new Error(
      `every proposal pass failed (${fanned.passes}/${fanned.passes}); ` +
        `first: ${fanned.failures[0]!.message}`,
    )
  }

  const result = admit(corpus, fanned.proposals, queryTerms, idf, threshold)

  const anchoredCount = result.admitted.length +
    result.denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code)).length

  return {
    result: assemble(corpus, fanned.proposals.length, result, {
      conflictMode, anchoredCount, ...(fanned.passes === undefined ? {} : { passes: fanned.passes }),
    }),
    admitted: result,
    failures: fanned.failures,
  }
}

function admittedMeta(admitted: AdmitResult["admitted"]) {
  return admitted.map((a) => ({
    rowKey: rowKey({ topic: a.proposal.topic, sides: a.sides }),
    passId: passIdOf(a.proposal.proposalId),
  }))
}

/**
 * Documents and a query in; a grounded ledger or a refusal out.
 *
 * Pure given the corpus and the responses of `opts.client`. The Assay never
 * fetches and has no opinion about how a document's pin was obtained.
 *
 * `runs: 1` (the default) is today's behaviour: one propose+admit+assemble
 * cycle and no `row.provenance`. `runs: 2` takes a second sample and merges.
 */
export async function assay(
  corpus: PinnedCorpus,
  query: AssayQuery,
  opts: AssayOptions = {},
): Promise<AssayResult> {
  const empty = { admitted: [], denied: [] }
  const conflictMode = opts.conflictMode ?? "report"

  // Structural refusals are decided before the model is called, because the
  // guard exists precisely to stop a run spending money to produce a report
  // where everything is unverified for want of a second side.
  const roles = new Set(corpus.docs.map((d) => d.role))
  if (corpus.docs.length === 0 || roles.size < 2) {
    return assemble(corpus, 0, empty, { conflictMode, anchoredCount: 0 })
  }

  const clientFor = (sample: number): ProposalClient | undefined =>
    opts.clientForSample?.(sample) ?? opts.client

  const runs = opts.runs ?? 1
  const first = await assayOnce(corpus, query, opts, clientFor(0))
  if (runs !== 2) return first.result

  const second = await assayOnce(corpus, query, opts, clientFor(1))
  return mergeRuns(first.result, second.result, {
    admittedA: admittedMeta(first.admitted.admitted),
    admittedB: admittedMeta(second.admitted.admitted),
    failuresA: first.failures,
    failuresB: second.failures,
    docs: corpus.docs,
    ...(opts.stabilityViolated ? { stabilityViolated: opts.stabilityViolated } : {}),
  })
}

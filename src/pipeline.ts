import { admit } from "./bookkeeper/admit.js"
import { proposeAcrossPasses, type ProposalClient } from "./cartographer/propose.js"
import { chunkAll } from "./chunk/chunk.js"
import { buildReport } from "./report/build.js"
import { buildIdf, tokenize } from "./retrieve/idf.js"
import { selectCandidates } from "./retrieve/select.js"
import type { Corpus, Report } from "./types.js"

/**
 * Everything downstream of the network. A pure-ish function of the corpus:
 * given the same fixture and the same model output, it produces the same
 * report, which is what makes the whole engine testable offline.
 */
export async function analyzeCorpus(
  corpus: Corpus,
  opts: { client?: ProposalClient; candidates?: number; concurrency?: number } = {},
): Promise<Report> {
  const queryTerms = tokenize(corpus.subject)
  const idf = buildIdf(corpus.docs)
  const chunks = chunkAll(corpus.docs)

  // How much of the corpus the model gets to see, and the run's dominant cost.
  // The per-document cap has to rise with the total or it becomes the real
  // limit: at the default 8, five documents can only ever supply 40 chunks
  // however high the total goes. Scaling it keeps round-robin able to fill the
  // budget while still stopping any one document from taking most of it.
  const total = opts.candidates ?? 40
  const perDoc = Math.max(8, Math.ceil(total / Math.max(corpus.docs.length, 1)))
  const candidates = selectCandidates(chunks, queryTerms, idf, { perDoc, total })

  // One call per independent source rather than one call over everything. See
  // proposeAcrossPasses: the single pass was the ceiling on every ledger this
  // engine has produced, and it did not move when the corpus grew 90-fold.
  const fanned = await proposeAcrossPasses(corpus.subject, corpus.docs, candidates, opts)
  for (const f of fanned.failures) {
    console.error(`  pass ${f.passId} failed: ${f.message}`)
  }

  // Every pass failing is our outage, not a finding about the subject.
  //
  // Partial failure is survivable and reported — five passes out of six is a
  // thinner ledger, honestly labelled. Zero out of six is not a thin ledger, it
  // is no evidence at all, and it renders as "nothing was found wrong with this
  // vendor". An expired API key produced exactly that: an empty Vercel report,
  // exit code 0, indistinguishable from a clean bill of health.
  if (fanned.failures.length > 0 && fanned.failures.length === fanned.passes) {
    throw new Error(
      `every proposal pass failed (${fanned.passes}/${fanned.passes}); ` +
        `first: ${fanned.failures[0]!.message}`,
    )
  }
  const result = admit(corpus, fanned.proposals, queryTerms, idf)

  return buildReport(corpus, fanned.proposals.length, result, { passes: fanned.passes })
}

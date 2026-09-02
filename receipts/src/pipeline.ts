import { admit } from "./bookkeeper/admit.js"
import { proposeRelations, type ProposalClient } from "./cartographer/propose.js"
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
  opts: { client?: ProposalClient; candidates?: number } = {},
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

  const proposals = await proposeRelations(corpus.subject, corpus.docs, candidates, opts)
  const result = admit(corpus, proposals, queryTerms, idf)

  return buildReport(corpus, proposals.length, result)
}

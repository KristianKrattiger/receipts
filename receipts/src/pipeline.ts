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
  opts: { client?: ProposalClient } = {},
): Promise<Report> {
  const queryTerms = tokenize(corpus.subject)
  const idf = buildIdf(corpus.docs)
  const chunks = chunkAll(corpus.docs)
  const candidates = selectCandidates(chunks, queryTerms, idf)

  const proposals = await proposeRelations(corpus.subject, corpus.docs, candidates, opts)
  const result = admit(corpus, proposals, queryTerms, idf)

  return buildReport(corpus, proposals.length, result)
}

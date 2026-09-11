import { readFileSync } from "node:fs"
import type { FanOptions } from "../fetch/fan.js"
import { fetchCorpus } from "../fetch/fan.js"
import { buildDriftReport, compareDrift, findVanishedQuotes, type FreshDoc } from "../provenance/drift.js"
import { getSnapshot } from "../provenance/snapshots.js"
import { storeCorpus } from "../provenance/store.js"
import { isRefusal, type Refusal } from "../assay/types.js"
import type { Corpus, DriftReport, FetchedDoc, Report, SourceTarget } from "../types.js"

/**
 * Re-fetch a saved ledger's sources and report what changed. No model call.
 *
 * The prior report is the source of truth for what to fetch: its documents, at
 * their recorded urls and kinds, so the comparison is like with like even if
 * the plan file has since changed. Permalink-pinned documents are read from the
 * snapshot store rather than re-fetched -- a permanent url is permanent by
 * construction, and re-fetching an SEC accession is pointless and can only
 * fail. Everything else is re-fetched, including documents declared stable
 * that are not permalink-pinned: that is exactly the misdeclaration
 * STABILITY_VIOLATED exists to catch.
 */
export async function runRefresh(
  reportPath: string,
  fetchOpts: Omit<FanOptions, "labels">,
): Promise<{ drift: DriftReport; fresh: Corpus; prior: Report }> {
  const saved = JSON.parse(readFileSync(reportPath, "utf8")) as Report | Refusal
  if (isRefusal(saved)) {
    throw new Error(`receipts: ${reportPath} is a refusal, not a ledger; there are no rows to check`)
  }
  const prior = saved
  const missing = prior.docs.filter((d) => d.pin === undefined || d.driftHash === undefined || d.kind === undefined)
  if (missing.length > 0) {
    throw new Error(
      `receipts: ${reportPath} carries no provenance for ${missing.length} of ${prior.docs.length} documents ` +
        `(${missing.slice(0, 3).map((d) => d.label).join(", ")}${missing.length > 3 ? ", …" : ""}); ` +
        `nothing to compare against. A report needs pins and drift hashes before it can be refreshed.`,
    )
  }

  // Partition: permalink-pinned comes from the store, everything else is re-fetched.
  const fromStore = new Set<string>()
  const storeDocs: FetchedDoc[] = []
  const targets: SourceTarget[] = []
  for (const d of prior.docs) {
    if (d.pin!.kind === "permalink") {
      const entry = getSnapshot(d.pin!.sha256)
      fromStore.add(d.docId)
      storeDocs.push({
        docId: d.docId, url: d.url, label: d.label, role: d.role, kind: d.kind!,
        fetchedAt: entry.fetchedAt, title: d.label, text: entry.content,
        ...(d.stability !== undefined ? { stability: d.stability } : {}),
      })
    } else {
      targets.push({
        kind: d.kind!, role: d.role, url: d.url, label: d.label,
        ...(d.stability !== undefined ? { stability: d.stability } : {}),
      })
    }
  }

  console.error(`refreshing ${prior.docs.length} sources: ${targets.length} to re-fetch, ${fromStore.size} from the store`)
  const refetched = targets.length > 0
    ? await fetchCorpus(prior.subject, targets, { ...fetchOpts, ...(prior.labels ? { labels: prior.labels } : {}) })
    : { subject: prior.subject, docs: [], failures: [] }

  // The re-fetched bytes are real captures and belong in the store, whatever
  // the comparison says about them. Guarded like every other store write.
  try {
    storeCorpus(refetched)
  } catch (err) {
    console.error(`could not commit re-fetched bytes: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Match re-fetched documents back to prior ones by url: fetchCorpus records
  // a target's url verbatim on both its docs and its failures, whereas a
  // report's docIds are whatever its producer chose. Every committed report
  // derives docId from url, but nothing enforces that, so do not lean on it.
  const priorIdByUrl = new Map(prior.docs.map((d) => [d.url, d.docId]))
  const idFor = (url: string, fallback: string) => priorIdByUrl.get(url) ?? fallback
  const freshDocs: FreshDoc[] = [
    ...refetched.docs.map((d) => ({ docId: idFor(d.url, d.docId), text: d.text })),
    ...refetched.failures.map((f) => ({ docId: idFor(f.url, f.url), failure: f.reason })),
  ]
  const freshText = new Map<string, string>([
    ...refetched.docs.map((d): [string, string] => [idFor(d.url, d.docId), d.text]),
    ...storeDocs.map((d): [string, string] => [d.docId, d.text]),
  ])

  const docs = compareDrift(prior.docs, freshDocs, fromStore)
  const vanished = findVanishedQuotes(prior.rows, freshText, prior.docs)
  const drift = buildDriftReport(prior.subject, prior.generatedAt, docs, vanished)

  const fresh: Corpus = {
    subject: prior.subject,
    docs: [...storeDocs, ...refetched.docs],
    failures: refetched.failures,
    ...(prior.labels ? { labels: prior.labels } : {}),
  }
  return { drift, fresh, prior }
}

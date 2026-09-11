import type { Pin } from "../assay/types.js"

/**
 * A URL is permanent by construction when its permanence follows from its own
 * shape and the issuer's contract, rather than from anyone's claim about it.
 *
 * Two such shapes today:
 *
 *  - an SEC EDGAR *accession* path. The accession number identifies one filed
 *    document; EDGAR does not reissue it, and a filed document is not edited.
 *  - a Wikipedia `oldid` link. It names one revision, and a revision is
 *    immutable by definition — later edits create new ones.
 *
 * Both are checked host-first, against the parsed hostname rather than a
 * substring, so `sec.gov.evil.example` cannot pass for `sec.gov`.
 *
 * This deliberately does NOT *derive* a permalink for a page that has one but
 * was not fetched at it, and does NOT submit anything to an archive. Both need
 * a network fetch, which Phase 2a does not do.
 */
const SEC_ACCESSION = /^\/Archives\/edgar\/data\/\d+\/\d+\//
const WIKIPEDIA_HOST = /(^|\.)wikipedia\.org$/

export function isPermanentUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false

  const host = u.hostname.toLowerCase()
  if (host === "sec.gov" || host === "www.sec.gov") {
    return SEC_ACCESSION.test(u.pathname)
  }
  if (WIKIPEDIA_HOST.test(host)) {
    const oldid = u.searchParams.get("oldid")
    return oldid !== null && /^\d+$/.test(oldid)
  }
  return false
}

/**
 * The pin for a document we already hold.
 *
 * `sha256` is the raw content hash the caller already computed — this function
 * never rehashes, so a pin cannot disagree with the bytes it describes.
 *
 * A recognized permalink needs no verification fetch: the document in hand WAS
 * fetched at this exact URL, so the bytes at the permalink are the bytes we
 * have, established by the fetch that already happened.
 *
 * `stored` says the caller has committed this content to the snapshot store.
 * Precedence is `permalink` > `snapshot` > `hash`: a permanent URL is the
 * stronger claim and wins even when the blob is also stored, and nothing is
 * lost by that, because replay looks a document up by `pin.sha256` whatever
 * the kind says.
 *
 * It defaults to `false` so a caller that has not stored anything cannot
 * accidentally claim it has.
 */
export function resolvePin(url: string, sha256: string, stored = false): Pin {
  if (isPermanentUrl(url)) return { kind: "permalink", url, sha256 }
  return stored ? { kind: "snapshot", sha256 } : { kind: "hash", sha256 }
}

import { createHash } from "node:crypto"
import type { Egress, FailureReason, SourceTarget } from "../types.js"

/**
 * What both fetchers need, extracted so neither has to import the other.
 *
 * `fan.ts` imports the Reddit adapter to route to it, so anything the adapter
 * also needs cannot live in `fan.ts` without making the two modules circular.
 */

/** A fetch that failed in a way the ledger can name. */
export class FetchError extends Error {
  constructor(public reason: FailureReason, message: string, public egress?: Egress) {
    super(message)
    this.name = "FetchError"
  }
}

/**
 * Pure: stable per-URL document id.
 *
 * Shared rather than reimplemented per fetcher. Two fetchers hashing
 * independently can drift, and then one URL yields different ids depending on
 * which path read it -- which silently breaks every anchor citing that document.
 */
export function docIdFor(target: SourceTarget): string {
  return createHash("sha256").update(target.url).digest("hex").slice(0, 12)
}

/**
 * The fields a FetchedDoc copies verbatim from the SourceTarget that produced it.
 *
 * One helper rather than three literals, because three hand-maintained copies of
 * one field list is how `stability` came to reach the browser path and neither
 * Reddit path. Anything a target carries into its document belongs here, so a
 * new field cannot reach some fetch paths and not others.
 */
export function targetFields(target: SourceTarget) {
  return {
    docId: docIdFor(target),
    url: target.url,
    label: target.label,
    role: target.role,
    kind: target.kind,
    ...(target.stability !== undefined ? { stability: target.stability } : {}),
  }
}

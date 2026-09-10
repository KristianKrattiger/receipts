import { isRefusal } from "../assay/types.js"
import type { Ledger, Refusal } from "../assay/types.js"
import type { Report } from "../types.js"

/**
 * 0 = ledger, 3 = refusal, 1 = operational error (raised by `die`).
 *
 * A refusal is a result, not a crash — GIN_14's "the assay that comes back
 * empty is a real result". It gets its own code so a caller can tell it from
 * both a finding and a failure, which is the distinction an empty report at
 * exit 0 destroyed.
 *
 * Typed over `Report | Ledger | Refusal`, the same union `isRefusal` narrows,
 * rather than `AssayResult` alone: the CLI's `--render` path loads a saved
 * `reports/*.json` into a plain `Report`, which has no `outcome` field at
 * all. Delegating to `isRefusal` keeps "a missing `outcome` means ledger" in
 * exactly one place, so the renderers and the exit code cannot drift apart.
 */
export function exitCodeFor(r: Report | Ledger | Refusal): 0 | 3 {
  return isRefusal(r) ? 3 : 0
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export type LimitVerdict = "ok" | "client" | "global"

/**
 * Sliding-window limiter with two ceilings.
 *
 * Every hosted run spends the operator's money on a stranger's request — a
 * browser fan plus one model call — so the demo is capped rather than open.
 *
 * The per-client ceiling alone is not a spend cap. Its key comes from a
 * request header, and a caller who varies that header gets a fresh bucket
 * every time, so the bill it bounds is unbounded. The daily ceiling is the one
 * that actually limits the money: it is shared by everyone, keyed on nothing,
 * and therefore cannot be spoofed around.
 *
 * Buckets whose timestamps have all aged out are dropped rather than kept, so
 * a stream of distinct keys cannot grow the map without bound.
 */
export function createLimiter(opts: {
  perHour: number
  perDay?: number
  now?: () => number
}) {
  const now = opts.now ?? (() => Date.now())
  const hits = new Map<string, number[]>()
  let globalHits: number[] = []

  function prune(t: number): void {
    for (const [key, stamps] of hits) {
      const live = stamps.filter((ts) => t - ts < HOUR_MS)
      if (live.length === 0) hits.delete(key)
      else hits.set(key, live)
    }
  }

  return {
    /**
     * Consume one unit of quota. Nothing is consumed unless the answer is "ok",
     * so a rejected request never counts against the budget it was refused by.
     */
    check(key: string): LimitVerdict {
      const t = now()
      prune(t)

      globalHits = globalHits.filter((ts) => t - ts < DAY_MS)
      if (opts.perDay !== undefined && globalHits.length >= opts.perDay) return "global"

      const recent = hits.get(key) ?? []
      if (recent.length >= opts.perHour) return "client"

      recent.push(t)
      hits.set(key, recent)
      globalHits.push(t)
      return "ok"
    },

    /** Remaining runs against the shared daily ceiling, for logging. */
    remainingToday(): number {
      if (opts.perDay === undefined) return Number.POSITIVE_INFINITY
      const t = now()
      globalHits = globalHits.filter((ts) => t - ts < DAY_MS)
      return Math.max(0, opts.perDay - globalHits.length)
    },
  }
}

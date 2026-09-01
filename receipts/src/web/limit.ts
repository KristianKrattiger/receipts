const WINDOW_MS = 3_600_000

/**
 * Fixed-window per-key limiter.
 *
 * Every hosted run spends real money on browser time and one Opus 5 call, so
 * the demo is capped rather than open.
 */
export function createLimiter(opts: { perHour: number; now?: () => number }) {
  const now = opts.now ?? (() => Date.now())
  const hits = new Map<string, number[]>()

  return {
    take(key: string): boolean {
      const t = now()
      const recent = (hits.get(key) ?? []).filter((ts) => t - ts < WINDOW_MS)
      if (recent.length >= opts.perHour) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.set(key, recent)
      return true
    },
  }
}

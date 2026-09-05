/**
 * Why G2's challenge solves about one attempt in four.
 *
 * Spends money; CI never runs it. The two exported helpers are pure and tested;
 * everything below them is the probe, kept inert on import by the run-as-main
 * guard at the bottom so the test file can load this module safely.
 */

/**
 * Challenge vendors, matched on the asset hosts their widgets load from.
 *
 * Matching hosts rather than vendor names is the point. A page that discusses
 * captchas contains the word "hcaptcha"; only a page that *is* a challenge
 * loads `newassets.hcaptcha.com`. The same distinction classifyFailure draws
 * by scanning the body rather than the title.
 *
 * First match wins. A page loading two vendors is not something we have seen,
 * and inventing a precedence for it would be guessing.
 */
const CHALLENGE_VENDORS: readonly { name: string; hosts: readonly string[] }[] = [
  { name: "datadome", hosts: ["captcha-delivery.com", "datadome.co", "js.datadome"] },
  { name: "hcaptcha", hosts: ["hcaptcha.com"] },
  { name: "recaptcha", hosts: ["google.com/recaptcha", "gstatic.com/recaptcha"] },
  { name: "turnstile", hosts: ["challenges.cloudflare.com"] },
  { name: "perimeterx", hosts: ["perimeterx.net", "px-cloud.net", "px-cdn.net"] },
]

/** Pure: name the challenge vendor a page loads, or null if it loads none. */
export function fingerprintChallenge(html: string): string | null {
  const hay = html.toLowerCase()
  for (const vendor of CHALLENGE_VENDORS) {
    if (vendor.hosts.some((host) => hay.includes(host))) return vendor.name
  }
  return null
}

/** One poll of the page: how much text and HTML existed, and when. */
export interface PollSample {
  tMs: number
  textLen: number
  htmlLen: number
}

export type TraceShape = "flat" | "immediate" | "late-arrival" | "cut-off"

/**
 * Pure: name the shape of a poll trace.
 *
 * This exists because a failed fetch currently reports one number -- `0` -- and
 * that number is two different facts wearing the same clothes. A solve that
 * never fired and a solve that was still working when the budget expired both
 * end at zero text, and they call for opposite fixes: abandon the route, or
 * raise the budget.
 *
 * `cut-off` is checked before `immediate` deliberately. A trace that starts
 * non-zero and is still climbing is reported as cut off, because "still growing
 * when we stopped looking" is the fact that changes what we do.
 */
export function classifyTrace(trace: readonly PollSample[]): TraceShape {
  if (trace.length === 0) return "flat"
  if (trace.every((sample) => sample.textLen === 0)) return "flat"

  // Ends empty after text had appeared: the page was mid-transition when the
  // budget expired. A successful solve navigates, and document.body reads
  // empty during that navigation -- so this is the budget binding, and
  // reporting it as `late-arrival` would claim the solve landed cleanly.
  if (trace[trace.length - 1]!.textLen === 0) return "cut-off"

  const last = trace[trace.length - 1]!
  const prior = trace[trace.length - 2]
  if (prior !== undefined && last.textLen > prior.textLen) return "cut-off"
  if (trace[0]!.textLen > 0) return "immediate"
  return "late-arrival"
}

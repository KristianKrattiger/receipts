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

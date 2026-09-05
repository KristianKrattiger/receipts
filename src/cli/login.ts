/**
 * Log in to Reddit once and store the cookies as a Solari profile.
 *
 *   npm run login
 *
 * Prints a profile id. Pass it to later runs as `--profile <id>` and they carry
 * the session without logging in again -- which is the point. Each login is an
 * opportunity for a challenge, and there is no reason to spend one per run:
 * Solari stores the cookies server-side and attaches them by id.
 *
 * Pin the exit IP for this and for the runs that use the profile, or the
 * account is seen from a different address on every request, which is itself
 * what triggers a security check:
 *
 *   npm run login
 *   npm run cli -- vercel --proxy us:static --proxy-session reddit-1 --profile <id>
 *
 * Credentials come from the environment and are never committed; `.env` is
 * gitignored. Automating a logged-in account is contrary to Reddit's user
 * agreement -- a deliberate choice recorded in
 * docs/superpowers/specs/2026-09-05-verified-egress-design.md, not an oversight.
 */
import { Solari } from "@solarisdk/browser"

const LOGIN_URL = "https://www.reddit.com/login"

async function main(): Promise<void> {
  const apiKey = process.env["SOLARI_API_KEY"]
  const username = process.env["REDDIT_USERNAME"]
  const password = process.env["REDDIT_PASSWORD"]
  if (!apiKey) throw new Error("login: SOLARI_API_KEY is not set")
  if (!username || !password) {
    throw new Error("login: set REDDIT_USERNAME and REDDIT_PASSWORD in .env")
  }
  const label = process.argv[2] ?? "reddit"
  const proxySession = process.env["REDDIT_PROXY_SESSION"] ?? "reddit-1"

  const solari = new Solari({ apiKey })
  try {
    const browser = await solari.launch({
      stealth: true,
      proxy: { country: "us", tier: "static", session: proxySession },
    })
    try {
      const page = await browser.newPage()
      await page.goto(LOGIN_URL, { timeout: 45_000, waitUntil: "load" })
      await page.fill("input[name='username']", username)
      await page.fill("input[name='password']", password)
      await page.click("button[type='submit']")
      // Wait for the navigation, not for a timer. A fixed sleep either wastes
      // time or captures a half-finished login, and a half-finished login
      // stores cookies that fail silently on some later run instead of here.
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45_000 })

      const state = await page.context().storageState()
      const profile = await solari.profiles.create({ name: label })
      const saved = await solari.profiles.save(profile.id, state)
      console.error(`saved ${saved.sizeBytes} bytes to profile ${profile.id}`)
      console.log(profile.id)
    } finally {
      await browser.close()
    }
  } finally {
    // REQUIRED in Node: the client holds a loopback proxy server open and that
    // handle keeps the event loop alive.
    await solari.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

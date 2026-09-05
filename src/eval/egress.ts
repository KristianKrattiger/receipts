/**
 * What each egress setting actually does, per host. Spends money; never run by CI.
 *
 * The tesla.com row is here on purpose. It should report identically under
 * `smart` and `off`, which is the whole reason this file exists: the
 * measurement that set the current default was taken against that host, where
 * a proxy makes no difference to whether the page loads. "OK, 3924 chars"
 * proved the page loaded and nothing about the route it took.
 *
 *   npm run egress -- > reports/egress-YYYY-MM-DD.json
 */
import { Solari } from "@solarisdk/browser"
import { classifyFailure, describeFailure, parseProxy, readEgress } from "../fetch/fan.js"
import { normalizeText } from "../fetch/normalize.js"

const HOSTS = [
  { key: "wikipedia", label: "wikipedia (control)", url: "https://en.wikipedia.org/wiki/Vercel" },
  { key: "tesla", label: "tesla (blocks nothing)", url: "https://www.tesla.com/fsd" },
  { key: "g2", label: "g2", url: "https://www.g2.com/products/vercel/reviews" },
  { key: "reddit", label: "reddit", url: "https://www.reddit.com/r/nextjs/search/?q=vercel" },
] as const

/** `webBotAuth` is tried only on the two that refuse us; it is the sanctioned lever. */
const CELLS: readonly {
  proxy: string
  webBotAuth: boolean
  captcha?: boolean
  only?: readonly string[]
}[] = [
  { proxy: "smart", webBotAuth: false },
  { proxy: "us:static", webBotAuth: false },
  { proxy: "off", webBotAuth: false },
  { proxy: "us:static", webBotAuth: true, only: ["g2", "reddit"] },
  // Captcha solving, enabled by policy on 2026-09-05. Measured rather than
  // assumed: G2 showed no challenge widget at all, so this should change
  // nothing there, and saying so in the record is the point.
  { proxy: "us:static", webBotAuth: false, captcha: true, only: ["g2", "reddit"] },
]

interface Row {
  host: string
  url: string
  proxy: string
  webBotAuth: boolean
  captcha: boolean
  /** "us/static", or "NONE" when the gateway attached nothing. */
  proxied: string
  status: number | null
  textLen: number
  htmlLen: number
  reason: string
  excerpt: string
}

async function probe(
  solari: Solari,
  host: (typeof HOSTS)[number],
  cell: (typeof CELLS)[number],
): Promise<Row> {
  const base = {
    host: host.label, url: host.url, proxy: cell.proxy,
    webBotAuth: cell.webBotAuth, captcha: cell.captcha ?? false,
  }
  let browser
  try {
    // `off` still launches with stealth: the shim is held constant so the
    // proxy is the only variable in the comparison.
    browser = await solari.launch({
      stealth: true,
      proxy: parseProxy(cell.proxy),
      ...(cell.webBotAuth ? { webBotAuth: true } : {}),
      ...(cell.captcha ? { captcha: true } : {}),
    })
  } catch (err) {
    return {
      ...base, proxied: "launch failed", status: null, textLen: 0, htmlLen: 0,
      reason: "launch_error", excerpt: err instanceof Error ? err.message : String(err),
    }
  }
  const egress = readEgress(browser, cell.proxy, true)
  const proxied = egress.proxy
    ? `${egress.proxy.country}/${egress.proxy.tier ?? "default"}`
    : "NONE"
  try {
    const page = await browser.newPage()
    const response = await page.goto(host.url, { timeout: 45_000, waitUntil: "load" })
    // The same settle the fan uses, so these numbers describe what a real run
    // sees rather than what a faster or slower reader would.
    //
    // Except when measuring the solver. A challenge page is short and STABLE,
    // so the stability test fires after roughly 1.4s -- which would report
    // "captcha solving does not work" when what happened is that nobody waited
    // for it. Solari's docs say the solve lands by the time you submit a form,
    // implying seconds, not milliseconds. For captcha cells, keep polling while
    // the page still looks like a challenge.
    const attempts = cell.captcha ? 60 : 6
    let previous = ""
    for (let i = 0; i < attempts; i++) {
      // A solve that succeeds NAVIGATES, and an evaluate in flight across that
      // navigation throws "Execution context was destroyed". Treating that as a
      // failed probe would report the exact opposite of what happened, so
      // swallow it and read again once the new document exists.
      let current: string
      try {
        current = await page.evaluate(() => document.body?.innerText ?? "")
      } catch {
        await new Promise((r) => setTimeout(r, 700))
        continue
      }
      const settled = current.length > 0 && current.length === previous.length
      if (settled) {
        if (!cell.captcha) break
        // Still a challenge? The solver may not have landed yet. Keep waiting.
        if (classifyFailure("", normalizeText(current)) !== "captcha") break
      }
      previous = current
      await new Promise((r) => setTimeout(r, 700))
    }
    const title = await page.title().catch(() => "")
    const text = normalizeText(previous)
    const htmlLen = await page
      .evaluate(() => document.documentElement?.outerHTML.length ?? 0)
      .catch(() => 0)
    const reason = classifyFailure(title, text)
    return {
      ...base,
      proxied,
      status: response?.status() ?? null,
      textLen: text.length,
      htmlLen,
      reason: reason ?? "ok",
      // `reason ?? "empty"` here would print "empty" for a page that classified
      // fine, which is exactly the confusion this script exists to remove.
      excerpt: describeFailure(host.label, reason ?? "http_error", title, text, htmlLen)
        .replace(": http_error ", ": ok ")
        .slice(0, 1000),
    }
  } catch (err) {
    return {
      ...base, proxied, status: null, textLen: 0, htmlLen: 0,
      reason: "threw", excerpt: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const apiKey = process.env["SOLARI_API_KEY"]
  if (!apiKey) throw new Error("egress: SOLARI_API_KEY is not set")
  const solari = new Solari({ apiKey })
  const rows: Row[] = []
  try {
    // Optional argv filter: `npx tsx src/eval/egress.ts captcha` runs only the
    // captcha cells, so a follow-up question does not re-pay for the whole grid.
    const onlyCaptcha = process.argv[2] === "captcha"
    for (const cell of CELLS) {
      if (onlyCaptcha && !cell.captcha) continue
      for (const host of HOSTS) {
        if (cell.only && !cell.only.includes(host.key)) continue
        // Serial on purpose: sharing concurrency slots would let one cell's
        // pressure on a host show up as another cell's block.
        const row = await probe(solari, host, cell)
        rows.push(row)
        console.error(
          `${row.proxy}${row.webBotAuth ? "+wba" : ""}${row.captcha ? "+captcha" : ""} ${row.host}: ` +
          `proxy=${row.proxied} status=${row.status} text=${row.textLen} ` +
          `html=${row.htmlLen} ${row.reason}`,
        )
      }
    }
  } finally {
    // REQUIRED in Node: the client holds a loopback proxy server open and that
    // handle keeps the event loop alive. Skip it and the script prints its
    // output and then hangs forever.
    await solari.close()
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

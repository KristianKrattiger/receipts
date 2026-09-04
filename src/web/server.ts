import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import { fetchCorpus } from "../fetch/fan.js"
import { analyzeCorpus } from "../pipeline.js"
import { esc, renderHtml } from "../report/render/html.js"
import { buildSourcePlan } from "../sources/plan.js"
import { createLimiter } from "./limit.js"

const PORT = Number(process.env.PORT ?? 8080)
const limiter = createLimiter({
  perHour: Number(process.env.RUNS_PER_HOUR ?? 2),
  // The ceiling that actually bounds the bill. Per-client limiting is keyed on
  // a request header, so a caller who varies it gets a fresh bucket every
  // time; only a shared ceiling is unspoofable. ~$0.18 a run, so 50 is about
  // $9 on the worst day.
  perDay: Number(process.env.RUNS_PER_DAY ?? 50),
})

/**
 * Trust x-forwarded-for only when the operator says a proxy sets it.
 *
 * Behind Fly/Railway/Render the socket address is the proxy's and everyone
 * shares one bucket; directly exposed, the header is attacker-controlled and
 * every request can claim a new one. Neither default is right for both, so it
 * is a deployment fact the operator states.
 */
const TRUST_PROXY = process.env.TRUST_PROXY === "1"

function clientKey(req: import("node:http").IncomingMessage): string {
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"]
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? "anon"
}

const PUBLIC_ROOT = resolve("public")

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
}

/** Plain-text responses, pinned so a non-ASCII body renders and never sniffs. */
const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const

function serveStatic(path: string, res: import("node:http").ServerResponse): boolean {
  // `path` is taken straight from the request URL. Without this check a request
  // for `/../package.json` lets `readFileSync` walk out of public/ on a public
  // endpoint. Resolve the path and confirm it still sits inside the directory.
  const full = resolve(PUBLIC_ROOT + path)
  if (full !== PUBLIC_ROOT && !full.startsWith(PUBLIC_ROOT + sep)) return false
  try {
    const body = readFileSync(full)
    // Serving every file as HTML breaks the first asset anyone adds, and an
    // SVG mislabelled text/html renders as markup rather than an image.
    const type = CONTENT_TYPES[extname(full).toLowerCase()] ?? "application/octet-stream"
    res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" })
    res.end(body)
    return true
  } catch {
    return false
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)

  if (url.pathname === "/run") {
    const subject = url.searchParams.get("q")?.trim()
    if (!subject) {
      res.writeHead(400, TEXT_HEADERS)
      res.end("missing ?q=<vendor>")
      return
    }

    // Both keys are the operator's to supply. If either is unset every run is
    // doomed, and the visitor would otherwise see it as a source failure or a
    // model error only after the browser fan has already spent the operator's
    // money. Say it is a deployment problem, and say so before any paid work.
    const missing = ["SOLARI_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k])
    if (missing.length > 0) {
      res.writeHead(500, TEXT_HEADERS)
      res.end(
        `receipts: this deployment is missing ${missing.join(" and ")}. ` +
          `That is a server configuration problem, not a problem with your request.`,
      )
      return
    }

    // buildSourcePlan throws rather than guess a domain it might get wrong. That
    // is a problem with the query, not a server fault, and its message is
    // actionable — answer 400 with it instead of letting it fall to the 500
    // path below. Checked before the limiter so a bad name costs no quota.
    let plan
    try {
      plan = buildSourcePlan(subject)
    } catch (err) {
      res.writeHead(400, TEXT_HEADERS)
      res.end(esc(err instanceof Error ? err.message : String(err)))
      return
    }

    const verdict = limiter.check(clientKey(req))
    if (verdict !== "ok") {
      const reason = verdict === "global"
        ? "This demo's daily run budget is spent."
        : "Rate limit reached."
      res.writeHead(429, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" })
      res.end(
        `${reason} Run it yourself with your own key: ` +
        `git clone the repo, then cd receipts && npm run cli -- ${esc(subject)}`,
      )
      return
    }
    try {
      const corpus = await fetchCorpus(subject, plan.targets, {
        apiKey: process.env.SOLARI_API_KEY!,
        concurrency: Number(process.env.CONCURRENCY ?? 3),
      })
      if (corpus.docs.length === 0) {
        res.writeHead(502, TEXT_HEADERS)
        res.end(`No sources could be read for ${esc(subject)}.`)
        return
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(renderHtml(await analyzeCorpus(corpus)))
    } catch (err) {
      // The visitor is anonymous and the exception is upstream. A wrong
      // SOLARI_API_KEY yields an auth error whose message can echo a key
      // prefix; fetch and model failures can carry internal hosts and paths.
      // esc() stops injection but does not redact. Log it where the operator
      // can read it, and tell the caller only that it failed.
      console.error(`[run] ${subject}:`, err)
      res.writeHead(500, TEXT_HEADERS)
      res.end("Run failed. The operator has been given the details.")
    }
    return
  }

  const path = url.pathname === "/" ? "/index.html" : url.pathname
  if (!serveStatic(path, res)) {
    res.writeHead(404, TEXT_HEADERS)
    res.end("not found")
  }
}).listen(PORT, () => console.log(`receipts listening on :${PORT}`))

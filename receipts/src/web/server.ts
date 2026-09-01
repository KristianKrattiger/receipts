import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { fetchCorpus } from "../fetch/fan.js"
import { analyzeCorpus } from "../pipeline.js"
import { esc, renderHtml } from "../report/render/html.js"
import { buildSourcePlan } from "../sources/plan.js"
import { createLimiter } from "./limit.js"

const PORT = Number(process.env.PORT ?? 8080)
const limiter = createLimiter({ perHour: Number(process.env.RUNS_PER_HOUR ?? 2) })

const PUBLIC_ROOT = resolve("public")

function serveStatic(path: string, res: import("node:http").ServerResponse): boolean {
  // `path` is taken straight from the request URL. Without this check a request
  // for `/../package.json` lets `readFileSync` walk out of public/ on a public
  // endpoint. Resolve the path and confirm it still sits inside the directory.
  const full = resolve(PUBLIC_ROOT + path)
  if (full !== PUBLIC_ROOT && !full.startsWith(PUBLIC_ROOT + sep)) return false
  try {
    const body = readFileSync(full)
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
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
      res.writeHead(400, { "content-type": "text/plain" })
      res.end("missing ?q=<vendor>")
      return
    }

    // Both keys are the operator's to supply. If either is unset every run is
    // doomed, and the visitor would otherwise see it as a source failure or a
    // model error only after the browser fan has already spent the operator's
    // money. Say it is a deployment problem, and say so before any paid work.
    const missing = ["SOLARI_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k])
    if (missing.length > 0) {
      res.writeHead(500, { "content-type": "text/plain" })
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
      res.writeHead(400, { "content-type": "text/plain" })
      res.end(esc(err instanceof Error ? err.message : String(err)))
      return
    }

    const key = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "anon")
    if (!limiter.take(key)) {
      res.writeHead(429, { "content-type": "text/plain" })
      res.end("Rate limit reached. Run it yourself with your own key: npx receipts " + esc(subject))
      return
    }
    try {
      const corpus = await fetchCorpus(subject, plan.targets, {
        apiKey: process.env.SOLARI_API_KEY!,
        concurrency: Number(process.env.CONCURRENCY ?? 3),
      })
      if (corpus.docs.length === 0) {
        res.writeHead(502, { "content-type": "text/plain" })
        res.end(`No sources could be read for ${esc(subject)}.`)
        return
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(renderHtml(await analyzeCorpus(corpus)))
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" })
      res.end(`Run failed: ${esc(err instanceof Error ? err.message : String(err))}`)
    }
    return
  }

  const path = url.pathname === "/" ? "/index.html" : url.pathname
  if (!serveStatic(path, res)) {
    res.writeHead(404, { "content-type": "text/plain" })
    res.end("not found")
  }
}).listen(PORT, () => console.log(`receipts listening on :${PORT}`))

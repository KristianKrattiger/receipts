import { readdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const ASSAY_ROOT = fileURLToPath(new URL("./", import.meta.url))
const ALLOWED_PACKAGES = new Set(["zod", "vitest"])
const FROM = /(?:\bfrom\s+|\bimport\s*\(\s*)["']([^"']+)["']/g

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith(".ts")) out.push(path)
  }
  return out
}

function isInsideAssay(resolved: string): boolean {
  const rel = relative(ASSAY_ROOT, resolved)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

describe("assay isolation", () => {
  it("imports only from src/assay, zod, vitest, or node:", () => {
    const leaks: string[] = []
    for (const file of walk(ASSAY_ROOT)) {
      const src = readFileSync(file, "utf8")
      FROM.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = FROM.exec(src))) {
        const spec = match[1]!
        if (spec.startsWith("node:") || ALLOWED_PACKAGES.has(spec)) continue
        if (spec.startsWith(".")) {
          const resolved = resolve(dirname(file), spec)
          if (!isInsideAssay(resolved)) {
            leaks.push(`${relative(ASSAY_ROOT, file)}: ${spec}`)
          }
          continue
        }
        leaks.push(`${relative(ASSAY_ROOT, file)}: ${spec}`)
      }
    }
    expect(leaks).toEqual([])
  })
})

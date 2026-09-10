import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getSnapshot, hasSnapshot, putSnapshot } from "./snapshots.js"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "snap-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const entry = { url: "https://a.example", fetchedAt: "2026-09-10T00:00:00.000Z", content: "hello world" }

describe("the snapshot store", () => {
  it("addresses a blob by the sha256 of its content alone", () => {
    const id = putSnapshot(entry, dir)
    expect(id).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
  })

  it("round-trips the entry", () => {
    const id = putSnapshot(entry, dir)
    expect(getSnapshot(id, dir)).toEqual(entry)
  })

  it("deduplicates identical content fetched from different urls", () => {
    const a = putSnapshot(entry, dir)
    const b = putSnapshot({ ...entry, url: "https://b.example" }, dir)
    expect(b).toBe(a)
  })

  it("gives different content different ids", () => {
    expect(putSnapshot({ ...entry, content: "goodbye" }, dir)).not.toBe(putSnapshot(entry, dir))
  })

  it("reports presence without reading the blob", () => {
    expect(hasSnapshot("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", dir)).toBe(false)
    putSnapshot(entry, dir)
    expect(hasSnapshot("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", dir)).toBe(true)
  })

  it("names the missing id when a blob is absent", () => {
    expect(() => getSnapshot("0".repeat(64), dir)).toThrow(/0{64}/)
  })

  it("does not rewrite a blob that already exists", () => {
    const id = putSnapshot(entry, dir)
    const first = readFileSync(join(dir, `${id}.json`), "utf8")
    putSnapshot({ ...entry, url: "https://other.example", fetchedAt: "2027-01-01T00:00:00.000Z" }, dir)
    expect(readFileSync(join(dir, `${id}.json`), "utf8")).toBe(first)
  })
})

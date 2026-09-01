/**
 * Normalize fetched page text exactly once, at the fetch boundary.
 *
 * Every downstream anchor check is an exact substring match against the output
 * of this function. If any other module transforms the text before anchoring,
 * every quote fails to anchor and the admission gate looks broken. Normalize
 * here, store the result, verify against the stored result.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

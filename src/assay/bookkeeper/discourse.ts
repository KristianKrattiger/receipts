/**
 * Discourse role of an independent sentence, from the field profile's closed
 * lexicon; the engine ships none.
 *
 * This is not an inferential read of the source. It tags extractive cues
 * (cert-grant, argument, holding) so corroboration cannot rest on a question
 * presented. An unmarked, context-true span with no holding competitor in the
 * pile still admits, labeled by the confident/unverified split: corroboration
 * gets context_unverified (not corroborated), and contradiction or update
 * gets disputed (not divergent) — residual curator work, labeled not solved.
 * An unmarked span that closely echoes the claim's own wording cannot
 * contradict a claim another independent document already holds; one that
 * paraphrases it may slip through and land as disputed rather than divergent.
 */

export type DiscourseRole = "holding" | "issue" | "argument" | "unmarked"

export interface SentenceSpan {
  start: number
  end: number
  text: string
}

function isEndPunct(ch: string): boolean {
  return ch === "." || ch === "?" || ch === "!"
}

/**
 * Expand an anchored span to the sentence that contains it.
 * Bounds are `.?!` or newline. `text.slice(start, end)` equals `text`.
 */
export function enclosingSentence(text: string, start: number, end: number): SentenceSpan {
  const lo = Math.max(0, Math.min(start, text.length))
  const hi = Math.max(lo, Math.min(end, text.length))
  let s = lo
  while (s > 0 && !isEndPunct(text[s - 1]!) && text[s - 1] !== "\n") s--
  if (s > 0 && text[s - 1] === "\n") {
    // already at the char after the newline
  }
  let e = hi
  while (e < text.length && !isEndPunct(text[e]!) && text[e] !== "\n") e++
  if (e < text.length && isEndPunct(text[e]!)) e++
  return { start: s, end: e, text: text.slice(s, e) }
}

export function sentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++
    if (i >= text.length) break
    const s = enclosingSentence(text, i, Math.min(i + 1, text.length))
    if (s.end <= i) {
      i++
      continue
    }
    if (s.text.trim().length > 0) out.push(s)
    i = s.end
  }
  return out
}

export type Lexicon = { holding: RegExp; issue: RegExp; argument: RegExp }

/**
 * Tag a sentence from the field's closed lexicon. Only the trailing "?" is
 * the engine's own rule: a question is not a holding in any field.
 */
export function discourseRole(sentence: string, lexicon: Lexicon): DiscourseRole {
  const t = sentence.trim()
  if (lexicon.holding.test(t)) return "holding"
  if (lexicon.issue.test(t) || /\?\s*$/.test(t)) return "issue"
  if (lexicon.argument.test(t)) return "argument"
  return "unmarked"
}

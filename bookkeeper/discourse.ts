/**
 * Discourse role of an independent sentence, from a closed lexicon.
 *
 * This is not an inferential read of the source. It tags extractive cues
 * (cert-grant, argument, holding) so corroboration cannot rest on a question
 * presented. An unmarked, context-true span with no holding competitor in the
 * pile still admits as context_unverified (corroboration) or divergent
 * (contradiction) — residual curator work, labeled not solved. An unmarked
 * span cannot contradict a claim another independent document already holds.
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

const HOLDING = /\bwe hold\b|\bheld:|\bwe conclude\b|\bwe reverse\b/i
const ISSUE = new RegExp(
  [
    String.raw`\bgranted certiorari\b`,
    String.raw`\bquestion presented\b`,
    String.raw`\bpetition for (?:a )?writ of certiorari\b`,
    String.raw`\bwe (?:must |now )?(?:decide|consider|resolve|determine) whether\b`,
    String.raw`\bthis case (?:requires us to consider|presents the question)\b`,
    String.raw`\bto resolve (?:the )?(?:question|conflict|issue)\b`,
    String.raw`\bthe (?:question|issue)(?: in this case| before (?:us|the court)| presented)? is whether\b`,
    String.raw`\bwhether .{0,80} will lie\b`,
    String.raw`^["“']?whether\b`,
    String.raw`\?\s*$`,
  ].join("|"),
  "i",
)
const ARGUMENT = /\bpetitioner argues\b|\brespondent (?:argues|contends)\b|\bsome courts have held\b|\bthe court below\b/i

export function discourseRole(sentence: string): DiscourseRole {
  const t = sentence.trim()
  if (HOLDING.test(t)) return "holding"
  if (ISSUE.test(t) || /\?\s*$/.test(t)) return "issue"
  if (ARGUMENT.test(t)) return "argument"
  return "unmarked"
}

import type { FieldProfile } from "./types.js"

/**
 * A profile for engine tests only. The admit and calibration fixtures were
 * written in legal vocabulary, so this lexicon is legal-shaped; the isolation
 * test forbids any non-test engine file from importing it.
 */
export const TEST_PROFILE: FieldProfile = {
  name: "test",
  system: "Test system prompt.",
  lexicon: {
    holding: /\bwe hold\b|\bheld:|\bwe conclude\b|\bwe reverse\b/i,
    issue: /\bgranted certiorari\b|\bquestion presented\b|\bwhether .{0,80} will lie\b|^["“']?whether\b/i,
    argument: /\bpetitioner argues\b|\brespondent (?:argues|contends)\b|\bsome courts have held\b|\bthe court below\b/i,
  },
  retrieval: { queryTerms: "subject+claimant", pinEnds: true },
}

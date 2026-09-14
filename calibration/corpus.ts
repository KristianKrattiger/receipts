import type { PinnedCorpus, PinnedDoc, SourceRole } from "../types.js"

function pin(docId: string, role: SourceRole, text: string): PinnedDoc {
  return {
    docId,
    url: `https://example.com/${docId}`,
    label: docId,
    role,
    kind: role === "claimant" ? "vendor_docs" : "review_site",
    fetchedAt: "2026-09-13T00:00:00.000Z",
    title: docId,
    text,
    stability: "stable",
    pin: { kind: "hash", sha256: "00" },
    driftHash: "00",
  }
}

/** Compact in-repo 10(b) twins. Not the Desktop corpus. */
export const CLAIM = pin("claim", "claimant", [
  "Section 10(b) creates a private right of action against those who aid and abet a primary violation.",
  "A private plaintiff may not maintain an aiding and abetting suit under Section 10(b).",
  "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter.",
  "Scienter, intent to deceive, manipulate, or defraud, is required in a private action under Section 10(b).",
].join("\n\n"))

export const CENTRAL_BANK = pin("central_bank", "independent",
  "Because the text of Section 10(b) does not prohibit aiding and abetting, we hold that a private plaintiff may not maintain an aiding and abetting suit under Section 10(b).")

export const TELLABS = pin("tellabs", "independent",
  "We hold that plaintiffs in a Section 10(b) action must plead facts evidencing scienter, the defendant's intention to deceive, manipulate, or defraud.")

export const HOCHFELDER = pin("hochfelder", "independent",
  "We granted certiorari to resolve the question whether a private cause of action for damages will lie under Section 10(b) in the absence of any allegation of scienter. We hold that a private damages action will not lie in the absence of scienter.")

export const STATUTE = pin("statute", "independent",
  "Section 10(b) makes it unlawful to use any manipulative or deceptive device in connection with the purchase or sale of any security.")

/** Residual trap: unmarked, no holding competitor. Must still admit. */
export const COMMENTATORS = pin("commentators", "independent",
  "A private damages action under Section 10(b) may rest on negligent bookkeeping without any allegation of scienter, as commentators have written.")

export const ARGUMENT = pin("argument", "independent",
  "Petitioner argues that a private damages action under Section 10(b) may rest on negligent bookkeeping without scienter.")

export const SUBJECT = "10(b) scienter abetting"

export function goldCorpus(independents: PinnedDoc[]): PinnedCorpus {
  return { subject: SUBJECT, docs: [CLAIM, ...independents], failures: [] }
}

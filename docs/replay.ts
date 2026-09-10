/**
 * docs/replay.ts — pace piped output for a screen recording.
 *
 * Not part of the product. Run when recording the README / launch demo, so a
 * screen capture shows the ledger *arriving* at a readable pace instead of
 * dumping in a single frame:
 *
 *   npm run cli -- tesla --render reports/tesla-fsd.json | npx tsx docs/replay.ts
 *
 * Modes:
 *   --lines           reveal one line at a time (default)
 *   --cps <n>         character-by-character at n chars/second
 *
 * Tuning (line mode):
 *   --line-ms <n>     delay after each non-blank line   (default 45)
 *   --blank-ms <n>    delay after each blank line       (default 400)
 *
 * Any delay accepts 0 to disable it.
 */

const args = process.argv.slice(2);

const has = (name: string) => args.includes(`--${name}`);
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= args.length) return fallback;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

if (has("help") || has("h")) {
  process.stdout.write(
    "replay.ts — pace piped output for a screen recording\n\n" +
      "  --lines           reveal line by line (default)\n" +
      "  --cps <n>         character mode at n chars/second\n" +
      "  --line-ms <n>     ms after each non-blank line (default 45)\n" +
      "  --blank-ms <n>    ms after each blank line (default 400)\n",
  );
  process.exit(0);
}

if (process.stdin.isTTY) {
  process.stderr.write(
    "replay.ts reads piped input, e.g.\n" +
      "  npm run cli -- tesla --render reports/tesla-fsd.json | npx tsx docs/replay.ts\n",
  );
  process.exit(1);
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Drop the `> receipts@0.1.0 cli` / `> tsx …` lines npm prints before real output.
function stripBanner(text: string): string {
  const lines = text.split("\n");
  let start = 0;
  while (
    start < lines.length &&
    (lines[start].startsWith("> ") || lines[start].trim() === "")
  ) {
    start++;
  }
  return lines.slice(start).join("\n");
}

async function main() {
  const text = stripBanner(await readStdin());

  if (has("cps")) {
    const cps = num("cps", 45);
    const perChar = cps > 0 ? 1000 / cps : 0;
    for (const ch of text) {
      process.stdout.write(ch);
      if (ch !== "\n") await sleep(perChar);
    }
    if (!text.endsWith("\n")) process.stdout.write("\n");
    return;
  }

  const lineMs = num("line-ms", 45);
  const blankMs = num("blank-ms", 400);
  const lines = text.replace(/\n$/, "").split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    process.stdout.write(line + "\n");
    await sleep(line.trim() === "" ? blankMs : lineMs);
  }
}

void main();

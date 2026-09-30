"""Build docs/demo.gif from a captured `tesla --render` terminal dump.

Not part of the product — run once when regenerating the README demo.
"""
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
TEXT = (ROOT / "demo-terminal.txt").read_text(encoding="utf-8")
# Drop the npm script banner and the blank lines before the title, so the GIF
# opens on the ledger.
LINES = [ln.rstrip("\n") for ln in TEXT.splitlines() if not ln.startswith("> ")]
while LINES and not LINES[0].strip():
    LINES.pop(0)

W, H = 920, 520
COLS, ROWS = 92, 28


def wrap(line: str) -> list[str]:
    """Wrap at COLS on word boundaries, continuing under the line's own indent."""
    if len(line) <= COLS:
        return [line]
    indent = " " * (len(line) - len(line.lstrip()) + 4)
    out, cur = [], ""
    for word in line.split(" "):
        if cur and len(cur) + 1 + len(word) > COLS:
            out.append(cur)
            cur = indent + word
        else:
            cur = f"{cur} {word}" if cur else word
    out.append(cur)
    # split(" ") dropped the leading spaces into empty words; restore them.
    out[0] = " " * (len(line) - len(line.lstrip())) + out[0].lstrip()
    return out


# Title, the first section's heading and its first row (the README's headline
# row), then the audit trailer; the rest of the ledger is elided. The whole
# ledger no longer fits a 28-row window, and a GIF that scrolls its own title
# away shows nothing a reader can place.
HEADING = next(i for i, ln in enumerate(LINES) if re.match(r"^  [A-Z][A-Z ]+ — ", ln))
ROW_END = next(i for i in range(HEADING + 3, len(LINES)) if not LINES[i].strip())
AUDIT_IDX = next(i for i, ln in enumerate(LINES) if "proposed" in ln and "admitted" in ln)
AUDIT_END = next((i for i in range(AUDIT_IDX, len(LINES)) if not LINES[i].strip()), len(LINES))
PICKED = LINES[:HEADING] + LINES[HEADING:ROW_END] + ["", "  …", ""] + LINES[AUDIT_IDX:AUDIT_END]
BG = (22, 22, 29)
FG = (232, 232, 238)
MUTED = (154, 154, 166)
ACCENT = (255, 128, 149)  # divergent / disputed heading
PAD = 20
LINE_H = 16

try:
    FONT = ImageFont.truetype("consola.ttf", 14)
except OSError:
    try:
        FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 14)
    except OSError:
        FONT = ImageFont.load_default()


def color_for(line: str) -> tuple[int, int, int]:
    if re.match(r"^  (DIVERGENT|DISPUTED) — ", line):
        return ACCENT
    if line.strip().startswith(("proposed", "provenance:")) or "audit" in line.lower():
        return MUTED
    if line.strip().startswith(("tesla ", "independent ")):
        return MUTED
    return FG


# A wrapped line keeps the color of the line it came from.
SHOW = [(part, color_for(ln)) for ln in PICKED for part in wrap(ln)]
assert len(SHOW) <= ROWS, f"{len(SHOW)} lines will not fit {ROWS} rows"


def paint(visible: list[tuple[str, tuple[int, int, int]]]) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W - 1, H - 1], outline=(44, 44, 54))
    draw.text((PAD, 8), "receipts — tesla --render reports/tesla-fsd.json", font=FONT, fill=MUTED)
    y = 32
    for line, color in visible[-ROWS:]:
        draw.text((PAD, y), line[:COLS], font=FONT, fill=color)
        y += LINE_H
    return img


frames: list[Image.Image] = []
# Reveal line-by-line, then hold on the full view.
for n in range(1, len(SHOW) + 1):
    frames.append(paint(SHOW[:n]))
# Hold the final frame so the audit line is readable.
for _ in range(18):
    frames.append(frames[-1])

out = ROOT / "demo.gif"
frames[0].save(
    out,
    save_all=True,
    append_images=frames[1:],
    duration=90,
    loop=0,
    optimize=True,
)
kb = out.stat().st_size / 1024
print(f"wrote {out} ({kb:.0f} KB, {len(frames)} frames, {len(SHOW)} lines)")

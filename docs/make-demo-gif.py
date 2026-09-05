"""Build docs/demo.gif from a captured `tesla --render` terminal dump.

Not part of the product — run once when regenerating the README demo.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
TEXT = (ROOT / "demo-terminal.txt").read_text(encoding="utf-8")
# Drop the npm script banner lines so the GIF opens on the ledger.
LINES = [ln.rstrip("\n") for ln in TEXT.splitlines() if not ln.startswith("> ")]
# Keep the divergent block and the audit trailer; skip the long middle.
DIV_END = next(i for i, ln in enumerate(LINES) if ln.startswith("  UNVERIFIED"))
AUDIT_START = next(i for i, ln in enumerate(LINES) if "audit:" in ln.lower() or ln.strip().startswith("proposed "))
# Terminal render puts the audit near the end; also match the footer style.
AUDIT_IDX = next(
    (i for i, ln in enumerate(LINES) if "proposed" in ln and "admitted" in ln),
    len(LINES) - 8,
)
SHOW = LINES[:DIV_END] + ["", "  …", ""] + LINES[AUDIT_IDX:]

W, H = 920, 520
COLS, ROWS = 92, 28
BG = (22, 22, 29)
FG = (232, 232, 238)
MUTED = (154, 154, 166)
ACCENT = (255, 128, 149)  # divergent heading
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
    if "DIVERGENT" in line:
        return ACCENT
    if line.strip().startswith("proposed") or "audit" in line.lower():
        return MUTED
    if line.strip().startswith('"') or line.strip().startswith("tesla") or line.strip().startswith("independent"):
        return MUTED
    return FG


def paint(visible: list[str]) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W - 1, H - 1], outline=(44, 44, 54))
    draw.text((PAD, 8), "receipts — tesla --render reports/tesla-fsd.json", font=FONT, fill=MUTED)
    y = 32
    for line in visible[-ROWS:]:
        draw.text((PAD, y), line[:COLS], font=FONT, fill=color_for(line))
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

"""Generate the SkillScope app icon (PNG + ICO) from code so it is reproducible.

The mark mirrors the in-app wordmark: three lane dots for Claude Code, Codex and Cursor
on the green-black ink colour. Run with: python3 -I scripts/generate-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "desktop" / "build"

SIZE = 1024
INK = (28, 36, 32, 255)
PAPER_RULE = (58, 70, 64, 255)
LANES = [(200, 150, 216, 255), (143, 169, 245, 255), (92, 201, 172, 255)]


def draw(size: int) -> Image.Image:
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    margin = int(s * 0.06)
    radius = int(s * 0.22)
    d.rounded_rectangle([margin, margin, s - margin, s - margin], radius=radius, fill=INK)
    # Faint graph-paper rule under the dots.
    y = s // 2
    d.line([(int(s * 0.2), y + int(s * 0.14)), (int(s * 0.8), y + int(s * 0.14))], fill=PAPER_RULE, width=max(2, s // 160))
    r = int(s * 0.085)
    gap = int(s * 0.21)
    cx = s // 2
    for i, colour in enumerate(LANES):
        x = cx + (i - 1) * gap
        d.ellipse([x - r, y - r, x + r, y + r], fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = draw(SIZE)
    icon.save(OUT / "icon.png")
    icon.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {OUT / 'icon.png'} and {OUT / 'icon.ico'}")


if __name__ == "__main__":
    main()

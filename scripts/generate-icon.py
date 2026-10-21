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


# Sizes the hicolor icon theme indexes on Ubuntu/GNOME. A 1024 px icon alone is not found.
LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256]


def draw(size: int) -> Image.Image:
    """Render at the target size (supersampled) so small icons stay crisp, not just downscaled."""
    small = size <= 32
    scale = 8 if small else 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    margin = int(s * (0.02 if small else 0.06))
    radius = int(s * 0.22)
    d.rounded_rectangle([margin, margin, s - margin, s - margin], radius=radius, fill=INK)
    y = s // 2
    if not small:
        # Faint graph-paper rule under the dots; dropped at small sizes where it would blur.
        d.line([(int(s * 0.2), y + int(s * 0.14)), (int(s * 0.8), y + int(s * 0.14))], fill=PAPER_RULE, width=max(2, s // 160))
    # Larger dots at small sizes so the three lanes stay distinguishable in a 16 px taskbar.
    r = int(s * (0.115 if small else 0.085))
    gap = int(s * (0.27 if small else 0.21))
    cx = s // 2
    for i, colour in enumerate(LANES):
        x = cx + (i - 1) * gap
        d.ellipse([x - r, y - r, x + r, y + r], fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(SIZE).save(OUT / "icon.png")
    icons_dir = OUT / "icons"
    icons_dir.mkdir(exist_ok=True)
    for size in LINUX_SIZES:
        draw(size).save(icons_dir / f"{size}x{size}.png")
    frames = [draw(size) for size in WINDOWS_SIZES]
    frames[-1].save(
        OUT / "icon.ico",
        sizes=[(size, size) for size in WINDOWS_SIZES],
        append_images=frames[:-1],
    )
    print(f"wrote {OUT / 'icon.png'}, {OUT / 'icon.ico'} and {len(LINUX_SIZES)} PNGs in {icons_dir}")


if __name__ == "__main__":
    main()

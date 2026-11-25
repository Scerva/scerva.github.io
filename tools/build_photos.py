"""
Convert the originals in imgs/ (HEIC / JPG) into web-ready JPEGs in photos/,
and write photos/manifest.json with each photo's capture date and dominant color.

  - Output is resized (long edge <= 2000px), orientation applied, and ALL metadata
    stripped (iPhone photos carry GPS coordinates; those never reach the site).
  - Originals in imgs/ are never modified.

Usage (needs Pillow + pillow-heif):
    python3 -m pip install pillow pillow-heif
    python3 tools/build_photos.py
"""

import json
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "imgs"
OUT = ROOT / "photos"
LONG_EDGE = 2000
EXTS = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp"}


def capture_date(im):
    ex = im.getexif()
    raw = ex.get_ifd(0x8769).get(36867) or ex.get(306)  # DateTimeOriginal, else DateTime
    if not raw:
        return None
    try:
        dt = datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    # A camera whose clock was never set reports its factory default (e.g. 1983);
    # treat anything before 2000 as unknown rather than print a wrong date.
    return dt.isoformat() if dt.year >= 2000 else None


def dominant_color(im):
    """
    The color the eye reads as "the photo's color": quantize a thumbnail into
    clusters, then pick the cluster with the best population x vividness score.
    Pure pixel count tends to crown deep shadows; this nudges toward the sky,
    the snow, the sunset — while truly dark night shots still come out dark.
    """
    small = im.convert("RGB").resize((96, 96), Image.Resampling.BILINEAR)
    q = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    best, best_score = None, -1.0
    for count, idx in q.getcolors():
        r, g, b = (c / 255 for c in pal[idx * 3 : idx * 3 + 3])
        hi, lo = max(r, g, b), min(r, g, b)
        chroma = hi - lo
        light = (hi + lo) / 2
        score = count * (0.35 + chroma) * (0.4 + 0.6 * min(1.0, light / 0.3))
        if score > best_score:
            best, best_score = pal[idx * 3 : idx * 3 + 3], score
    return best


def main():
    OUT.mkdir(exist_ok=True)
    manifest = {}
    for src in sorted(p for p in SRC.iterdir() if p.suffix.lower() in EXTS):
        im = Image.open(src)
        date = capture_date(im)
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((LONG_EDGE, LONG_EDGE), Image.Resampling.LANCZOS)
        color = dominant_color(im)

        dest = OUT / (src.stem + ".jpg")
        # Saving without exif= drops all metadata, GPS included.
        im.save(dest, "JPEG", quality=82, optimize=True, progressive=True)

        key = f"photos/{dest.name}"
        manifest[key] = {"date": date, "color": color, "width": im.width, "height": im.height}
        print(f"{src.name:16} -> {key:24} {date or 'no date':20} rgb{tuple(color)}")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\n{len(manifest)} photos -> {OUT.relative_to(ROOT)}/manifest.json")


if __name__ == "__main__":
    main()

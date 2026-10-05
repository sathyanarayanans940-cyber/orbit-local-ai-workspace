"""Optional font rebuild. Use FontTools and a licensed DejaVu font directory.

The prebuilt, licensed WOFF files ship with Orbit; users/installers need no
FontTools or desktop fonts. Keep common Latin, Greek and mathematical notation.
"""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument("source_dir", type=Path)
args = parser.parse_args()
destination = Path(__file__).resolve().parents[1] / "vendor/widgets/fonts"
destination.mkdir(parents=True, exist_ok=True)
codes = set(range(0x20, 0x530)) | set(range(0x1E00, 0x1F00)) | set(range(0x2000, 0x2400)) | set(range(0x1D400, 0x1D800))
for style, name in [("normal", "DejaVuSans"), ("bold", "DejaVuSans-Bold"), ("italics", "DejaVuSans-Oblique"), ("bolditalics", "DejaVuSans-BoldOblique")]:
    font = TTFont(args.source_dir / (name + ".ttf"), recalcTimestamp=False)
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_legacy = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(font)
    font.flavor = "woff"
    font.save(destination / ("Symbols-" + style + ".woff"))

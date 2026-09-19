"""Render launcher PNGs from the selected concept's Android vector paths.

Requires CairoSVG and Pillow. Run with python3 android-app/generate_icons.py.
"""

from io import BytesIO
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image


RES = Path(__file__).resolve().parent / "app/src/main/res"
ANDROID = "{http://schemas.android.com/apk/res/android}"
vector = ET.parse(RES / "drawable/ic_launcher_foreground.xml").getroot()
group = vector.find("group")
paths = "".join(
    f'<path fill="{p.attrib[ANDROID + "fillColor"]}" d="{p.attrib[ANDROID + "pathData"]}"/>'
    for p in group.findall("path")
)
background = ET.parse(RES / "drawable/ic_launcher_background.xml").getroot()
color = background.find("solid").attrib[ANDROID + "color"]
transform = (
    f'translate({group.attrib[ANDROID + "translateX"]} {group.attrib[ANDROID + "translateY"]}) '
    f'scale({group.attrib[ANDROID + "scaleX"]} {group.attrib[ANDROID + "scaleY"]})'
)
artworks = {
    "ic_launcher": (256, f'<rect width="256" height="256" rx="58" fill="{color}"/>{paths}'),
    "ic_launcher_round": (256, f'<circle cx="128" cy="128" r="128" fill="{color}"/>{paths}'),
    "ic_launcher_foreground": (108, f'<g transform="{transform}">{paths}</g>'),
}
for density, scale in [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]:
    for name, (viewport, artwork) in artworks.items():
        size = round((108 if name.endswith("foreground") else 48) * scale)
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {viewport} {viewport}">{artwork}</svg>'
        # Supersampling preserves smooth edges at launcher sizes.
        rendered = cairosvg.svg2png(bytestring=svg.encode(), output_width=size * 4, output_height=size * 4)
        image = Image.open(BytesIO(rendered)).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
        target = RES / f"mipmap-{density}" / f"{name}.png"
        image.save(target)
        with Image.open(target) as saved:
            assert saved.size == (size, size)
            if name.endswith("foreground"):
                # Check every visible pixel against Android's 33dp safe radius.
                for y in range(size):
                    for x in range(size):
                        if saved.getpixel((x, y))[3]:
                            assert ((x + 0.5 - size / 2) / scale) ** 2 + ((y + 0.5 - size / 2) / scale) ** 2 <= 33 ** 2
        print(f"Verified {target.relative_to(RES)}: {size}x{size}")

"""Build the Windows icon from the checked-in 512px launcher artwork."""

from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parent
with Image.open(assets / "icon.png") as image:
    image.save(
        assets / "icon.ico",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )

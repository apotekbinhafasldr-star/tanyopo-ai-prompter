"""Re-render public/brand/linoe/og-linoe-1200x630.png from scripts/og/og.html.

Uses the unmodified official logo (public/brand/linoe/linoe-logo-official.png —
a JPEG with a .png extension; Chromium decodes by content). Never use the
legacy linoe-logo-vertical.png. Run: python3 scripts/og/render.py
"""
import pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent
out = root.parent.parent / "public/brand/linoe/og-linoe-1200x630.png"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.goto((root / "og.html").as_uri())
    pg.screenshot(path=str(out))
    b.close()

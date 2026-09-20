"""Regenerate the picture in the Field map's nav hover preview
(public/images/page-previews/map.webp).

Every other page's preview shows its featured cards, so the map is the only
capture. It is taken of the map itself (not the page around it) at 1200px
wide, at full resolution so the labels stay legible when the preview shows it
scaled down, and saved as WebP. Run against a running site:

    python3 scripts/capture-page-previews.py http://localhost:3000

Needs `pip install playwright pillow` and `python3 -m playwright install chromium`.
"""
import os, sys
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000').rstrip('/')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'images', 'page-previews')
# Hide the nav bar and anything floating over the page (the chatbot bubble),
# so only the map is left at the top.
HIDE = """() => {
  const nav = document.querySelector('nav');
  if (nav) nav.parentElement.parentElement.style.setProperty('display', 'none', 'important');
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).position === 'fixed') el.style.setProperty('display', 'none', 'important');
  }
  window.scrollTo(0, 0);
}"""

os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 750}, device_scale_factor=1)
    page.goto(f'{BASE}/map', wait_until='networkidle', timeout=240000)
    page.wait_for_timeout(1200)
    page.evaluate(HIDE)
    page.wait_for_timeout(300)
    tmp = os.path.join(OUT, 'map.png')
    page.locator('[class*="map-container"]').first.screenshot(path=tmp)
    browser.close()

image = Image.open(tmp).convert('RGB')
image.save(os.path.join(OUT, 'map.webp'), 'WEBP', quality=85)
os.remove(tmp)
print('captured map', image.size)

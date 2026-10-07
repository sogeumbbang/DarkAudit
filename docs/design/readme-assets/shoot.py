import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":960,"height":800},device_scale_factor=2)
    pg.goto("file://"+os.path.abspath("assets.html")); pg.wait_for_timeout(800)
    for i in ["banner","flow","hybrid","arch","types"]:
        pg.locator(f"#{i} .card").screenshot(path=f"../../images/readme/{i}.png",omit_background=True)
    b.close()

"""Capture the installed demo with the production runner's safe tap selection."""
from pathlib import Path
import argparse
import json
import subprocess
import time
import sys
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.api.android_runner import _tap_candidates
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--adb", default="adb")
parser.add_argument("--device", default="emulator-5554")
args = parser.parse_args()
ADB = args.adb
DEVICE = args.device
OUT = ROOT / "demo/previews"

def adb(*args, binary=False):
    return subprocess.check_output([ADB, "-s", DEVICE, *args], text=not binary, timeout=30)

adb("shell", "am", "force-stop", "com.darkaudit.demo")
adb("shell", "am", "start", "-n", "com.darkaudit.demo/.MainActivity")
time.sleep(1)
records = []
for step in range(1, 7):
    adb("shell", "uiautomator", "dump", "/sdcard/darkaudit-demo.xml")
    source = adb("shell", "cat", "/sdcard/darkaudit-demo.xml")
    texts = [n.get("text", "") for n in ET.fromstring(source).iter("node") if n.get("text")]
    assert any(f"{step} / 6" in t for t in texts), (step, texts)
    (OUT / f"android-{step:02d}.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    candidates = _tap_candidates(source, set(), goal="다음 버튼으로 6단계 최종 이용료까지 확인")
    records.append({"step": step, "visible_text": texts, "candidates": [c.label for c in candidates]})
    if step < 6:
        assert candidates, (step, texts)
        target = candidates[0]
        adb("shell", "input", "tap", str(target.x), str(target.y))
        time.sleep(.3)
assert any("8,400" in t for t in records[-1]["visible_text"])
first = Image.open(OUT / "android-01.png")
preview_height = round(393 * first.height / first.width)
sheet = Image.new("RGB", (1259, 2 * (preview_height + 40) + 30), "#e9edf3")
draw = ImageDraw.Draw(sheet)
for index in range(6):
    x, y = 20 + index % 3 * 413, 30 + index // 3 * (preview_height + 40)
    draw.text((x, y-17), f"ANDROID / {index+1:02d}", fill="#324255")
    im=Image.open(OUT/f"android-{index+1:02d}.png").convert("RGB")
    im.thumbnail((393,852)); sheet.paste(im,(x,y))
sheet.save(OUT / "android-overview.png")
(OUT/"android-validation.json").write_text(json.dumps(records, ensure_ascii=False, indent=2)+"\n")
print("Validated six native screens using production safe tap selection.")

"""S10 컨택트 시트 — 라벨 붙은 타일을 1456×816 JPEG 로 묶는다. 1차 분석(시트 몇 장)·2차(3프레임 스트립)."""
from __future__ import annotations

import json
import math
from typing import Dict, List

from PIL import Image, ImageDraw, ImageFont


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf", "C:/Windows/Fonts/consola.ttf", "DejaVuSansMono.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _fit(img: Image.Image, w: int, h: int) -> Image.Image:
    """비율 유지해 w×h 안에 넣고 검은 여백 (레터박스)"""
    img = img.convert("RGB")
    s = min(w / img.width, h / img.height)
    nw, nh = max(1, int(img.width * s)), max(1, int(img.height * s))
    small = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), (0, 0, 0))
    canvas.paste(small, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def contact_sheets(tiles: List[Dict], out_prefix: str, sheet_w: int = 1456, sheet_h: int = 816, cols: int = 5, label_h: int = 18, quality: int = 82) -> List[str]:
    """tiles: [{image, label}] → out_prefix_01.jpg … 칸이 모자라면 다음 장으로. 컷 단위로 줄바꿈하지 않는다(빈칸 = 토큰 낭비)."""
    pad = 4
    tile_w = (sheet_w - pad * (cols + 1)) // cols
    tile_h = int(round(tile_w * 9 / 16))
    rows = max(1, (sheet_h - pad) // (tile_h + label_h + pad))
    per = cols * rows
    font = _font(13)
    outs: List[str] = []
    for si in range(math.ceil(len(tiles) / per) if tiles else 0):
        sheet = Image.new("RGB", (sheet_w, sheet_h), (24, 24, 24))
        draw = ImageDraw.Draw(sheet)
        for k, t in enumerate(tiles[si * per : (si + 1) * per]):
            r, c = divmod(k, cols)
            x = pad + c * (tile_w + pad)
            y = pad + r * (tile_h + label_h + pad)
            draw.rectangle([x, y, x + tile_w - 1, y + label_h - 1], fill=(250, 220, 60))
            draw.text((x + 4, y + 2), str(t.get("label", ""))[:34], fill=(0, 0, 0), font=font)
            try:
                with Image.open(t["image"]) as im:
                    sheet.paste(_fit(im, tile_w, tile_h), (x, y + label_h))
            except Exception:
                draw.rectangle([x, y + label_h, x + tile_w - 1, y + label_h + tile_h - 1], outline=(200, 60, 60))
        path = f"{out_prefix}_{si + 1:02d}.jpg"
        sheet.save(path, "JPEG", quality=quality, optimize=True)
        outs.append(path)
    return outs


def strip_sheets(rows: List[Dict], out_prefix: str, sheet_w: int = 1456, per_sheet: int = 4, label_h: int = 20, quality: int = 85) -> List[str]:
    """2차 분석용: 패널마다 한 줄 = [시작·가운데·끝] 3프레임. rows: [{label, images:[3]}]"""
    pad = 4
    tile_w = (sheet_w - pad * 4) // 3
    tile_h = int(round(tile_w * 9 / 16))
    font = _font(14)
    outs: List[str] = []
    for si in range(math.ceil(len(rows) / per_sheet) if rows else 0):
        chunk = rows[si * per_sheet : (si + 1) * per_sheet]
        h = pad + len(chunk) * (label_h + tile_h + pad)
        sheet = Image.new("RGB", (sheet_w, h), (24, 24, 24))
        draw = ImageDraw.Draw(sheet)
        for r, row in enumerate(chunk):
            y = pad + r * (label_h + tile_h + pad)
            draw.rectangle([pad, y, sheet_w - pad - 1, y + label_h - 1], fill=(250, 220, 60))
            draw.text((pad + 4, y + 2), str(row.get("label", ""))[:90], fill=(0, 0, 0), font=font)
            for c, p in enumerate(row.get("images", [])[:3]):
                x = pad + c * (tile_w + pad)
                try:
                    with Image.open(p) as im:
                        sheet.paste(_fit(im, tile_w, tile_h), (x, y + label_h))
                except Exception:
                    pass
        path = f"{out_prefix}_{si + 1:02d}.jpg"
        sheet.save(path, "JPEG", quality=quality, optimize=True)
        outs.append(path)
    return outs


def run_spec(spec_path: str) -> Dict:
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    out: Dict = {}
    if spec.get("tiles") is not None:
        out["sheets"] = contact_sheets(spec["tiles"], spec["out_prefix"], cols=spec.get("cols", 5))
    if spec.get("strips") is not None:
        out["strips"] = strip_sheets(spec["strips"], spec.get("strip_prefix", spec["out_prefix"] + "_strip"))
    return out

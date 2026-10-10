"""CLI — 앱(main)이 uv 로 부른다. 진행은 stdout JSONL `{"stage":…, "progress":…}`, 결과는 --out 파일.

  python -m conti_media measure --input proxy.mp4 --out measure.json
  python -m conti_media sheets  --spec spec.json --out sheets.json
  python -m conti_media asr     --input audio.wav --out asr.json [--model large-v3-turbo] [--hotwords "해수 의현"]
  python -m conti_media check
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from . import MEASURE_VERSION, __version__


def emit(**kw) -> None:
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def progress(stage: str, p: float) -> None:
    emit(stage=stage, progress=round(p, 3))


def write(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="conti_media")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("measure")
    m.add_argument("--input", required=True)
    m.add_argument("--out", required=True)
    m.add_argument("--rate", type=float, default=8.0)
    m.add_argument("--threshold", type=float, default=27.0)
    m.add_argument("--adaptive", type=float, default=3.0)
    m.add_argument("--min-scene", type=int, default=6)
    s = sub.add_parser("sheets")
    s.add_argument("--spec", required=True)
    s.add_argument("--out", required=True)
    a = sub.add_parser("asr")
    a.add_argument("--input", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--model", default="large-v3-turbo")
    a.add_argument("--lang", default="auto")
    a.add_argument("--hotwords", default=None)
    sub.add_parser("check")
    args = ap.parse_args(argv)
    t0 = time.time()
    try:
        if args.cmd == "check":
            import cv2
            import numpy
            import PIL
            import scenedetect

            info = {"conti_media": __version__, "measure_version": MEASURE_VERSION, "python": sys.version.split()[0], "cv2": cv2.__version__, "numpy": numpy.__version__, "PIL": PIL.__version__, "scenedetect": scenedetect.__version__}
            try:
                import faster_whisper

                info["faster_whisper"] = faster_whisper.__version__
            except Exception:
                info["faster_whisper"] = None
            emit(stage="check", progress=1.0, info=info)
            return 0
        if args.cmd == "measure":
            from .measure import measure

            data = measure(args.input, rate=args.rate, threshold=args.threshold, adaptive=args.adaptive, min_scene=args.min_scene, progress=progress)
            data["version"] = MEASURE_VERSION
        elif args.cmd == "sheets":
            from .sheets import run_spec

            data = run_spec(args.spec)
        else:
            from .asr import transcribe

            data = transcribe(args.input, model=args.model, lang=args.lang, hotwords=args.hotwords, progress=progress)
        data["elapsed"] = round(time.time() - t0, 2)
        write(args.out, data)
        emit(stage="done", progress=1.0, out=args.out, elapsed=data["elapsed"])
        return 0
    except Exception as e:  # 앱이 메시지를 그대로 보여준다
        emit(stage="error", error=f"{type(e).__name__}: {e}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

"""합성 영상으로 측정 검증 — ffmpeg 이 있으면 돈다. python -m unittest discover -s tests"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conti_media.asr import is_hallucination  # noqa: E402
from conti_media.measure import direction, hamming, measure  # noqa: E402
from conti_media.sheets import contact_sheets  # noqa: E402

FFMPEG = shutil.which("ffmpeg")


def synth(path: str) -> None:
    """3초 테스트패턴 | 3초 만델브로 줌 | 2초 정지 컬러바 | 4초 오른쪽 팬 — 컷 3개"""
    fc = (
        "[1:v]trim=duration=3,setpts=PTS-STARTPTS[m];"
        "[3:v]drawgrid=w=80:h=80:t=3:c=white@0.8,drawbox=x=300:y=200:w=200:h=200:c=red:t=fill,crop=1280:720:'t*300':0,setpts=PTS-STARTPTS[pan];"
        "[0:v][m][2:v][pan]concat=n=4:v=1:a=0,format=yuv420p[v]"
    )
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=3",
         "-f", "lavfi", "-i", "mandelbrot=size=1280x720:rate=24",
         "-f", "lavfi", "-i", "smptehdbars=size=1280x720:rate=24:duration=2",
         "-f", "lavfi", "-i", "color=c=0x334455:size=2560x720:rate=24:duration=4",
         "-filter_complex", fc, "-map", "[v]", "-c:v", "libx264", "-g", "1", "-crf", "23", path],
        check=True,
    )


@unittest.skipUnless(FFMPEG, "ffmpeg 필요")
class MeasureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.video = os.path.join(cls.dir, "synth.mp4")
        synth(cls.video)
        cls.m = measure(cls.video)

    def test_cuts(self):
        cuts = [b["t"] for b in self.m["boundaries"] if b["verdict"] in ("cut", "uncertain")]
        self.assertEqual(cuts, [3.0, 6.0, 8.0])
        self.assertEqual([s["t0"] for s in self.m["segments"]], [0.0, 3.0, 6.0, 8.0])

    def test_camera(self):
        labels = [(s["camera"]["label"], s["camera"]["dir"]) for s in self.m["segments"]]
        self.assertEqual(labels[1][0], "ZOOM IN")
        self.assertEqual(labels[2][0], "STATIC")
        self.assertEqual(labels[3], ("PAN", "→"))

    def test_longtake_split_and_keys(self):
        pan = self.m["segments"][3]
        self.assertEqual(len(pan["panels"]), 2)
        self.assertEqual(pan["panels"][1]["split"], "view")
        for s in self.m["segments"]:
            for p in s["panels"]:
                self.assertTrue(p["t0"] <= p["key"] < p["t1"])

    def test_samples(self):
        self.assertAlmostEqual(len(self.m["samples"]), 96, delta=2)
        self.assertEqual(len(self.m["samples"][0]["phash"]), 16)

    def test_sheet(self):
        tiles = []
        for i in range(23):
            p = os.path.join(self.dir, f"k{i}.jpg")
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(i * 0.5), "-i", self.video, "-frames:v", "1", p], check=True)
            tiles.append({"image": p, "label": f"{(i + 1) * 10:04d} 00:{i * 0.5:04.1f}"})
        outs = contact_sheets(tiles, os.path.join(self.dir, "sheet"))
        self.assertEqual(len(outs), 2)  # 20칸 + 3칸
        from PIL import Image

        with Image.open(outs[0]) as im:
            self.assertEqual(im.size, (1456, 816))


class PureTest(unittest.TestCase):
    def test_helpers(self):
        self.assertEqual(direction(1, 0), "→")
        self.assertEqual(direction(0, -1), "↑")
        self.assertEqual(direction(0, 0), "")
        self.assertEqual(hamming(0b1011, 0b0001), 2)
        self.assertTrue(is_hallucination("시청해주셔서 감사합니다"))
        self.assertTrue(is_hallucination("..."))
        self.assertFalse(is_hallucination("여기서 멈춰."))


if __name__ == "__main__":
    unittest.main()

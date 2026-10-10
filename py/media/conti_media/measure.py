"""영상 측정 (플랜 §4 S3–S8) — 컷 후보·검증, 8fps 샘플(선명도·모션·pHash·색), 카메라 라벨, 롱테이크 패널 분할, 키프레임.

입력은 분석용 프록시(960px CFR 올-키프레임). 모든 값은 결정적이고 토큰을 쓰지 않는다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

Progress = Callable[[str, float], None]


# ── 프레임 읽기 ────────────────────────────────────────────────────────────


def video_info(path: str) -> Tuple[float, int, int, int]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"영상을 열 수 없습니다: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return float(fps), n, w, h


def read_frame(cap: "cv2.VideoCapture", idx: int) -> Optional[np.ndarray]:
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, idx))
    ok, frame = cap.read()
    return frame if ok else None


def gray_small(frame: np.ndarray, width: int) -> np.ndarray:
    h, w = frame.shape[:2]
    s = width / float(w)
    small = cv2.resize(frame, (width, max(2, int(round(h * s)))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)


# ── 지표 ──────────────────────────────────────────────────────────────────


def phash(gray: np.ndarray) -> int:
    """32×32 DCT 저주파 8×8 의 중앙값 비교 — 64비트 지각 해시."""
    img = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    d = cv2.dct(img)[:8, :8]
    med = np.median(d[1:, 1:]) if d.size > 1 else 0
    bits = (d > med).flatten()
    v = 0
    for b in bits:
        v = (v << 1) | int(b)
    return v


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def mean_lab(frame: np.ndarray) -> List[float]:
    small = cv2.resize(frame, (32, 18), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    m = lab.mean(axis=0)
    # OpenCV 8비트 Lab → L 0..100, a/b -128..127
    return [round(float(m[0]) * 100 / 255, 2), round(float(m[1]) - 128, 2), round(float(m[2]) - 128, 2)]


@dataclass
class Motion:
    dx: float = 0.0  # 화면 내용의 이동 (프레임 폭 대비). 카메라 팬 오른쪽 → 내용은 왼쪽(-)
    dy: float = 0.0
    scale: float = 1.0
    rot: float = 0.0  # 도
    inliers: float = 0.0  # RANSAC 인라이어 비율
    tracked: int = 0
    subject: float = 0.0  # 카메라 움직임을 뺀 잔여 이동 크기 (프레임 폭 대비)
    subject_dx: float = 0.0
    subject_dy: float = 0.0
    ok: bool = False


def estimate_motion(prev: np.ndarray, cur: np.ndarray) -> Motion:
    """특징점 LK 추적 + 유사변환 RANSAC. 피사체 = 카메라 모델에 안 맞는 점들의 잔여 이동."""
    h, w = prev.shape[:2]
    m = Motion()
    pts = cv2.goodFeaturesToTrack(prev, maxCorners=220, qualityLevel=0.01, minDistance=7, blockSize=7)
    if pts is None or len(pts) < 12:
        return m
    nxt, st, err = cv2.calcOpticalFlowPyrLK(prev, cur, pts, None, winSize=(21, 21), maxLevel=3)
    if nxt is None:
        return m
    good = st.reshape(-1) == 1
    p0 = pts.reshape(-1, 2)[good]
    p1 = nxt.reshape(-1, 2)[good]
    m.tracked = int(good.sum())
    if len(p0) < 10:
        return m
    A, inl = cv2.estimateAffinePartial2D(p0, p1, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=500)
    if A is None:
        return m
    inl = inl.reshape(-1).astype(bool)
    a, b = float(A[0, 0]), float(A[1, 0])
    m.scale = math.hypot(a, b)
    m.rot = math.degrees(math.atan2(b, a))
    m.dx = float(A[0, 2]) / w
    m.dy = float(A[1, 2]) / w
    m.inliers = float(inl.mean()) if len(inl) else 0.0
    # 인라이어가 적으면 카메라 모델이 아니라 블러·피사체를 맞춘 것 — 카메라 이동으로 세지 않는다
    if m.inliers < 0.35:
        m.subject = float(np.median(np.hypot(*(p1 - p0).T)) / w)
        return m
    out = ~inl
    if out.sum() >= 4:
        pred = (p0[out] @ A[:, :2].T) + A[:, 2]
        res = p1[out] - pred
        mag = np.hypot(res[:, 0], res[:, 1]) / w
        m.subject = float(np.median(mag)) * float(out.mean())
        m.subject_dx = float(np.median(res[:, 0])) / w
        m.subject_dy = float(np.median(res[:, 1])) / w
    m.ok = True
    return m


def track_ratio(a: np.ndarray, b: np.ndarray) -> float:
    """a 의 특징점 중 b 로 추적되고 RANSAC 에 맞는 비율 (0..1). 컷 너머로는 낮다."""
    pts = cv2.goodFeaturesToTrack(a, maxCorners=150, qualityLevel=0.01, minDistance=5)
    if pts is None or len(pts) < 8:
        # 질감 없는 화면 — 밝기 차이로 대신
        diff = float(np.mean(cv2.absdiff(a, b))) / 255.0
        return max(0.0, 1.0 - diff * 6)
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pts, None, winSize=(15, 15), maxLevel=2)
    if nxt is None:
        return 0.0
    good = st.reshape(-1) == 1
    if good.sum() < 6:
        return float(good.mean()) * 0.5
    A, inl = cv2.estimateAffinePartial2D(pts.reshape(-1, 2)[good], nxt.reshape(-1, 2)[good], method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if A is None:
        return 0.0
    return float(inl.reshape(-1).sum()) / float(len(pts))


# ── S3 컷 후보 ─────────────────────────────────────────────────────────────


def detect_candidates(path: str, threshold: float, adaptive: float, min_len: int) -> List[int]:
    """PySceneDetect Content ∪ Adaptive (같은 SceneManager 에 두면 컷 목록이 합쳐진다)."""
    from scenedetect import SceneManager, open_video
    from scenedetect.detectors import AdaptiveDetector, ContentDetector

    video = open_video(path)
    sm = SceneManager()
    sm.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_len))
    sm.add_detector(AdaptiveDetector(adaptive_threshold=adaptive, min_scene_len=min_len))
    sm.detect_scenes(video, show_progress=False)
    scenes = sm.get_scene_list()
    cuts = sorted({int(s[0].get_frames()) for s in scenes[1:]})
    return cuts


# ── S4 컷 검증 ─────────────────────────────────────────────────────────────


@dataclass
class Boundary:
    frame: int
    t: float
    verdict: str  # cut | uncertain | same
    cross: float
    inside: float
    hash_diff: int


def verify_cuts(path: str, fps: float, cands: List[int], low: float = 0.12, gap: float = 0.15, high: float = 0.25) -> List[Boundary]:
    cap = cv2.VideoCapture(path)
    out: List[Boundary] = []
    for f in cands:
        fa = read_frame(cap, f - 2)
        fb = read_frame(cap, f + 1)
        fc = read_frame(cap, f - 4)
        if fa is None or fb is None:
            continue
        ga, gb = gray_small(fa, 192), gray_small(fb, 192)
        cross = track_ratio(ga, gb)
        inside = track_ratio(gray_small(fc, 192), ga) if fc is not None else 1.0
        hd = hamming(phash(ga), phash(gb))
        if cross <= low and cross < inside - gap:
            v = "cut"
        elif cross >= high:
            v = "same"
        else:
            v = "uncertain" if hd >= 12 else "same"
        out.append(Boundary(frame=f, t=round(f / fps, 3), verdict=v, cross=round(cross, 3), inside=round(inside, 3), hash_diff=hd))
    cap.release()
    return out


# ── S5 샘플 ───────────────────────────────────────────────────────────────


@dataclass
class Sample:
    t: float
    frame: int
    sharp: float
    phash: str
    lab: List[float]
    motion: Motion = field(default_factory=Motion)


def sample_video(path: str, fps: float, n_frames: int, rate: float, progress: Optional[Progress] = None) -> List[Sample]:
    step = max(1, int(round(fps / rate)))
    cap = cv2.VideoCapture(path)
    out: List[Sample] = []
    prev_g: Optional[np.ndarray] = None
    idx = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if idx % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            g = gray_small(frame, 320)
            s = Sample(t=round(idx / fps, 3), frame=idx, sharp=round(sharpness(g), 1), phash=f"{phash(g):016x}", lab=mean_lab(frame))
            if prev_g is not None:
                s.motion = estimate_motion(prev_g, g)
            prev_g = g
            out.append(s)
            if progress and n_frames and len(out) % 40 == 0:
                progress("samples", min(0.99, idx / n_frames))
        idx += 1
    cap.release()
    return out


# ── 카메라 라벨 ────────────────────────────────────────────────────────────


@dataclass
class Camera:
    label: str  # STATIC | PAN | TILT | ZOOM IN | ZOOM OUT | DOLLY IN | DOLLY OUT | ROLL | WHIP | HANDHELD
    dir: str  # → ← ↑ ↓ ↗ … 또는 ''
    size: str  # small | medium | large
    travel: float
    scale: float
    rot: float
    jitter: float
    parallax: float
    reliable: bool
    path: List[List[float]]  # 화살표용 카메라 경로 (0..1, 중앙 출발)
    end_quad: Optional[List[float]]  # 줌 끝 프레임 [x0,y0,x1,y1]


ARROWS = {(1, 0): "→", (-1, 0): "←", (0, -1): "↑", (0, 1): "↓", (1, -1): "↗", (-1, -1): "↖", (1, 1): "↘", (-1, 1): "↙"}


def direction(dx: float, dy: float) -> str:
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return ""
    ang = math.atan2(dy, dx)
    oct_ = int(round(ang / (math.pi / 4))) % 8
    vec = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)][oct_]
    return ARROWS[vec]


def camera_for(samples: List[Sample]) -> Camera:
    ms = [s.motion for s in samples[1:]]
    good = [m for m in ms if m.ok]
    reliable = len(ms) == 0 or len(good) >= max(1, int(0.6 * len(ms)))
    cx = cy = 0.0
    path = [[0.5, 0.5]]
    scale = 1.0
    rot = 0.0
    txs: List[float] = []
    max_step = 0.0
    for m in good:
        # 카메라 이동 = 내용 이동의 반대
        cx -= m.dx
        cy -= m.dy
        scale *= m.scale
        rot += m.rot
        txs.append(m.dx)
        max_step = max(max_step, math.hypot(m.dx, m.dy))
        path.append([0.5 + cx, 0.5 + cy])
    travel = math.hypot(cx, cy)
    jitter = 0.0
    if len(txs) >= 5:
        arr = np.array(txs)
        smooth = np.convolve(arr, np.ones(5) / 5, mode="same")
        jitter = float(np.std(arr - smooth))
    subj = [m.subject for m in good]
    glob = [math.hypot(m.dx, m.dy) + abs(m.scale - 1) for m in good]
    parallax = float(np.mean(subj) / max(1e-6, np.mean(glob))) if good and np.mean(glob) > 1e-4 else 0.0
    zoom = math.log(max(1e-6, scale))
    if max_step > 0.2:
        label = "WHIP"
    elif abs(zoom) > 0.08 and abs(zoom) * 1.0 >= travel * 0.8:
        inward = zoom > 0
        label = ("DOLLY " if parallax > 0.25 else "ZOOM ") + ("IN" if inward else "OUT")
    elif abs(rot) >= 15:
        label = "ROLL"
    elif travel > 0.15:
        label = "PAN" if abs(cx) >= abs(cy) else "TILT"
    elif jitter > 0.004:
        label = "HANDHELD"
    else:
        label = "STATIC"
    mag = max(travel, abs(zoom))
    size = "small" if mag < 0.3 else "medium" if mag < 0.8 else "large"
    # 화살표 경로: 0.1..0.9 안에 들어오게 비율 축소, 최대 8점
    pts = np.array(path)
    span = max(1e-6, float(np.max(np.abs(pts - 0.5))))
    k = min(1.0, 0.38 / span)
    pts = 0.5 + (pts - 0.5) * k
    if len(pts) > 8:
        idx = np.linspace(0, len(pts) - 1, 8).round().astype(int)
        pts = pts[idx]
    end_quad = None
    if label.startswith("ZOOM") or label.startswith("DOLLY"):
        half = 0.5 / max(0.2, scale) if scale > 1 else 0.5
        if scale < 1:
            half = 0.5 * max(0.2, scale)
        end_quad = [round(0.5 - half, 3), round(0.5 - half, 3), round(0.5 + half, 3), round(0.5 + half, 3)]
    return Camera(
        label=label,
        dir=direction(cx, cy) if label in ("PAN", "TILT", "WHIP") else "",
        size=size,
        travel=round(travel, 4),
        scale=round(scale, 4),
        rot=round(rot, 2),
        jitter=round(jitter, 5),
        parallax=round(parallax, 3),
        reliable=reliable,
        path=[[round(float(x), 3), round(float(y), 3)] for x, y in pts],
        end_quad=end_quad,
    )


# ── S7 패널 분할 (롱테이크·애니매틱 그림 전환) ──────────────────────────────


def split_panels(samples: List[Sample], t0: float, t1: float, min_sec: float = 1.0) -> List[Tuple[float, float, str]]:
    """구간 [t0,t1) 을 패널로 나눈다. 기준 프레임 대비 시야 이동 >0.5, 배율 0.67–1.5 밖, 롤 ≥15° 면 분할(view),
    카메라는 거의 그대로인데 그림이 바뀌면(pHash ≥10) 분할(pose). 최대 min(4, 1+⌊길이/2초⌋), 패널 ≥1초."""
    seg = [s for s in samples if t0 <= s.t < t1]
    length = t1 - t0
    max_panels = min(4, 1 + int(length // 2.0))
    if len(seg) < 3 or max_panels <= 1:
        return [(t0, t1, "")]
    cuts: List[Tuple[float, str]] = []
    cx = cy = 0.0
    sc = 1.0
    rt = 0.0
    start = t0
    prev_hash = int(seg[0].phash, 16)
    for s in seg[1:]:
        m = s.motion
        if m.ok:
            cx -= m.dx
            cy -= m.dy
            sc *= m.scale
            rt += m.rot
        h = int(s.phash, 16)
        moved = math.hypot(cx, cy) > 0.5 or not (0.67 <= sc <= 1.5) or abs(rt) >= 15
        still = (not m.ok) or (math.hypot(m.dx, m.dy) < 0.01 and abs(m.scale - 1) < 0.01)
        pose = still and hamming(prev_hash, h) >= 10 and not is_dark(s)
        if (moved or pose) and s.t - start >= min_sec and t1 - s.t >= min_sec:
            cuts.append((s.t, "view" if moved else "pose"))
            start = s.t
            cx = cy = 0.0
            sc = 1.0
            rt = 0.0
        prev_hash = h
    cuts = cuts[: max_panels - 1]
    bounds = [t0] + [c[0] for c in cuts] + [t1]
    kinds = [""] + [c[1] for c in cuts]
    panels = [(bounds[i], bounds[i + 1], kinds[i]) for i in range(len(bounds) - 1)]
    # 전부 검은 패널(페이드 인·아웃)은 이웃 패널에 붙인다
    def dark_panel(p: Tuple[float, float, str]) -> bool:
        ss = [x for x in seg if p[0] <= x.t < p[1]]
        return bool(ss) and all(is_dark(x) for x in ss)
    merged: List[Tuple[float, float, str]] = []
    for p in panels:
        if merged and dark_panel(p):
            a = merged.pop()
            merged.append((a[0], p[1], a[2]))
        elif merged and dark_panel(merged[-1]):
            a = merged.pop()
            merged.append((a[0], p[1], p[2]))
        else:
            merged.append(p)
    return merged


# ── S8 키프레임 ────────────────────────────────────────────────────────────


DARK_L = 6.0  # 평균 밝기(L) 이 아래면 검은 화면 (페이드·딥 투 블랙)


def is_dark(s: "Sample") -> bool:
    return s.lab[0] < DARK_L


def pick_keyframe(samples: List[Sample], t0: float, t1: float) -> float:
    """정지 그림 = 가장 긴 홀드의 가장 선명한 프레임 / 액션 = 모션 피크 뒤 40% 아래로 떨어진 첫 프레임(전환이 아닌 상태).
    검은 프레임은 (전부 검지 않은 한) 후보에서 뺀다."""
    seg = [s for s in samples if t0 <= s.t < t1]
    lit = [s for s in seg if not is_dark(s)]
    if lit:
        seg = lit
    if not seg:
        return round((t0 + t1) / 2, 3)
    mag = [math.hypot(s.motion.dx, s.motion.dy) + abs(s.motion.scale - 1) + s.motion.subject if s.motion.ok else 0.0 for s in seg]
    peak = max(mag) if mag else 0.0
    if peak < 0.01:
        # 홀드: 연속으로 비슷한(pHash ≤4) 구간 중 가장 긴 것 → 그 안에서 가장 선명
        best: Tuple[int, int] = (0, 0)
        i = 0
        while i < len(seg):
            j = i
            while j + 1 < len(seg) and hamming(int(seg[j + 1].phash, 16), int(seg[i].phash, 16)) <= 4:
                j += 1
            if j - i > best[1] - best[0]:
                best = (i, j)
            i = j + 1
        run = seg[best[0] : best[1] + 1]
        return max(run, key=lambda s: s.sharp).t
    ip = mag.index(peak)
    for k in range(ip + 1, len(seg)):
        if mag[k] < 0.4 * peak:
            # 가라앉은 직후 1~2 샘플 중 선명한 쪽
            cand = seg[k : k + 2]
            return max(cand, key=lambda s: s.sharp).t
    # 끝까지 움직이면: 가운데 60% 에서 가장 선명
    lo, hi = int(len(seg) * 0.2), max(int(len(seg) * 0.8), int(len(seg) * 0.2) + 1)
    return max(seg[lo:hi], key=lambda s: s.sharp).t


# ── 전체 ──────────────────────────────────────────────────────────────────


def measure(path: str, rate: float = 8.0, threshold: float = 27.0, adaptive: float = 3.0, min_scene: int = 6, progress: Optional[Progress] = None) -> Dict:
    fps, n, w, h = video_info(path)
    duration = n / fps if fps else 0.0
    if progress:
        progress("cuts", 0.0)
    cands = detect_candidates(path, threshold, adaptive, min_scene)
    if progress:
        progress("verify", 0.0)
    bounds = verify_cuts(path, fps, cands)
    samples = sample_video(path, fps, n, rate, progress)
    if progress:
        progress("segments", 0.0)
    cut_ts = [b.t for b in bounds if b.verdict in ("cut", "uncertain")]
    uncertain = {b.t for b in bounds if b.verdict == "uncertain"}
    # 0.25초 미만 컷은 앞 컷에 합친다
    edges = [0.0]
    for t in cut_ts:
        if t - edges[-1] >= 0.25 and duration - t >= 0.25:
            edges.append(t)
    edges.append(round(duration, 3))
    segments = []
    for i in range(len(edges) - 1):
        t0, t1 = edges[i], edges[i + 1]
        seg_samples = [s for s in samples if t0 <= s.t < t1]
        cam = camera_for(seg_samples)
        panels = []
        for (p0, p1, kind) in split_panels(samples, t0, t1):
            panels.append({"t0": round(p0, 3), "t1": round(p1, 3), "split": kind, "key": pick_keyframe(samples, p0, p1)})
        subj = [s.motion for s in seg_samples[1:] if s.motion.ok]
        smag = float(np.mean([m.subject for m in subj])) if subj else 0.0
        sdx = float(np.sum([m.subject_dx for m in subj])) if subj else 0.0
        sdy = float(np.sum([m.subject_dy for m in subj])) if subj else 0.0
        segments.append(
            {
                "t0": round(t0, 3),
                "t1": round(t1, 3),
                "uncertain_in": t0 in uncertain,
                "camera": cam.__dict__,
                "subject": {"level": "high" if smag > 0.01 else "medium" if smag > 0.004 else "low", "mag": round(smag, 5), "dir": direction(sdx, sdy), "dx": round(sdx, 4), "dy": round(sdy, 4)},
                "panels": panels,
            }
        )
    if progress:
        progress("done", 1.0)
    return {
        "fps": fps,
        "frames": n,
        "width": w,
        "height": h,
        "duration": round(duration, 3),
        "rate": rate,
        "candidates": len(cands),
        "boundaries": [b.__dict__ for b in bounds],
        "segments": segments,
        "samples": [{"t": s.t, "sharp": s.sharp, "phash": s.phash, "lab": s.lab, "motion": round(math.hypot(s.motion.dx, s.motion.dy) + abs(s.motion.scale - 1), 5) if s.motion.ok else None, "subject": round(s.motion.subject, 5) if s.motion.ok else None} for s in samples],
    }

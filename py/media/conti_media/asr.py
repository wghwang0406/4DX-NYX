"""S6 대사 인식 — faster-whisper (맥 cpu int8 / 윈도우 cuda), 한국어, VAD, 단어 타임스탬프, 인물 이름 힌트, 환각 문구 제거."""
from __future__ import annotations

import re
from typing import Callable, Dict, List, Optional

# whisper 가 무음·음악에서 자주 지어내는 문구 (한국어 방송 자막 학습 흔적)
HALLUCINATIONS = [
    r"시청해\s*주셔서\s*감사합니다",
    r"구독(과|\s*와)?\s*좋아요",
    r"좋아요(와|\s*와)?\s*구독",
    r"다음\s*영상에서\s*만나요",
    r"MBC\s*뉴스",
    r"자막\s*(제공|by)",
    r"^\s*[.,!?…♪]+\s*$",
    r"^\s*(음+|아+|어+)\s*[.]*\s*$",
]


def is_hallucination(text: str) -> bool:
    return any(re.search(p, text) for p in HALLUCINATIONS)


def transcribe(audio: str, model: str = "large-v3-turbo", lang: str = "auto", hotwords: Optional[str] = None, device: str = "auto", progress: Optional[Callable[[str, float], None]] = None) -> Dict:
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # extra 'asr' 미설치
        raise RuntimeError("faster-whisper 가 설치돼 있지 않습니다 (uv extra 'asr')") from e
    if device == "auto":
        device = "cpu"
        try:
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                device = "cuda"
        except Exception:
            pass
    compute = "float16" if device == "cuda" else "int8"
    wm = WhisperModel(model, device=device, compute_type=compute)
    # auto = 앞 30초로 언어 감지. 언어를 강제하면 다른 언어 대사를 조용히 "번역"해 버린다 (실측: 일본어 → 한국어)
    kwargs = dict(language=None if lang in ("", "auto") else lang, vad_filter=True, word_timestamps=True, beam_size=5, condition_on_previous_text=False)
    if hotwords:
        kwargs["hotwords"] = hotwords
        kwargs["initial_prompt"] = hotwords
    segments, info = wm.transcribe(audio, **kwargs)
    out: List[Dict] = []
    dropped = 0
    total = getattr(info, "duration", 0) or 0
    for s in segments:
        text = (s.text or "").strip()
        if not text:
            continue
        if is_hallucination(text) or (s.no_speech_prob or 0) > 0.6:
            dropped += 1
            continue
        out.append(
            {
                "t0": round(float(s.start), 3),
                "t1": round(float(s.end), 3),
                "text": text,
                "logprob": round(float(s.avg_logprob or 0), 3),
                "no_speech": round(float(s.no_speech_prob or 0), 3),
                "low": (s.avg_logprob or 0) < -1.0,
                "words": [{"t0": round(float(w.start), 3), "t1": round(float(w.end), 3), "w": w.word, "p": round(float(w.probability or 0), 3)} for w in (s.words or [])],
            }
        )
        if progress and total:
            progress("asr", min(0.99, float(s.end) / total))
    return {"model": model, "device": device, "language": getattr(info, "language", lang), "language_prob": round(float(getattr(info, "language_probability", 0) or 0), 3), "forced": lang not in ("", "auto"), "duration": total, "segments": out, "dropped": dropped}

#!/usr/bin/env python3
"""Small JSON boundary for an optional local faster-whisper runtime.

The desktop app owns job state and the media facts contract. This process only
loads the explicitly configured model and returns time-bounded transcript
segments; it never writes the catalog or accepts arbitrary tool instructions.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default=os.environ.get("FASTER_WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("FASTER_WHISPER_COMPUTE_TYPE", "int8"))
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"音频/视频文件不存在：{input_path}")

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type, local_files_only=os.environ.get("HF_HUB_OFFLINE", "").lower() in {"1", "true", "yes", "on"})
    segments, info = model.transcribe(str(input_path), word_timestamps=True, language=args.language, vad_filter=True)
    output = []
    for segment in segments:
        text = (segment.text or "").strip()
        if not text or segment.end <= segment.start:
            continue
        output.append({
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
            "language": getattr(info, "language", args.language),
        })
    json.dump({"segments": output, "language": getattr(info, "language", args.language)}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise

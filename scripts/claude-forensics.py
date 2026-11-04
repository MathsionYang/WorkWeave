#!/usr/bin/env python3
"""Offline Claude record fingerprinting.

This script only reports field names and types. It never prints message bodies,
credentials, settings.json contents, or directory file lists.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

SKIP_NAMES = {
    "settings.json",
    "settings.local.json",
    ".credentials.json",
    ".credentials.yaml",
    "keyblob",
    "login-device-nonce",
}


def kind_of(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def describe(value: Any, depth: int = 0) -> Any:
    if depth > 3:
        return kind_of(value)
    if isinstance(value, dict):
        return {key: describe(child, depth + 1) for key, child in value.items()}
    if isinstance(value, list):
        return [describe(value[0], depth + 1)] if value else []
    return kind_of(value)


def safe_frame_type(record: dict[str, Any]) -> str | None:
    candidate = record.get("type")
    if isinstance(candidate, str) and len(candidate) <= 64 and candidate.replace("/", "").replace("-", "").isalnum():
        return candidate
    return None


def inspect_file(path: Path) -> dict[str, Any] | None:
    if path.name in SKIP_NAMES or path.name.startswith("."):
        return None
    if path.suffix != ".jsonl":
        return None

    line_count = 0
    type_counts: Counter[str] = Counter()
    shape_samples: dict[str, Any] = {}
    parse_failures = 0

    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                line_count += 1
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    parse_failures += 1
                    continue
                if not isinstance(record, dict):
                    continue
                frame_type = safe_frame_type(record) or "unknown"
                type_counts[frame_type] += 1
                if frame_type not in shape_samples:
                    shape_samples[frame_type] = describe(record)

    except OSError:
        return None

    return {
        "file": path.name,
        "lineCount": line_count,
        "parseFailures": parse_failures,
        "typeCounts": dict(type_counts),
        "shapes": shape_samples,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Claude record directory (read-only)")
    parser.add_argument("--out", required=True, help="fingerprint JSON output path")
    args = parser.parse_args()

    root = Path(args.input)
    files: list[dict[str, Any]] = []
    for current, dirs, names in os.walk(root):
        dirs[:] = [entry for entry in dirs if entry not in {"node_modules", ".git"}]
        for name in names:
            result = inspect_file(Path(current) / name)
            if result is not None:
                files.append(result)

    report = {
        "version": 1,
        "files": len(files),
        "samples": files,
    }
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"claude forensics: {len(files)} file(s) inspected -> {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
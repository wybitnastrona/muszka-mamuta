#!/usr/bin/env python3
"""Inspect MaleCNS Feather tables and write verified seed sets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pyarrow.feather as feather

sys.path.insert(0, str(Path(__file__).resolve().parent))

from feeding import (
    ANNOTATION_FILE,
    DATASET_VERSION,
    DERIVED_DIR,
    FILTER_DEFINITIONS,
    NT_FILE,
    RAW_DIR,
    WEIGHT_FILE,
    json_records,
    resolve_seeds,
    sha256_file,
    utc_now,
)

FILES = (ANNOTATION_FILE, NT_FILE, WEIGHT_FILE)


def print_frame_overview(name: str, path: Path, frame: pd.DataFrame) -> None:
    print("=" * 80)
    print(f"{name}")
    print(f"path: {path}")
    print(f"rows: {len(frame):,}")
    print(f"cols: {frame.shape[1]}")
    print("schema / dtypes:")
    for col, dtype in frame.dtypes.items():
        print(f"  {col}: {dtype}")
    print()


def print_value_counts(annotations: pd.DataFrame) -> None:
    columns = ("class", "subclass", "superclass", "entryNerve", "exitNerve")
    for col in columns:
        print("-" * 80)
        print(f"value_counts: {col}")
        counts = annotations[col].value_counts(dropna=False)
        print(counts.to_string())
        print(f"(unique including NaN: {len(counts)})")
        print()


def main() -> int:
    missing = [RAW_DIR / f for f in FILES if not (RAW_DIR / f).exists()]
    if missing:
        print("Missing input files:", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        return 1

    frames: dict[str, pd.DataFrame] = {}
    weight_rows = 0
    weight_cols = 0
    for name in FILES:
        path = RAW_DIR / name
        if name == WEIGHT_FILE:
            print(f"Reading {path} with pyarrow memory_map (1 GB; columns+schema only) ...")
            table = feather.read_table(path, memory_map=True)
            weight_rows = int(table.num_rows)
            weight_cols = int(table.num_columns)
            print("=" * 80)
            print(name)
            print(f"path: {path}")
            print(f"rows: {weight_rows:,}")
            print(f"cols: {weight_cols}")
            print("schema / dtypes:")
            for field in table.schema:
                print(f"  {field.name}: {field.type}")
            print()
            del table
            continue
        print(f"Reading {path} with pd.read_feather ...")
        frames[name] = pd.read_feather(path)
        print_frame_overview(name, path, frames[name])

    annotations = frames[ANNOTATION_FILE]
    print_value_counts(annotations)

    try:
        seeds = resolve_seeds(annotations)
    except AssertionError as exc:
        print("SEED ASSERTION FAILED", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        print("Stopping. Filters will not be changed.", file=sys.stderr)
        return 1

    n_g = len(seeds["proboscis_gustatory"])
    n_mn9 = len(seeds["mn9"])
    n_m = len(seeds["proboscis_motor"])
    print("Resolved seed sets (verified filters, not receptor-gene names):")
    print(f"  PROBOSCIS_GUSTATORY: {n_g}  (assert 250–290)")
    print(f"  MN9:                 {n_mn9}  bodyIds {sorted(int(x) for x in seeds['mn9']['bodyId'])}")
    print(f"  PROBOSCIS_MOTOR:     {n_m}  (superclass == cb_motor; MN9 is a subset)")
    print()
    print("PROBOSCIS_GUSTATORY subclass counts:")
    print(seeds["proboscis_gustatory"]["subclass"].value_counts().to_string())
    print()

    payload = {
        "proboscis_gustatory": json_records(
            seeds["proboscis_gustatory"],
            ("bodyId", "type", "subclass", "entryNerve"),
        ),
        "mn9": json_records(
            seeds["mn9"],
            ("bodyId", "type", "instance", "exitNerve"),
        ),
        "proboscis_motor": json_records(
            seeds["proboscis_motor"],
            ("bodyId", "type", "exitNerve"),
        ),
        "provenance": {
            "dataset": DATASET_VERSION,
            "date": utc_now(),
            "filter_definitions": FILTER_DEFINITIONS,
            "note": (
                "MaleCNS has no Gr64f/Gr5a/Gr66a (sweet/bitter receptor) annotations. "
                "These seeds are anatomical/class filters only."
            ),
            "source_files": {
                name: {
                    "path": f"data/raw/{name}",
                    "sha256": sha256_file(RAW_DIR / name),
                    "rows": (
                        weight_rows
                        if name == WEIGHT_FILE
                        else int(len(frames[name]))
                    ),
                    "cols": (
                        weight_cols
                        if name == WEIGHT_FILE
                        else int(frames[name].shape[1])
                    ),
                }
                for name in FILES
            },
            "seed_counts": {
                "proboscis_gustatory": n_g,
                "mn9": n_mn9,
                "proboscis_motor": n_m,
            },
        },
    }
    out_path = DERIVED_DIR / "seeds.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

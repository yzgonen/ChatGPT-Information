#!/usr/bin/env python3
"""Reassemble split ZIP uploads from this folder and verify their ZIP CRCs."""
from pathlib import Path
import zipfile

SPLIT_ARCHIVES = {
    "BeagleNF404's UI - v1.4(1).zip": 4,
    "CustomWeapons-Models(1).zip": 3,
    "Enhanced Audio Ambience r2(1).zip": 2,
    "Enhanced Audio r7(1).zip": 3,
    "Visual Effects+.zip": 3,
    "minecraft-assets-master(2).zip": 11,
    "skinview3d-master(2).zip": 2,
    "three.js-master.zip": 39,
}

folder = Path(__file__).resolve().parent
for name, count in SPLIT_ARCHIVES.items():
    output = folder / name
    with output.open("wb") as target:
        for index in range(1, count + 1):
            part = folder / f"{name}.part{index:03d}"
            if not part.is_file():
                raise FileNotFoundError(f"Missing required part: {part.name}")
            with part.open("rb") as source:
                while block := source.read(1024 * 1024):
                    target.write(block)
    with zipfile.ZipFile(output) as archive:
        bad_member = archive.testzip()
    if bad_member:
        raise RuntimeError(f"CRC error in {name}: {bad_member}")
    print(f"Rebuilt and CRC-checked: {name}")

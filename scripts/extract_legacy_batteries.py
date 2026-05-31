# -*- coding: utf-8 -*-
"""
BATLog: 레거시 재고 Excel에서 배터리 등록 양식용 데이터만 추출합니다.

재고 관리 필드(등급, 품목코드, 재고량 등)는 선택지·seed 생성에만 참고하고
BATLog Model/ID에는 넣지 않습니다.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
UTILITY_ROOT = PROJECT_ROOT.parent / "utility"
sys.path.insert(0, str(UTILITY_ROOT))

from xlsx.reader import filter_rows_by_substring, get_int, load_sheet_rows  # noqa: E402

EXCEL_PATH = PROJECT_ROOT.parent / "WMP" / "artifacts" / "source" / "legacy-inventory.xlsx"
ARTIFACT_DIR = PROJECT_ROOT / "artifacts" / "seed"
JSON_PATH = ARTIFACT_DIR / "legacy-batteries.json"
CSV_PATH = ARTIFACT_DIR / "batteries-seed.csv"

CHEM_LABELS = {
    "LPO": "LiPo",
    "LIO": "Li-ion",
    "LFE": "LiFe",
    "NMH": "NiMH",
    "SSE": "전고체",
    "SSI": "반고체",
}


def guess_chem(name: str) -> str:
    upper = name.upper()
    if "LIPO" in upper or "LI-PO" in upper:
        return "LPO"
    if "LI-ION" in upper or "LIION" in upper:
        return "LIO"
    if "LIFE" in upper or "LIFEPO4" in upper or "인산" in name:
        return "LFE"
    if "NIMH" in upper or "NI-MH" in upper:
        return "NMH"
    if "전고체" in name:
        return "SSE"
    if "반고체" in name:
        return "SSI"
    return "LPO"


def parse_battery_name(name: str) -> dict | None:
    name = str(name or "").strip()
    if not name:
        return None

    match = re.search(r"(\d+)\s*S(?:\s*(\d+)\s*P)?\s*(\d+)\s*m?Ah", name, re.I)
    if match:
        return {
            "rawName": name,
            "cells": str(int(match.group(1))),
            "parallel": int(match.group(2) or 1),
            "capacity": str(int(match.group(3))),
            "chem": guess_chem(name),
        }

    match = re.search(r"^(\d+)\s*S\b", name, re.I)
    if match:
        return {
            "rawName": name,
            "cells": str(int(match.group(1))),
            "parallel": 1,
            "capacity": None,
            "chem": guess_chem(name),
        }

    return {
        "rawName": name,
        "cells": None,
        "parallel": 1,
        "capacity": None,
        "chem": guess_chem(name),
    }


def build_model_name(item: dict) -> str:
    chem_label = CHEM_LABELS.get(item["chem"], item["chem"])
    if item["parallel"] > 1:
        return f"{item['cells']}S {item['parallel']}P {item['capacity']}mAh ({chem_label})"
    return f"{item['cells']}S {item['capacity']}mAh ({chem_label})"


def main() -> None:
    _, inventory_rows = load_sheet_rows(EXCEL_PATH, header_row=2, data_start_row=3, max_col=12)
    battery_rows = filter_rows_by_substring(inventory_rows, "중분류", "배터")

    parsed_rows = []
    spec_summary: dict[str, dict] = defaultdict(lambda: {"qty": 0, "names": set()})

    for row in battery_rows:
        name = str(row.get("품목명") or "").strip()
        qty = get_int(row, "재고량", 0)
        parsed = parse_battery_name(name)
        if not parsed:
            continue

        parsed["qty"] = qty
        parsed_rows.append(parsed)

        if parsed["cells"] and parsed["capacity"]:
            key = f"{parsed['cells']}S-{parsed['capacity']}"
            spec_summary[key]["qty"] += qty
            spec_summary[key]["names"].add(name)
        else:
            spec_summary[name]["qty"] += qty
            spec_summary[name]["names"].add(name)

    cell_options = sorted({item["cells"] for item in parsed_rows if item["cells"]}, key=int)
    capacity_options = sorted(
        {item["capacity"] for item in parsed_rows if item["capacity"]},
        key=int,
    )

    seed_rows = []
    seq_by_prefix: dict[str, int] = defaultdict(int)

    for item in sorted(
        (entry for entry in parsed_rows if entry["cells"] and entry["capacity"]),
        key=lambda entry: (int(entry["cells"]), int(entry["capacity"]), entry["rawName"]),
    ):
        prefix = f"{item['chem']}-{item['cells']}S-{int(int(item['capacity']) / 1000)}"
        for _ in range(max(item["qty"], 0)):
            seq_by_prefix[prefix] += 1
            seed_rows.append({
                "batteryId": f"{prefix}-{str(seq_by_prefix[prefix]).zfill(3)}",
                "model": build_model_name(item),
                "startDate": "2026-01-01",
                "maxCycles": 300,
                "rawName": item["rawName"],
            })

    payload = {
        "source": str(EXCEL_PATH),
        "extractedAt": "2026-05-31",
        "batteryRowCount": len(battery_rows),
        "defaultCellOptions": cell_options,
        "defaultCapacityOptions": capacity_options,
        "inventory": parsed_rows,
        "specSummary": {
            key: {
                "qty": value["qty"],
                "names": sorted(value["names"]),
            }
            for key, value in sorted(spec_summary.items(), key=lambda item: (-item[1]["qty"], item[0]))
        },
        "seedRows": seed_rows,
        "notes": [
            "BATLog 등록 양식 필드(종류·셀·용량)만 추출합니다.",
            "재고 등급·품목코드·창고 정보는 포함하지 않습니다.",
        ],
    }

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_lines = ["BatteryID,Model,StartDate,MaxCycles"]
    for row in seed_rows:
        csv_lines.append(
            f"{row['batteryId']},{row['model']},{row['startDate']},{row['maxCycles']}"
        )
    CSV_PATH.write_text("\n".join(csv_lines) + "\n", encoding="utf-8-sig")

    print(json.dumps({
        "cells": cell_options,
        "capacities": capacity_options,
        "inventoryRows": len(parsed_rows),
        "seedRows": len(seed_rows),
        "json": str(JSON_PATH),
        "csv": str(CSV_PATH),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

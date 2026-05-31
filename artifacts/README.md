# artifacts

BATLog 코드와 직접 연결되지 않는 **프로젝트 산출물**입니다.

## seed/

레거시 재고 Excel(`WMP/artifacts/source/legacy-inventory.xlsx`)에서 추출한 BATLog 등록 양식용 데이터입니다.

| 파일 | 설명 |
|------|------|
| `batteries-seed.csv` | Batteries 시트 붙여넣기용 (선택) |
| `legacy-batteries.json` | 추출 요약·선택지 원본 |

재생성:

```powershell
python scripts/extract_legacy_batteries.py
```

Excel 읽기 등 범용 로직은 `D:\WorkSpace\Code\utility` 를 사용합니다.

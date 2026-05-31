# BATLog 설정 가이드

## 1. Google 스프레드시트 준비

새 스프레드시트를 만들고 아래 2개 시트를 구성합니다.

### Batteries

| A: BatteryID | B: Model | C: StartDate | D: MaxCycles |
|--------------|----------|--------------|--------------|
| LPO-6S-22-001 | 6S 22000mAh (LiPo) | 2026-01-01 | 300 |

#### Battery ID 규칙 (확정)

```
{CHEM}-{N}S-{용량Ah}-{순번}
```

| 코드 | 종류 |
|------|------|
| LPO | LiPo (리튬폴리머) |
| LIO | Li-ion (리튬이온) |
| LFE | LiFe (인산철) |
| NMH | NiMH |
| SSE | 전고체 |
| SSI | 반고체 |

- **용량Ah** = mAh ÷ 1000 (22000 → `22`)
- **순번** = 같은 `{종류-S-용량Ah}` 조합에서 001부터 자동 증가
- 예: `LPO-7S-35-001` → 7S 35000mAh LiPo 1번
- 기존 `BT001` 형식도 **조회·기록**은 계속 지원

#### 레거시 재고 일괄 반영

`artifacts/source/legacy-inventory.xlsx`(WMP) 기준 배터리 **266개**를 미리 생성해 두었습니다.

1. `artifacts/seed/batteries-seed.csv` 열기
2. Google 스프레드시트 `Batteries` 시트 2행부터 붙여넣기 (헤더 제외)
3. `StartDate`는 필요 시 일괄 수정

재고 파일이 바뀌면 아래 명령으로 다시 추출합니다.

```powershell
python scripts/extract_legacy_batteries.py
```

생성물 (`artifacts/seed/`):

- `legacy-batteries.json` — 추출 원본·요약 (BATLog 양식 필드만)
- `batteries-seed.csv` — Batteries 시트용 CSV (등급 등 재고 필드 미포함)

Excel 읽기 등 범용 로직은 `D:\WorkSpace\Code\utility` 에 있습니다.

등록 화면 드롭다운(셀 수·용량)도 같은 재고 기준으로 맞춰져 있습니다.

### ChargingLogs

| A: Timestamp | B: BatteryID | C: Worker |
|--------------|--------------|-----------|

1행은 반드시 헤더로 두세요.

## 2. Apps Script 연결

1. 스프레드시트에서 `확장 프로그램` → `Apps Script`
2. `apps-script/Code.gs` 내용을 붙여넣기
3. `배포` → `새 배포`
4. 유형: `웹 앱`
5. 실행 사용자: `나`
6. 액세스 권한: `모든 사용자`
7. 배포 후 생성된 **웹 앱 URL** 복사

## 3. 프론트엔드 연결

`index.html` 상단의 `API_URL` 값을 배포 URL로 교체합니다.

```javascript
const API_URL = 'https://script.google.com/macros/s/....../exec';
```

## 4. 배포 방법

- GitHub Pages, Netlify, 사내 웹 서버 등 정적 호스팅에 `index.html` 업로드
- 또는 로컬 테스트 시 간단한 HTTP 서버로 실행

## 5. QR 코드 예시

아래 중 하나로 QR을 생성하면 됩니다.

- `BT001`
- `https://your-domain/index.html?id=BT001`

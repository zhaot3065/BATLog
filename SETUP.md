# BATLog 설정 가이드

## 1. Google 스프레드시트 준비

새 스프레드시트를 만들고 아래 시트를 구성합니다.

### Batteries

| A: BatteryID | B: Model | C: StartDate | D: MaxCycles | E: CycleCount |
|--------------|----------|--------------|--------------|---------------|
| LPO-6S-22-001 | 6S 22000mAh (LiPo) | 2026-01-01 | 300 | 0 |

- **E: CycleCount** — 비워 두어도 됩니다. 최초 조회 시 ChargingLogs에서 자동 backfill 후 이후 +1 갱신.

### ChargingLogs

| A: Timestamp | B: BatteryID | C: Worker |
|--------------|--------------|-----------|

- Timestamp는 **Date** 형식으로 저장됩니다 (문자열로 저장된 기존 행도 호환).

### AppearanceReports

| A: Timestamp | B: BatteryID | C: Worker | D: Issues | E: Note | F: Status |
|--------------|--------------|-----------|-----------|---------|-----------|

- Status: `open` | `resolved` | `disposed` (또는 한글 `조치완료`, `폐기`)

### Workers

| A: Name |
|---------|

- 시트가 없으면 API 첫 호출 시 자동 생성·기본 인원 seed.
- 앱 **작업자 선택 → + 신규 등록**으로 추가.

---

## 2. Apps Script 연결

1. 스프레드시트 → **확장 프로그램** → **Apps Script**
2. `apps-script/Code.gs` 붙여넣기
3. **배포** → **새 배포** (웹 앱, 실행: 나, 액세스: 모든 사용자)
4. URL을 `index.html`의 `API_URL`에 입력

### 메일 알림 (외관 이상 보고)

1. 편집기에서 함수 **`authorizeMailPermission`** 선택 → 실행
2. **권한 검토** → Gmail/메일 보내기 허용
3. **배포 → 새 버전 배포**
4. 앱 **관리자 설정**에서 알림 메일 주소 등록 · 테스트 메일 발송
5. 첫 메일은 스팸함일 수 있음 → `comet3065@gmail.com` 수신 허용

---

## 3. GitHub Pages

```powershell
git add .
git commit -m "변경 내용"
git push
```

---

## 4. QR 코드

권장: `https://zhaot3065.github.io/BATLog/?id=LPO-7S-35-001`

관리자 **QR 재출력**에서 PNG 다운로드.

---

## 5. 레거시 재고 seed

`artifacts/seed/batteries-seed.csv` → Batteries 시트 2행부터 붙여넣기.

```powershell
python scripts/extract_legacy_batteries.py
```

---

## 6. CycleCount · Timestamp 마이그레이션

기존 운영 데이터가 있는 경우:

1. **Code.gs 새 버전 배포**
2. Batteries **E1**에 헤더 `CycleCount` 추가 (없으면 API가 자동 추가)
3. 배터리 하나를 앱에서 조회하면 E열이 로그 수로 backfill
4. 이후 충전 기록은 E열 +1, ChargingLogs A열은 Date로 저장

기존 ChargingLogs의 문자열 Timestamp는 삭제하지 않아도 됩니다.

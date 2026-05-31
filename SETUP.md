# BATLog 설정 가이드

## 1. Google 스프레드시트 준비

새 스프레드시트를 만들고 아래 2개 시트를 구성합니다.

### Batteries

| A: BatteryID | B: Model | C: StartDate | D: MaxCycles |
|--------------|----------|--------------|--------------|
| BT001 | 6S 22000mAh | 2026-01-01 | 300 |

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

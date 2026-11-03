# LVC 훈련 시나리오 설계 도우미

해병대 교육훈련용 LVC(실기동·가상·모의) 시나리오를 만들고, 검토·수정하고, 훈련 뒤 사후검토(AAR)까지 하는 웹앱입니다. 모든 데이터는 가상입니다.

- 배포: https://lvc-scenario-helper.vercel.app (Vercel Hobby, 무료)
- 저장소: Supabase (무료 요금제)
- AI: Google Gemini API (무료 등급, 서버에서만 호출)

## 화면

| 탭 | 내용 |
|---|---|
| S1 시나리오 만들기 | 작전 형태·규모·훈련장·위협을 고르면 단계별 L·V·C 구분, 신기술 투입, 가상 지형도 배치를 만든다 |
| S2 검토하기 | 검토관이 단계별 의견을 남기고 승인·수정 요청을 결정한다 |
| S3 수정과 이력 | 의견을 반영하고 버전별 변경을 비교한다 |
| S4 사후검토 | 단계를 재생·되돌려 보며 실제 수행을 기록하고, 전투행동별 더 나은 결심과 근거를 추천받는다 |
| 카탈로그 | 신기술 목록 관리 |

작전 형태: 상륙작전, 전략도서방어, 신속대응, 중대급 유무인복합(MUM-T) 공격(시나리오 2).

## 폴더

| 경로 | 내용 |
|---|---|
| `index.html` | 앱 화면 원본 (claude.ai 아티팩트로도 게시) |
| `web/` | Next.js 웹앱. `web/public/index.html`은 원본에 서버 연결 스크립트를 붙인 사본 |
| `web/app/api/` | 저장소(`db`), AI(`sample`), 상태(`health`) API |
| `web/supabase/setup.sql` | Supabase 표·함수 생성 SQL |
| `tools/` | 컴퓨터 이름이 한글일 때 Vercel CLI를 쓰기 위한 래퍼 |
| `PRD.md` | 제품 요구사항 |

## 환경 변수 (Vercel → Settings → Environment Variables)

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스(secret) 키. 서버 전용 |
| `GEMINI_API_KEY` | Google AI Studio에서 만든 API 키 |
| `GEMINI_MODEL` | (선택) 기본 `gemini-flash-latest` |

키가 없으면 앱은 브라우저 저장 + 규칙 기반 초안으로 동작합니다.

## 로컬 실행

```bash
cd web
npm install
npm run build
npm start
```

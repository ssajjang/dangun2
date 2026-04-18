# DANGUN 금융플랫폼

Node.js + SQLite3 기반 풀스택 금융 플랫폼 (Railway 배포용)

---

## 🔐 보안 수정 내역 (최신)

| 항목 | 상태 | 설명 |
|------|------|------|
| 관리자 경로 무단 접근 차단 | ✅ 완료 | 모든 `admin/*.html`에 `requireAdminAuth()` 적용 – 토큰·관리자ID 없으면 `/index.html`로 강제 리다이렉트 |
| 로그아웃 버그 수정 | ✅ 완료 | 단순 링크(`href="../index.html"`) → `Auth.clear()` 호출 후 리다이렉트로 변경 (localStorage 완전 삭제) |
| 데모 버튼 제거 | ✅ 완료 | `index.html`의 「회원 데모」·「관리자 데모」 버튼 및 `demoLogin()` 함수 삭제 |
| reset.html·simulate.html 인증 통일 | ✅ 완료 | `adminToken` → `dangun_token` + `dangun_admin` 체계로 통일 |

---

## ✅ 구현 완료 기능

### 인증
- 회원/관리자 통합 로그인 (`POST /api/auth/login`, `POST /api/auth/admin/login`)
- JWT 발급 및 검증 (7일 유효)
- 페이지별 인증 가드 (`requireAdminAuth`, `requireMemberAuth`)

### 관리자 대시보드
- KPI 카드 (전체 회원, 총 투자금, 지급 예정, 수당, 출금 대기)
- 월별 투자금 현황 차트 (Chart.js)
- 수당 지급 구조 도넛 차트
- 출금 대기 / 승인 대기 회원 위젯
- 이번 주 금요일 지급 예정 테이블 + 일괄 승인
- **퀵 액션 버튼** (회원 추가, 투자금 입금, 출금 관리, 시뮬레이션, 데이터 초기화, 새로고침)

### 회원 관리 (`admin/members.html`)
- 회원 목록 조회 (검색, 직급·상태 필터, 페이지네이션)
- **회원 직접 추가 모달** (아이디, 비밀번호, 이름, 전화번호, 은행, 계좌, 추천인 검색, 직급, 즉시 활성화 지원)
- 직급 변경 (드롭다운 즉시 적용)
- 회원 상세 조회 (투자 현황 포함)
- 회원 활성화 / 정지
- 비밀번호 강제 변경

### 투자 관리
- 투자금 입금 (`admin/deposit.html`) – 회원 검색 후 금액 입력
- 출금 신청 승인/거절 (`admin/withdrawal.html`)

### 직급 수당 (`admin/commission.html`)
- 수당 내역 목록 (직급별 필터)

### 데이터 초기화 (`admin/reset.html`)
- 선택적 초기화: 회원정보 / 투자 / 주간지급 / 직급수당 / 출금 / 로그
- 전체 초기화 (확인 문구 `RESET` 입력 필요)

### 지급 시뮬레이션 (`admin/simulate.html`)
- 특정 날짜 기준 지급 대기 건 미리보기
- 드라이런(dry_run) 모드 지원
- 실제 지급 실행

### 회원 가입 (`index.html`)
- 추천인 실시간 검색 (2자 이상 자동검색)
- 가입 즉시 `active` 상태로 바로 로그인 가능

---

## 🌐 API 엔드포인트 요약

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스체크 |
| POST | `/api/auth/register` | 회원가입 |
| POST | `/api/auth/login` | 회원 로그인 |
| POST | `/api/auth/admin/login` | 관리자 로그인 |
| GET | `/api/auth/me` | 내 정보 (회원) |
| GET | `/api/auth/members/search?q=` | 추천인 검색 |
| GET | `/api/members` | 회원 목록 (관리자) |
| GET | `/api/members/:id` | 회원 상세 |
| PATCH | `/api/members/:id` | 회원 정보 수정 |
| PATCH | `/api/members/:id/password` | 비밀번호 변경 |
| POST | `/api/investments` | 투자금 입금 |
| GET | `/api/investments` | 투자 목록 |
| GET | `/api/investments/payouts/pending` | 지급 대기 목록 |
| PATCH | `/api/investments/payouts/:id/pay` | 개별 지급 확정 |
| POST | `/api/investments/payouts/bulk-pay` | 일괄 지급 |
| GET | `/api/withdrawals` | 출금 목록 |
| PATCH | `/api/withdrawals/:id/approve` | 출금 승인 |
| PATCH | `/api/withdrawals/:id/reject` | 출금 거절 |
| GET | `/api/commissions` | 수당 목록 |
| GET | `/api/dashboard/admin` | 관리자 대시보드 데이터 |
| **POST** | **`/api/admin/members`** | **관리자: 회원 직접 추가** |
| **POST** | **`/api/admin/reset`** | **데이터 초기화** |
| **GET** | **`/api/admin/payout-preview`** | **지급 미리보기** |
| **POST** | **`/api/admin/simulate-payout`** | **지급 시뮬레이션 실행** |

---

## 🚀 Railway 배포 설정

### 필수 환경변수

| 변수명 | 설명 | 예시 |
|--------|------|------|
| `JWT_SECRET` | JWT 서명 키 (64자 이상 랜덤) | `openssl rand -hex 32` |
| `ADMIN_ID` | 최초 관리자 아이디 | `superadmin` |
| `ADMIN_PASSWORD` | 최초 관리자 비밀번호 | `MyPass123!` |
| `ADMIN_NAME` | 관리자 이름 | `최고관리자` |
| `ADMIN_EMAIL` | 관리자 이메일 | `admin@example.com` |
| `DB_PATH` | SQLite 파일 경로 | `/app/database/dangun.db` |
| `NODE_ENV` | 환경 | `production` |
| `PORT` | 포트 (자동 설정) | `3000` |

### 배포 명령
```
빌드: (없음 - 순수 Node.js)
시작: node server.js
```

### railway.toml
```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node server.js"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

---

## 📁 프로젝트 구조

```
├── server.js              # Express 메인 서버
├── scheduler.js           # 주간 지급 스케줄러 (매주 금요일 09:00 KST)
├── package.json
├── railway.toml
├── index.html             # 로그인/회원가입 페이지
├── api/
│   ├── middleware/auth.js # JWT 인증 미들웨어
│   └── routes/
│       ├── auth.js        # 인증 API
│       ├── admin.js       # 관리자 전용 API (회원추가, 초기화, 시뮬레이션)
│       ├── members.js     # 회원 관리 API
│       ├── investments.js # 투자 API
│       ├── withdrawals.js # 출금 API
│       ├── commissions.js # 수당 API
│       └── dashboard.js   # 대시보드 API
├── database/
│   ├── db.js              # SQLite 연결 (sqlite3 + Promise 래퍼)
│   └── migrate.js         # 스키마 마이그레이션
├── admin/
│   ├── dashboard.html     # 관리자 메인 대시보드
│   ├── members.html       # 회원 관리 + 회원추가 모달
│   ├── deposit.html       # 투자금 입금
│   ├── withdrawal.html    # 출금 관리
│   ├── commission.html    # 직급 수당
│   ├── simulate.html      # 지급 시뮬레이션
│   └── reset.html         # 데이터 초기화 / 회원추가
├── member/
│   └── index.html         # 회원 대시보드
├── css/theme.css          # 공통 스타일
└── js/
    ├── app.js             # UI 유틸리티 (테마, 토스트, 날짜포맷 등)
    └── api.js             # API 클라이언트 (Auth, AuthAPI, AdminAPI 등)
```

---

## ⚠️ 미구현 / 추후 개발 예정

- 이메일 기반 아이디/비밀번호 찾기
- CSV 내보내기
- 시스템 설정 UI (이율, 주차, 수당률 실시간 변경)
- 2FA (관리자 이중 인증)
- 감사 로그 UI

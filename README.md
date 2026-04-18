# DANGUN 금융플랫폼 (단군 투자 관리 시스템)

## 프로젝트 개요
단군 금융플랫폼은 투자 수익 분배, 직급 수당 시스템, 회원 추천 계보를 관리하는 관리자·회원 통합 플랫폼입니다.

---

## ✅ 현재 구현 완료 기능

### 인증 시스템
- 관리자/일반 회원 JWT 기반 이중 로그인 (admin/login → member/login 폴백)
- **관리자 대시보드 경로 보안**: `<head>` 내 즉시 실행 인증 가드 (모든 admin/*.html 적용)
- 로그아웃: `doLogout()` 전역 함수 통일 (api.js), localStorage 완전 초기화 후 `/index.html` 리다이렉트
- 인증 없이 admin/* 접근 시 자동 `/index.html` 리다이렉트

### 회원가입 / 추천인 시스템
- **SuperAdmin 추천인 검색 지원**: `/api/auth/members/search` → members + admins 테이블 통합 검색
- 추천인 검색 시 관리자(🛡관리자 뱃지) 표시
- SuperAdmin을 추천인으로 선택하면 최상위 회원으로 등록 (rank='일반회원', recommender_id=null)
- 회원가입 시 rank 명시적으로 '일반회원' 고정 (DB DEFAULT 의존 제거)
- 추천 계보(referral_tree) 자동 구성

### 관리자 페이지
- **대시보드** (`admin/dashboard.html`): DB 연동 KPI (전체 회원, 투자금, 수당, 출금 대기), 월별 투자 차트, 수당 구조 도넛 차트, 출금 대기·승인 대기 회원 목록, 최근 활동 로그, 주간 지급 예정 목록
- **회원 관리** (`admin/members.html`): DB 회원 목록, 직급 변경, 활성화/정지, 비밀번호 변경, **관리자 회원 추가 모달** (SuperAdmin 추천인 지원)
- **투자금 입금** (`admin/deposit.html`): KPI DB 연동, 회원 검색 후 투자 등록, 주간 지급 스케줄 자동 생성
- **투자금 출금** (`admin/withdrawal.html`): 출금 신청 목록, 개별/일괄 승인·거절, KPI DB 연동
- **직급 수당** (`admin/commission.html`): 수당 목록, 본부장·팀장 수당 KPI DB 연동
- **지급 시뮬레이션** (`admin/simulate.html`): 날짜 기준 pending 지급건 미리보기 및 즉시 처리
- **데이터 초기화** (`admin/reset.html`): 전체/선택 초기화 (투자, 출금, 수당, 회원, 로그)

### 회원 페이지
- **대시보드** (`member/index.html`): DB 연동 투자 현황, 지갑 잔액, 수당 내역, 추천 계보 요약
- **지급 내역** (`member/payouts.html`): 주간 지급 스케줄 목록
- **추천 계보** (`member/referrals.html`): 하부 회원 목록, 추천 통계

---

## 🔧 주요 API 엔드포인트

| Method | Path | 설명 | Auth |
|--------|------|------|------|
| POST | `/api/auth/register` | 회원가입 (SuperAdmin 추천인 지원) | 불필요 |
| POST | `/api/auth/login` | 회원 로그인 | 불필요 |
| POST | `/api/auth/admin/login` | 관리자 로그인 | 불필요 |
| GET | `/api/auth/members/search?q=` | 추천인 검색 (members + admins) | 불필요 |
| GET | `/api/dashboard/admin` | 관리자 대시보드 DB 데이터 | adminToken |
| GET | `/api/dashboard/member` | 회원 대시보드 DB 데이터 | memberToken |
| GET | `/api/members` | 회원 목록 (페이지네이션, 필터) | admin |
| POST | `/api/admin/members` | 관리자 회원 직접 추가 | admin |
| POST | `/api/admin/reset` | 데이터 초기화 | admin |
| POST | `/api/admin/simulate-payout` | 지급 시뮬레이션 | admin |
| GET | `/api/investments` | 투자 목록 | admin |
| POST | `/api/investments` | 투자 등록 | admin |
| GET | `/api/withdrawals` | 출금 목록 | admin |
| PATCH | `/api/withdrawals/:id/approve` | 출금 승인 | admin |
| GET | `/api/commissions` | 수당 목록 | admin |

---

## 📁 파일 구조

```
/
├── index.html              # 로그인/회원가입 페이지
├── js/
│   ├── api.js              # Auth, API 클라이언트 (MembersAPI, etc.) 전역 노출
│   └── app.js              # 공통 유틸 (showToast, formatMoney, etc.)
├── css/
│   └── theme.css           # 테마 스타일
├── admin/
│   ├── dashboard.html      # 관리자 대시보드 (DB 연동 KPI)
│   ├── members.html        # 회원 관리 (추가/수정/조회)
│   ├── deposit.html        # 투자금 입금 관리
│   ├── withdrawal.html     # 투자금 출금 관리
│   ├── commission.html     # 직급 수당 관리
│   ├── simulate.html       # 지급 시뮬레이션
│   └── reset.html          # 데이터 초기화/회원 추가
├── member/
│   ├── index.html          # 회원 대시보드
│   ├── payouts.html        # 지급 내역
│   └── referrals.html      # 추천 계보
├── api/
│   ├── routes/
│   │   ├── auth.js         # 인증 (login, register, search)
│   │   ├── admin.js        # 관리자 전용 API
│   │   ├── members.js      # 회원 CRUD
│   │   ├── investments.js  # 투자 관리
│   │   ├── withdrawals.js  # 출금 관리
│   │   ├── commissions.js  # 수당 관리
│   │   └── dashboard.js    # 대시보드 집계
│   └── middleware/
│       └── auth.js         # JWT 인증 미들웨어
├── database/
│   ├── db.js               # SQLite Promise 래퍼
│   └── migrate.js          # DB 마이그레이션
└── server.js               # Express 앱 진입점
```

---

## 🐛 최근 수정 이력 (2026-04-18)

### 버그 수정
1. **"Auth is not defined" 오류** → api.js에서 `window.Auth = Auth` 즉시 전역 노출, `<head>` 인증 가드는 localStorage 직접 접근으로 변경
2. **"MembersAPI is not defined" 오류** → api.js에서 `window.MembersAPI = MembersAPI` 전역 노출 확인
3. **SuperAdmin 추천인 등록 실패** → `/api/auth/members/search`가 members + admins 테이블 통합 검색하도록 수정
4. **관리자 회원 추가 시 Auth 오류** → admin/members.html의 searchAdminRecommender()가 Auth.getToken()을 안전하게 사용, SuperAdmin 타입 지원
5. **로그아웃 먹통** → reset.html, simulate.html의 `logout()` 함수를 `doLogout()`으로 통일
6. **관리자 대시보드 하드코딩 KPI** → `data-counter="128"` 등 하드코딩 제거, renderKPIs()가 DB 데이터로 업데이트
7. **회원가입 시 SuperAdmin 등록 문제** → register API에 rank='일반회원' 명시 삽입, 로그인 로직 강화 (localStorage 초기화 후 저장)
8. **인증 없이 admin/* 접근 가능** → 모든 admin HTML `<head>`에 즉시 실행 인증 가드 적용

---

## ⚠️ 미구현 / 추후 작업

- 이메일 서비스 연동 (아이디/비밀번호 찾기)
- CSV 내보내기 기능
- SMS 알림 (출금 승인/거절 시)
- 실시간 알림 (WebSocket)
- 다중 관리자 계정 관리

---

## 🚀 배포

Railway 배포: `nixpacks.toml` 설정에 따라 자동 빌드 및 시작
- `Procfile`: `web: node server.js`
- 환경변수: `JWT_SECRET`, `NODE_ENV`, `PORT`

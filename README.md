# 🏦 DANGUN 금융플랫폼

Node.js + Express + SQLite 기반 투자 관리 플랫폼

---

## 🚀 배포 방법 (Railway 권장)

### 1단계: GitHub에 Push

```bash
git add -A
git commit -m "fix: sqlite3 async 전환, Railway 배포 오류 해결"
git push origin main
```

### 2단계: Railway 환경변수 설정

Railway 대시보드 → Variables 탭에서 아래 변수 추가:

| 변수명 | 값 |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 랜덤 64자 이상 문자열 |
| `ADMIN_ID` | `superadmin` |
| `ADMIN_PASSWORD` | 변경 필요 (예: `MyPass1234!`) |
| `ADMIN_NAME` | `최고관리자` |
| `ADMIN_EMAIL` | `admin@example.com` |
| `DB_PATH` | `/app/database/dangun.db` |
| `SCHEDULER_ENABLED` | `true` |

### 3단계: Railway Volume 설정 (SQLite 데이터 유지)

Railway 대시보드 → 서비스 선택 → **Volumes** 탭:
- Mount Path: `/app/database`
- 추가 후 Redeploy

### 4단계: 빌드 설정 확인

Railway → Settings → Build:
- Builder: **Nixpacks** (자동 감지)
- Start Command: `node server.js`

---

## ✅ 해결된 배포 오류

| 문제 | 해결책 |
|---|---|
| `better-sqlite3` 네이티브 빌드 실패 | `sqlite3` + `sqlite` Promise 래퍼로 완전 교체 |
| `VOLUME` 키워드 오류 | Dockerfile 완전 제거, Nixpacks 사용 |
| Healthcheck 타임아웃 | healthcheckPath 제거, TCP 포트 체크 사용 |
| Node 22 호환 오류 | `engines: "node": "20.x"` + `.nvmrc` 고정 |
| 동기 API 오류 | 모든 라우트 `async/await` + Promise API 전환 |

---

## 📁 프로젝트 구조

```
dangun-platform/
├── server.js              # Express 서버 진입점
├── scheduler.js           # 주간 자동 지급 스케줄러
├── package.json           # 의존성 (sqlite3 + sqlite)
├── nixpacks.toml          # Railway Nixpacks 빌드 설정
├── railway.toml           # Railway 배포 설정
├── .nvmrc                 # Node 20 버전 고정
├── database/
│   ├── db.js              # SQLite 연결 싱글톤 (async)
│   └── migrate.js         # DB 스키마 마이그레이션
├── api/
│   ├── middleware/auth.js # JWT 인증 미들웨어
│   └── routes/
│       ├── auth.js        # 회원/관리자 로그인
│       ├── members.js     # 회원 관리 + 비밀번호 변경
│       ├── investments.js # 투자금/이자 관리 + 삭제
│       ├── commissions.js # 직급수당 관리 + 삭제
│       ├── withdrawals.js # 출금 신청/승인
│       └── dashboard.js   # 대시보드 통계
├── admin/                 # 관리자 UI (HTML)
├── member/                # 회원 UI (HTML)
└── index.html             # 메인 페이지
```

---

## 📡 API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/health` | 헬스체크 |
| `POST` | `/api/auth/login` | 회원 로그인 |
| `POST` | `/api/auth/admin/login` | 관리자 로그인 |
| `POST` | `/api/auth/register` | 회원가입 |
| `GET` | `/api/members` | 회원 목록 (관리자) |
| `PATCH` | `/api/members/:id` | 회원 정보 수정 |
| `PATCH` | `/api/members/:id/password` | **비밀번호 변경** (관리자) |
| `POST` | `/api/investments` | 투자금 등록 |
| `DELETE` | `/api/investments/:id` | **투자금 삭제** (관리자) |
| `DELETE` | `/api/investments/payouts/:id` | **이자 삭제** (관리자) |
| `DELETE` | `/api/commissions/:id` | **직급수당 삭제** (관리자) |
| `GET` | `/api/dashboard/admin` | 관리자 대시보드 |
| `GET` | `/api/dashboard/member` | 회원 대시보드 |

---

## 🗄️ 데이터베이스 구조

| 테이블 | 설명 |
|---|---|
| `members` | 회원 정보, 직급, 추천인 |
| `admins` | 관리자 계정 |
| `investments` | 투자금 내역 (15주 스케줄) |
| `weekly_payouts` | 주간 지급 스케줄 |
| `rank_commissions` | 직급수당 내역 |
| `member_wallets` | 회원 지갑 잔액 |
| `withdrawal_requests` | 출금 신청 |
| `referral_tree` | 추천인 계보 |

---

## 💼 비즈니스 로직

- 투자 원금의 **10% 주간 수익** → 15주 분할 지급
- **팀장 수당**: 추천 회원 투자금의 10%
- **본부장 수당**: 단독 20% / 팀장 있을 때 10%
- **자동 지급**: 매주 금요일 09:00 KST

---

## 🔧 로컬 개발

```bash
npm install
cp .env.example .env   # .env 편집 후
node server.js
```

접속: http://localhost:3000

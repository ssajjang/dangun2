# DANGUN 금융플랫폼

## 프로젝트 개요
Express.js + SQLite 기반 투자 관리 플랫폼.  
관리자가 회원 투자금을 등록하면 **15주 분할 지급 스케줄이 자동 생성**되고, **직급 수당이 라인 상위 탐색 방식으로 즉시 지급**됩니다.

---

## 기술 스택
- **Backend**: Node.js + Express.js
- **Database**: SQLite3 + sqlite (Promise 래퍼, async/await)
- **Auth**: JWT (jsonwebtoken)
- **Frontend**: Vanilla JS + Chart.js (CDN)
- **배포**: Railway / Render / Docker

---

## 관리자 계정

| 항목 | 기본값 | 환경변수 |
|------|--------|---------|
| 아이디 | `superadmin` | `ADMIN_ID` |
| 비밀번호 | `Admin1234!` | `ADMIN_PASSWORD` |
| 이름 | 최고관리자 | `ADMIN_NAME` |
| 이메일 | admin@dangun.com | `ADMIN_EMAIL` |

> ⚠️ 배포 시 반드시 환경변수로 변경하세요.

---

## 투자금 지급 로직

| 항목 | 내용 |
|------|------|
| 총 지급배율 | 매출의 **150%** (원금 100% + 이자 50%) |
| 지급 기간 | **15주** 분할 (매주 금요일) |
| 주차 지급액 | `(원금 ÷ 15) + (이자 ÷ 15)` |
| 잔고 표시 | 지급 전/후 잔고 자동 계산 및 저장 |

**예시**: 100만원 투자 → 총 150만원 (15주 × 약 10만원/주)

---

## 소개수당 (직급수당) 지급 규칙

| 상황 | 지급 규칙 |
|------|----------|
| 본부장만 있을 때 | 본부장 → 투자금의 **20%** 즉시 지급 |
| 팀장 + 본부장 있을 때 | 팀장 → **10%**, 본부장 → **10%** 각각 즉시 지급 |
| 팀장만 있을 때 | 팀장 → **10%**, 나머지 10%는 미지급 |
| 직급자 없음 | 미지급 |

라인 상위 탐색 방식 (최대 20단계, 최초 팀장/본부장 탐색)

---

## API 엔드포인트

### 인증 (`/api/auth`)
| Method | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 회원 로그인 |
| POST | `/api/auth/admin/login` | 관리자 로그인 |
| POST | `/api/auth/register` | 회원 가입 |
| GET | `/api/auth/me` | 내 정보 조회 |

### 회원 (`/api/members`)
| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/members` | 전체 회원 목록 | Admin |
| GET | `/api/members/:id` | 회원 상세 | Admin |
| PATCH | `/api/members/:id` | 회원 정보 수정 | Admin |
| GET | `/api/members/my/referrals` | 내 추천 계보 | Member |
| GET | `/api/members/:id/referrals` | 특정 회원 추천 계보 | Admin |

> ⚠️ **중요**: `/my/referrals`는 `/:id/referrals`보다 **먼저** 라우터에 등록되어야 합니다.

### 투자 (`/api/investments`)
| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | `/api/investments` | 투자 등록 + 15주 스케줄 생성 | Admin |
| GET | `/api/investments` | 투자 목록 | Admin |
| GET | `/api/investments/my` | 내 투자 내역 | Member |
| GET | `/api/investments/payouts/pending` | 미지급 주차 목록 | Admin |
| PATCH | `/api/investments/payouts/:id/pay` | 단건 지급 처리 | Admin |
| POST | `/api/investments/payouts/bulk-pay` | 일괄 지급 | Admin |

### 소개수당 (`/api/commissions`)
| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/commissions` | 전체 수당 내역 | Admin |
| GET | `/api/commissions/my` | 내 수당 내역 | Member |
| PATCH | `/api/commissions/:id/withdraw` | 수당 출금완료 처리 | Admin |
| DELETE | `/api/commissions/:id` | 수당 삭제 (잔고 복원) | Admin |

### 출금 (`/api/withdrawals`)
| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | `/api/withdrawals` | 출금 신청 | Member |
| GET | `/api/withdrawals` | 전체 출금 목록 | Admin |
| GET | `/api/withdrawals/my` | 내 출금 내역 | Member |
| PATCH | `/api/withdrawals/:id/approve` | 출금 승인 | Admin |
| PATCH | `/api/withdrawals/:id/reject` | 출금 거절 | Admin |

---

## 프론트엔드 페이지

### 관리자 (`/admin`)
| 파일 | 설명 |
|------|------|
| `admin/dashboard.html` | 관리자 대시보드 (KPI, 차트, 미결 목록) |
| `admin/members.html` | 회원 목록 및 상세 관리 |
| `admin/deposit.html` | 투자금 입금 등록 |
| `admin/withdrawal.html` | 출금 신청 관리 |
| `admin/commission.html` | 소개수당 내역 (지급전/후 잔고, 계좌번호, 출금완료) |
| `admin/simulate.html` | 지급 시뮬레이션 |
| `admin/reset.html` | 데이터 초기화 / 회원 추가 |

### 회원 (`/member`)
| 파일 | 설명 |
|------|------|
| `member/index.html` | 회원 대시보드 (투자 현황, 소개수당 내역) |
| `member/payouts.html` | 투자금 지급 내역 |
| `member/referrals.html` | 추천 계보 트리 (전체하부/직계/깊이/총투자금) |

---

## 스크립트 파일
- `js/app.js` - 공통 유틸 (테마, toast, 날짜 포맷, rankBadge 등)
- `js/api.js` - API 클라이언트 (Auth, DashboardAPI, MembersAPI, InvestmentsAPI, WithdrawalsAPI, CommissionsAPI, AdminAPI)

> **로드 순서**: 모든 HTML 페이지에서 `app.js` → `api.js` → 인라인 스크립트 순서로 로드

---

## DB 구조 (주요 테이블)

| 테이블 | 설명 |
|--------|------|
| `admins` | 관리자 계정 |
| `members` | 회원 계정 |
| `investments` | 투자 내역 |
| `weekly_payouts` | 주차별 지급 스케줄 |
| `rank_commissions` | 소개수당 내역 (`withdraw_status` 컬럼 포함) |
| `member_wallets` | 회원 지갑 (available_balance, total_withdrawn 등) |
| `referral_tree` | 추천 계보 (ancestor-descendant 구조) |
| `withdrawal_requests` | 출금 신청 |
| `activity_logs` | 활동 로그 |
| `system_settings` | 시스템 설정 |

---

## 완료된 기능

- ✅ 전체 관리자/회원 페이지 app.js + api.js 로드 통합
- ✅ API 401 오류 시 보호된 페이지에서만 리다이렉트
- ✅ 투자 지급 로직: 매출의 150% 15주 분할 (원금100% + 이자50%)
- ✅ 소개수당 즉시 지급: 팀장 10%, 본부장 20% (상황별 분배)
- ✅ 추천 계보 API 권한 수정: `/my/referrals` 회원 전용 라우트 우선 등록
- ✅ referrals.html: 전체하부회원/직계추천/최대계보깊이/총투자금 표시
- ✅ 소개수당 UI: 팀장·본부장만 표시, 제공아이디/투자금/수당금액/지급일자 테이블
- ✅ commission.html: 출금계좌번호 표시, 지급전/후 잔고, 개별/전체 출금완료
- ✅ PATCH /api/commissions/:id/withdraw 엔드포인트 추가
- ✅ rank_commissions.withdraw_status 컬럼 마이그레이션 추가
- ✅ CommissionsAPI.withdraw() 클라이언트 함수 추가

## 미완료 / 향후 개선사항

- ⏳ 회원 플레이스홀더 텍스트 하드코딩 제거 (일부 UI 잔존)
- ⏳ 시뮬레이션 페이지 실제 DB 연동 강화
- ⏳ 비밀번호 변경 회원 자체 기능
- ⏳ 모바일 반응형 개선
- ⏳ 출금 신청 및 승인 이메일 알림

---

## 환경 변수 (.env)

```
PORT=3000
DB_PATH=./database/dangun.db
JWT_SECRET=your_secret_key_here
ADMIN_ID=superadmin
ADMIN_PASSWORD=Admin1234!
ADMIN_NAME=최고관리자
ADMIN_EMAIL=admin@dangun.com
```

## 실행 방법

```bash
npm install
npm start   # node server.js
```

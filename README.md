# DANGUN 금융플랫폼 (단군)

> **안전하고 투명한 고정 수익 투자 플랫폼**  
> 투자금 분할 지급 · 직급 수당 · 추천 계보 관리 시스템

---

## 📋 프로젝트 개요

DANGUN은 Express.js + SQLite 기반의 투자 자금 관리 플랫폼입니다.

| 항목 | 내용 |
|------|------|
| **투자 원칙** | 투자금 × 1.5 = 총 지급액 (50% 이자) |
| **지급 방식** | 15주 균등 분할, 투자 승인일로부터 정확히 7일 간격 자동 지급 |
| **주당 지급** | 총지급액 ÷ 15 (예: 100만원 투자 → 주당 10만원, 총 150만원) |
| **직급 수당** | 팀장·본부장 직급자에 하부 투자금의 10%~20% 즉시 지급 |

---

## ✅ 구현 완료 기능

### 🔧 백엔드 API (`/api/*`)

#### 투자 (`/api/investments`)
- `POST /` – 관리자: 투자금 입금 등록 + 15주 스케줄 자동 생성 + 직급수당 즉시 산출
  - `profit_rate = 0.50` (50% 이자), `total_payout = amount * 1.5`
  - `weekly_payout = floor(total_payout / 15)` (15주 균등)
  - 직급수당 `withdraw_status = 'pending'` 기본값으로 삽입
- `GET /` – 관리자: 전체 투자 목록 (페이지네이션)
- `GET /my` – 회원: 내 투자 목록
- `GET /:id/payouts` – 주간 지급 스케줄 조회
- `PATCH /payouts/:id/pay` – 관리자: 단건 지급 승인 → `paid_amount`, `remaining_amount` 자동 업데이트
- `POST /payouts/bulk-pay` – 관리자: 일괄 지급 승인
- `GET /payouts/pending` – 이번 주 지급 대기 목록

#### 직급수당 (`/api/commissions`)
- `GET /` – 관리자: 전체 수당 내역 (bank_name, account_number 포함)
- `GET /my` – 회원: 내가 받은 수당 내역 (withdraw_status 포함)
- `PATCH /:id/withdraw` – 관리자: 수당 출금완료 처리 (`withdraw_status = 'done'`)
- `POST /approve` – 관리자: 수당 출금승인 → `completed_at` 저장, `commissions_history` 이력 추가
- `GET /monthly` – 관리자: 월별 수당 집계 (차트용)
- `DELETE /:id` – 관리자: 수당 삭제 (지갑 복원)

#### 시스템 설정 (`/api/settings`) ✨ 신규
- `GET /public` – 공개 설정 조회 (토큰 불필요 / 코인 환율 포함)
- `GET /all` – 전체 설정 조회 (관리자)
- `PUT /:key` – 단일 설정 수정 (superadmin 전용)
- `POST /batch` – 설정 일괄 수정 (superadmin 전용)
- `GET /admins` – sub-admin 목록 (superadmin 전용)
- `POST /admins` – sub-admin 생성 (superadmin 전용)
- `PATCH /admins/:id/password` – 비밀번호 재설정 (superadmin 전용)
- `PATCH /admins/:id/status` – 상태 변경 active/inactive/suspended (superadmin 전용)
- `DELETE /admins/:id` – sub-admin 삭제 (superadmin 전용)

#### 대시보드 (`/api/dashboard`)
- `GET /admin` – 관리자 종합 통계
  - `comm_stats.pending_comm_count`: 직급수당 출금대기 건수 (신규 추가)
  - `comm_stats.pending_comm_amount`: 직급수당 출금대기 금액 합산 (신규 추가)
- `GET /member` – 회원 개인 대시보드 (투자/지급/수당/계보/대기중수당 합산)
  - `pending_comm_stats.pending_amount`: 출금대기 수당 합산
  - `pending_comm_stats.pending_count`: 출금대기 건수

#### 출금 (`/api/withdrawals`)
- `POST /` – 출금 신청
- `GET /` – 관리자: 전체 출금 목록
- `GET /my` – 회원: 내 출금 목록
- `PATCH /:id/approve` – 관리자: 출금 승인
- `PATCH /:id/reject` – 관리자: 출금 거절
- `POST /bulk-approve` – 관리자: 일괄 출금 승인

#### 회원 (`/api/members` / `/api/admin`)
- `GET /members/my/referrals` – 회원: 내 추천 계보 (일반회원 접근 가능)
- `GET /members/:id/referrals` – 관리자: 특정 회원 추천 계보

---

### 🖥️ 프론트엔드

#### 회원 페이지 (`/member/`)
| 파일 | 기능 |
|------|------|
| `index.html` | 대시보드 · 투자 현황 · 소개수당 내역(대기/완료) · 최근 지급내역(승인 완료만) |
| `payouts.html` | 투자금 지급내역 · 배너(원금/총지급/주당지급/누적/잔여) · 타임라인 차트 |
| `referrals.html` | 추천 계보 트리(캔버스) · 하부 회원 목록 · 계보 통계 |

**payouts.html 배너 수치:**
- 원금 (투자금) = `inv.amount`
- 총 지급액 (원금+이자150%) = `Math.round(amount * 1.5)`
- 주당 지급액 (÷15) = `Math.round(total_payout / 15)`
- 누적 지급액 = `inv.paid_amount` (관리자 승인 후 누적)
- 잔여 지급액 = `inv.remaining_amount`
- **지급일 계산**: `approved_date(또는 investment_date) + 7 × week_number` — 매주 금요일 방식이 아닌 개별 투자 승인일 기준
- **DGN 코인 환산**: 모든 금액 표시 아래 `≒ X DGN` 표시 (js/dgn.js 통합)
- **DB 없을 때 더미 스케줄**: 15주차 허수 스케줄 자동 생성 후 렌더링

#### 관리자 페이지 (`/admin/`)
| 파일 | 기능 |
|------|------|
| `dashboard.html` | 종합 KPI · **직급수당 출금대기(comm_pending 직접 바인딩, API 분리 없음)** · 출금내역(모든 상태 영구 보존, 신청일 컬럼 제거, DB 컬럼 1:1 매핑) · 주간 지급 예정 · 활동 로그 · 즉시 AJAX 출금완료 처리 |
| `commission.html` | 직급수당 전체 목록 · **⏳출금대기 영구 노출(관리자 승인 전)** · 출금대기만 필터 체크박스 · **CSV 엑셀 다운로드(이름/은행/계좌/금액/상태)** · 월별추이·직급별비율 차트 · DGN 코인 환산 표시 |
| `members.html` | 회원 정보 관리 · **추천인 아이디(referrer_id) 컬럼 표시** · CSV 내보내기 |
| `withdrawal.html` | 출금 요청 관리 · **출금대기 기본 필터(영구 노출)** · 전체 보기 체크박스 · **CSV 엑셀 다운로드(이름/은행/계좌/금액/상태)** · 승인/거절 · DGN 코인 환산 표시 |
| `deposit.html` | 투자금 입금 등록 (50% 이자, 15주, 주당 100,000원) · **직급수당 미지급 체크박스(skip_commission)** · 첫 지급일 = 입금일+7일 프리뷰 |
| `reset.html` | 데이터 초기화 · 회원 추가 |
| `simulate.html` | 지급 시뮬레이션 (날짜 기준 or 전체 pending 처리 선택 가능) |
| `backup.html` | DB 전체 백업(JSON) · 서버 저장 백업 목록 · 복원(서버 파일/로컬 파일 업로드) |
| `settings.html` | ✨신규: DANGUN 코인 환율 설정 · 플랫폼 설정 · **서브관리자 생성/비밀번호 재설정/상태 관리** |

---

## 📊 데이터 모델

### 핵심 테이블

#### `investments`
```
id, member_id, amount, weekly_profit(이자분/주), total_weeks=15,
current_week, paid_amount, remaining_amount(=amount*1.5 초기값),
investment_date, next_pay_date, end_date, status
```

#### `weekly_payouts`
```
id, investment_id, member_id, week_number(1~15),
principal_portion, profit_portion, total_payout,
balance_before, balance_after, scheduled_date,
status(pending/paid), paid_date, approved_by
```

#### `rank_commissions`
```
id, investment_id, investor_id, receiver_id, receiver_rank,
commission_rate(10.0 or 20.0), investment_amount, commission_amount,
balance_before, balance_after, paid_at,
status(paid), withdraw_status(pending/done/completed), completed_at
```

#### `commissions_history` ✨ 신규
```
id, commission_id, investment_id, investor_id, receiver_id, receiver_rank,
commission_rate, investment_amount, commission_amount,
paid_at, completed_at, approved_by, withdraw_status(done/completed)
```

#### `system_settings` (확장)
```
setting_key: dangun_coin_rate (기본 10.00)
setting_key: dangun_coin_symbol (기본 DGN)
setting_key: dangun_coin_enabled (1=표시, 0=숨김)
```

#### `admins` (확장)
```
role: superadmin / subadmin (multi-role 지원)
status: active / inactive / suspended
```

#### `member_wallets`
```
id, member_id, total_invested, total_profit, total_commission,
available_balance, pending_payout, total_withdrawn
```

---

## 🕐 스케줄러 (7일 주기 개별 지급)

```
scheduler.js 동작:
  - 매일 00:01 KST 자동 실행 (cron: '1 0 * * *' KST)
  - 각 회원의 투자 승인일(approved_date > investment_date > created_at) 기준으로
    정확히 7일 간격마다 지급 처리
  - 예: 2025-01-01 투자 승인 → 1주 2025-01-08, 2주 01-15, 3주 01-22 ... (15회)
  - ensurePayoutSchedule() 으로 지급 예정 스케줄 자동 생성
  - scheduled_date <= today 인 pending 건 일괄 처리

UI (member/payouts.html):
  - calcPayDate(inv, week) 함수로 동일 로직 재현
  - DB 데이터 없으면 15주 더미 스케줄 즉시 렌더링
  - 타임라인·요약 테이블·차트 모두 +7일 간격 날짜로 표시
```

## 💰 수당 계산 규칙

### 투자금 지급
```
총 지급액   = 투자금 × 1.5   (50% 이자 포함)
주당 지급액 = 총지급액 ÷ 15  (15주 균등, 정수 KRW)
예) 1,000,000원 → 총 1,500,000원 → 주당 100,000원 × 15주
지급 시점: 투자 승인일로부터 7일, 14일, 21일 ... (각 회원 개별 기준)
```

### 직급 수당 (즉시 지급, 출금은 관리자 승인 후)
```
본부장만 존재  → 투자금의 20%
팀장 + 본부장  → 각각 투자금의 10%
팀장만 존재    → 투자금의 10% (나머지 10% 미지급)
직급자 없음    → 미지급 (flush)
```

#### 직급수당 탐색 규칙 (검증 완료 2026-04-18)
```
탐색 방향: 투자자 → 추천인 → 상위 → 상위 (위쪽만, 단방향)
탐색 깊이: 최대 20단계 (depth 0~19)
중복 방지: visitedIds Set으로 순환 참조 방지

같은 라인에 동일 직급이 2명 이상인 경우:
  → 가장 가까운(낮은 depth) 1명만 수당 받음
  → 상위(높은 depth) 동일 직급자는 수당 없음

시나리오 검증:
  1) 투자자→팀장→본부장A→본부장B   : 팀장10% + 본부장A10% (본부장B 수당없음) ✅
  2) 투자자→본부장A→팀장→본부장B   : 본부장A10% + 팀장10% (본부장B 수당없음) ✅
  3) 투자자→팀장A→팀장B            : 팀장A10% (팀장B 수당없음) ✅
  4) 투자자→본부장A→본부장B         : 본부장A20% (본부장B 수당없음) ✅
  5) 투자자→일반→일반→본부장        : 본부장20% ✅
  6) 직급자 없음                     : 미지급 ✅
```

### 출금 흐름
```
투자금 입금 → rank_commissions 생성 (withdraw_status='pending')
             → 회원 UI: '⏳ 출금대기' 표시, 대기중수당 합산
관리자 승인 → withdraw_status='done' 업데이트
             → 회원 UI: '✓ 출금완료' 표시, 대기중수당 0으로 변경
```

---

## 🚀 배포 정보

### 기술 스택
- **Backend**: Node.js + Express.js
- **Database**: SQLite3 (async/Promise 래퍼)
- **Auth**: JWT (jsonwebtoken)
- **Frontend**: Vanilla JavaScript + Chart.js (CDN)

### 기본 관리자 계정 (반드시 변경 필요)
```
ID: superadmin
PW: Admin1234!
```
> ⚠️ **보안 경고**: 배포 전 반드시 환경변수 `ADMIN_ID`, `ADMIN_PASSWORD` 변경

### 환경변수 (`.env`)
```
NODE_ENV=production
PORT=3000
JWT_SECRET=your-secret-key
DB_PATH=./database/dangun.db
ADMIN_ID=superadmin
ADMIN_PASSWORD=Admin1234!
ADMIN_NAME=최고관리자
ADMIN_EMAIL=admin@dangun.com
```

### 배포 옵션
- **Railway**: `railway.toml` 설정 포함
- **Render**: `render.yaml` 설정 포함
- **Docker**: `docker-compose.yml` 포함

---

## 🔗 주요 URI

| 경로 | 설명 |
|------|------|
| `/index.html` | 로그인 페이지 |
| `/member/index.html` | 회원 대시보드 |
| `/member/payouts.html` | 지급 내역 |
| `/member/referrals.html` | 추천 계보 |
| `/admin/dashboard.html` | 관리자 대시보드 |
| `/admin/commission.html` | 직급수당 관리 |
| `/admin/deposit.html` | 투자금 입금 |
| `/admin/withdrawal.html` | 출금 관리 |
| `/admin/members.html` | 회원 관리 |

---

## 📌 미구현 / 향후 개발 과제

- [ ] 이메일/SMS 알림 (투자 입금, 지급 완료, 수당 발생 시)
- [ ] 2단계 인증 (관리자 보안 강화)
- [ ] 투자금 복수 투자 지원 (회원당 1건 초과)
- [ ] 자동 스케줄러 검증 (scheduler.js 매주 금요일 자동 지급)
- [ ] 통계 리포트 엑셀 내보내기

---

## 🔍 직급수당 검증 규칙 (2026-04-18 재검증 완료)

### 같은 라인에 동일 직급 2명 이상 시
```
시나리오 1: 투자자 → 팀장A → 본부장B → 본부장C(상위)
  → 팀장A 10% + 본부장B 10% 지급 / 본부장C 수당 없음 ✅

시나리오 2: 투자자 → 본부장A → 팀장B → 본부장C(상위)
  → 본부장A 10% + 팀장B 10% 지급 / 본부장C 수당 없음 ✅

시나리오 3: 투자자 → 팀장A → 팀장B(상위)
  → 팀장A 10%만 지급 (나머지 10% flush) / 팀장B 수당 없음 ✅

시나리오 4: 투자자 → 본부장A → 본부장B(상위)
  → 본부장A 20%만 지급 / 본부장B 수당 없음 ✅
```

### 구현 메커니즘
- 상위 탐색 시 `!foundTeamjang` / `!foundBonbujang` 조건으로 **최초 1명만** 저장
- 팀장+본부장 둘 다 발견 즉시 `break` → 상위 탐색 즉시 중단
- `visitedIds Set` → 순환 참조 방지
- 동일인 방지: `foundTeamjang.id === foundBonbujang.id` 체크 → 본부장 우선

---

## 💡 UI 수당 표시 규칙

### 회원 대시보드 (member/index.html)
- **대기중 수당**: `⏳ 출금대기` 상태일 때 → 금액 + "대기중" 표시 (빨간색)
- **완료 후**: 대기중 수당이 0이면 → `₩0` + "대기중 수당 없음" 표시 (녹색 테두리)
- **소개수당 테이블**: `withdraw_status = 'done'` → `✓ 출금완료` / `pending` → `⏳ 출금대기`

### 관리자 대시보드 (admin/dashboard.html)
- 투자금 입금 즉시 `rank_commissions.withdraw_status = 'pending'` 자동 삽입
- `CommissionsAPI.pending()` → `GET /api/commissions?withdraw_status=pending` 즉시 조회
- 관리자 승인 → `withdraw_status = 'done'` → 회원 UI에 즉시 반영

### 금액 표시 규칙
- 모든 금액: `Math.round()` 후 `toLocaleString('ko-KR')` → **소수점 없는 정수**
- `formatMoney()`: `₩1,000,000원` 형식
- `formatMoneyK()`: `100만원` / `1.5억원` 형식 (정수 반올림)

---

*최종 업데이트: 2026-04-18 (직급수당 중복 검증 완료)*

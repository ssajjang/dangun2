# DANGUN 금융플랫폼

## 프로젝트 개요
Express.js + SQLite 기반 투자 관리 플랫폼. 관리자가 회원 투자금을 등록하면 15주 분할 지급 스케줄이 자동 생성되고, 직급 수당이 라인 상위 탐색 방식으로 즉시 지급됩니다.

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

## API 엔드포인트

### 인증
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 회원 로그인 |
| POST | `/api/auth/admin/login` | 관리자 로그인 |
| POST | `/api/auth/register` | 회원 가입 |
| GET  | `/api/auth/me` | 내 정보 |
| GET  | `/api/auth/members/search?q=` | 회원 검색 (SuperAdmin 포함) |

### 대시보드
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/dashboard/admin` | 관리자 종합 통계 |
| GET | `/api/dashboard/member` | 회원 대시보드 |

### 회원
| Method | Path | 설명 |
|--------|------|------|
| GET    | `/api/members` | 전체 회원 목록 (페이지네이션, 필터) |
| GET    | `/api/members/:id` | 회원 상세 |
| PATCH  | `/api/members/:id` | 회원 정보 수정 |
| PATCH  | `/api/members/:id/password` | 비밀번호 변경 |
| GET    | `/api/members/:id/referrals` | 추천 계보 트리 (관리자) |
| GET    | `/api/members/my/referrals` | 내 추천 계보 (회원) |

### 투자
| Method | Path | 설명 |
|--------|------|------|
| POST   | `/api/investments` | 투자금 등록 (15주 스케줄 생성 + 직급수당 즉시지급) |
| GET    | `/api/investments` | 전체 투자 목록 |
| GET    | `/api/investments/my` | 내 투자 |
| GET    | `/api/investments/payouts/pending` | 이번주 지급 대기 |
| PATCH  | `/api/investments/payouts/:id/pay` | 주간 지급 처리 |
| POST   | `/api/investments/payouts/bulk-pay` | 일괄 지급 |
| DELETE | `/api/investments/:id` | 투자 삭제 (수당 복원) |

### 출금
| Method | Path | 설명 |
|--------|------|------|
| POST   | `/api/withdrawals` | 출금 신청 |
| GET    | `/api/withdrawals` | 전체 출금 목록 |
| GET    | `/api/withdrawals/my` | 내 출금 목록 |
| PATCH  | `/api/withdrawals/:id/approve` | 출금 승인 |
| PATCH  | `/api/withdrawals/:id/reject` | 출금 거절 |
| POST   | `/api/withdrawals/bulk-approve` | 일괄 승인 |

### 직급수당
| Method | Path | 설명 |
|--------|------|------|
| GET    | `/api/commissions` | 전체 수당 내역 (관리자) |
| GET    | `/api/commissions/my` | 내가 받은 수당 (회원) |
| DELETE | `/api/commissions/:id` | 수당 삭제 (잔고 복원) |

### 관리자 전용
| Method | Path | 설명 |
|--------|------|------|
| POST   | `/api/admin/members` | 회원 직접 추가 |
| POST   | `/api/admin/reset` | 데이터 초기화 |
| POST   | `/api/admin/simulate-payout` | 지급 시뮬레이션 |
| GET    | `/api/admin/payout-preview` | 지급 예정 미리보기 |

---

## 직급 수당 계산 규칙

**라인 상위 탐색 방식** (유니레벨):

투자금 발생 시 해당 회원의 추천 라인(recommender_id)을 상위 방향으로 탐색하여 가장 가까운 직급자를 찾습니다.

| 조건 | 지급 |
|------|------|
| 본부장만 존재 | 본부장 20% |
| 팀장 + 본부장 존재 | 팀장 10% + 본부장 10% |
| 팀장만 존재 | 팀장 10%, 나머지 10% flush (미지급) |
| 직급자 없음 | 미지급 |

- 최대 탐색 깊이: 20단계
- 팀장과 본부장은 각각 가장 가까운 1명에게만 지급

---

## 투자 구조

- **수익률**: 원금의 10%
- **지급 기간**: 15주 분할 지급
- **지급일**: 매주 금요일
- **스케줄**: 투자금 등록 즉시 15주 스케줄 자동 생성

---

## 페이지 구조

### 관리자 (`/admin/`)
| 파일 | 설명 |
|------|------|
| `dashboard.html` | 종합 대시보드 (KPI, 차트, 대기 목록) |
| `members.html` | 회원 목록/관리 |
| `deposit.html` | 투자금 입금 등록 (콤마 표기, 직급수당 즉시 표시) |
| `withdrawal.html` | 출금 관리 |
| `commission.html` | 직급수당 내역 |
| `simulate.html` | 지급 시뮬레이션 |
| `reset.html` | 데이터 초기화 / 회원 추가 |

### 회원 (`/member/`)
| 파일 | 설명 |
|------|------|
| `index.html` | 회원 대시보드 (투자 현황, 다음 지급 예정, 직급자 추천수당) |
| `payouts.html` | 투자금 지급 내역 |
| `referrals.html` | 추천 계보 트리 (본인 포함, 하부 리스트, DB 연동) |

---

## 주요 수정 이력

### 2026-04-18 (최신)
- **[BUGFIX]** `admin/deposit.html`: `submit-btn` id 누락으로 투자 등록 실패 → 추가
- **[FEAT]** `admin/deposit.html`: 투자금 입력 시 콤마 자동 표기 + 한글 단위 미리보기
- **[BUGFIX]** `api/routes/investments.js`: 직급수당 계산을 직계 부모만 체크 → **라인 상위 탐색 방식**으로 재작성
- **[BUGFIX]** `member/index.html`: 투자 없을 때 "9주차 지급 대기" 하드코딩 표시 → 투자 없음 안내 표시로 수정
- **[FEAT]** `member/index.html`: 팀장/본부장 전용 추천수당 섹션 추가 (오늘/주간/월간 집계)
- **[BUGFIX]** `member/referrals.html`: DEMO_DATA 제거, DB API 완전 연동, 본인(루트) 노드 포함, 하부 없으면 빈 상태 표시
- **[BUGFIX]** `admin/reset.html`, `admin/simulate.html`: `app.js`/`api.js` 스크립트 누락 → 추가 (doLogout, showToast 정상 작동)
- **[BUGFIX]** `js/api.js`: 401 오류 시 무조건 리다이렉트 → 관리자/회원 페이지에서만 리다이렉트

---

## 환경 변수 (.env)

```env
PORT=3000
NODE_ENV=production
JWT_SECRET=your_secret_key_here
DB_PATH=./database/dangun.db
ADMIN_ID=superadmin
ADMIN_PASSWORD=Admin1234!
ADMIN_NAME=최고관리자
ADMIN_EMAIL=admin@dangun.com
```

---

## 실행 방법

```bash
npm install
node server.js
```

Railway/Render 배포 시 환경변수 설정 후 자동 빌드됩니다.

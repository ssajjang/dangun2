/**
 * DANGUN 금융플랫폼 - API 클라이언트
 * 모든 fetch 호출을 중앙화
 */
'use strict';

const API_BASE = '/api';

// ── Token 관리 ──────────────────────────────────────────────
const Auth = {
  getToken: ()   => localStorage.getItem('dangun_token') || '',
  setToken: (t)  => localStorage.setItem('dangun_token', t),
  getUser:  ()   => { try { return JSON.parse(localStorage.getItem('dangun_user') || '{}'); } catch { return {}; } },
  setUser:  (u)  => localStorage.setItem('dangun_user', JSON.stringify(u)),
  isAdmin:  ()   => { try { return JSON.parse(localStorage.getItem('dangun_admin') || 'null') !== null; } catch { return false; } },
  getAdmin: ()   => { try { return JSON.parse(localStorage.getItem('dangun_admin') || 'null'); } catch { return null; } },
  setAdmin: (a)  => localStorage.setItem('dangun_admin', JSON.stringify(a)),
  clear:    ()   => { localStorage.removeItem('dangun_token'); localStorage.removeItem('dangun_user'); localStorage.removeItem('dangun_admin'); },
};

// ── 공통 fetch wrapper ──────────────────────────────────────
async function request(method, endpoint, body = null, isAdmin = false) {
  const token = Auth.getToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `HTTP ${res.status}`;
      if (res.status === 401) {
        Auth.clear();
        window.location.href = '/index.html';
        return null;
      }
      throw new Error(msg);
    }
    return data;
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message, 'error');
    throw err;
  }
}

const get    = (ep, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request('GET', ep + (qs ? '?' + qs : ''));
};
const post   = (ep, body) => request('POST',  ep, body);
const patch  = (ep, body) => request('PATCH', ep, body);
const del    = (ep)       => request('DELETE', ep);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const AuthAPI = {
  /** 회원 로그인 */
  login: async (user_id, password) => {
    const data = await post('/auth/login', { user_id, password });
    if (data?.token) { Auth.setToken(data.token); Auth.setUser(data.user); }
    return data;
  },
  /** 관리자 로그인 */
  adminLogin: async (admin_id, password) => {
    const data = await post('/auth/admin/login', { admin_id, password });
    if (data?.token) { Auth.setToken(data.token); Auth.setAdmin(data.admin); }
    return data;
  },
  /** 회원가입 */
  register: (body) => post('/auth/register', body),
  /** 내 정보 */
  me: () => get('/auth/me'),
  /** 추천인 검색 */
  searchMembers: (q) => get('/auth/members/search', { q }),
  /** 로그아웃 */
  logout: () => { Auth.clear(); window.location.href = '/index.html'; },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DashboardAPI = {
  member: () => get('/dashboard/member'),
  admin:  () => get('/dashboard/admin'),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEMBERS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MembersAPI = {
  list:       (params) => get('/members', params),
  get:        (id)     => get(`/members/${id}`),
  update:     (id, body) => patch(`/members/${id}`, body),
  referrals:  (id)     => get(`/members/${id}/referrals`),
  myReferrals: ()      => get('/members/my/referrals'),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INVESTMENTS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const InvestmentsAPI = {
  /** 관리자: 투자금 입금 등록 */
  deposit:     (body)    => post('/investments', body),
  /** 관리자: 전체 목록 */
  list:        (params)  => get('/investments', params),
  /** 회원: 내 투자 목록 */
  my:          ()        => get('/investments/my'),
  /** 주간 지급 스케줄 */
  payouts:     (invId)   => get(`/investments/${invId}/payouts`),
  /** 관리자: 이번 주 지급 대기 */
  pendingPayouts: ()     => get('/investments/payouts/pending'),
  /** 관리자: 개별 지급 확정 */
  payOne:      (payId)   => patch(`/investments/payouts/${payId}/pay`, {}),
  /** 관리자: 일괄 지급 확정 */
  bulkPay:     (ids)     => post('/investments/payouts/bulk-pay', { payout_ids: ids }),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WITHDRAWALS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const WithdrawalsAPI = {
  /** 회원: 출금 신청 */
  request:      (body)   => post('/withdrawals', body),
  /** 관리자: 전체 목록 */
  list:         (params) => get('/withdrawals', params),
  /** 회원: 내 출금 내역 */
  my:           ()       => get('/withdrawals/my'),
  /** 관리자: 개별 승인 */
  approve:      (id)     => patch(`/withdrawals/${id}/approve`, {}),
  /** 관리자: 거절 */
  reject:       (id, reason) => patch(`/withdrawals/${id}/reject`, { reason }),
  /** 관리자: 일괄 승인 */
  bulkApprove:  (ids)    => post('/withdrawals/bulk-approve', { ids }),
  /** 회원: 취소 */
  cancel:       (id)     => del(`/withdrawals/${id}/cancel`),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMMISSIONS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CommissionsAPI = {
  list: (params) => get('/commissions', params),
  my:   ()       => get('/commissions/my'),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADMIN API (관리자 전용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const AdminAPI = {
  /** 회원 직접 추가 */
  addMember:  (body)          => post('/admin/members', body),
  /** 데이터 초기화 */
  reset:      (target)        => post('/admin/reset', { target, confirm_text: 'RESET' }),
  /** 지급 시뮬레이션 미리보기 */
  payoutPreview: ()           => get('/admin/payout-preview'),
  /** 지급 시뮬레이션 실행 */
  simulatePayout: (opts = {}) => post('/admin/simulate-payout', opts),
};

// ── 인증 가드 (페이지 로드 시 호출) ────────────────────────
function requireMemberAuth() {
  const token = Auth.getToken();
  const user  = Auth.getUser();
  if (!token || !user?.id) {
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

function requireAdminAuth() {
  const token = Auth.getToken();
  const admin = Auth.getAdmin();
  if (!token || !admin?.id) {
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

// ── 전역 노출 ──────────────────────────────────────────────
window.Auth            = Auth;
window.AuthAPI         = AuthAPI;
window.DashboardAPI    = DashboardAPI;
window.MembersAPI      = MembersAPI;
window.InvestmentsAPI  = InvestmentsAPI;
window.WithdrawalsAPI  = WithdrawalsAPI;
window.CommissionsAPI  = CommissionsAPI;
window.AdminAPI        = AdminAPI;
window.requireMemberAuth = requireMemberAuth;
window.requireAdminAuth  = requireAdminAuth;

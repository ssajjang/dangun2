/**
 * DANGUN 금융플랫폼 - API 클라이언트
 * 모든 fetch 호출 중앙화 + 인증 관리
 */
'use strict';

const API_BASE = '/api';

// ── Token / Auth 관리 (즉시 전역 노출) ──────────────────────
const Auth = {
  getToken: ()   => localStorage.getItem('dangun_token') || '',
  setToken: (t)  => localStorage.setItem('dangun_token', t),
  getUser:  ()   => { try { return JSON.parse(localStorage.getItem('dangun_user') || '{}'); } catch { return {}; } },
  setUser:  (u)  => localStorage.setItem('dangun_user', JSON.stringify(u)),
  isAdmin:  ()   => { try { return JSON.parse(localStorage.getItem('dangun_admin') || 'null') !== null; } catch { return false; } },
  getAdmin: ()   => { try { return JSON.parse(localStorage.getItem('dangun_admin') || 'null'); } catch { return null; } },
  setAdmin: (a)  => localStorage.setItem('dangun_admin', JSON.stringify(a)),
  clear:    ()   => {
    localStorage.removeItem('dangun_token');
    localStorage.removeItem('dangun_user');
    localStorage.removeItem('dangun_admin');
  },
};

// 즉시 전역 노출 (다른 인라인 스크립트에서 바로 사용 가능)
window.Auth = Auth;

// ── 인증 가드 (페이지 로드 시 호출) ─────────────────────────
function requireMemberAuth() {
  const token = Auth.getToken();
  const user  = Auth.getUser();
  if (!token || !user?.id) {
    Auth.clear();
    window.location.replace('/index.html');
    return false;
  }
  return true;
}

function requireAdminAuth() {
  const token = Auth.getToken();
  const admin = Auth.getAdmin();
  if (!token || !admin?.id) {
    Auth.clear();
    window.location.replace('/index.html');
    return false;
  }
  return true;
}

// 즉시 전역 노출
window.requireMemberAuth = requireMemberAuth;
window.requireAdminAuth  = requireAdminAuth;

// ── 로그아웃 (전역) ─────────────────────────────────────────
function doLogout() {
  Auth.clear();
  window.location.replace('/index.html');
}
window.doLogout = doLogout;

// ── 공통 fetch wrapper ───────────────────────────────────────
async function request(method, endpoint, body = null) {
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
    const res  = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `HTTP ${res.status}`;
      if (res.status === 401) {
        Auth.clear();
        window.location.replace('/index.html');
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

const get  = (ep, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request('GET', ep + (qs ? '?' + qs : ''));
};
const post  = (ep, body) => request('POST',   ep, body);
const patch = (ep, body) => request('PATCH',  ep, body);
const del   = (ep)       => request('DELETE', ep);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const AuthAPI = {
  login: async (user_id, password) => {
    const data = await post('/auth/login', { user_id, password });
    if (data?.token) { Auth.setToken(data.token); Auth.setUser(data.user); }
    return data;
  },
  adminLogin: async (admin_id, password) => {
    const data = await post('/auth/admin/login', { admin_id, password });
    if (data?.token) { Auth.setToken(data.token); Auth.setAdmin(data.admin); }
    return data;
  },
  register:      (body) => post('/auth/register', body),
  me:            ()     => get('/auth/me'),
  searchMembers: (q)    => get('/auth/members/search', { q }),
  logout: () => { Auth.clear(); window.location.replace('/index.html'); },
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
  list:        (params)    => get('/members', params),
  get:         (id)        => get(`/members/${id}`),
  update:      (id, body)  => patch(`/members/${id}`, body),
  referrals:   (id)        => get(`/members/${id}/referrals`),
  myReferrals: ()          => get('/members/my/referrals'),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INVESTMENTS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const InvestmentsAPI = {
  deposit:       (body)   => post('/investments', body),
  list:          (params) => get('/investments', params),
  my:            ()       => get('/investments/my'),
  payouts:       (invId)  => get(`/investments/${invId}/payouts`),
  pendingPayouts:()       => get('/investments/payouts/pending'),
  payOne:        (payId)  => patch(`/investments/payouts/${payId}/pay`, {}),
  bulkPay:       (ids)    => post('/investments/payouts/bulk-pay', { payout_ids: ids }),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WITHDRAWALS API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const WithdrawalsAPI = {
  request:     (body)         => post('/withdrawals', body),
  list:        (params)       => get('/withdrawals', params),
  my:          ()             => get('/withdrawals/my'),
  approve:     (id)           => patch(`/withdrawals/${id}/approve`, {}),
  reject:      (id, reason)   => patch(`/withdrawals/${id}/reject`, { reason }),
  bulkApprove: (ids)          => post('/withdrawals/bulk-approve', { ids }),
  cancel:      (id)           => del(`/withdrawals/${id}/cancel`),
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
  addMember:     (body)        => post('/admin/members', body),
  reset:         (target)      => post('/admin/reset', { target, confirm_text: 'RESET' }),
  payoutPreview: ()            => get('/admin/payout-preview'),
  simulatePayout:(opts = {})   => post('/admin/simulate-payout', opts),
};

// ── 전역 노출 ──────────────────────────────────────────────
window.AuthAPI         = AuthAPI;
window.DashboardAPI    = DashboardAPI;
window.MembersAPI      = MembersAPI;
window.InvestmentsAPI  = InvestmentsAPI;
window.WithdrawalsAPI  = WithdrawalsAPI;
window.CommissionsAPI  = CommissionsAPI;
window.AdminAPI        = AdminAPI;

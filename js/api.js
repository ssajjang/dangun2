/**
 * DANGUN 금융플랫폼 - API 클라이언트
 * ※ IIFE로 감싸서 app.js 전역 변수와 충돌 완전 차단
 * ※ 필요한 객체만 window에 명시적으로 노출
 */
(function (global) {

  var API_BASE = '/api';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Auth 모듈 (localStorage 기반 토큰/유저 관리)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var Auth = {
    getToken: function () { return localStorage.getItem('dangun_token') || ''; },
    setToken: function (t) { localStorage.setItem('dangun_token', t); },
    getUser:  function () {
      try { return JSON.parse(localStorage.getItem('dangun_user') || '{}'); } catch (e) { return {}; }
    },
    setUser:  function (u) { localStorage.setItem('dangun_user', JSON.stringify(u)); },
    isAdmin:  function () {
      try { return JSON.parse(localStorage.getItem('dangun_admin') || 'null') !== null; } catch (e) { return false; }
    },
    getAdmin: function () {
      try { return JSON.parse(localStorage.getItem('dangun_admin') || 'null'); } catch (e) { return null; }
    },
    setAdmin: function (a) { localStorage.setItem('dangun_admin', JSON.stringify(a)); },
    clear: function () {
      localStorage.removeItem('dangun_token');
      localStorage.removeItem('dangun_user');
      localStorage.removeItem('dangun_admin');
    },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 인증 가드
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function requireMemberAuth() {
    var token = Auth.getToken();
    var user  = Auth.getUser();
    if (!token || !user || !user.id) {
      Auth.clear();
      global.location.replace('/index.html');
      return false;
    }
    return true;
  }

  function requireAdminAuth() {
    var token = Auth.getToken();
    var admin = Auth.getAdmin();
    if (!token || !admin || !admin.id) {
      Auth.clear();
      global.location.replace('/index.html');
      return false;
    }
    return true;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 로그아웃
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function doLogout() {
    Auth.clear();
    global.location.replace('/index.html');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 공통 fetch wrapper
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function request(method, endpoint, body) {
    var token = Auth.getToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var opts = { method: method, headers: headers };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    var url = API_BASE + endpoint;

    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
          // 401: 토큰 만료/무효 → 로그아웃 (단, 관리자 페이지인 경우만)
          if (res.status === 401) {
            // 현재 페이지가 admin/ 또는 member/ 하위인 경우에만 리다이렉트
            var isProtected = global.location.pathname.indexOf('/admin/') !== -1 ||
                              global.location.pathname.indexOf('/member/') !== -1;
            if (isProtected) {
              Auth.clear();
              global.location.replace('/index.html');
              return null;
            }
          }
          throw new Error(msg);
        }
        return data;
      });
    }).catch(function (err) {
      // 네트워크 오류 또는 API 오류 - toast는 호출부에서 처리하도록 throw만
      throw err;
    });
  }

  function get(ep, params) {
    var qs = params ? new URLSearchParams(params).toString() : '';
    return request('GET', ep + (qs ? '?' + qs : ''), null);
  }
  function post(ep, body)  { return request('POST',   ep, body); }
  function patch(ep, body) { return request('PATCH',  ep, body); }
  function del(ep)         { return request('DELETE', ep, null); }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AUTH API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var AuthAPI = {
    login: function (user_id, password) {
      return post('/auth/login', { user_id: user_id, password: password }).then(function (data) {
        if (data && data.token) { Auth.setToken(data.token); Auth.setUser(data.user); }
        return data;
      });
    },
    adminLogin: function (admin_id, password) {
      return post('/auth/admin/login', { admin_id: admin_id, password: password }).then(function (data) {
        if (data && data.token) { Auth.setToken(data.token); Auth.setAdmin(data.admin); }
        return data;
      });
    },
    register:      function (body) { return post('/auth/register', body); },
    me:            function ()     { return get('/auth/me'); },
    searchMembers: function (q)    { return get('/auth/members/search', { q: q }); },
    logout: function () { Auth.clear(); global.location.replace('/index.html'); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DASHBOARD API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var DashboardAPI = {
    member: function () { return get('/dashboard/member'); },
    admin:  function () { return get('/dashboard/admin'); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MEMBERS API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var MembersAPI = {
    list:        function (params)   { return get('/members', params); },
    get:         function (id)       { return get('/members/' + id); },
    update:      function (id, body) { return patch('/members/' + id, body); },
    referrals:   function (id)       { return get('/members/' + id + '/referrals'); },
    myReferrals: function ()         { return get('/members/my/referrals'); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INVESTMENTS API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var InvestmentsAPI = {
    deposit:        function (body)  { return post('/investments', body); },
    list:           function (params){ return get('/investments', params); },
    my:             function ()      { return get('/investments/my'); },
    payouts:        function (invId) { return get('/investments/' + invId + '/payouts'); },
    pendingPayouts: function ()      { return get('/investments/payouts/pending'); },
    payOne:         function (payId) { return patch('/investments/payouts/' + payId + '/pay', {}); },
    bulkPay:        function (ids)   { return post('/investments/payouts/bulk-pay', { payout_ids: ids }); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WITHDRAWALS API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var WithdrawalsAPI = {
    request:     function (body)         { return post('/withdrawals', body); },
    list:        function (params)       { return get('/withdrawals', params); },
    my:          function ()             { return get('/withdrawals/my'); },
    approve:     function (id)           { return patch('/withdrawals/' + id + '/approve', {}); },
    reject:      function (id, reason)   { return patch('/withdrawals/' + id + '/reject', { reason: reason }); },
    bulkApprove: function (ids)          { return post('/withdrawals/bulk-approve', { ids: ids }); },
    cancel:      function (id)           { return del('/withdrawals/' + id + '/cancel'); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // COMMISSIONS API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var CommissionsAPI = {
    list:     function (params) { return get('/commissions', params); },
    my:       function ()       { return get('/commissions/my'); },
    withdraw: function (id)     { return patch('/commissions/' + id + '/withdraw', {}); },
    // POST /api/commissions/approve  ── 신규 승인 엔드포인트
    // withdraw_status: pending → completed, commissions_history 이력 저장
    approve:  function (id)     { return post('/commissions/approve', { id: id }); },
    // 출금대기(withdraw_status=pending) 목록 전용 - 관리자 대시보드용
    pending:  function (limit)  {
      return get('/commissions', {
        withdraw_status: 'pending',
        limit: limit || 100,
        page: 1,
      });
    },
    // 월별 수당 집계 (created_at 기준, 차트용)
    monthly:  function ()       { return get('/commissions/monthly'); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ADMIN API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var AdminAPI = {
    addMember:     function (body)      { return post('/admin/members', body); },
    reset:         function (target)    { return post('/admin/reset', { target: target, confirm_text: 'RESET' }); },
    payoutPreview: function ()          { return get('/admin/payout-preview'); },
    simulatePayout:function (opts)      { return post('/admin/simulate-payout', opts || {}); },
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 전역(window) 노출 - 모든 HTML 인라인 스크립트에서 사용 가능
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  global.Auth               = Auth;
  global.requireMemberAuth  = requireMemberAuth;
  global.requireAdminAuth   = requireAdminAuth;
  global.doLogout           = doLogout;
  global.AuthAPI            = AuthAPI;
  global.DashboardAPI       = DashboardAPI;
  global.MembersAPI         = MembersAPI;
  global.InvestmentsAPI     = InvestmentsAPI;
  global.WithdrawalsAPI     = WithdrawalsAPI;
  global.CommissionsAPI     = CommissionsAPI;
  global.AdminAPI           = AdminAPI;

  // 로드 확인 로그 (개발용)
  console.log('[api.js] ✅ 전역 API 로드 완료:', Object.keys({
    Auth, DashboardAPI, MembersAPI, InvestmentsAPI, WithdrawalsAPI, CommissionsAPI, AdminAPI
  }).join(', '));

}(window));

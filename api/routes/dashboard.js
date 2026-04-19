'use strict';
/**
 * DANGUN - 대시보드 API (sqlite3 + sqlite Promise 래퍼 완전 async)
 *
 * [수정 이력]
 * - withdraw_pending: status 필터 제거 → 모든 상태 영구 보존, 30건, 필드 명시적 SELECT
 * - comm_pending:     withdraw_status='pending' 필터, 모든 필드 1:1 명시 SELECT
 * - 두 쿼리 모두 JOIN 컬럼 별칭 고정 → 프론트엔드 바인딩과 완전 일치
 */
const express = require('express');
const { getDb } = require('../../database/db');
const { authAdmin, authMember } = require('../middleware/auth');

const router = express.Router();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/dashboard/admin  ── 관리자 대시보드 종합 통계
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/admin', authAdmin, async (req, res) => {
  try {
    const db = await getDb();

    /* ── 회원 통계 ── */
    const memberStats = await db.get(
      `SELECT
        COUNT(*)                                                    AS total,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END)         AS active,
        SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END)         AS inactive,
        SUM(CASE WHEN rank='팀장'       THEN 1 ELSE 0 END)         AS teamjang,
        SUM(CASE WHEN rank='본부장'     THEN 1 ELSE 0 END)         AS bonbujang,
        COALESCE(SUM(investment_total), 0)                         AS total_investment
       FROM members`
    );

    /* ── 투자 통계 ── */
    const investStats = await db.get(
      `SELECT
        COUNT(*)                                                           AS total,
        COALESCE(SUM(amount), 0)                                           AS total_amount,
        COALESCE(SUM(CASE WHEN status='active' THEN amount ELSE 0 END), 0) AS active_amount
       FROM investments`
    );

    /* ── 주간 지급 통계 (전체, 기간 필터 없음) ── */
    const payoutStats = await db.get(
      `SELECT
        COALESCE(SUM(CASE WHEN status='pending' THEN total_payout ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0)            AS pending_count,
        COALESCE(SUM(CASE WHEN status='paid'    THEN total_payout ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN status='paid'    THEN 1 ELSE 0 END), 0)            AS paid_count
       FROM weekly_payouts
       WHERE scheduled_date <= date('now', '+7 days', 'localtime')`
    );

    /* ── 직급수당 통계
     *   - total / teamjang / bonbujang : 전체 누적
     *   - pending_comm_amount / pending_comm_count : 출금 대기
     * ── */
    const commStats = await db.get(
      `SELECT
        COALESCE(SUM(commission_amount), 0)                                              AS total,
        COALESCE(SUM(CASE WHEN receiver_rank='팀장'  THEN commission_amount ELSE 0 END), 0) AS teamjang,
        COALESCE(SUM(CASE WHEN receiver_rank='본부장' THEN commission_amount ELSE 0 END), 0) AS bonbujang,
        COALESCE(SUM(CASE WHEN withdraw_status='pending' THEN commission_amount ELSE 0 END), 0) AS pending_comm_amount,
        COALESCE(SUM(CASE WHEN withdraw_status='pending' THEN 1 ELSE 0 END), 0)          AS pending_comm_count
       FROM rank_commissions
       WHERE status = 'paid'`
    );

    /* ── 출금(투자금) 통계 ── */
    const withdrawStats = await db.get(
      `SELECT
        COUNT(*)                                                              AS total,
        COALESCE(SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END), 0)     AS pending_count,
        COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN status='paid'     THEN amount ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END), 0)     AS rejected_count
       FROM withdrawal_requests`
    );

    /* ── 월별 투자 추이 (최근 12개월) ── */
    const monthlyInvest = await db.all(
      `SELECT strftime('%Y-%m', investment_date) AS month,
              COALESCE(SUM(amount), 0)            AS amount
       FROM investments
       WHERE investment_date >= date('now', '-12 months', 'localtime')
       GROUP BY month
       ORDER BY month`
    );

    /* ── 최근 활동 로그 (10건) ── */
    const recentActivities = await db.all(
      `SELECT al.*,
              CASE WHEN al.actor_type='member'
                   THEN m.user_id
                   ELSE a.admin_id END AS actor_name
       FROM activity_logs al
       LEFT JOIN members m ON m.id = al.actor_id AND al.actor_type = 'member'
       LEFT JOIN admins  a ON a.id = al.actor_id AND al.actor_type = 'admin'
       ORDER BY al.created_at DESC
       LIMIT 10`
    );

    /* ── 주간 지급 대기 목록 (이번 주 금요일 기준 +7일, 10건) ── */
    const weeklyPending = await db.all(
      `SELECT
        wp.id,
        wp.investment_id,
        wp.member_id,
        wp.week_number,
        wp.principal_portion,
        wp.profit_portion,
        wp.total_payout,
        wp.balance_before,
        wp.balance_after,
        wp.scheduled_date,
        wp.paid_date,
        wp.is_partial,
        wp.status,
        m.user_id,
        m.name,
        m.bank_name,
        m.account_number
       FROM weekly_payouts wp
       JOIN members m ON m.id = wp.member_id
       WHERE wp.status = 'pending'
         AND wp.scheduled_date <= date('now', '+7 days', 'localtime')
       ORDER BY wp.scheduled_date ASC, wp.id ASC
       LIMIT 10`
    );

    /* ── 출금 내역 (모든 상태, 영구 보존, 30건)
     *
     * ✅ 수정 포인트:
     *   - WHERE status='pending' 조건 제거 → 전체(paid/rejected/pending) 모두 출력
     *   - 필드를 명시적으로 SELECT → 프론트엔드 바인딩과 정확히 1:1 일치
     *   - week_number, investment_amount (ALTER 로 추가된 컬럼) 포함
     * ── */
    const withdrawPending = await db.all(
      `SELECT
        wr.id,
        wr.member_id,
        wr.payout_id,
        wr.withdraw_type,
        wr.amount,
        wr.bank_name,
        wr.account_number,
        wr.account_holder,
        wr.request_date,
        wr.approved_by,
        wr.approved_at,
        wr.paid_at,
        wr.withdraw_date,
        wr.status,
        wr.reject_reason,
        wr.week_number,
        wr.investment_amount,
        wr.created_at,
        wr.updated_at,
        m.user_id,
        m.name
       FROM withdrawal_requests wr
       JOIN members m ON m.id = wr.member_id
       ORDER BY wr.created_at DESC
       LIMIT 30`
    );

    /* ── 미승인 회원 (5건) ── */
    const pendingMembers = await db.all(
      `SELECT id, user_id, name, phone, created_at
       FROM members
       WHERE status = 'inactive'
       ORDER BY created_at DESC
       LIMIT 5`
    );

    /* ── 직급수당 출금 대기 목록
     *
     * ✅ 수정 포인트:
     *   - withdraw_status='pending' 만 조회 (대기 상태 고정)
     *   - rc 모든 필드 + receiver(수령자) 별칭 + investor(투자자) 별칭 명시
     *   - 기간 필터 없음 → 관리자 승인 전까지 영구 노출
     * ── */
    const commPending = await db.all(
      `SELECT
        rc.id,
        rc.investment_id,
        rc.investor_id,
        rc.receiver_id,
        rc.receiver_rank,
        rc.commission_rate,
        rc.investment_amount,
        rc.commission_amount,
        rc.balance_before,
        rc.balance_after,
        rc.paid_at,
        rc.status,
        rc.withdraw_status,
        rc.completed_at,
        rc.created_at,
        rc.updated_at,
        rcv.user_id       AS receiver_user_id,
        rcv.name          AS receiver_name,
        rcv.bank_name     AS receiver_bank_name,
        rcv.account_number AS receiver_account_number,
        inv_m.user_id     AS investor_user_id,
        inv_m.name        AS investor_name
       FROM rank_commissions rc
       JOIN members rcv   ON rcv.id   = rc.receiver_id
       JOIN members inv_m ON inv_m.id = rc.investor_id
       WHERE rc.withdraw_status = 'pending'
         AND rc.status          = 'paid'
       ORDER BY rc.created_at DESC
       LIMIT 100`
    );

    return res.json({
      member_stats:      memberStats,
      invest_stats:      investStats,
      payout_stats:      payoutStats,
      comm_stats:        commStats,
      withdraw_stats:    withdrawStats,
      monthly_invest:    monthlyInvest,
      recent_activities: recentActivities,
      weekly_pending:    weeklyPending,
      withdraw_pending:  withdrawPending,   // 모든 상태 영구 보존
      pending_members:   pendingMembers,
      comm_pending:      commPending,       // 직급수당 출금대기 전체 (withdraw_status='pending')
    });
  } catch (e) {
    console.error('GET /dashboard/admin error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/dashboard/member  ── 회원 대시보드
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/member', authMember, async (req, res) => {
  try {
    const db  = await getDb();
    const mid = req.user.id;

    const member = await db.get(
      `SELECT m.*,
              w.total_invested,
              w.total_profit,
              w.total_commission,
              w.available_balance,
              w.pending_payout,
              w.total_withdrawn
       FROM members m
       LEFT JOIN member_wallets w ON w.member_id = m.id
       WHERE m.id = ?`,
      [mid]
    );

    const investment = await db.get(
      `SELECT * FROM investments
       WHERE member_id = ? AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [mid]
    );

    let payouts = [], nextPayout = null;
    if (investment) {
      payouts = await db.all(
        `SELECT * FROM weekly_payouts
         WHERE investment_id = ?
         ORDER BY week_number`,
        [investment.id]
      );
      nextPayout = await db.get(
        `SELECT * FROM weekly_payouts
         WHERE investment_id = ? AND status = 'pending'
         ORDER BY week_number
         LIMIT 1`,
        [investment.id]
      );
    }

    const commissions = await db.all(
      `SELECT rc.*,
              inv_m.user_id AS investor_user_id,
              inv_m.name    AS investor_name
       FROM rank_commissions rc
       JOIN members inv_m ON inv_m.id = rc.investor_id
       WHERE rc.receiver_id = ?
       ORDER BY rc.created_at DESC
       LIMIT 10`,
      [mid]
    );

    /* 대기중 수당 합산 (withdraw_status='pending') */
    const pendingCommStats = await db.get(
      `SELECT
        COALESCE(SUM(commission_amount), 0) AS pending_amount,
        COUNT(*) AS pending_count
       FROM rank_commissions
       WHERE receiver_id = ? AND withdraw_status = 'pending'`,
      [mid]
    );

    const referralStats = await db.get(
      `SELECT
        COUNT(*)                                           AS total,
        SUM(CASE WHEN rt.depth = 1 THEN 1 ELSE 0 END)    AS direct
       FROM referral_tree rt
       WHERE rt.ancestor_id = ? AND rt.depth > 0`,
      [mid]
    );

    const withdrawals = await db.get(
      `SELECT * FROM withdrawal_requests
       WHERE member_id = ?
       ORDER BY created_at DESC
       LIMIT 5`,
      [mid]
    );

    return res.json({
      member:             { ...member, password: undefined },
      investment,
      payouts,
      next_payout:        nextPayout,
      commissions,
      pending_comm_stats: pendingCommStats,
      referral_stats:     referralStats,
      recent_withdrawals: withdrawals,
    });
  } catch (e) {
    console.error('GET /dashboard/member error:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

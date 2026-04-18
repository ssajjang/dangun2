'use strict';
/**
 * DANGUN - 대시보드 API (sqlite3 + sqlite Promise 래퍼 완전 async)
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

    const memberStats = await db.get(
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) as inactive,
        SUM(CASE WHEN rank='팀장'       THEN 1 ELSE 0 END) as teamjang,
        SUM(CASE WHEN rank='본부장'     THEN 1 ELSE 0 END) as bonbujang,
        SUM(investment_total) as total_investment
       FROM members`
    );

    const investStats = await db.get(
      `SELECT COUNT(*) as total,
        SUM(amount) as total_amount,
        SUM(CASE WHEN status='active' THEN amount ELSE 0 END) as active_amount
       FROM investments`
    );

    const payoutStats = await db.get(
      `SELECT
        SUM(CASE WHEN status='pending' THEN total_payout ELSE 0 END) as pending_amount,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status='paid'    THEN total_payout ELSE 0 END) as paid_amount,
        SUM(CASE WHEN status='paid'    THEN 1 ELSE 0 END) as paid_count
       FROM weekly_payouts
       WHERE scheduled_date <= date('now','+7 days','localtime')`
    );

    const commStats = await db.get(
      `SELECT SUM(commission_amount) as total,
              SUM(CASE WHEN receiver_rank='팀장'  THEN commission_amount ELSE 0 END) as teamjang,
              SUM(CASE WHEN receiver_rank='본부장' THEN commission_amount ELSE 0 END) as bonbujang
       FROM rank_commissions WHERE status='paid'`
    );

    const withdrawStats = await db.get(
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) as pending_amount,
        SUM(CASE WHEN status='paid'    THEN amount ELSE 0 END) as paid_amount
       FROM withdrawal_requests`
    );

    const monthlyInvest = await db.all(
      `SELECT strftime('%Y-%m', investment_date) as month, SUM(amount) as amount
       FROM investments
       WHERE investment_date >= date('now', '-12 months', 'localtime')
       GROUP BY month ORDER BY month`
    );

    const recentActivities = await db.all(
      `SELECT al.*,
        CASE WHEN al.actor_type='member' THEN m.user_id ELSE a.admin_id END as actor_name
       FROM activity_logs al
       LEFT JOIN members m ON m.id = al.actor_id AND al.actor_type='member'
       LEFT JOIN admins  a ON a.id = al.actor_id AND al.actor_type='admin'
       ORDER BY al.created_at DESC LIMIT 10`
    );

    const weeklyPending = await db.all(
      `SELECT wp.*, m.user_id, m.name, m.bank_name, m.account_number
       FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status='pending' AND wp.scheduled_date <= date('now','+7 days','localtime')
       ORDER BY wp.scheduled_date LIMIT 10`
    );

    const withdrawPending = await db.all(
      `SELECT wr.*, m.user_id, m.name, m.bank_name, m.account_number
       FROM withdrawal_requests wr JOIN members m ON m.id = wr.member_id
       WHERE wr.status='pending' ORDER BY wr.created_at LIMIT 10`
    );

    const pendingMembers = await db.all(
      `SELECT id, user_id, name, phone, created_at FROM members WHERE status='inactive' ORDER BY created_at DESC LIMIT 5`
    );

    return res.json({
      member_stats:       memberStats,
      invest_stats:       investStats,
      payout_stats:       payoutStats,
      comm_stats:         commStats,
      withdraw_stats:     withdrawStats,
      monthly_invest:     monthlyInvest,
      recent_activities:  recentActivities,
      weekly_pending:     weeklyPending,
      withdraw_pending:   withdrawPending,
      pending_members:    pendingMembers,
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
      `SELECT m.*, w.total_invested, w.total_profit, w.total_commission,
              w.available_balance, w.pending_payout, w.total_withdrawn
       FROM members m LEFT JOIN member_wallets w ON w.member_id=m.id
       WHERE m.id=?`,
      [mid]
    );

    const investment = await db.get(
      `SELECT * FROM investments WHERE member_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`,
      [mid]
    );

    let payouts = [], nextPayout = null;
    if (investment) {
      payouts = await db.all(
        `SELECT * FROM weekly_payouts WHERE investment_id=? ORDER BY week_number`,
        [investment.id]
      );
      nextPayout = await db.get(
        `SELECT * FROM weekly_payouts WHERE investment_id=? AND status='pending' ORDER BY week_number LIMIT 1`,
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
       ORDER BY rc.created_at DESC LIMIT 10`,
      [mid]
    );

    // 대기중 수당 합산 (withdraw_status='pending')
    const pendingCommStats = await db.get(
      `SELECT COALESCE(SUM(commission_amount),0) as pending_amount,
              COUNT(*) as pending_count
       FROM rank_commissions
       WHERE receiver_id=? AND withdraw_status='pending'`,
      [mid]
    );

    const referralStats = await db.get(
      `SELECT COUNT(*) as total,
       SUM(CASE WHEN rt.depth=1 THEN 1 ELSE 0 END) as direct
       FROM referral_tree rt WHERE rt.ancestor_id=? AND rt.depth>0`,
      [mid]
    );

    const withdrawals = await db.get(
      `SELECT * FROM withdrawal_requests WHERE member_id=? ORDER BY created_at DESC LIMIT 5`,
      [mid]
    );

    return res.json({
      member:               { ...member, password: undefined },
      investment,
      payouts,
      next_payout:          nextPayout,
      commissions,
      pending_comm_stats:   pendingCommStats,   // 대기중 수당 합산
      referral_stats:       referralStats,
      recent_withdrawals:   withdrawals,
    });
  } catch (e) {
    console.error('GET /dashboard/member error:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

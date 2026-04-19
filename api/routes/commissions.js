'use strict';
/**
 * DANGUN - 직급수당 API (sqlite3 + sqlite Promise 래퍼 완전 async)
 */
const express = require('express');
const { getDb } = require('../../database/db');
const { authAdmin, authMember } = require('../middleware/auth');

const router = express.Router();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/commissions  ── 관리자: 전체 수당 내역
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const page   = parseInt(req.query.page  || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const q               = req.query.search         || '';
    const rank            = req.query.rank           || '';
    const status          = req.query.status         || '';
    const withdraw_status = req.query.withdraw_status || '';

    const conds = ['1=1'];
    const params = [];
    if (q) {
      conds.push(`(rcv.user_id LIKE ? OR rcv.name LIKE ? OR inv_m.user_id LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (rank)            { conds.push(`rc.receiver_rank = ?`);    params.push(rank); }
    if (status)          { conds.push(`rc.status = ?`);           params.push(status); }
    if (withdraw_status) { conds.push(`rc.withdraw_status = ?`);  params.push(withdraw_status); }

    const where = conds.join(' AND ');

    const rows = await db.all(
      `SELECT rc.*,
              rcv.user_id       AS receiver_user_id,   rcv.name         AS receiver_name,
              rcv.bank_name     AS receiver_bank_name, rcv.account_number AS receiver_account_number,
              inv_m.user_id     AS investor_user_id,   inv_m.name       AS investor_name
       FROM rank_commissions rc
       JOIN members rcv   ON rcv.id   = rc.receiver_id
       JOIN members inv_m ON inv_m.id = rc.investor_id
       WHERE ${where} ORDER BY rc.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const { cnt: total } = await db.get(
      `SELECT COUNT(*) as cnt FROM rank_commissions rc
       JOIN members rcv   ON rcv.id   = rc.receiver_id
       JOIN members inv_m ON inv_m.id = rc.investor_id
       WHERE ${where}`,
      params
    );

    // 통계: status='paid' 전체 기준 (withdraw_status 별 구분, role/rank 기준 직급 구분)
    const stats = await db.get(
      `SELECT
        COUNT(*)                                                                              AS total_count,
        COALESCE(SUM(commission_amount), 0)                                                   AS total_amount,
        COALESCE(SUM(CASE WHEN receiver_rank='팀장'  THEN commission_amount ELSE 0 END), 0)  AS teamjang_total,
        COALESCE(SUM(CASE WHEN receiver_rank='본부장' THEN commission_amount ELSE 0 END), 0) AS bonbujang_total,
        COALESCE(SUM(CASE WHEN withdraw_status='pending'   THEN commission_amount ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN withdraw_status='done'      THEN commission_amount ELSE 0 END), 0) AS withdrawn_amount,
        COALESCE(SUM(CASE WHEN withdraw_status='completed' THEN commission_amount ELSE 0 END), 0) AS completed_amount,
        COALESCE(SUM(CASE WHEN withdraw_status='pending'   THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN withdraw_status='done'      THEN 1 ELSE 0 END), 0) AS withdrawn_count,
        COALESCE(SUM(CASE WHEN withdraw_status='completed' THEN 1 ELSE 0 END), 0) AS completed_count
       FROM rank_commissions WHERE status='paid'`
    );

    // commissions_history 합산 (최종 출금완료 이력)
    let histStats = { history_count: 0, history_amount: 0 };
    try {
      histStats = await db.get(
        `SELECT COUNT(*) AS history_count, COALESCE(SUM(commission_amount),0) AS history_amount
         FROM commissions_history`
      ) || histStats;
    } catch(he) { /* commissions_history 없으면 무시 */ }

    return res.json({ data: rows, total, page, limit, stats: { ...stats, ...histStats } });
  } catch (e) {
    console.error('GET /commissions error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/commissions/my  ── 회원: 내가 받은 수당 내역
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/my', authMember, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT rc.*, inv_m.user_id AS investor_user_id, inv_m.name AS investor_name
       FROM rank_commissions rc JOIN members inv_m ON inv_m.id = rc.investor_id
       WHERE rc.receiver_id = ? ORDER BY rc.created_at DESC`,
      [req.user.id]
    );

    const stats = await db.get(
      `SELECT SUM(commission_amount) as total, COUNT(*) as count
       FROM rank_commissions WHERE receiver_id=? AND status='paid'`,
      [req.user.id]
    );

    return res.json({ data: rows, stats });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/commissions/monthly  ── 관리자: 월별 수당 집계 (최근 12개월)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/monthly', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    // created_at 기준 집계 (paid_at 이 NULL 인 경우 대비)
    const rows = await db.all(`
      SELECT
        strftime('%Y-%m', created_at) AS month,
        COALESCE(SUM(CASE WHEN receiver_rank='팀장'  THEN commission_amount ELSE 0 END), 0) AS teamjang_amount,
        COALESCE(SUM(CASE WHEN receiver_rank='본부장' THEN commission_amount ELSE 0 END), 0) AS bonbujang_amount,
        COALESCE(SUM(commission_amount), 0)  AS total_amount,
        COUNT(*)                             AS count,
        COALESCE(SUM(CASE WHEN withdraw_status='pending'   THEN commission_amount ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN withdraw_status='done'      THEN commission_amount ELSE 0 END), 0) AS withdrawn_amount,
        COALESCE(SUM(CASE WHEN withdraw_status='completed' THEN commission_amount ELSE 0 END), 0) AS completed_amount
      FROM rank_commissions
      WHERE status='paid'
        AND created_at >= date('now', '-12 months', 'localtime')
      GROUP BY month
      ORDER BY month
    `);
    return res.json({ data: rows });
  } catch (e) {
    console.error('GET /commissions/monthly error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/commissions/approve  ── 관리자: 수당 출금 승인
   - withdraw_status: pending → completed
   - completed_at 저장
   - commissions_history 테이블에 이력 복사
   - 지갑 available_balance 차감, total_withdrawn 증가
   body: { id: commission_id }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/approve', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const commId = parseInt(req.body.id);
    if (!commId) return res.status(400).json({ error: 'id 필드가 필요합니다.' });

    const comm = await db.get(
      `SELECT rc.*, rcv.name AS receiver_name, rcv.user_id AS receiver_user_id,
              rcv.bank_name AS bank_name, rcv.account_number AS account_number
       FROM rank_commissions rc JOIN members rcv ON rcv.id = rc.receiver_id
       WHERE rc.id = ?`,
      [commId]
    );
    if (!comm) return res.status(404).json({ error: '수당 내역을 찾을 수 없습니다.' });
    if (comm.withdraw_status === 'completed' || comm.withdraw_status === 'done') {
      return res.status(409).json({ error: '이미 출금완료 처리된 항목입니다.' });
    }

    const amt      = Math.round(comm.commission_amount || 0);
    const nowLocal = `datetime('now','localtime')`;

    // ① rank_commissions: withdraw_status → completed, completed_at 저장
    await db.run(
      `UPDATE rank_commissions
       SET withdraw_status = 'completed',
           completed_at    = datetime('now','localtime'),
           updated_at      = datetime('now','localtime')
       WHERE id = ?`,
      [commId]
    );

    // ② commissions_history 에 이력 복사
    try {
      await db.run(
        `INSERT INTO commissions_history
           (commission_id, investment_id, investor_id, receiver_id, receiver_rank,
            commission_rate, investment_amount, commission_amount,
            balance_before, balance_after, paid_at, completed_at, approved_by,
            withdraw_status, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, 'completed', ?)`,
        [
          comm.id, comm.investment_id, comm.investor_id, comm.receiver_id, comm.receiver_rank,
          comm.commission_rate, comm.investment_amount, amt,
          comm.balance_before, comm.balance_after, comm.paid_at,
          req.admin.id,
          comm.memo || '',
        ]
      );
    } catch (he) {
      console.warn('[approve] commissions_history insert 실패 (테이블 없을 수 있음):', he.message);
    }

    // ③ 지갑: available_balance 차감, total_withdrawn 증가
    await db.run(
      `UPDATE member_wallets
       SET available_balance = MAX(available_balance - ?, 0),
           total_withdrawn   = total_withdrawn + ?,
           updated_at        = datetime('now','localtime')
       WHERE member_id = ?`,
      [amt, amt, comm.receiver_id]
    );

    // ④ 활동 로그
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('admin',?,'commission_approve','rank_commissions',?,?)`,
      [req.admin.id, commId,
       `직급수당 출금승인: ${comm.receiver_user_id}(${comm.receiver_name}) ₩${amt.toLocaleString()} [${comm.receiver_rank}]`]
    );

    return res.json({
      message: `출금완료 처리되었습니다. (${comm.receiver_name}: ₩${amt.toLocaleString()})`,
      commission_id: commId,
      withdraw_status: 'completed',
      completed_at: new Date().toISOString(),
      withdrawn_amount: amt,
    });
  } catch (e) {
    console.error('POST /commissions/approve error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PATCH /api/commissions/:id/withdraw  ── 관리자: 수당 출금완료 처리 (레거시 호환)
   (지갑 available_balance → total_withdrawn 이동, withdraw_status='done')
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.patch('/:id/withdraw', authAdmin, async (req, res) => {
  try {
    const db   = await getDb();
    const comm = await db.get(
      `SELECT rc.*, rcv.name AS receiver_name, rcv.user_id AS receiver_user_id,
              rcv.bank_name AS bank_name, rcv.account_number AS account_number
       FROM rank_commissions rc JOIN members rcv ON rcv.id = rc.receiver_id
       WHERE rc.id = ?`,
      [req.params.id]
    );
    if (!comm) return res.status(404).json({ error: '수당 내역을 찾을 수 없습니다.' });
    if (comm.withdraw_status === 'done') return res.status(409).json({ error: '이미 출금완료 처리된 항목입니다.' });

    const amt = comm.commission_amount || 0;

    // 지갑: available_balance 차감, total_withdrawn 증가
    await db.run(
      `UPDATE member_wallets
       SET available_balance = MAX(available_balance - ?, 0),
           total_withdrawn   = total_withdrawn + ?,
           updated_at        = datetime('now','localtime')
       WHERE member_id = ?`,
      [amt, amt, comm.receiver_id]
    );

    // 수당 행: withdraw_status = 'done' 마크 + completed_at 저장
    await db.run(
      `UPDATE rank_commissions
       SET withdraw_status = 'done',
           completed_at    = datetime('now','localtime'),
           updated_at      = datetime('now','localtime')
       WHERE id = ?`,
      [comm.id]
    );

    // commissions_history 이력 복사 (실패해도 출금 처리는 계속)
    try {
      await db.run(
        `INSERT INTO commissions_history
           (commission_id, investment_id, investor_id, receiver_id, receiver_rank,
            commission_rate, investment_amount, commission_amount,
            balance_before, balance_after, paid_at, completed_at, approved_by,
            withdraw_status, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, 'done', ?)`,
        [
          comm.id, comm.investment_id, comm.investor_id, comm.receiver_id, comm.receiver_rank,
          comm.commission_rate, comm.investment_amount, amt,
          comm.balance_before, comm.balance_after, comm.paid_at,
          req.admin.id,
          comm.memo || '',
        ]
      );
    } catch (he) {
      console.warn('[withdraw] commissions_history insert 실패:', he.message);
    }

    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('admin',?,'commission_withdraw','rank_commissions',?,?)`,
      [req.admin.id, comm.id,
       `수당 출금완료: ${comm.receiver_user_id}(${comm.receiver_name}) ₩${amt.toLocaleString()} [계좌: ${comm.bank_name} ${comm.account_number}]`]
    );

    return res.json({
      message: `출금완료 처리되었습니다. (${comm.receiver_name}: ₩${amt.toLocaleString()})`,
      commission_id: comm.id,
      withdrawn_amount: amt,
    });
  } catch(e) {
    console.error('PATCH /commissions/:id/withdraw error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DELETE /api/commissions/:id  ── 관리자: 직급수당 삭제 (잔고 복원)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.delete('/:id', authAdmin, async (req, res) => {
  try {
    const db   = await getDb();
    const comm = await db.get(
      `SELECT rc.*,
              rcv.user_id AS receiver_user_id, rcv.name AS receiver_name,
              inv_m.user_id AS investor_user_id
       FROM rank_commissions rc
       JOIN members rcv   ON rcv.id   = rc.receiver_id
       JOIN members inv_m ON inv_m.id = rc.investor_id
       WHERE rc.id = ?`,
      [req.params.id]
    );
    if (!comm) return res.status(404).json({ error: '수당 내역을 찾을 수 없습니다.' });

    // 수당 수령자 지갑에서 수당 금액 차감 (잔고 복원)
    await db.run(
      `UPDATE member_wallets
       SET total_commission  = MAX(total_commission - ?, 0),
           available_balance = MAX(available_balance - ?, 0),
           updated_at        = datetime('now','localtime')
       WHERE member_id = ?`,
      [comm.commission_amount, comm.commission_amount, comm.receiver_id]
    );

    // 수당 내역 삭제
    await db.run(`DELETE FROM rank_commissions WHERE id=?`, [comm.id]);

    // 활동 로그
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('admin',?,'commission_delete','rank_commissions',?,?)`,
      [req.admin.id, comm.id,
       `직급수당 삭제: ${comm.receiver_user_id}(${comm.receiver_name}) ₩${comm.commission_amount.toLocaleString()} [${comm.receiver_rank}] ← 투자자:${comm.investor_user_id}`]
    );

    return res.json({
      message: `수당이 삭제되고 잔고가 복원되었습니다. (수령자: ${comm.receiver_name}, 금액: ₩${comm.commission_amount.toLocaleString()})`,
      deleted_commission_id: comm.id,
    });
  } catch (e) {
    console.error('DELETE /commissions error:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

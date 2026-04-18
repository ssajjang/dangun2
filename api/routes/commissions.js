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
    const q      = req.query.search || '';
    const rank   = req.query.rank   || '';
    const status = req.query.status || '';

    const conds = ['1=1'];
    const params = [];
    if (q) {
      conds.push(`(rcv.user_id LIKE ? OR rcv.name LIKE ? OR inv_m.user_id LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (rank)   { conds.push(`rc.receiver_rank = ?`); params.push(rank); }
    if (status) { conds.push(`rc.status = ?`);        params.push(status); }

    const where = conds.join(' AND ');

    const rows = await db.all(
      `SELECT rc.*,
              rcv.user_id   AS receiver_user_id, rcv.name   AS receiver_name,
              inv_m.user_id AS investor_user_id, inv_m.name AS investor_name
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

    const stats = await db.get(
      `SELECT COUNT(*) as total, SUM(commission_amount) as total_amount,
              SUM(CASE WHEN receiver_rank='팀장'  THEN commission_amount ELSE 0 END) as teamjang_total,
              SUM(CASE WHEN receiver_rank='본부장' THEN commission_amount ELSE 0 END) as bonbujang_total
       FROM rank_commissions WHERE status='paid'`
    );

    return res.json({ data: rows, total, page, limit, stats });
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

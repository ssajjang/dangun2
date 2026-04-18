'use strict';
/**
 * DANGUN - 출금신청 API (sqlite3 + sqlite Promise 래퍼 완전 async)
 */
const express = require('express');
const { getDb } = require('../../database/db');
const { authAdmin, authMember } = require('../middleware/auth');

const router = express.Router();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/withdrawals  ── 회원: 출금 신청
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/', authMember, async (req, res) => {
  try {
    const { amount, bank_name, account_number, account_holder } = req.body;
    if (!amount || !bank_name || !account_number || !account_holder)
      return res.status(400).json({ error: 'amount, bank_name, account_number, account_holder 필수' });

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 10000)
      return res.status(400).json({ error: '최소 출금 금액은 10,000원입니다.' });

    const db     = await getDb();
    const wallet = await db.get('SELECT * FROM member_wallets WHERE member_id=?', [req.user.id]);
    if (!wallet || wallet.available_balance < amt)
      return res.status(400).json({ error: '출금 가능 잔액이 부족합니다.', available: wallet?.available_balance || 0 });

    // 중복 출금 신청 방지
    const pending = await db.get(
      `SELECT id FROM withdrawal_requests WHERE member_id=? AND status='pending'`,
      [req.user.id]
    );
    if (pending) return res.status(409).json({ error: '이미 처리 대기 중인 출금 신청이 있습니다.' });

    const result = await db.run(
      `INSERT INTO withdrawal_requests
        (member_id, amount, bank_name, account_number, account_holder, withdraw_type, status)
       VALUES (?,?,?,?,?,'weekly_profit','pending')`,
      [req.user.id, amt, bank_name, account_number, account_holder]
    );
    const withdrawId = result.lastID;

    // 가용 잔액 선차감
    await db.run(
      `UPDATE member_wallets SET available_balance=available_balance-?, updated_at=datetime('now','localtime') WHERE member_id=?`,
      [amt, req.user.id]
    );

    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('member',?,'withdrawal_request','withdrawal_requests',?,?)`,
      [req.user.id, withdrawId, `출금 신청: ₩${amt.toLocaleString()}`]
    );

    return res.status(201).json({ message: '출금 신청이 접수되었습니다.', withdrawal_id: withdrawId, amount: amt });
  } catch (e) {
    console.error('POST /withdrawals error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/withdrawals  ── 관리자: 전체 출금 신청 목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const page   = parseInt(req.query.page  || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const q      = req.query.search || '';
    const status = req.query.status || '';

    const conds  = ['1=1'];
    const params = [];
    if (q) {
      conds.push(`(m.user_id LIKE ? OR m.name LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status) { conds.push(`wr.status = ?`); params.push(status); }

    const where = conds.join(' AND ');

    const rows = await db.all(
      `SELECT wr.*, m.user_id, m.name, m.rank
       FROM withdrawal_requests wr JOIN members m ON m.id = wr.member_id
       WHERE ${where} ORDER BY wr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const { cnt: total } = await db.get(
      `SELECT COUNT(*) as cnt FROM withdrawal_requests wr JOIN members m ON m.id = wr.member_id WHERE ${where}`,
      params
    );

    return res.json({ data: rows, total, page, limit });
  } catch (e) {
    console.error('GET /withdrawals error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/withdrawals/my  ── 회원: 내 출금 신청 내역
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/my', authMember, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT * FROM withdrawal_requests WHERE member_id=? ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PATCH /api/withdrawals/:id/approve  ── 관리자: 출금 승인
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.patch('/:id/approve', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const wr = await db.get('SELECT * FROM withdrawal_requests WHERE id=?', [req.params.id]);
    if (!wr) return res.status(404).json({ error: '출금 신청을 찾을 수 없습니다.' });
    if (wr.status !== 'pending') return res.status(400).json({ error: '대기 중인 신청만 승인 가능합니다.' });

    await db.run(
      `UPDATE withdrawal_requests SET status='paid', approved_by=?, approved_at=datetime('now','localtime'),
       paid_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
      [req.admin.id, wr.id]
    );

    // 지갑 총출금액 반영
    await db.run(
      `UPDATE member_wallets SET total_withdrawn=total_withdrawn+?, updated_at=datetime('now','localtime') WHERE member_id=?`,
      [wr.amount, wr.member_id]
    );

    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('admin',?,'withdrawal_approve','withdrawal_requests',?,?)`,
      [req.admin.id, wr.id, `출금 승인: ₩${wr.amount.toLocaleString()}`]
    );

    return res.json({ message: '출금 승인 완료', withdrawal_id: wr.id });
  } catch (e) {
    console.error('PATCH /withdrawals/approve error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PATCH /api/withdrawals/:id/reject  ── 관리자: 출금 거절
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.patch('/:id/reject', authAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const db = await getDb();
    const wr = await db.get('SELECT * FROM withdrawal_requests WHERE id=?', [req.params.id]);
    if (!wr) return res.status(404).json({ error: '출금 신청을 찾을 수 없습니다.' });
    if (wr.status !== 'pending') return res.status(400).json({ error: '대기 중인 신청만 거절 가능합니다.' });

    await db.run(
      `UPDATE withdrawal_requests SET status='rejected', reject_reason=?, approved_by=?,
       approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
      [reason || '', req.admin.id, wr.id]
    );

    // 선차감한 잔액 복원
    await db.run(
      `UPDATE member_wallets SET available_balance=available_balance+?, updated_at=datetime('now','localtime') WHERE member_id=?`,
      [wr.amount, wr.member_id]
    );

    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('admin',?,'withdrawal_reject','withdrawal_requests',?,?)`,
      [req.admin.id, wr.id, `출금 거절: ₩${wr.amount.toLocaleString()} 사유: ${reason || '없음'}`]
    );

    return res.json({ message: '출금 거절 처리 완료', withdrawal_id: wr.id });
  } catch (e) {
    console.error('PATCH /withdrawals/reject error:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

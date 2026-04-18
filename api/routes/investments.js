'use strict';
/**
 * DANGUN - 투자금 입금 API (sqlite3 + sqlite Promise 래퍼 완전 async)
 * 입금 즉시: ① 15주 지급 스케줄 생성 ② 직급수당 자동 계산·지급
 */
const express = require('express');
const { getDb } = require('../../database/db');
const { authAdmin, authMember } = require('../middleware/auth');

const router = express.Router();

/* ── 다음 금요일 계산 ── */
function nextFriday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const add = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

/* ── 날짜 + N주 ── */
function addWeeks(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/investments  ── 관리자: 투자금 입금 등록
   → 15주 스케줄 + 직급수당 즉시 처리
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/', authAdmin, async (req, res) => {
  try {
    const { member_id, amount, investment_date, memo } = req.body;
    if (!member_id || !amount || !investment_date)
      return res.status(400).json({ error: 'member_id, amount, investment_date 필수' });

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 100000)
      return res.status(400).json({ error: '최소 투자금액은 100,000원입니다.' });

    const db = await getDb();
    const member = await db.get('SELECT * FROM members WHERE id = ? AND status = "active"', [member_id]);
    if (!member) return res.status(404).json({ error: '활성 회원을 찾을 수 없습니다.' });

    /* ━━ 지급 계산 규칙 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     * 매출(투자금) N원 → 15주간 1.5N원 지급
     * 이자 = 매출의 50%  (profit_rate = 0.50)
     * 총 지급 = 원금 N + 이자 0.5N = 1.5N
     * 매주 지급 = floor(원금/15) + floor(이자/15)  (마지막 주에 나머지 처리)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    const profit_rate       = 0.50;   // 50% 이자 (원금의 50%)
    const total_weeks       = 15;
    const total_profit      = Math.round(amt * profit_rate);   // 이자 금액
    const total_payout      = amt + total_profit;              // 총 지급 = 1.5배
    const principal_per_week = Math.floor(amt / total_weeks);
    const profit_per_week    = Math.floor(total_profit / total_weeks);
    const first_friday       = nextFriday(investment_date);
    const end_date           = addWeeks(first_friday, total_weeks - 1);

    /* ① investments INSERT */
    const invResult = await db.run(
      `INSERT INTO investments
        (member_id, amount, weekly_profit, total_weeks, current_week,
         paid_amount, remaining_amount, investment_date, next_pay_date, end_date, status, admin_id, memo)
       VALUES (?,?,?,?,0, 0,?,?,?,?,'active',?,?)`,
      [member_id, amt, profit_per_week, total_weeks, total_payout,
       investment_date, first_friday, end_date, req.admin.id, memo || '']
    );
    const invId = invResult.lastID;

    /* ② 15주 지급 스케줄 생성 */
    let balance = total_payout;
    let payDate = first_friday;
    for (let w = 1; w <= total_weeks; w++) {
      const pp = (w === total_weeks) ? (amt - principal_per_week * (total_weeks - 1)) : principal_per_week;
      const pr = (w === total_weeks) ? (total_profit - profit_per_week * (total_weeks - 1)) : profit_per_week;
      const wt = pp + pr;
      const bal_before = balance;
      balance = Math.round(Math.max(balance - wt, 0));
      await db.run(
        `INSERT INTO weekly_payouts
          (investment_id, member_id, week_number, principal_portion, profit_portion,
           total_payout, balance_before, balance_after, scheduled_date, status)
         VALUES (?,?,?,?,?,?,?,?,?,'pending')`,
        [invId, member_id, w, pp, pr, wt, bal_before, balance, payDate]
      );
      payDate = addWeeks(payDate, 1);
    }

    /* ③ 회원 investment_total, investment_date 업데이트 */
    await db.run(
      `UPDATE members SET investment_total=investment_total+?, investment_date=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [amt, investment_date, member_id]
    );

    /* ④ 지갑 업데이트 */
    await db.run(
      `INSERT INTO member_wallets (member_id, total_invested, pending_payout)
       VALUES (?,?,?)
       ON CONFLICT(member_id) DO UPDATE SET
         total_invested = total_invested + ?,
         pending_payout = pending_payout + ?,
         updated_at = datetime('now','localtime')`,
      [member_id, amt, total_payout, amt, total_payout]
    );

    /* ⑤ 직급수당 자동 계산 - 라인 상위 탐색 방식
     *
     * 규칙:
     *  - 투자금 발생 회원의 추천 라인(상위)을 따라 올라가며 최초 직급자를 탐색
     *  - 본부장만 존재 → 20% 지급
     *  - 팀장+본부장 존재 → 각 10% 지급
     *  - 팀장만 존재 → 10% 지급, 나머지(10%)는 미지급(flush)
     *  - 직급자 없음 → 미지급
     *  - 유니레벨: 라인 상위 방향으로만 탐색 (무한 루프 방지, 최대 20단계)
     */
    const commissions = [];

    const getWalletBal = async (mid) => {
      const w = await db.get('SELECT available_balance FROM member_wallets WHERE member_id = ?', [mid]);
      return (w && w.available_balance != null) ? w.available_balance : 0;
    };
    const updWallet = async (commAmt, mid) => {
      await db.run(
        `UPDATE member_wallets
         SET available_balance = available_balance + ?,
             total_commission  = total_commission  + ?,
             updated_at = datetime('now','localtime')
         WHERE member_id = ?`,
        [commAmt, commAmt, mid]
      );
    };
    const insertComm = async (receiverId, receiverRank, rate, commAmt, walBefore) => {
      // withdraw_status = 'pending' (출금대기 - 관리자 승인 후 출금완료)
      // balance_before / balance_after: 수당 발생 시점 지갑 잔고 기준
      await db.run(
        `INSERT INTO rank_commissions
          (investment_id, investor_id, receiver_id, receiver_rank, commission_rate,
           investment_amount, commission_amount, balance_before, balance_after,
           paid_at, status, withdraw_status)
         VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'),'paid','pending')`,
        [invId, member_id, receiverId, receiverRank, rate, amt, commAmt, walBefore, walBefore + commAmt]
      );
    };

    // 라인 상위 탐색: 최초 팀장, 최초 본부장 탐색
    let foundTeamjang  = null; // 가장 가까운 팀장
    let foundBonbujang = null; // 가장 가까운 본부장
    let cursor = member.recommender_id;
    let depth  = 0;
    const MAX_DEPTH = 20;

    while (cursor && depth < MAX_DEPTH) {
      const ancestor = await db.get(
        'SELECT id, rank, recommender_id FROM members WHERE id = ?',
        [cursor]
      );
      if (!ancestor) break;

      if (ancestor.rank === '팀장' && !foundTeamjang) {
        foundTeamjang = ancestor;
      }
      if (ancestor.rank === '본부장' && !foundBonbujang) {
        foundBonbujang = ancestor;
      }
      // 둘 다 찾으면 조기 종료
      if (foundTeamjang && foundBonbujang) break;

      cursor = ancestor.recommender_id;
      depth++;
    }

    // 수당 지급 결정
    if (foundBonbujang && foundTeamjang) {
      // 팀장 + 본부장 둘 다 존재 → 각 10%
      const commAmt1   = Math.round(amt * 0.10);
      const walBefore1 = await getWalletBal(foundTeamjang.id);
      await insertComm(foundTeamjang.id, '팀장', 10.0, commAmt1, walBefore1);
      await updWallet(commAmt1, foundTeamjang.id);
      commissions.push({ receiver_id: foundTeamjang.id, rank: '팀장', amount: commAmt1 });

      const commAmt2   = Math.round(amt * 0.10);
      const walBefore2 = await getWalletBal(foundBonbujang.id);
      await insertComm(foundBonbujang.id, '본부장', 10.0, commAmt2, walBefore2);
      await updWallet(commAmt2, foundBonbujang.id);
      commissions.push({ receiver_id: foundBonbujang.id, rank: '본부장', amount: commAmt2 });

    } else if (foundBonbujang && !foundTeamjang) {
      // 본부장만 존재 → 20%
      const commAmt   = Math.round(amt * 0.20);
      const walBefore = await getWalletBal(foundBonbujang.id);
      await insertComm(foundBonbujang.id, '본부장', 20.0, commAmt, walBefore);
      await updWallet(commAmt, foundBonbujang.id);
      commissions.push({ receiver_id: foundBonbujang.id, rank: '본부장', amount: commAmt });

    } else if (foundTeamjang && !foundBonbujang) {
      // 팀장만 존재 → 10% 지급, 나머지 10%는 flush (미지급)
      const commAmt   = Math.round(amt * 0.10);
      const walBefore = await getWalletBal(foundTeamjang.id);
      await insertComm(foundTeamjang.id, '팀장', 10.0, commAmt, walBefore);
      await updWallet(commAmt, foundTeamjang.id);
      commissions.push({ receiver_id: foundTeamjang.id, rank: '팀장', amount: commAmt });
    }
    // 직급자 없음 → 미지급 (flush)

    /* ⑥ 활동 로그 */
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description) VALUES ('admin',?,?,?,?,?)`,
      [req.admin.id, 'investment_deposit', 'investments', invId, `투자금 입금: ${member.user_id} ₩${amt.toLocaleString()}`]
    );

    return res.status(201).json({
      message: '투자금 등록 완료',
      investment_id: invId,
      schedule_created: total_weeks,
      commissions_paid: commissions.length,
      commissions,
      first_pay_date: first_friday,
      end_date,
      total_payout,
    });
  } catch (e) {
    console.error('POST /investments error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/investments  ── 관리자: 전체 투자 목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const page   = parseInt(req.query.page  || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const q      = req.query.search || '';

    const params = [limit, offset];
    let where = '1=1';
    if (q) { where += ` AND (m.user_id LIKE ? OR m.name LIKE ?)`; params.unshift(`%${q}%`, `%${q}%`); }

    const rows = await db.all(
      `SELECT i.*, m.user_id, m.name, m.rank, m.bank_name, m.account_number
       FROM investments i JOIN members m ON m.id = i.member_id
       WHERE ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    const countParams = q ? [`%${q}%`, `%${q}%`] : [];
    const { cnt: total } = await db.get(
      `SELECT COUNT(*) as cnt FROM investments i JOIN members m ON m.id = i.member_id WHERE ${where}`,
      countParams
    );

    // ── KPI 통계 (전체 기준) ──
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const stats = await db.get(`
      SELECT
        COUNT(*)                   AS total_count,
        SUM(amount)                AS total_amount,
        COUNT(DISTINCT member_id)  AS member_count,
        SUM(CASE WHEN strftime('%Y-%m', investment_date) = ? THEN amount ELSE 0 END) AS month_amount
      FROM investments
      WHERE status != 'cancelled'
    `, [monthStr]);

    return res.json({ data: rows, total, page, limit, stats: stats || {} });
  } catch (e) {
    console.error('GET /investments error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/investments/payouts/pending  ── 관리자: 이번주 지급 대기 목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/payouts/pending', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT wp.*, m.user_id, m.name, m.bank_name, m.account_number, m.rank
       FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status = 'pending' AND wp.scheduled_date <= date('now','+7 days','localtime')
       ORDER BY wp.scheduled_date, wp.member_id`
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/investments/my  ── 회원: 내 투자 목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/my', authMember, async (req, res) => {
  try {
    const db = await getDb();
    const investments = await db.all(
      `SELECT * FROM investments WHERE member_id=? ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json(investments);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/investments/:id/payouts  ── 주간 지급 스케줄 조회
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/:id/payouts', authMember, async (req, res) => {
  try {
    const db  = await getDb();
    const inv = await db.get(
      'SELECT * FROM investments WHERE id=? AND member_id=?',
      [req.params.id, req.user.id]
    );
    if (!inv) return res.status(404).json({ error: '투자 정보를 찾을 수 없습니다.' });
    const payouts = await db.all(
      'SELECT * FROM weekly_payouts WHERE investment_id=? ORDER BY week_number',
      [req.params.id]
    );
    return res.json({ investment: inv, payouts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PATCH /api/investments/payouts/:payoutId/pay  ── 관리자: 주간 지급 확정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.patch('/payouts/:payoutId/pay', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const payout = await db.get('SELECT * FROM weekly_payouts WHERE id=?', [req.params.payoutId]);
    if (!payout) return res.status(404).json({ error: '지급 항목 없음' });
    if (payout.status === 'paid') return res.status(400).json({ error: '이미 지급된 항목입니다.' });

    await db.run(
      `UPDATE weekly_payouts SET status='paid', paid_date=datetime('now','localtime'),
       approved_by=?, approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
      [req.admin.id, payout.id]
    );

    const inv     = await db.get('SELECT * FROM investments WHERE id=?', [payout.investment_id]);
    const newWeek = Math.max(inv.current_week, payout.week_number);
    const paid_amount = inv.paid_amount + payout.total_payout;
    const remaining   = Math.max(inv.remaining_amount - payout.total_payout, 0);
    const status      = newWeek >= inv.total_weeks ? 'completed' : 'active';

    const nextP = await db.get(
      `SELECT scheduled_date FROM weekly_payouts WHERE investment_id=? AND week_number>? AND status='pending' ORDER BY week_number LIMIT 1`,
      [payout.investment_id, payout.week_number]
    );

    await db.run(
      `UPDATE investments SET current_week=?, paid_amount=?, remaining_amount=?, next_pay_date=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [newWeek, paid_amount, remaining, nextP?.scheduled_date || null, status, payout.investment_id]
    );

    await db.run(
      `UPDATE member_wallets SET total_profit=total_profit+?, pending_payout=MAX(pending_payout-?,0),
       total_withdrawn=total_withdrawn+?, updated_at=datetime('now','localtime') WHERE member_id=?`,
      [payout.profit_portion, payout.total_payout, payout.total_payout, payout.member_id]
    );

    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description) VALUES ('admin',?,'payout_paid','weekly_payouts',?,?)`,
      [req.admin.id, payout.id, `${payout.week_number}주차 지급 완료: ₩${payout.total_payout.toLocaleString()}`]
    );

    return res.json({ message: `${payout.week_number}주차 지급 완료 처리`, payout_id: payout.id });
  } catch (e) {
    console.error('PATCH payouts/pay error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/investments/payouts/bulk-pay  ── 관리자: 일괄 지급 확정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/payouts/bulk-pay', authAdmin, async (req, res) => {
  try {
    const { payout_ids } = req.body;
    if (!Array.isArray(payout_ids) || payout_ids.length === 0)
      return res.status(400).json({ error: 'payout_ids 배열이 필요합니다.' });

    const db = await getDb();
    let successCount = 0;

    for (const pid of payout_ids) {
      const payout = await db.get('SELECT * FROM weekly_payouts WHERE id=? AND status="pending"', [pid]);
      if (!payout) continue;
      await db.run(
        `UPDATE weekly_payouts SET status='paid', paid_date=datetime('now','localtime'),
         approved_by=?, approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
        [req.admin.id, payout.id]
      );
      const inv     = await db.get('SELECT * FROM investments WHERE id=?', [payout.investment_id]);
      const newWeek = Math.max(inv.current_week, payout.week_number);
      await db.run(
        `UPDATE investments SET current_week=?, paid_amount=paid_amount+?, remaining_amount=MAX(remaining_amount-?,0), updated_at=datetime('now','localtime') WHERE id=?`,
        [newWeek, payout.total_payout, payout.total_payout, payout.investment_id]
      );
      await db.run(
        `UPDATE member_wallets SET total_profit=total_profit+?, pending_payout=MAX(pending_payout-?,0),
         total_withdrawn=total_withdrawn+?, updated_at=datetime('now','localtime') WHERE member_id=?`,
        [payout.profit_portion, payout.total_payout, payout.total_payout, payout.member_id]
      );
      successCount++;
    }

    return res.json({ message: `${successCount}건 일괄 지급 완료`, success_count: successCount });
  } catch (e) {
    console.error('bulk-pay error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DELETE /api/investments/:id  ── 관리자: 투자금 삭제
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.delete('/:id', authAdmin, async (req, res) => {
  try {
    const db  = await getDb();
    const inv = await db.get(
      `SELECT i.*, m.user_id, m.name FROM investments i JOIN members m ON m.id = i.member_id WHERE i.id = ?`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: '투자 내역을 찾을 수 없습니다.' });

    // ① 관련 직급수당 잔고 복원 후 삭제
    const commissions = await db.all(`SELECT * FROM rank_commissions WHERE investment_id=?`, [inv.id]);
    for (const c of commissions) {
      await db.run(
        `UPDATE member_wallets SET total_commission=MAX(total_commission-?,0), available_balance=MAX(available_balance-?,0), updated_at=datetime('now','localtime') WHERE member_id=?`,
        [c.commission_amount, c.commission_amount, c.receiver_id]
      );
    }
    await db.run(`DELETE FROM rank_commissions WHERE investment_id=?`, [inv.id]);

    // ② 주간지급 스케줄 전체 삭제
    await db.run(`DELETE FROM weekly_payouts WHERE investment_id=?`, [inv.id]);

    // ③ 회원 지갑 복원
    await db.run(
      `UPDATE member_wallets SET total_invested=MAX(total_invested-?,0), total_profit=MAX(total_profit-?,0),
       available_balance=MAX(available_balance-?,0), pending_payout=0, updated_at=datetime('now','localtime')
       WHERE member_id=?`,
      [inv.amount, inv.paid_amount, inv.remaining_amount, inv.member_id]
    );

    // ④ 회원 투자 총액 복원
    await db.run(
      `UPDATE members SET investment_total=MAX(investment_total-?,0), updated_at=datetime('now','localtime') WHERE id=?`,
      [inv.amount, inv.member_id]
    );

    // ⑤ 출금신청 취소
    await db.run(
      `UPDATE withdrawal_requests SET status='cancelled', reject_reason='투자 삭제로 인한 자동 취소' WHERE member_id=? AND status='pending'`,
      [inv.member_id]
    );

    // ⑥ 투자 내역 삭제
    await db.run(`DELETE FROM investments WHERE id=?`, [inv.id]);

    // ⑦ 활동 로그
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description) VALUES ('admin',?,'investment_delete','investments',?,?)`,
      [req.admin.id, inv.id, `투자금 삭제: ${inv.user_id}(${inv.name}) ₩${inv.amount.toLocaleString()} / 수당${commissions.length}건 삭제`]
    );

    return res.json({
      message: `투자 내역이 삭제되었습니다. (회원: ${inv.name}, 금액: ₩${inv.amount.toLocaleString()})`,
      deleted_investment_id: inv.id,
    });
  } catch (e) {
    console.error('DELETE /investments error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DELETE /api/investments/payouts/:payoutId  ── 관리자: 이자(주간지급) 삭제
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.delete('/payouts/:payoutId', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const payout = await db.get(
      `SELECT wp.*, m.user_id, m.name FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id WHERE wp.id = ?`,
      [req.params.payoutId]
    );
    if (!payout) return res.status(404).json({ error: '지급 항목을 찾을 수 없습니다.' });

    const force = req.query.force === 'true';
    if (payout.status === 'paid' && !force) {
      return res.status(400).json({
        error: '이미 지급된 이자입니다. 강제 삭제하려면 ?force=true 를 추가하세요.',
        payout_status: payout.status,
      });
    }

    if (payout.status === 'paid') {
      await db.run(
        `UPDATE member_wallets SET total_profit=MAX(total_profit-?,0), available_balance=MAX(available_balance-?,0),
         total_withdrawn=MAX(total_withdrawn-?,0), updated_at=datetime('now','localtime') WHERE member_id=?`,
        [payout.profit_portion, payout.total_payout, payout.total_payout, payout.member_id]
      );
      await db.run(
        `UPDATE investments SET paid_amount=MAX(paid_amount-?,0), remaining_amount=remaining_amount+?,
         current_week=MAX(current_week-1,0), status='active', updated_at=datetime('now','localtime') WHERE id=?`,
        [payout.total_payout, payout.total_payout, payout.investment_id]
      );
    }

    await db.run(`DELETE FROM weekly_payouts WHERE id=?`, [payout.id]);
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description) VALUES ('admin',?,'payout_delete','weekly_payouts',?,?)`,
      [req.admin.id, payout.id, `${payout.week_number}주차 이자 삭제: ${payout.user_id}(${payout.name}) ₩${payout.total_payout.toLocaleString()} [${payout.status}]`]
    );

    return res.json({
      message: `${payout.week_number}주차 이자가 삭제되었습니다. (${payout.status === 'paid' ? '지급 취소 및 잔고 복원' : '예정 삭제'})`,
      deleted_payout_id: payout.id,
    });
  } catch (e) {
    console.error('DELETE /payouts error:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

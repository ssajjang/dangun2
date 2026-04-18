'use strict';
/**
 * DANGUN - 관리자 전용 특수 기능 API
 *  - 데이터 초기화 (전체 / 선택적)
 *  - 관리자가 회원 직접 추가
 *  - 수당 지급 시뮬레이션
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb }    = require('../../database/db');
const { authAdmin } = require('../middleware/auth');

const router = express.Router();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/admin/members  ── 관리자: 회원 직접 추가
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/members', authAdmin, async (req, res) => {
  try {
    const { user_id, password, name, email, phone,
            bank_name, account_number, account_holder,
            recommender_user_id, rank, status } = req.body;

    if (!user_id || !password || !name || !phone)
      return res.status(400).json({ error: 'user_id, password, name, phone 필수' });

    const db = await getDb();

    // 중복 체크
    const dup = await db.get(
      'SELECT id FROM members WHERE user_id=? OR phone=?',
      [user_id, phone]
    );
    if (dup) return res.status(409).json({ error: '이미 사용 중인 아이디 또는 전화번호입니다.' });

    // 추천인 조회 (일반회원 + SuperAdmin 포함)
    let resolvedRecommenderId = null;
    if (recommender_user_id) {
      // 먼저 일반 회원에서 검색
      const rec = await db.get('SELECT id FROM members WHERE user_id=?', [recommender_user_id]);
      if (rec) {
        resolvedRecommenderId = rec.id;
      } else {
        // 관리자(admins) 테이블에서 검색 (SuperAdmin이 추천인인 경우)
        const adminRec = await db.get('SELECT id FROM admins WHERE admin_id=? AND status=?', [recommender_user_id, 'active']);
        if (!adminRec) {
          return res.status(404).json({ error: `추천인 '${recommender_user_id}'를 찾을 수 없습니다. (회원 또는 관리자 아이디를 확인하세요)` });
        }
        // SuperAdmin이 추천인인 경우: recommender_id=null (최상위로 등록)
        resolvedRecommenderId = null;
      }
    }

    const hashed     = bcrypt.hashSync(password, 10);
    const finalEmail = email || `${user_id}@dangun.internal`;
    const finalRank  = rank   || '일반회원';
    const finalStatus = status || 'active';

    const result = await db.run(
      `INSERT INTO members
         (user_id,password,name,email,phone,bank_name,account_number,account_holder,
          recommender_id,rank,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [user_id, hashed, name, finalEmail, phone,
       bank_name||'', account_number||'', account_holder||name,
       resolvedRecommenderId, finalRank, finalStatus]
    );
    const memberId = result.lastID;

    // 지갑 생성
    await db.run('INSERT OR IGNORE INTO member_wallets (member_id) VALUES (?)', [memberId]);

    // 추천 계보
    await db.run('INSERT INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,0)', [memberId, memberId]);
    if (resolvedRecommenderId) {
      const ancestors = await db.all('SELECT ancestor_id, depth FROM referral_tree WHERE member_id=?', [resolvedRecommenderId]);
      for (const a of ancestors) {
        await db.run('INSERT OR IGNORE INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,?)',
          [memberId, a.ancestor_id, a.depth + 1]);
      }
    }

    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
       VALUES ('admin',?,'add_member','members',?,?)`,
      [req.admin.id, memberId, `관리자가 회원 추가: ${user_id}`]
    );

    return res.status(201).json({
      message: `회원 '${name}(${user_id})'이 추가되었습니다.`,
      member_id: memberId, user_id, name, rank: finalRank, status: finalStatus
    });
  } catch (e) {
    console.error('POST /admin/members error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/admin/reset  ── 관리자: 데이터 초기화
   body: { target: 'all' | 'investments' | 'payouts' | 'commissions' | 'withdrawals' | 'members' | 'logs' }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/reset', authAdmin, async (req, res) => {
  try {
    const { target, confirm_text } = req.body;

    // 확인 문구 체크
    if (confirm_text !== 'RESET') {
      return res.status(400).json({ error: "확인 문구로 'RESET'을 입력하세요." });
    }

    const allowed = ['all', 'investments', 'payouts', 'commissions', 'withdrawals', 'members', 'logs'];
    if (!target || !allowed.includes(target)) {
      return res.status(400).json({ error: `target은 다음 중 하나: ${allowed.join(', ')}` });
    }

    const db = await getDb();
    const deleted = {};

    if (target === 'all' || target === 'logs') {
      const r = await db.run('DELETE FROM activity_logs');
      deleted.activity_logs = r.changes;
    }
    if (target === 'all' || target === 'commissions') {
      const r = await db.run('DELETE FROM rank_commissions');
      deleted.rank_commissions = r.changes;
    }
    if (target === 'all' || target === 'payouts') {
      const r = await db.run('DELETE FROM weekly_payouts');
      deleted.weekly_payouts = r.changes;
    }
    if (target === 'all' || target === 'withdrawals') {
      const r = await db.run('DELETE FROM withdrawal_requests');
      deleted.withdrawal_requests = r.changes;
    }
    if (target === 'all' || target === 'investments') {
      const r = await db.run('DELETE FROM investments');
      deleted.investments = r.changes;
      // 투자 초기화 시 회원 투자총액도 리셋
      await db.run(`UPDATE members SET investment_total=0, investment_date=NULL, updated_at=datetime('now','localtime')`);
      await db.run(`UPDATE member_wallets SET total_invested=0, total_profit=0, total_commission=0, available_balance=0, pending_payout=0, total_withdrawn=0, updated_at=datetime('now','localtime')`);
      deleted.member_wallets_reset = true;
    }
    if (target === 'all' || target === 'members') {
      // 일반 회원만 삭제 (관리자 계정 보호)
      await db.run('DELETE FROM referral_tree');
      await db.run('DELETE FROM member_wallets');
      await db.run('DELETE FROM weekly_payouts');
      await db.run('DELETE FROM investments');
      await db.run('DELETE FROM rank_commissions');
      await db.run('DELETE FROM withdrawal_requests');
      const r = await db.run('DELETE FROM members');
      deleted.members = r.changes;
    }

    // 초기화 로그
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'data_reset',?)`,
      [req.admin.id, `데이터 초기화: ${target}`]
    );

    return res.json({
      message: `[${target}] 데이터 초기화 완료`,
      deleted,
    });
  } catch (e) {
    console.error('POST /admin/reset error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/admin/simulate-payout  ── 수당 지급 시뮬레이션
   특정 날짜 또는 오늘 기준으로 pending 지급건을 즉시 처리
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/simulate-payout', authAdmin, async (req, res) => {
  try {
    const db    = await getDb();
    const { date_override, dry_run } = req.body;
    const isDryRun = dry_run === true;

    // force_all=true 이면 날짜 무관하게 전체 pending 처리 (시뮬레이션 편의용)
    const forceAll = req.body.force_all === true;

    // 기준 날짜: 요청한 날짜 or 오늘
    const targetDate = date_override || new Date().toISOString().slice(0, 10);

    // 지급 대상 조회 (force_all=true 이면 날짜 조건 없이 전체 pending)
    let duePayouts;
    if (forceAll) {
      duePayouts = await db.all(
        `SELECT wp.*, m.user_id, m.name, m.bank_name, m.account_number
         FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id
         WHERE wp.status = 'pending'
         ORDER BY wp.scheduled_date, wp.member_id`
      );
    } else {
      duePayouts = await db.all(
        `SELECT wp.*, m.user_id, m.name, m.bank_name, m.account_number
         FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id
         WHERE wp.status = 'pending' AND wp.scheduled_date <= ?
         ORDER BY wp.scheduled_date, wp.member_id`,
        [targetDate]
      );
    }

    if (duePayouts.length === 0) {
      return res.json({
        message: `${targetDate} 기준 지급 대기 항목이 없습니다.`,
        target_date: targetDate, processed: 0, dry_run: isDryRun, results: []
      });
    }

    const sysAdmin = await db.get(`SELECT id FROM admins WHERE role='superadmin' LIMIT 1`);
    const adminId  = sysAdmin ? sysAdmin.id : req.admin.id;

    let processed   = 0;
    let totalAmount = 0;
    const results   = [];

    for (const payout of duePayouts) {
      const inv = await db.get('SELECT * FROM investments WHERE id=?', [payout.investment_id]);
      if (!inv) continue;

      const result = {
        payout_id:   payout.id,
        week_number: payout.week_number,
        member:      payout.user_id,
        name:        payout.name,
        amount:      payout.total_payout,
        scheduled:   payout.scheduled_date,
        status:      isDryRun ? 'simulated' : 'paid',
      };

      if (!isDryRun) {
        // 실제 지급 처리 ① weekly_payouts 상태 업데이트
        await db.run(
          `UPDATE weekly_payouts SET status='paid', paid_date=datetime('now','localtime'),
           approved_by=?, approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime')
           WHERE id=?`,
          [adminId, payout.id]
        );

        // ② investments 업데이트
        const newWeek    = Math.max(inv.current_week, payout.week_number);
        const paidAmount = inv.paid_amount + payout.total_payout;
        const remaining  = Math.max(inv.remaining_amount - payout.total_payout, 0);
        const invStatus  = newWeek >= inv.total_weeks ? 'completed' : 'active';

        const nextP = await db.get(
          `SELECT scheduled_date FROM weekly_payouts WHERE investment_id=? AND week_number>? AND status='pending' ORDER BY week_number LIMIT 1`,
          [payout.investment_id, payout.week_number]
        );

        await db.run(
          `UPDATE investments SET current_week=?, paid_amount=?, remaining_amount=?, next_pay_date=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
          [newWeek, paidAmount, remaining, nextP?.scheduled_date || null, invStatus, payout.investment_id]
        );

        // ③ 지갑: 이익 누적 + 가용 잔액 증가 + 대기 지급액 감소
        await db.run(
          `UPDATE member_wallets SET total_profit=total_profit+?, available_balance=available_balance+?,
           pending_payout=MAX(pending_payout-?,0), updated_at=datetime('now','localtime') WHERE member_id=?`,
          [payout.profit_portion, payout.total_payout, payout.total_payout, payout.member_id]
        );

        // ④ withdrawal_requests에 지급 내역 기록 (투자금 주간 지급 자동 기록)
        //    - 관리자 출금관리 화면에서 지급완료 내역 확인 가능하도록 기록
        const member = await db.get('SELECT bank_name, account_number, name FROM members WHERE id=?', [payout.member_id]);
        await db.run(
          `INSERT INTO withdrawal_requests
            (member_id, amount, bank_name, account_number, account_holder,
             withdraw_type, status, week_number, investment_amount,
             approved_by, approved_at, paid_at, withdraw_date)
           VALUES (?,?,?,?,?,'weekly_profit','paid',?,?,?,datetime('now','localtime'),datetime('now','localtime'),datetime('now','localtime'))`,
          [payout.member_id, payout.total_payout,
           member?.bank_name || '', member?.account_number || '', member?.name || '',
           payout.week_number, inv.amount,
           adminId]
        );

        // ⑤ 활동 로그
        await db.run(
          `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
           VALUES ('admin',?,'sim_payout','weekly_payouts',?,?)`,
          [req.admin.id, payout.id, `${payout.week_number}주차 지급 완료: ${payout.user_id} ₩${payout.total_payout.toLocaleString()}`]
        );
      }

      processed++;
      totalAmount += payout.total_payout;
      results.push(result);
    }

    return res.json({
      message: isDryRun
        ? `[시뮬레이션 미리보기] ${processed}건 지급 예정 (실제 반영 안됨)`
        : `[지급 완료] ${processed}건 / 총 ₩${totalAmount.toLocaleString()}`,
      target_date:  targetDate,
      processed,
      total_amount: totalAmount,
      dry_run:      isDryRun,
      results,
    });
  } catch (e) {
    console.error('POST /admin/simulate-payout error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/admin/reset-targets  ── 초기화 대상별 건수 미리보기
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/reset-targets', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const members     = await db.get('SELECT COUNT(*) as cnt FROM members');
    const investments = await db.get('SELECT COUNT(*) as cnt FROM investments');
    const payouts     = await db.get('SELECT COUNT(*) as cnt FROM weekly_payouts');
    const commissions = await db.get('SELECT COUNT(*) as cnt FROM rank_commissions');
    const withdrawals = await db.get('SELECT COUNT(*) as cnt FROM withdrawal_requests');
    const logs        = await db.get('SELECT COUNT(*) as cnt FROM activity_logs');

    return res.json({
      members:     members.cnt,
      investments: investments.cnt,
      payouts:     payouts.cnt,
      commissions: commissions.cnt,
      withdrawals: withdrawals.cnt,
      logs:        logs.cnt,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/admin/payout-preview  ── 지급 예정 미리보기
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/payout-preview', authAdmin, async (req, res) => {
  try {
    const db         = await getDb();
    const targetDate = req.query.date || new Date().toISOString().slice(0, 10);

    const rows = await db.all(
      `SELECT wp.id, wp.week_number, wp.total_payout, wp.scheduled_date, wp.status,
              m.user_id, m.name, m.bank_name, m.account_number
       FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status='pending' AND wp.scheduled_date <= ?
       ORDER BY wp.scheduled_date, m.user_id`,
      [targetDate]
    );

    const total = rows.reduce((s, r) => s + r.total_payout, 0);

    return res.json({
      target_date: targetDate,
      count:       rows.length,
      total_amount: total,
      items:       rows,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

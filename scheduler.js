'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   DANGUN 금융플랫폼 - 자동 주간 지급 스케줄러             ║
 * ║   매주 금요일 09:00 KST 실행                              ║
 * ║   sqlite3 + sqlite Promise 래퍼 완전 async 버전           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
const { getDb } = require('./database/db');
require('dotenv').config();

/* ── 금액 포맷 ── */
function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }

/* ── 오늘 날짜 (KST) ── */
function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   메인 스케줄러 실행 함수 (완전 async)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function runScheduler() {
  try {
    const db    = await getDb();
    const today = todayKST();

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📅 [스케줄러] 주간 지급 처리 시작: ${today}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 시스템 관리자 ID
    const sysAdmin = await db.get(`SELECT id FROM admins WHERE role='superadmin' LIMIT 1`);
    const adminId  = sysAdmin ? sysAdmin.id : 1;

    // 당일 지급 예정 & pending 목록 조회
    const duePayouts = await db.all(
      `SELECT wp.*, m.user_id, m.name, m.bank_name, m.account_number
       FROM weekly_payouts wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status = 'pending' AND wp.scheduled_date <= ?
       ORDER BY wp.scheduled_date, wp.member_id`,
      [today]
    );

    if (duePayouts.length === 0) {
      console.log('✅ 지급 대기 항목 없음.');
      return { processed: 0, total_amount: 0 };
    }

    console.log(`📊 지급 대기: ${duePayouts.length}건`);

    let processed   = 0;
    let totalAmount = 0;
    const results   = [];

    for (const payout of duePayouts) {
      try {
        const inv = await db.get('SELECT * FROM investments WHERE id=?', [payout.investment_id]);
        if (!inv) continue;

        const endDate  = inv.end_date;
        const daysLeft = endDate
          ? Math.ceil((new Date(endDate) - new Date(today)) / 86400000)
          : 7;

        let finalTotal = payout.total_payout;
        let isPartial  = false;

        // 7일 미만이면 비례 수익 재계산
        if (daysLeft < 7 && daysLeft > 0) {
          isPartial = true;
          const proRataProfit = Math.round(payout.profit_portion * (daysLeft / 7));
          finalTotal = payout.principal_portion + proRataProfit;
          await db.run(
            `UPDATE weekly_payouts SET profit_portion=?, total_payout=?, is_partial=1, updated_at=datetime('now','localtime') WHERE id=?`,
            [proRataProfit, finalTotal, payout.id]
          );
        }

        // 지급 처리
        await db.run(
          `UPDATE weekly_payouts
           SET status='paid', paid_date=datetime('now','localtime'),
               approved_by=?, approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime')
           WHERE id=?`,
          [adminId, payout.id]
        );

        // investments 업데이트
        const newWeek    = Math.max(inv.current_week, payout.week_number);
        const paidAmount = inv.paid_amount + finalTotal;
        const remaining  = Math.max(inv.remaining_amount - finalTotal, 0);
        const status     = newWeek >= inv.total_weeks ? 'completed' : 'active';

        const nextP = await db.get(
          `SELECT scheduled_date FROM weekly_payouts WHERE investment_id=? AND week_number>? AND status='pending' ORDER BY week_number LIMIT 1`,
          [payout.investment_id, payout.week_number]
        );

        await db.run(
          `UPDATE investments SET current_week=?, paid_amount=?, remaining_amount=?, next_pay_date=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
          [newWeek, paidAmount, remaining, nextP ? nextP.scheduled_date : null, status, payout.investment_id]
        );

        // 지갑 업데이트
        await db.run(
          `UPDATE member_wallets
           SET total_profit      = total_profit + ?,
               available_balance = available_balance + ?,
               pending_payout    = MAX(pending_payout - ?, 0),
               updated_at        = datetime('now','localtime')
           WHERE member_id=?`,
          [payout.profit_portion, finalTotal, payout.total_payout, payout.member_id]
        );

        // 활동 로그
        await db.run(
          `INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description)
           VALUES ('admin',?,'auto_payout','weekly_payouts',?,?)`,
          [adminId, payout.id,
           `[자동] ${payout.week_number}주차 지급: ${payout.user_id} ₩${fmt(finalTotal)}${isPartial ? ' (부분지급)' : ''}`]
        );

        processed++;
        totalAmount += finalTotal;
        results.push({ id: payout.id, member_id: payout.member_id, amount: finalTotal, isPartial });
        console.log(`  ✔ [${payout.week_number}주차] ${payout.user_id} → ₩${fmt(finalTotal)}${isPartial ? ' ⚡부분' : ''}`);
      } catch (err) {
        console.error(`  ✗ 지급 오류 (payout.id=${payout.id}):`, err.message);
      }
    }

    console.log('');
    console.log(`✅ 처리 완료: ${processed}건 / 총 ₩${fmt(totalAmount)}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return { processed, total_amount: totalAmount, results };
  } catch (err) {
    console.error('❌ [스케줄러] 오류:', err.message);
    return { processed: 0, total_amount: 0, error: err.message };
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   크론 스케줄링 — 매 1분마다 금요일 09:00 KST인지 확인
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let lastRunDate = '';

async function checkAndRun() {
  try {
    const now = new Date();
    const kst        = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dayOfWeek  = kst.getUTCDay();    // 5 = 금요일
    const hour       = kst.getUTCHours();  // 09
    const today      = kst.toISOString().slice(0, 10);

    if (dayOfWeek === 5 && hour === 9 && today !== lastRunDate) {
      lastRunDate = today;
      console.log(`\n🕘 [스케줄러] 금요일 09:00 KST 자동 실행 감지`);
      await runScheduler();
    }
  } catch (err) {
    console.error('❌ [checkAndRun] 오류:', err.message);
  }
}

module.exports = { runScheduler, checkAndRun };

/* ── CLI 직접 실행 ── */
if (require.main === module) {
  if (process.argv.includes('--now')) {
    console.log('🚀 [강제 실행] scheduler.js --now');
    runScheduler().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  } else {
    console.log('⏰ [스케줄러] 시작됨 — 매 금요일 09:00 KST 자동 실행');
    setInterval(checkAndRun, 60 * 1000);
    checkAndRun();
  }
}

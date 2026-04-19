'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   DANGUN 금융플랫폼 - 자동 주간 지급 스케줄러             ║
 * ║   매일 00:01 KST 실행 → 각 회원의 투자 승인일 기준       ║
 * ║   정확히 7일 단위로 지급 처리                            ║
 * ║   sqlite3 + sqlite Promise 래퍼 완전 async 버전           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
const { getDb } = require('./database/db');
require('dotenv').config();

/* ── 금액 포맷 ── */
function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }

/* ── 오늘 날짜 (KST) YYYY-MM-DD ── */
function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 투자 승인일(investment_date) 기준으로
 * 7일 단위 지급 예정일(scheduled_date)을 생성/업데이트합니다.
 *
 * 이미 weekly_payouts에 week_number가 있으면 SKIP하고,
 * 없으면 investment_date + 7 * week_number 로 생성합니다.
 */
async function ensurePayoutSchedule(db, inv, adminId) {
  const base = inv.investment_date; // YYYY-MM-DD (투자 승인일)
  if (!base) return;

  const existingRows = await db.all(
    'SELECT week_number FROM weekly_payouts WHERE investment_id=?',
    [inv.id]
  );
  const existingWeeks = new Set(existingRows.map(r => r.week_number));

  const totalPayout   = Math.floor(inv.amount * 1.5);  // 원금 × 1.5
  const totalProfit   = Math.floor(inv.amount * 0.5);  // 50% 이익
  const weeklyPrinc   = Math.floor(inv.amount / inv.total_weeks);
  const weeklyProfit  = Math.floor(totalProfit / inv.total_weeks);
  const weeklyTotal   = weeklyPrinc + weeklyProfit;

  for (let w = 1; w <= inv.total_weeks; w++) {
    if (existingWeeks.has(w)) continue;

    // 지급 예정일 = 투자 승인일 + 7 * w 일
    const scheduledDate = addDays(base, 7 * w);

    // 마지막 주차 보정: 나머지 금액 전량 지급
    let pPrinc = weeklyPrinc;
    let pProfit = weeklyProfit;
    if (w === inv.total_weeks) {
      pPrinc  = inv.amount - weeklyPrinc * (inv.total_weeks - 1);
      pProfit = totalProfit - weeklyProfit * (inv.total_weeks - 1);
    }
    const pTotal = Math.floor(pPrinc + pProfit);

    try {
      await db.run(
        `INSERT OR IGNORE INTO weekly_payouts
           (investment_id, member_id, week_number,
            principal_portion, profit_portion, total_payout,
            balance_before, balance_after, scheduled_date,
            days_invested, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,0,0,?,7,'pending',
                 datetime('now','localtime'), datetime('now','localtime'))`,
        [inv.id, inv.member_id, w, Math.floor(pPrinc), Math.floor(pProfit), pTotal, scheduledDate]
      );
    } catch (e) {
      // UNIQUE 제약 충돌이면 무시
    }
  }
}

/* ── 날짜에 n일 더하기 ── */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   메인 스케줄러 실행 함수 (완전 async)
   - 모든 active 투자에 대해 7일 단위 지급 예정일 생성
   - scheduled_date <= today 인 pending 지급 건 처리
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
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

    // ① 모든 active 투자에 대해 주간 지급 예정 스케줄 생성 (없으면 채워 넣기)
    const activeInvestments = await db.all(
      `SELECT * FROM investments WHERE status IN ('active','pending') ORDER BY id`
    );

    console.log(`📊 활성 투자 수: ${activeInvestments.length}건 → 지급 예정일 확인 중...`);
    for (const inv of activeInvestments) {
      await ensurePayoutSchedule(db, inv, adminId);
    }

    // ② 오늘 이하 scheduled_date인 pending 지급 처리
    const duePayouts = await db.all(
      `SELECT wp.*, m.user_id, m.name, m.bank_name, m.account_number
       FROM weekly_payouts wp
       JOIN members m ON m.id = wp.member_id
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
          finalTotal = Math.floor(payout.principal_portion + proRataProfit);
          await db.run(
            `UPDATE weekly_payouts SET profit_portion=?, total_payout=?, is_partial=1, updated_at=datetime('now','localtime') WHERE id=?`,
            [proRataProfit, finalTotal, payout.id]
          );
        }

        // 지급 처리
        await db.run(
          `UPDATE weekly_payouts
           SET status='paid', paid_date=datetime('now','localtime'),
               approved_by=?, approved_at=datetime('now','localtime'),
               updated_at=datetime('now','localtime')
           WHERE id=?`,
          [adminId, payout.id]
        );

        // investments 업데이트
        const newWeek    = Math.max(inv.current_week, payout.week_number);
        const paidAmount = Math.floor(inv.paid_amount + finalTotal);
        const remaining  = Math.max(Math.floor(inv.remaining_amount - finalTotal), 0);
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
          [Math.floor(payout.profit_portion), finalTotal, payout.total_payout, payout.member_id]
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
   크론 스케줄링 — 매 1분마다 자정(KST 00:01) 체크
   (각 회원의 투자 승인일로부터 7일 단위로 처리하므로 매일 실행)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let lastRunDate = '';

async function checkAndRun() {
  try {
    const now  = new Date();
    const kst  = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const hour = kst.getUTCHours();
    const min  = kst.getUTCMinutes();
    const today = kst.toISOString().slice(0, 10);

    // 매일 00:01 KST 에 실행 (하루 1회)
    if (hour === 0 && min === 1 && today !== lastRunDate) {
      lastRunDate = today;
      console.log(`\n🕐 [스케줄러] 자정(00:01 KST) 자동 실행 감지 — 투자 승인일 기준 7일 주기 지급`);
      await runScheduler();
    }
  } catch (err) {
    console.error('❌ [checkAndRun] 오류:', err.message);
  }
}

module.exports = { runScheduler, checkAndRun, ensurePayoutSchedule };

/* ── CLI 직접 실행 ── */
if (require.main === module) {
  if (process.argv.includes('--now')) {
    console.log('🚀 [강제 실행] scheduler.js --now');
    runScheduler().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  } else {
    console.log('⏰ [스케줄러] 시작됨 — 매일 00:01 KST 자동 실행 (투자 승인일 기준 7일 주기)');
    setInterval(checkAndRun, 60 * 1000);
    checkAndRun();
  }
}

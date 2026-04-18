'use strict';
/**
 * DANGUN 금융플랫폼 - 시드 데이터
 * npm run db:seed 으로 실행
 * 테스트용 회원 / 투자 데이터 생성
 */
const { getDb } = require('./db');
const bcrypt    = require('bcryptjs');
require('dotenv').config();

function nextFriday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const add = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function addWeeks(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

async function seed() {
  console.log('🌱 시드 데이터 생성 시작...');
  const db = getDb();

  /* ── 회원 데이터 ── */
  const members = [
    // [user_id, name, email, phone, bank, account, rank, status]
    ['bonbu01',  '정본부장', 'bonbu01@dangun.com',  '010-1000-0001', '국민은행',   '111-0001-001', '본부장', 'active'],
    ['bonbu02',  '유본부장', 'bonbu02@dangun.com',  '010-1000-0002', '신한은행',   '222-0002-002', '본부장', 'active'],
    ['team01',   '김팀장',   'team01@dangun.com',   '010-2000-0001', '하나은행',   '333-0001-001', '팀장',   'active'],
    ['team02',   '최팀장',   'team02@dangun.com',   '010-2000-0002', '우리은행',   '444-0002-002', '팀장',   'active'],
    ['member01', '이회원',   'member01@dangun.com', '010-3000-0001', '농협은행',   '555-0001-001', '일반회원','active'],
    ['member02', '박회원',   'member02@dangun.com', '010-3000-0002', '카카오뱅크', '666-0002-002', '일반회원','active'],
    ['member03', '강회원',   'member03@dangun.com', '010-3000-0003', '토스뱅크',   '777-0003-003', '일반회원','active'],
    ['pending01','대기회원', 'pending01@dangun.com','010-4000-0001', '기업은행',   '888-0001-001', '일반회원','inactive'],
  ];

  const pw = bcrypt.hashSync('Test1234!', 10);
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO members
      (user_id, password, name, email, phone, bank_name, account_number, account_holder, rank, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  const insertWallet = db.prepare(`INSERT OR IGNORE INTO member_wallets (member_id) VALUES (?)`);
  const insertTree   = db.prepare(`INSERT OR IGNORE INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,0)`);

  for (const [uid, name, email, phone, bank, acct, rank, status] of members) {
    const r = insertMember.run(uid, pw, name, email, phone, bank, acct, name, rank, status);
    if (r.lastInsertRowid) {
      const mid = r.lastInsertRowid;
      insertWallet.run(mid);
      insertTree.run(mid, mid);
    }
  }
  console.log(`  ✔ 회원 ${members.length}명 생성`);

  // 추천 계보 설정: team01 → bonbu01, member01/02 → team01, member03 → bonbu02
  const setRecommender = (childUid, parentUid) => {
    const child  = db.prepare('SELECT id FROM members WHERE user_id=?').get(childUid);
    const parent = db.prepare('SELECT id FROM members WHERE user_id=?').get(parentUid);
    if (!child || !parent) return;
    db.prepare('UPDATE members SET recommender_id=? WHERE id=?').run(parent.id, child.id);
    // Closure Table
    const ancestors = db.prepare('SELECT ancestor_id, depth FROM referral_tree WHERE member_id=?').all(parent.id);
    const ins = db.prepare('INSERT OR IGNORE INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,?)');
    for (const a of ancestors) ins.run(child.id, a.ancestor_id, a.depth + 1);
  };

  setRecommender('team01',   'bonbu01');
  setRecommender('team02',   'bonbu02');
  setRecommender('member01', 'team01');
  setRecommender('member02', 'team01');
  setRecommender('member03', 'bonbu02');
  console.log('  ✔ 추천 계보 설정 완료');

  /* ── 투자 데이터 ── */
  const sysAdmin = db.prepare('SELECT id FROM admins WHERE role="superadmin" LIMIT 1').get();
  const adminId  = sysAdmin?.id || 1;

  const investments = [
    // [user_id, amount, investment_date, current_week]
    ['member01', 5000000, '2025-01-05',  9],
    ['member02', 2000000, '2025-01-12',  6],
    ['member03', 3000000, '2025-01-20',  4],
    ['team01',   8000000, '2024-12-01', 14],
    ['bonbu01', 10000000, '2024-11-15', 15],
  ];

  const insertInv = db.prepare(`
    INSERT OR IGNORE INTO investments
      (member_id, amount, weekly_profit, total_weeks, current_week,
       paid_amount, remaining_amount, investment_date, next_pay_date, end_date, status, admin_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)
  `);
  const insertPayout = db.prepare(`
    INSERT OR IGNORE INTO weekly_payouts
      (investment_id, member_id, week_number, principal_portion, profit_portion,
       total_payout, balance_before, balance_after, scheduled_date, status)
    VALUES (?,?,?,?,?,?,?,?,'pending','pending')
  `);
  const insPayoutPaid = db.prepare(`
    INSERT OR IGNORE INTO weekly_payouts
      (investment_id, member_id, week_number, principal_portion, profit_portion,
       total_payout, balance_before, balance_after, scheduled_date, paid_date, status)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'),'paid')
  `);

  for (const [uid, amount, invDate, curWeek] of investments) {
    const mem = db.prepare('SELECT id FROM members WHERE user_id=?').get(uid);
    if (!mem) continue;

    const profit_rate = 0.10;
    const total_profit = Math.round(amount * profit_rate);
    const total_payout = amount + total_profit;
    const ppw = Math.floor(amount / 15);
    const prw = Math.floor(total_profit / 15);
    const firstFriday = nextFriday(invDate);
    const endDate     = addWeeks(firstFriday, 14);

    const paidAmt = (ppw + prw) * curWeek;
    const remAmt  = Math.max(total_payout - paidAmt, 0);

    const r = insertInv.run(
      mem.id, amount, prw, 15, curWeek,
      paidAmt, remAmt, invDate, nextFriday(addWeeks(firstFriday, curWeek)), endDate, adminId
    );
    const invId = r.lastInsertRowid;
    if (!invId) continue;

    // member wallet 업데이트
    db.prepare(`
      INSERT INTO member_wallets (member_id, total_invested, pending_payout)
      VALUES (?,?,?)
      ON CONFLICT(member_id) DO UPDATE SET total_invested=total_invested+?, pending_payout=pending_payout+?
    `).run(mem.id, amount, total_payout, amount, total_payout);
    db.prepare(`UPDATE members SET investment_total=investment_total+?, investment_date=? WHERE id=?`)
      .run(amount, invDate, mem.id);

    // 주간 지급 스케줄 생성
    let payDate = firstFriday;
    let balance = total_payout;
    for (let w = 1; w <= 15; w++) {
      const pp = w === 15 ? amount - ppw * 14 : ppw;
      const pr = w === 15 ? total_profit - prw * 14 : prw;
      const wt = pp + pr;
      const balBefore = balance;
      balance = Math.round(Math.max(balance - wt, 0));

      if (w <= curWeek) {
        insPayoutPaid.run(invId, mem.id, w, pp, pr, wt, balBefore, balance, payDate);
      } else {
        insertPayout.run(invId, mem.id, w, pp, pr, wt, balBefore, balance, payDate);
      }
      payDate = addWeeks(payDate, 1);
    }

    // 직급 수당 계산
    const recommender = db.prepare('SELECT id, rank, recommender_id FROM members WHERE id=?').get(mem.recommender_id || null);
    // 추천인 구하기
    const memberFull = db.prepare('SELECT recommender_id FROM members WHERE id=?').get(mem.id);
    if (memberFull?.recommender_id) {
      const parent = db.prepare('SELECT id, rank, recommender_id FROM members WHERE id=?').get(memberFull.recommender_id);
      if (parent) {
        const gw = db.prepare('SELECT available_balance FROM member_wallets WHERE member_id=?');
        const uw = db.prepare(`UPDATE member_wallets SET available_balance=available_balance+?, total_commission=total_commission+? WHERE member_id=?`);
        const ic = db.prepare(`INSERT OR IGNORE INTO rank_commissions (investment_id, investor_id, receiver_id, receiver_rank, commission_rate, investment_amount, commission_amount, balance_before, balance_after, paid_at, status) VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'),'paid')`);

        if (parent.rank === '팀장') {
          const ca = Math.round(amount * 0.10);
          const wb = (gw.get(parent.id)||{available_balance:0}).available_balance;
          ic.run(invId, mem.id, parent.id, '팀장', 10, amount, ca, wb, wb+ca);
          uw.run(ca, ca, parent.id);
          // 팀장의 상위 본부장
          if (parent.recommender_id) {
            const gp = db.prepare('SELECT id, rank FROM members WHERE id=?').get(parent.recommender_id);
            if (gp?.rank === '본부장') {
              const ca2 = Math.round(amount * 0.10);
              const wb2 = (gw.get(gp.id)||{available_balance:0}).available_balance;
              ic.run(invId, mem.id, gp.id, '본부장', 10, amount, ca2, wb2, wb2+ca2);
              uw.run(ca2, ca2, gp.id);
            }
          }
        } else if (parent.rank === '본부장') {
          const ca = Math.round(amount * 0.20);
          const wb = (gw.get(parent.id)||{available_balance:0}).available_balance;
          ic.run(invId, mem.id, parent.id, '본부장', 20, amount, ca, wb, wb+ca);
          uw.run(ca, ca, parent.id);
        }
      }
    }
  }
  console.log(`  ✔ 투자 ${investments.length}건 생성 (스케줄 + 수당 포함)`);
  console.log('');
  console.log('✅ 시드 데이터 생성 완료!');
  console.log('');
  console.log('📋 테스트 계정:');
  console.log('  관리자:   superadmin / Admin1234!');
  console.log('  본부장:   bonbu01 / Test1234!');
  console.log('  팀장:     team01  / Test1234!');
  console.log('  일반회원: member01 / Test1234!');
}

seed().catch(console.error);

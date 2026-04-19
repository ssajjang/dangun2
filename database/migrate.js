'use strict';
/**
 * DANGUN 금융플랫폼 - DB 마이그레이션 (비동기 버전)
 * sqlite3 + sqlite Promise 래퍼 사용
 */
const path    = require('path');
const fs      = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt  = require('bcryptjs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dangun.db');
const dbDir   = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

async function migrate() {
  const db = await open({
    filename: path.resolve(DB_PATH),
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL UNIQUE,
      role        TEXT    NOT NULL DEFAULT 'admin',
      last_login  TEXT,
      ip_address  TEXT,
      status      TEXT    NOT NULL DEFAULT 'active',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS members (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT    NOT NULL UNIQUE,
      password        TEXT    NOT NULL,
      name            TEXT    NOT NULL,
      email           TEXT    NOT NULL UNIQUE,
      phone           TEXT    NOT NULL UNIQUE,
      bank_name       TEXT    NOT NULL DEFAULT '',
      account_number  TEXT    NOT NULL DEFAULT '',
      account_holder  TEXT    NOT NULL DEFAULT '',
      recommender_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
      rank            TEXT    NOT NULL DEFAULT '일반회원',
      investment_total REAL   NOT NULL DEFAULT 0,
      investment_date TEXT,
      status          TEXT    NOT NULL DEFAULT 'inactive',
      memo            TEXT    DEFAULT '',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS investments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      amount           REAL    NOT NULL,
      weekly_profit    REAL    NOT NULL DEFAULT 0,
      total_weeks      INTEGER NOT NULL DEFAULT 15,
      current_week     INTEGER NOT NULL DEFAULT 0,
      paid_amount      REAL    NOT NULL DEFAULT 0,
      remaining_amount REAL    NOT NULL DEFAULT 0,
      investment_date  TEXT    NOT NULL,
      next_pay_date    TEXT,
      end_date         TEXT,
      status           TEXT    NOT NULL DEFAULT 'active',
      admin_id         INTEGER REFERENCES admins(id),
      memo             TEXT    DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS weekly_payouts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      investment_id     INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
      member_id         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      week_number       INTEGER NOT NULL,
      principal_portion REAL    NOT NULL DEFAULT 0,
      profit_portion    REAL    NOT NULL DEFAULT 0,
      total_payout      REAL    NOT NULL DEFAULT 0,
      balance_before    REAL    NOT NULL DEFAULT 0,
      balance_after     REAL    NOT NULL DEFAULT 0,
      scheduled_date    TEXT    NOT NULL,
      paid_date         TEXT,
      days_invested     INTEGER NOT NULL DEFAULT 7,
      is_partial        INTEGER NOT NULL DEFAULT 0,
      status            TEXT    NOT NULL DEFAULT 'pending',
      approved_by       INTEGER REFERENCES admins(id),
      approved_at       TEXT,
      memo              TEXT    DEFAULT '',
      created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(investment_id, week_number)
    );

    CREATE TABLE IF NOT EXISTS rank_commissions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      investment_id    INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
      investor_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      receiver_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      receiver_rank    TEXT    NOT NULL,
      commission_rate  REAL    NOT NULL,
      investment_amount REAL   NOT NULL,
      commission_amount REAL   NOT NULL,
      balance_before   REAL    NOT NULL DEFAULT 0,
      balance_after    REAL    NOT NULL DEFAULT 0,
      paid_at          TEXT,
      status           TEXT    NOT NULL DEFAULT 'paid',
      memo             TEXT    DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS member_wallets (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id         INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
      total_invested    REAL    NOT NULL DEFAULT 0,
      total_profit      REAL    NOT NULL DEFAULT 0,
      total_commission  REAL    NOT NULL DEFAULT 0,
      available_balance REAL    NOT NULL DEFAULT 0,
      pending_payout    REAL    NOT NULL DEFAULT 0,
      total_withdrawn   REAL    NOT NULL DEFAULT 0,
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      payout_id       INTEGER REFERENCES weekly_payouts(id),
      withdraw_type   TEXT    NOT NULL DEFAULT 'weekly_profit',
      amount          REAL    NOT NULL,
      bank_name       TEXT    NOT NULL,
      account_number  TEXT    NOT NULL,
      account_holder  TEXT    NOT NULL,
      request_date    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      approved_by     INTEGER REFERENCES admins(id),
      approved_at     TEXT,
      paid_at         TEXT,
      withdraw_date   TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending',
      reject_reason   TEXT    DEFAULT '',
      memo            TEXT    DEFAULT '',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS referral_tree (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      ancestor_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      depth       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(member_id, ancestor_id)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key   TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      description   TEXT DEFAULT '',
      updated_by    INTEGER REFERENCES admins(id),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type   TEXT NOT NULL,
      actor_id     INTEGER NOT NULL,
      action       TEXT NOT NULL,
      target_type  TEXT DEFAULT '',
      target_id    INTEGER,
      description  TEXT DEFAULT '',
      ip_address   TEXT DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_members_recommender  ON members(recommender_id);
    CREATE INDEX IF NOT EXISTS idx_members_rank         ON members(rank);
    CREATE INDEX IF NOT EXISTS idx_investments_member   ON investments(member_id);
    CREATE INDEX IF NOT EXISTS idx_investments_status   ON investments(status);
    CREATE INDEX IF NOT EXISTS idx_payouts_member       ON weekly_payouts(member_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_scheduled    ON weekly_payouts(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_payouts_status       ON weekly_payouts(status);
    CREATE INDEX IF NOT EXISTS idx_commissions_receiver ON rank_commissions(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_member   ON withdrawal_requests(member_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status   ON withdrawal_requests(status);
    CREATE INDEX IF NOT EXISTS idx_referral_ancestor    ON referral_tree(ancestor_id);
    CREATE INDEX IF NOT EXISTS idx_activity_actor       ON activity_logs(actor_type, actor_id);
  `);

  // ── commissions_history 테이블 (출금완료 처리된 수당 이력 보관) ──
  await db.exec(`
    CREATE TABLE IF NOT EXISTS commissions_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id    INTEGER NOT NULL,          -- 원본 rank_commissions.id
      investment_id    INTEGER,
      investor_id      INTEGER,
      receiver_id      INTEGER,
      receiver_rank    TEXT    NOT NULL,
      commission_rate  REAL    NOT NULL DEFAULT 0,
      investment_amount REAL   NOT NULL DEFAULT 0,
      commission_amount REAL   NOT NULL DEFAULT 0,
      balance_before   REAL    NOT NULL DEFAULT 0,
      balance_after    REAL    NOT NULL DEFAULT 0,
      paid_at          TEXT,
      completed_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      approved_by      INTEGER,                   -- admins.id
      withdraw_status  TEXT    NOT NULL DEFAULT 'done',
      memo             TEXT    DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_comm_hist_receiver  ON commissions_history(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_comm_hist_completed ON commissions_history(completed_at);
  `);

  // ── 컬럼 추가 마이그레이션 (이미 존재해도 오류 무시) ──
  const alterQueries = [
    `ALTER TABLE rank_commissions ADD COLUMN withdraw_status TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE rank_commissions ADD COLUMN completed_at TEXT DEFAULT NULL`,
    // withdrawal_requests: 주간 지급 정보 컬럼 추가
    `ALTER TABLE withdrawal_requests ADD COLUMN week_number INTEGER DEFAULT NULL`,
    `ALTER TABLE withdrawal_requests ADD COLUMN investment_amount REAL DEFAULT 0`,
    // admins: role 세분화 (superadmin / subadmin)
    `ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'subadmin'`,
    // investments: 투자 승인일(기준일) 필드 - 스케줄러가 이 날짜 기준 7일 주기 계산
    `ALTER TABLE investments ADD COLUMN approved_date TEXT DEFAULT NULL`,
  ];
  for (const q of alterQueries) {
    try { await db.run(q); } catch(e) { /* 이미 존재하는 컬럼 - 무시 */ }
  }

  // 시스템 설정 기본값
  const settings = [
    ['weekly_profit_rate',    '10',  '주간 수익률 (%)'],
    ['total_weeks',           '15',  '총 지급 주차'],
    ['commission_rate_total', '20',  '총 직급수당 요율 (%)'],
    ['commission_bonbu_solo', '20',  '본부장 단독 수당 요율'],
    ['commission_bonbu_team', '10',  '본부장 수당 요율 (팀장 있을 때)'],
    ['commission_teamjang',   '10',  '팀장 수당 요율 (%)'],
    ['pay_day_of_week',       '5',   '지급 요일 (5=금요일)'],
    ['min_investment',        '100000', '최소 투자금액 (원)'],
    ['platform_name',         'DANGUN 금융플랫폼', '플랫폼 이름'],
    ['maintenance_mode',      '0',   '점검 모드 (0=정상)'],
    ['site_notice',           '',    '사이트 공지사항'],
    // DANGUN 코인 환율: 1 KRW = ? DANGUN (소수점 2자리까지)
    ['dangun_coin_rate',      '10.00', 'DANGUN 코인 환율 (1 KRW = N DANGUN)'],
    ['dangun_coin_symbol',    'DGN',   'DANGUN 코인 심볼'],
    ['dangun_coin_enabled',   '1',     'DANGUN 코인 환산 표시 여부 (1=표시)'],
  ];

  for (const [k, v, d] of settings) {
    await db.run(
      `INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)`,
      [k, v, d]
    );
  }

  // 최고관리자 계정 생성 (없으면)
  const adminId = process.env.ADMIN_ID || 'superadmin';
  const existing = await db.get('SELECT id FROM admins WHERE admin_id = ?', [adminId]);
  if (!existing) {
    const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin1234!', 10);
    await db.run(
      `INSERT INTO admins (admin_id, password, name, email, role) VALUES (?, ?, ?, ?, 'superadmin')`,
      [
        adminId,
        hashed,
        process.env.ADMIN_NAME  || '최고관리자',
        process.env.ADMIN_EMAIL || 'admin@dangun.com',
      ]
    );
    console.log('✅ 최고관리자 계정 생성됨:', adminId);
  }

  await db.close();
  console.log('✅ DB 마이그레이션 완료:', DB_PATH);
}

module.exports = migrate;

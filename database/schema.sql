-- ============================================================
-- DANGUN 금융플랫폼 MySQL Database Schema
-- Version: 1.0.0
-- Charset: utf8mb4
-- Engine: InnoDB
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ============================================================
-- 데이터베이스 생성
-- ============================================================
CREATE DATABASE IF NOT EXISTS `dangun_platform`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `dangun_platform`;

-- ============================================================
-- 1. 회원 테이블 (members)
-- ============================================================
DROP TABLE IF EXISTS `members`;
CREATE TABLE `members` (
  `id`              INT(11)       NOT NULL AUTO_INCREMENT COMMENT '회원 고유 ID',
  `user_id`         VARCHAR(50)   NOT NULL COMMENT '로그인 아이디',
  `password`        VARCHAR(255)  NOT NULL COMMENT '비밀번호 (bcrypt 해시)',
  `name`            VARCHAR(50)   NOT NULL COMMENT '실명',
  `email`           VARCHAR(100)  NOT NULL COMMENT '이메일',
  `phone`           VARCHAR(20)   NOT NULL COMMENT '핸드폰 번호',
  `bank_name`       VARCHAR(50)   NOT NULL COMMENT '은행명',
  `account_number`  VARCHAR(30)   NOT NULL COMMENT '계좌번호',
  `account_holder`  VARCHAR(50)   NOT NULL COMMENT '예금주',
  `recommender_id`  INT(11)       NULL     COMMENT '추천인 회원 ID (FK → members.id)',
  `rank`            ENUM('일반회원','팀장','본부장') NOT NULL DEFAULT '일반회원' COMMENT '직급',
  `investment_total` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '총 투자금액',
  `investment_date`  DATE          NULL     COMMENT '투자 시작일',
  `status`          ENUM('active','inactive','suspended') NOT NULL DEFAULT 'inactive' COMMENT '계정 상태',
  `memo`            TEXT          NULL     COMMENT '관리자 메모',
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '가입일',
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_id`  (`user_id`),
  UNIQUE KEY `uq_email`    (`email`),
  UNIQUE KEY `uq_phone`    (`phone`),
  KEY `idx_recommender`    (`recommender_id`),
  KEY `idx_rank`           (`rank`),
  KEY `idx_status`         (`status`),
  CONSTRAINT `fk_recommender` FOREIGN KEY (`recommender_id`)
    REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='회원 정보 테이블';


-- ============================================================
-- 2. 투자금 내역 테이블 (investments)
--    관리자가 입력 → 매출 즉시 지급 사이클 시작
-- ============================================================
DROP TABLE IF EXISTS `investments`;
CREATE TABLE `investments` (
  `id`               INT(11)      NOT NULL AUTO_INCREMENT COMMENT '투자 고유 ID',
  `member_id`        INT(11)      NOT NULL COMMENT '회원 ID (FK)',
  `amount`           DECIMAL(18,2) NOT NULL COMMENT '투자금액',
  `weekly_profit`    DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '주당 수익금 (투자금 × 10%)',
  `total_weeks`      INT(3)       NOT NULL DEFAULT 15 COMMENT '총 지급 주차 (기본 15주)',
  `current_week`     INT(3)       NOT NULL DEFAULT 0 COMMENT '현재 진행 주차',
  `paid_amount`      DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '누적 지급 금액',
  `remaining_amount` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '잔여 지급 금액',
  `investment_date`  DATE         NOT NULL COMMENT '투자 입금일',
  `next_pay_date`    DATE         NULL COMMENT '다음 지급 예정일 (매주 금요일)',
  `end_date`         DATE         NULL COMMENT '15주 만기일',
  `status`           ENUM('active','completed','suspended') NOT NULL DEFAULT 'active' COMMENT '투자 상태',
  `admin_id`         INT(11)      NULL COMMENT '입력 관리자 ID',
  `memo`             TEXT         NULL COMMENT '비고',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_member`         (`member_id`),
  KEY `idx_status`         (`status`),
  KEY `idx_next_pay_date`  (`next_pay_date`),
  KEY `idx_investment_date`(`investment_date`),
  CONSTRAINT `fk_investment_member` FOREIGN KEY (`member_id`)
    REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='투자금 내역 테이블';


-- ============================================================
-- 3. 주간 수익 지급 내역 테이블 (weekly_payouts)
--    매주 금요일 15주 분할 지급 기록
--    (7일 미만 투자: 원금+10% 비례 지급)
-- ============================================================
DROP TABLE IF EXISTS `weekly_payouts`;
CREATE TABLE `weekly_payouts` (
  `id`              INT(11)       NOT NULL AUTO_INCREMENT COMMENT '지급 고유 ID',
  `investment_id`   INT(11)       NOT NULL COMMENT '투자 ID (FK)',
  `member_id`       INT(11)       NOT NULL COMMENT '회원 ID (FK)',
  `week_number`     INT(3)        NOT NULL COMMENT '주차 번호 (1~15)',
  `principal_portion` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '원금 분할 금액',
  `profit_portion`  DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '수익 분할 금액 (10%)',
  `total_payout`    DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '총 지급액 (원금+수익)',
  `balance_before`  DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '지급 전 잔고',
  `balance_after`   DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '지급 후 잔고',
  `scheduled_date`  DATE          NOT NULL COMMENT '지급 예정일 (금요일)',
  `paid_date`       DATETIME      NULL COMMENT '실제 지급 처리일',
  `days_invested`   INT(3)        NOT NULL DEFAULT 7 COMMENT '해당 주 실제 투자일수',
  `is_partial`      TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '부분 지급 여부 (7일 미만)',
  `status`          ENUM('pending','approved','paid','rejected') NOT NULL DEFAULT 'pending' COMMENT '지급 상태',
  `approved_by`     INT(11)       NULL COMMENT '승인 관리자 ID',
  `approved_at`     DATETIME      NULL COMMENT '승인 처리일시',
  `memo`            TEXT          NULL COMMENT '비고',
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invest_week` (`investment_id`, `week_number`),
  KEY `idx_member_id`       (`member_id`),
  KEY `idx_scheduled_date`  (`scheduled_date`),
  KEY `idx_status`          (`status`),
  KEY `idx_week_number`     (`week_number`),
  CONSTRAINT `fk_payout_investment` FOREIGN KEY (`investment_id`)
    REFERENCES `investments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_payout_member` FOREIGN KEY (`member_id`)
    REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='주간 수익 지급 내역 테이블 (매주 금요일, 15주)';


-- ============================================================
-- 4. 직급 수당 테이블 (rank_commissions)
--    투자금 입금 즉시 자동 지급
--    팀장 없음 → 본부장 20%
--    팀장 있음 → 본부장 10% + 팀장 10%
-- ============================================================
DROP TABLE IF EXISTS `rank_commissions`;
CREATE TABLE `rank_commissions` (
  `id`               INT(11)       NOT NULL AUTO_INCREMENT COMMENT '수당 고유 ID',
  `investment_id`    INT(11)       NOT NULL COMMENT '투자 ID (FK) - 수당 발생 원인',
  `investor_id`      INT(11)       NOT NULL COMMENT '투자자 회원 ID (수당 제공자)',
  `receiver_id`      INT(11)       NOT NULL COMMENT '수당 수령자 회원 ID',
  `receiver_rank`    ENUM('팀장','본부장') NOT NULL COMMENT '수당 수령자 직급',
  `commission_rate`  DECIMAL(5,2)  NOT NULL COMMENT '수당 요율 (10.00 or 20.00)',
  `investment_amount` DECIMAL(18,2) NOT NULL COMMENT '기준 투자금액',
  `commission_amount` DECIMAL(18,2) NOT NULL COMMENT '지급 수당금액',
  `balance_before`   DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '지급 전 잔고',
  `balance_after`    DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '지급 후 잔고',
  `paid_at`          DATETIME      NULL COMMENT '지급 처리일시',
  `status`           ENUM('pending','paid','cancelled') NOT NULL DEFAULT 'pending' COMMENT '지급 상태',
  `memo`             TEXT          NULL COMMENT '비고',
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_investment_id` (`investment_id`),
  KEY `idx_investor_id`   (`investor_id`),
  KEY `idx_receiver_id`   (`receiver_id`),
  KEY `idx_status`        (`status`),
  KEY `idx_paid_at`       (`paid_at`),
  CONSTRAINT `fk_commission_investment` FOREIGN KEY (`investment_id`)
    REFERENCES `investments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_commission_investor` FOREIGN KEY (`investor_id`)
    REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_commission_receiver` FOREIGN KEY (`receiver_id`)
    REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='직급 수당 테이블 (매출 즉시 지급)';


-- ============================================================
-- 5. 회원 지갑 / 잔고 테이블 (member_wallets)
--    투자수익 + 직급수당 누적 잔고
-- ============================================================
DROP TABLE IF EXISTS `member_wallets`;
CREATE TABLE `member_wallets` (
  `id`                 INT(11)       NOT NULL AUTO_INCREMENT,
  `member_id`          INT(11)       NOT NULL COMMENT '회원 ID (FK)',
  `total_invested`     DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '총 투자금 누계',
  `total_profit`       DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '총 수익금 누계',
  `total_commission`   DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '총 직급수당 누계',
  `available_balance`  DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '출금 가능 잔고',
  `pending_payout`     DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '지급 대기 금액',
  `total_withdrawn`    DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '총 출금 누계',
  `updated_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_id` (`member_id`),
  CONSTRAINT `fk_wallet_member` FOREIGN KEY (`member_id`)
    REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='회원 지갑 잔고 테이블';


-- ============================================================
-- 6. 추천인 계보 테이블 (referral_tree)
--    캔버스 트리 렌더링에 사용
-- ============================================================
DROP TABLE IF EXISTS `referral_tree`;
CREATE TABLE `referral_tree` (
  `id`            INT(11) NOT NULL AUTO_INCREMENT,
  `member_id`     INT(11) NOT NULL COMMENT '회원 ID',
  `ancestor_id`   INT(11) NOT NULL COMMENT '상위 계보 회원 ID',
  `depth`         INT(3)  NOT NULL DEFAULT 0 COMMENT '계보 깊이 (1=직계, 2=2단계, ...)',
  `path`          TEXT    NOT NULL COMMENT '계보 경로 (e.g. /1/5/12/)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_ancestor` (`member_id`, `ancestor_id`),
  KEY `idx_ancestor_id` (`ancestor_id`),
  KEY `idx_member_id`   (`member_id`),
  KEY `idx_depth`       (`depth`),
  CONSTRAINT `fk_tree_member`   FOREIGN KEY (`member_id`)   REFERENCES `members`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tree_ancestor` FOREIGN KEY (`ancestor_id`) REFERENCES `members`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='추천인 계보 트리 (Closure Table 방식)';


-- ============================================================
-- 7. 관리자 테이블 (admins)
-- ============================================================
DROP TABLE IF EXISTS `admins`;
CREATE TABLE `admins` (
  `id`          INT(11)       NOT NULL AUTO_INCREMENT,
  `admin_id`    VARCHAR(50)   NOT NULL COMMENT '관리자 아이디',
  `password`    VARCHAR(255)  NOT NULL COMMENT '비밀번호 (bcrypt)',
  `name`        VARCHAR(50)   NOT NULL COMMENT '관리자 이름',
  `email`       VARCHAR(100)  NOT NULL COMMENT '이메일',
  `role`        ENUM('superadmin','admin','viewer') NOT NULL DEFAULT 'admin' COMMENT '권한 레벨',
  `last_login`  DATETIME      NULL COMMENT '최근 로그인 일시',
  `ip_address`  VARCHAR(45)   NULL COMMENT '최근 접속 IP',
  `status`      ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_id` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='관리자 계정 테이블';


-- ============================================================
-- 8. 출금 신청 테이블 (withdrawal_requests)
--    관리자 개별/일괄 승인
-- ============================================================
DROP TABLE IF EXISTS `withdrawal_requests`;
CREATE TABLE `withdrawal_requests` (
  `id`              INT(11)       NOT NULL AUTO_INCREMENT COMMENT '출금 요청 ID',
  `member_id`       INT(11)       NOT NULL COMMENT '회원 ID (FK)',
  `payout_id`       INT(11)       NULL COMMENT '주간 지급 ID (FK, NULL=직급수당)',
  `withdraw_type`   ENUM('weekly_profit','commission','principal') NOT NULL DEFAULT 'weekly_profit' COMMENT '출금 종류',
  `amount`          DECIMAL(18,2) NOT NULL COMMENT '출금 신청 금액',
  `bank_name`       VARCHAR(50)   NOT NULL COMMENT '출금 은행명',
  `account_number`  VARCHAR(30)   NOT NULL COMMENT '출금 계좌번호',
  `account_holder`  VARCHAR(50)   NOT NULL COMMENT '예금주',
  `request_date`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '신청일',
  `approved_by`     INT(11)       NULL COMMENT '승인 관리자 ID',
  `approved_at`     DATETIME      NULL COMMENT '승인 처리일시',
  `paid_at`         DATETIME      NULL COMMENT '실제 지급 처리일시',
  `withdraw_date`   DATE          NULL COMMENT '출금일',
  `status`          ENUM('pending','approved','paid','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `reject_reason`   VARCHAR(255)  NULL COMMENT '거절 사유',
  `memo`            TEXT          NULL COMMENT '비고',
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_member_id`    (`member_id`),
  KEY `idx_status`       (`status`),
  KEY `idx_request_date` (`request_date`),
  KEY `idx_withdraw_date`(`withdraw_date`),
  CONSTRAINT `fk_withdraw_member` FOREIGN KEY (`member_id`)
    REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='출금 신청 내역 테이블';


-- ============================================================
-- 9. 시스템 설정 테이블 (system_settings)
-- ============================================================
DROP TABLE IF EXISTS `system_settings`;
CREATE TABLE `system_settings` (
  `id`           INT(11)       NOT NULL AUTO_INCREMENT,
  `setting_key`  VARCHAR(100)  NOT NULL COMMENT '설정 키',
  `setting_value` TEXT         NOT NULL COMMENT '설정 값',
  `description`  VARCHAR(255)  NULL COMMENT '설명',
  `updated_by`   INT(11)       NULL COMMENT '수정 관리자 ID',
  `updated_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='시스템 설정 테이블';


-- ============================================================
-- 10. 활동 로그 테이블 (activity_logs)
-- ============================================================
DROP TABLE IF EXISTS `activity_logs`;
CREATE TABLE `activity_logs` (
  `id`           BIGINT        NOT NULL AUTO_INCREMENT,
  `actor_type`   ENUM('member','admin') NOT NULL COMMENT '행위자 유형',
  `actor_id`     INT(11)       NOT NULL COMMENT '행위자 ID',
  `action`       VARCHAR(100)  NOT NULL COMMENT '액션 (login, invest, payout, ...)',
  `target_type`  VARCHAR(50)   NULL COMMENT '대상 테이블',
  `target_id`    INT(11)       NULL COMMENT '대상 레코드 ID',
  `description`  TEXT          NULL COMMENT '상세 설명',
  `ip_address`   VARCHAR(45)   NULL COMMENT 'IP 주소',
  `user_agent`   VARCHAR(255)  NULL COMMENT 'User-Agent',
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_actor`      (`actor_type`, `actor_id`),
  KEY `idx_action`     (`action`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='활동 로그 테이블';


-- ============================================================
-- 기본 시스템 설정 데이터 INSERT
-- ============================================================
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('weekly_profit_rate',    '10',         '주간 수익률 (%)'),
  ('total_weeks',           '15',         '총 지급 주차'),
  ('commission_rate_total', '20',         '총 직급수당 요율 (%)'),
  ('commission_bonbu',      '20',         '본부장 단독 수당 요율 (%) - 팀장 없을 때'),
  ('commission_bonbu_w_team','10',        '본부장 수당 요율 (%) - 팀장 있을 때'),
  ('commission_teamjang',   '10',         '팀장 수당 요율 (%)'),
  ('pay_day_of_week',       'friday',     '주간 수익 지급 요일'),
  ('platform_name',         'DANGUN 금융플랫폼', '플랫폼 이름'),
  ('platform_desc',         'DANGUN은 안전하고 투명한 금융투자 플랫폼입니다. 매주 10% 고정수익을 15주간 제공합니다.', '플랫폼 설명'),
  ('min_investment',        '100000',     '최소 투자금액 (원)'),
  ('maintenance_mode',      '0',          '점검 모드 (0=정상, 1=점검중)'),
  ('site_notice',           '',           '사이트 공지사항');


-- ============================================================
-- 기본 최고관리자 계정 INSERT
-- (비밀번호: admin1234 → bcrypt 해시로 실제 교체 필요)
-- ============================================================
INSERT INTO `admins` (`admin_id`, `password`, `name`, `email`, `role`) VALUES
  ('superadmin', '$2y$10$placeholder_hash_replace_me', '최고관리자', 'admin@dangun.com', 'superadmin');


-- ============================================================
-- VIEW: 회원 투자 현황 요약
-- ============================================================
CREATE OR REPLACE VIEW `v_member_investment_summary` AS
SELECT
  m.id                                AS member_id,
  m.user_id,
  m.name,
  m.phone,
  m.rank,
  m.bank_name,
  m.account_number,
  i.id                                AS investment_id,
  i.amount                            AS investment_amount,
  i.investment_date,
  i.current_week,
  i.total_weeks,
  i.paid_amount,
  i.remaining_amount,
  i.next_pay_date,
  i.status                            AS investment_status,
  ROUND(i.amount * 0.10, 2)           AS weekly_profit,
  ROUND((i.amount + i.amount * 0.10) / i.total_weeks, 2) AS payout_per_week,
  (SELECT COUNT(*) FROM members sub WHERE sub.recommender_id = m.id) AS direct_referrals
FROM members m
LEFT JOIN investments i ON i.member_id = m.id AND i.status = 'active';


-- ============================================================
-- VIEW: 직급 수당 내역 요약
-- ============================================================
CREATE OR REPLACE VIEW `v_commission_summary` AS
SELECT
  rc.id,
  rc.investment_id,
  inv.member_id     AS investor_member_id,
  inv_m.user_id     AS investor_user_id,
  inv_m.name        AS investor_name,
  rc.receiver_id,
  rcv_m.user_id     AS receiver_user_id,
  rcv_m.name        AS receiver_name,
  rc.receiver_rank,
  rc.commission_rate,
  rc.investment_amount,
  rc.commission_amount,
  rc.status,
  rc.paid_at,
  rc.created_at
FROM rank_commissions rc
JOIN investments inv       ON inv.id       = rc.investment_id
JOIN members    inv_m      ON inv_m.id     = rc.investor_id
JOIN members    rcv_m      ON rcv_m.id     = rc.receiver_id;


-- ============================================================
-- STORED PROCEDURE: 직급수당 자동 계산 및 지급
--   투자금 입금 시 호출 → 계보 탐색 후 수당 INSERT
-- ============================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_calculate_commission`$$
CREATE PROCEDURE `sp_calculate_commission`(
  IN p_investment_id INT,
  IN p_investor_id   INT,
  IN p_amount        DECIMAL(18,2)
)
BEGIN
  DECLARE v_parent_id     INT DEFAULT NULL;
  DECLARE v_parent_rank   VARCHAR(20);
  DECLARE v_grandpa_id    INT DEFAULT NULL;
  DECLARE v_grandpa_rank  VARCHAR(20);
  DECLARE v_commission_amt DECIMAL(18,2);

  -- 직계 상위 (추천인) 조회
  SELECT recommender_id INTO v_parent_id
    FROM members WHERE id = p_investor_id;

  IF v_parent_id IS NOT NULL THEN
    SELECT `rank` INTO v_parent_rank
      FROM members WHERE id = v_parent_id;

    IF v_parent_rank = '팀장' THEN
      -- 팀장: 10% 수당
      SET v_commission_amt = ROUND(p_amount * 0.10, 2);
      INSERT INTO rank_commissions
        (investment_id, investor_id, receiver_id, receiver_rank, commission_rate, investment_amount, commission_amount, status, paid_at)
        VALUES (p_investment_id, p_investor_id, v_parent_id, '팀장', 10.00, p_amount, v_commission_amt, 'paid', NOW());

      -- 팀장 상위 본부장 탐색
      SELECT recommender_id INTO v_grandpa_id
        FROM members WHERE id = v_parent_id;

      IF v_grandpa_id IS NOT NULL THEN
        SELECT `rank` INTO v_grandpa_rank
          FROM members WHERE id = v_grandpa_id;

        IF v_grandpa_rank = '본부장' THEN
          SET v_commission_amt = ROUND(p_amount * 0.10, 2);
          INSERT INTO rank_commissions
            (investment_id, investor_id, receiver_id, receiver_rank, commission_rate, investment_amount, commission_amount, status, paid_at)
            VALUES (p_investment_id, p_investor_id, v_grandpa_id, '본부장', 10.00, p_amount, v_commission_amt, 'paid', NOW());
        END IF;
      END IF;

    ELSEIF v_parent_rank = '본부장' THEN
      -- 팀장 없이 직계 본부장: 20%
      SET v_commission_amt = ROUND(p_amount * 0.20, 2);
      INSERT INTO rank_commissions
        (investment_id, investor_id, receiver_id, receiver_rank, commission_rate, investment_amount, commission_amount, status, paid_at)
        VALUES (p_investment_id, p_investor_id, v_parent_id, '본부장', 20.00, p_amount, v_commission_amt, 'paid', NOW());
    END IF;
  END IF;
END$$

-- ============================================================
-- STORED PROCEDURE: 15주 지급 스케줄 생성
--   투자금 입금 시 호출 → 15개 주간 지급 레코드 생성
-- ============================================================
DROP PROCEDURE IF EXISTS `sp_create_payout_schedule`$$
CREATE PROCEDURE `sp_create_payout_schedule`(
  IN p_investment_id   INT,
  IN p_member_id       INT,
  IN p_amount          DECIMAL(18,2),
  IN p_start_date      DATE
)
BEGIN
  DECLARE v_week         INT DEFAULT 1;
  DECLARE v_pay_date     DATE;
  DECLARE v_principal    DECIMAL(18,2);
  DECLARE v_profit       DECIMAL(18,2);
  DECLARE v_total        DECIMAL(18,2);
  DECLARE v_balance      DECIMAL(18,2);
  DECLARE v_days_to_fri  INT;

  -- 총 지급액 = 원금 + 원금×10%
  SET v_total   = p_amount + ROUND(p_amount * 0.10, 2);
  -- 주당 원금 분할
  SET v_principal = ROUND(p_amount / 15, 2);
  -- 주당 수익 분할
  SET v_profit    = ROUND((p_amount * 0.10) / 15, 2);
  SET v_balance   = v_total;

  -- 첫 지급 금요일 계산
  SET v_days_to_fri = (6 - DAYOFWEEK(p_start_date) + 7) % 7;
  IF v_days_to_fri = 0 THEN SET v_days_to_fri = 7; END IF;
  SET v_pay_date = DATE_ADD(p_start_date, INTERVAL v_days_to_fri DAY);

  WHILE v_week <= 15 DO
    SET v_balance = v_balance - (v_principal + v_profit);
    IF v_balance < 0 THEN SET v_balance = 0; END IF;

    INSERT INTO weekly_payouts
      (investment_id, member_id, week_number, principal_portion, profit_portion,
       total_payout, balance_before, balance_after, scheduled_date, days_invested, status)
    VALUES
      (p_investment_id, p_member_id, v_week, v_principal, v_profit,
       v_principal + v_profit,
       v_balance + (v_principal + v_profit),
       v_balance,
       v_pay_date, 7, 'pending');

    SET v_pay_date = DATE_ADD(v_pay_date, INTERVAL 7 DAY);
    SET v_week = v_week + 1;
  END WHILE;
END$$

DELIMITER ;


-- ============================================================
-- 외래 키 체크 복원
-- ============================================================
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 인덱스 확인 및 최적화 힌트
-- ============================================================
-- ANALYZE TABLE members, investments, weekly_payouts, rank_commissions;

-- ============================================================
-- END OF SCHEMA
-- ============================================================

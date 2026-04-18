'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb }      = require('../../database/db');
const { signToken, authMember } = require('../middleware/auth');

const router = express.Router();

/* ── 회원가입 ── */
router.post('/register', async (req, res) => {
  try {
    const {
      user_id, password, name, email, phone,
      bank_name, account_number, account_holder,
      recommender_id   // members.id (숫자) 또는 members.user_id (문자열)
    } = req.body;

    if (!user_id || !password || !name || !email || !phone)
      return res.status(400).json({ error: 'user_id, password, name, email, phone 필수' });

    const db = await getDb();

    // 중복 체크
    const dup = await db.get(
      'SELECT id FROM members WHERE user_id=? OR email=? OR phone=?',
      [user_id, email, phone]
    );
    if (dup) return res.status(409).json({ error: '이미 사용 중인 아이디/이메일/전화번호입니다.' });

    // ── 추천인 조회 ──
    // 숫자 → members.id로 조회
    // 문자열 → members.user_id로 조회
    // SuperAdmin 같은 admins 계정을 입력해도 graceful하게 무시 (추천인 없이 가입)
    let resolvedRecommenderId = null;
    if (recommender_id) {
      const rid = String(recommender_id).trim();
      let recRow = null;
      if (/^\d+$/.test(rid)) {
        recRow = await db.get('SELECT id FROM members WHERE id=?', [parseInt(rid)]);
      }
      if (!recRow) {
        recRow = await db.get('SELECT id FROM members WHERE user_id=?', [rid]);
      }
      if (recRow) {
        resolvedRecommenderId = recRow.id;
      }
      // 추천인을 찾지 못해도 에러 없이 계속 진행 (추천인 없이 가입)
    }

    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.run(
      `INSERT INTO members
         (user_id, password, name, email, phone, bank_name, account_number, account_holder, recommender_id, status)
       VALUES (?,?,?,?,?,?,?,?,?,'active')`,
      [user_id, hashed, name, email, phone,
       bank_name||'', account_number||'', account_holder||name,
       resolvedRecommenderId]
    );
    const memberId = result.lastID;

    // 지갑 생성
    await db.run('INSERT OR IGNORE INTO member_wallets (member_id) VALUES (?)', [memberId]);

    // 추천 계보 등록 (자기 자신 포함)
    await db.run(
      'INSERT INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,0)',
      [memberId, memberId]
    );
    if (resolvedRecommenderId) {
      const ancestors = await db.all(
        'SELECT ancestor_id, depth FROM referral_tree WHERE member_id=?',
        [resolvedRecommenderId]
      );
      for (const a of ancestors) {
        await db.run(
          'INSERT OR IGNORE INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,?)',
          [memberId, a.ancestor_id, a.depth + 1]
        );
      }
    }

    await db.run(
      `INSERT INTO activity_logs (actor_type, actor_id, action, description) VALUES ('member',?,'register',?)`,
      [memberId, `회원가입: ${user_id}`]
    );

    return res.status(201).json({
      message: '회원가입이 완료되었습니다. 바로 로그인 가능합니다.',
      user_id,
      recommender_linked: !!resolvedRecommenderId
    });
  } catch (e) {
    console.error('POST /register error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ── 회원 로그인 ── */
router.post('/login', async (req, res) => {
  try {
    const { user_id, password } = req.body;
    if (!user_id || !password)
      return res.status(400).json({ error: 'user_id, password 필수' });

    const db = await getDb();
    const member = await db.get('SELECT * FROM members WHERE user_id=?', [user_id]);
    if (!member || !bcrypt.compareSync(password, member.password))
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    if (member.status === 'inactive')
      return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
    if (member.status === 'suspended')
      return res.status(403).json({ error: '정지된 계정입니다. 관리자에게 문의하세요.' });

    const token = signToken({ id: member.id, type: 'member' });
    await db.run(
      `UPDATE members SET updated_at=datetime('now','localtime') WHERE id=?`,
      [member.id]
    );

    return res.json({
      token,
      user: { id: member.id, user_id: member.user_id, name: member.name, rank: member.rank }
    });
  } catch (e) {
    console.error('POST /login error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ── 관리자 로그인 ── */
router.post('/admin/login', async (req, res) => {
  try {
    const { admin_id, password } = req.body;
    if (!admin_id || !password)
      return res.status(400).json({ error: 'admin_id, password 필수' });

    const db = await getDb();
    const admin = await db.get('SELECT * FROM admins WHERE admin_id=?', [admin_id]);
    if (!admin || !bcrypt.compareSync(password, admin.password))
      return res.status(401).json({ error: '관리자 아이디 또는 비밀번호가 올바르지 않습니다.' });
    if (admin.status !== 'active')
      return res.status(403).json({ error: '비활성화된 관리자 계정입니다.' });

    const token = signToken({ id: admin.id, type: 'admin' });
    await db.run(
      `UPDATE admins SET last_login=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
      [admin.id]
    );

    return res.json({
      token,
      admin: { id: admin.id, admin_id: admin.admin_id, name: admin.name, role: admin.role }
    });
  } catch (e) {
    console.error('POST /admin/login error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ── 내 정보 (회원) ── */
router.get('/me', authMember, async (req, res) => {
  try {
    const db = await getDb();
    const m = await db.get(
      'SELECT id,user_id,name,email,phone,rank,status,investment_total,investment_date FROM members WHERE id=?',
      [req.user.id]
    );
    const w = await db.get('SELECT * FROM member_wallets WHERE member_id=?', [req.user.id]);
    return res.json({ ...m, wallet: w });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ── 회원 검색 (추천인 찾기용) ──
   members 테이블에서 검색하며, 결과에 SuperAdmin 항목을 별도 추가하지 않음
   (SuperAdmin은 관리자이므로 members에 없음 – 추천인으로 등록해도 시스템이 graceful 처리)
*/
router.get('/members/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const db = await getDb();
    const rows = await db.all(
      `SELECT id, user_id, name, rank
       FROM members
       WHERE status != 'suspended'
         AND (user_id LIKE ? OR name LIKE ?)
       ORDER BY created_at DESC
       LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

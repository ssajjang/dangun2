'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb }      = require('../../database/db');
const { authAdmin, authMember } = require('../middleware/auth');

const router = express.Router();

/* ── 전체 회원 목록 ── */
router.get('/', authAdmin, async (req, res) => {
  try {
    const db     = await getDb();
    const page   = parseInt(req.query.page   || 1);
    const limit  = parseInt(req.query.limit  || 20);
    const offset = (page - 1) * limit;
    const q      = req.query.search || '';
    const rank   = req.query.rank   || '';
    const status = req.query.status || '';

    const params = [];
    let where = '1=1';
    if (q)      { where += ` AND (m.user_id LIKE ? OR m.name LIKE ? OR m.phone LIKE ?)`; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    if (rank)   { where += ` AND m.rank = ?`;   params.push(rank); }
    if (status) { where += ` AND m.status = ?`; params.push(status); }

    const rows  = await db.all(`
      SELECT m.*, rec.user_id AS recommender_user_id, rec.name AS recommender_name,
             w.available_balance, w.total_invested, w.total_commission, w.total_withdrawn,
             inv.current_week, inv.remaining_amount,
             (SELECT COUNT(*) FROM members sub WHERE sub.recommender_id = m.id) AS direct_referrals
      FROM members m
      LEFT JOIN members rec ON rec.id = m.recommender_id
      LEFT JOIN member_wallets w ON w.member_id = m.id
      LEFT JOIN investments inv ON inv.member_id = m.id AND inv.status = 'active'
      WHERE ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const { cnt: total } = await db.get(`SELECT COUNT(*) as cnt FROM members m WHERE ${where}`, params);
    const stats = await db.get(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) as inactive_count,
        SUM(CASE WHEN rank='팀장'       THEN 1 ELSE 0 END) as teamjang_count,
        SUM(CASE WHEN rank='본부장'     THEN 1 ELSE 0 END) as bonbujang_count,
        SUM(investment_total) as total_investment
      FROM members
    `);

    return res.json({ data: rows.map(r => ({ ...r, password: undefined })), total, page, limit, stats });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

/* ── 회원 상세 ── */
router.get('/:id', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const member = await db.get(`
      SELECT m.*, w.available_balance, w.total_invested, w.total_commission, w.total_withdrawn,
             rec.user_id AS recommender_user_id
      FROM members m
      LEFT JOIN member_wallets w ON w.member_id = m.id
      LEFT JOIN members rec ON rec.id = m.recommender_id
      WHERE m.id = ?
    `, [req.params.id]);
    if (!member) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });

    const investments = await db.all('SELECT * FROM investments WHERE member_id=? ORDER BY created_at DESC', [req.params.id]);
    const commissions = await db.all(`
      SELECT rc.*, inv_m.user_id AS investor_user_id
      FROM rank_commissions rc JOIN members inv_m ON inv_m.id = rc.investor_id
      WHERE rc.receiver_id=? ORDER BY rc.created_at DESC LIMIT 20
    `, [req.params.id]);

    return res.json({ ...member, password: undefined, investments, commissions });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

/* ── 회원 수정 ── */
router.patch('/:id', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const targetId = req.params.id;
    const member = await db.get('SELECT * FROM members WHERE id=?', [targetId]);
    if (!member) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });

    // [수정 포인트] 기본 정보 업데이트 허용 항목에 이름(name), 전화번호(phone), 이메일(email) 추가
    const allowed = ['name', 'phone', 'email', 'rank', 'status', 'memo', 'bank_name', 'account_number', 'account_holder'];
    const updates = {};
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }

    // [수정 포인트] 비밀번호 변경 로직 추가 (비밀번호 입력값이 있을 경우 해싱하여 업데이트 항목에 포함)
    if (req.body.password && req.body.password.trim() !== '') {
      updates.password = bcrypt.hashSync(req.body.password, 10);
    }

    // 추천인(recommender) 변경 처리
    const recVal = req.body.recommender_id !== undefined ? req.body.recommender_id : req.body.recommender_user_id;
    if (recVal !== undefined) {
      if (!recVal || String(recVal).trim() === '') {
        updates.recommender_id = null; // 추천인 해제
      } else {
        const rid = String(recVal).trim();
        let recRow = await db.get('SELECT id FROM members WHERE user_id=?', [rid]);
        if (!recRow && /^\d+$/.test(rid)) {
          recRow = await db.get('SELECT id FROM members WHERE id=?', [parseInt(rid)]);
        }

        if (recRow) {
          if (recRow.id === Number(targetId)) {
            return res.status(400).json({ error: '자기 자신을 추천인으로 등록할 수 없습니다.' });
          }
          updates.recommender_id = recRow.id;
        } else {
          // 관리자(슈퍼관리자) 여부 확인
          const adminRow = await db.get('SELECT id FROM admins WHERE admin_id=? AND status=?', [rid, 'active']);
          if (adminRow) {
            updates.recommender_id = null; // 최고관리자는 members에 없으므로 null 취급
          } else {
            return res.status(400).json({ error: '존재하지 않는 추천인 아이디입니다.' });
          }
        }
      }
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: '변경할 항목이 없습니다.' });

    const set = Object.keys(updates).map(k => `${k}=?`).join(', ');
    await db.run(`UPDATE members SET ${set}, updated_at=datetime('now','localtime') WHERE id=?`,
      [...Object.values(updates), targetId]);

    // 추천인이 변경되었다면 referral_tree (조직도/계보) 동기화
    if ('recommender_id' in updates) {
      // 1. 자신의 상위 계보 끊기 (본인 하위 조망은 그대로 유지)
      await db.run(`DELETE FROM referral_tree WHERE member_id = ? AND depth > 0`, [targetId]);
      
      // 2. 새로운 추천인이 있다면 상위 계보 다시 연결
      if (updates.recommender_id) {
        const ancestors = await db.all('SELECT ancestor_id, depth FROM referral_tree WHERE member_id=?', [updates.recommender_id]);
        for (const a of ancestors) {
          await db.run('INSERT OR IGNORE INTO referral_tree (member_id, ancestor_id, depth) VALUES (?,?,?)', 
            [targetId, a.ancestor_id, a.depth + 1]);
        }
      }
    }

    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description) VALUES ('admin',?,?,?,?,?)`,
      [req.admin.id, 'member_update', 'members', targetId, `회원수정(정보변경): ID ${targetId}`]);

    return res.json({ message: '회원 정보가 정상적으로 수정되었습니다.' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

/* ── 비밀번호 변경 (별도 호출용 API) ── */
router.patch('/:id/password', authAdmin, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });

    const db = await getDb();
    const member = await db.get('SELECT id,user_id,name FROM members WHERE id=?', [req.params.id]);
    if (!member) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });

    const hashed = bcrypt.hashSync(new_password, 10);
    await db.run(`UPDATE members SET password=?, updated_at=datetime('now','localtime') WHERE id=?`, [hashed, req.params.id]);
    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,target_type,target_id,description) VALUES ('admin',?,?,?,?,?)`,
      [req.admin.id, 'password_change', 'members', req.params.id, `비밀번호변경: ${member.user_id}`]);

    return res.json({ message: `${member.name}(${member.user_id}) 비밀번호가 변경되었습니다.` });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

/* ── 추천 계보 (회원 본인) ─ /my/referrals 를 /:id/referrals 보다 먼저 등록해야 함 ── */
router.get('/my/referrals', authMember, async (req, res) => {
  try {
    const db = await getDb();
    const myId = req.user.id;

    const descendants = await db.all(`
      SELECT m.id, m.user_id, m.name, m.rank, m.investment_total, m.investment_date,
             m.status, m.recommender_id, rt.depth
      FROM referral_tree rt JOIN members m ON m.id = rt.member_id
      WHERE rt.ancestor_id = ? AND rt.depth > 0
      ORDER BY rt.depth, m.id
    `, [myId]);

    const directCount  = descendants.filter(d => d.depth === 1).length;
    const maxDepth     = descendants.reduce((a, d) => Math.max(a, d.depth), 0);
    const totalInvest  = descendants.reduce((a, d) => a + (d.investment_total || 0), 0);

    function buildTree(nodes, parentId) {
      return nodes
        .filter(n => n.recommender_id == parentId)
        .map(n => ({ ...n, children: buildTree(nodes, n.id) }));
    }

    return res.json({
      tree:          buildTree(descendants, myId),
      flat:          descendants,
      total:         descendants.length,
      direct_count:  directCount,
      max_depth:     maxDepth,
      total_invest:  totalInvest,
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

/* ── 추천 계보 (관리자) ── */
router.get('/:id/referrals', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: '유효하지 않은 회원 ID' });

    const descendants = await db.all(`
      SELECT m.id, m.user_id, m.name, m.rank, m.investment_total, m.investment_date,
             m.status, m.recommender_id, rt.depth
      FROM referral_tree rt JOIN members m ON m.id = rt.member_id
      WHERE rt.ancestor_id = ? AND rt.depth > 0 ORDER BY rt.depth, m.id
    `, [targetId]);

    const directCount = descendants.filter(d => d.depth === 1).length;
    const maxDepth    = descendants.reduce((a, d) => Math.max(a, d.depth), 0);
    const totalInvest = descendants.reduce((a, d) => a + (d.investment_total || 0), 0);

    function buildTree(nodes, parentId) {
      return nodes.filter(n => n.recommender_id == parentId).map(n => ({ ...n, children: buildTree(nodes, n.id) }));
    }
    return res.json({
      tree:         buildTree(descendants, targetId),
      flat:         descendants,
      total:        descendants.length,
      direct_count: directCount,
      max_depth:    maxDepth,
      total_invest: totalInvest,
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

module.exports = router;
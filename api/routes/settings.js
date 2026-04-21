'use strict';
/**
 * DANGUN - 시스템 설정 API
 * - DANGUN 코인 환율 조회/수정
 * - sub-admin 관리 (생성, 목록, 비밀번호 재설정, 상태 변경)
 * * Routes:
 * GET  /api/settings              — 공개 설정 조회 (토큰 불필요)
 * GET  /api/settings/all          — 전체 설정 조회 (관리자)
 * PUT  /api/settings/:key         — 설정 수정 (superadmin)
 * POST /api/settings/batch        — 여러 설정 일괄 수정 (superadmin)
 *
 * GET  /api/settings/admins       — sub-admin 목록 (superadmin)
 * POST /api/settings/admins       — sub-admin 생성 (superadmin)
 * PATCH /api/settings/admins/:id/password — 비밀번호 재설정 (superadmin)
 * PATCH /api/settings/admins/:id/status  — 상태 변경 active/inactive (superadmin)
 * DELETE /api/settings/admins/:id        — sub-admin 삭제 (superadmin)
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb }           = require('../../database/db');
const { authAdmin, authSuperAdmin } = require('../middleware/auth');

const router = express.Router();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   공개 설정 조회 (프론트엔드에서 토큰 없이 코인 환율 읽기용)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const PUBLIC_KEYS = [
  'dangun_coin_rate',
  'dangun_coin_symbol',
  'dangun_coin_enabled',
  'platform_name',
  'site_notice',
];

router.get('/public', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${PUBLIC_KEYS.map(() => '?').join(',')})`,
      PUBLIC_KEYS
    );
    const result = {};
    rows.forEach(r => { result[r.setting_key] = r.setting_value; });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   전체 설정 조회 (관리자)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/all', authAdmin, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all('SELECT * FROM system_settings ORDER BY id');
    const result = {};
    rows.forEach(r => { result[r.setting_key] = { value: r.setting_value, description: r.description, updated_at: r.updated_at }; });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   단일 설정 수정 (superadmin 전용)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.put('/:key', authSuperAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null)
      return res.status(400).json({ error: 'value 필드가 필요합니다.' });

    // 코인 환율 검증: 숫자, 소수점 2자리 이하
    if (key === 'dangun_coin_rate') {
      const rate = parseFloat(value);
      if (isNaN(rate) || rate < 0)
        return res.status(400).json({ error: '코인 환율은 0 이상의 숫자여야 합니다.' });
      // 소수점 2자리로 고정
      const rounded = Math.round(rate * 100) / 100;
      const db = await getDb();
      await db.run(
        `UPDATE system_settings SET setting_value=?, updated_by=?, updated_at=datetime('now','localtime') WHERE setting_key=?`,
        [rounded.toFixed(2), req.admin.id, key]
      );
      await db.run(
        `INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description, updated_by) VALUES (?,?,?,?)`,
        [key, rounded.toFixed(2), 'DANGUN 코인 환율 (1 KRW = N DANGUN)', req.admin.id]
      );
      await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'update_setting',?)`,
        [req.admin.id, `코인 환율 변경: 1 KRW = ${rounded.toFixed(2)} DGN`]);
      return res.json({ key, value: rounded.toFixed(2), message: '설정이 저장되었습니다.' });
    }

    const db = await getDb();
    const existing = await db.get('SELECT id FROM system_settings WHERE setting_key=?', [key]);
    if (existing) {
      await db.run(
        `UPDATE system_settings SET setting_value=?, updated_by=?, updated_at=datetime('now','localtime') WHERE setting_key=?`,
        [String(value), req.admin.id, key]
      );
    } else {
      await db.run(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?,?,?)`,
        [key, String(value), req.admin.id]
      );
    }
    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'update_setting',?)`,
      [req.admin.id, `설정 변경: ${key} = ${value}`]);

    return res.json({ key, value: String(value), message: '설정이 저장되었습니다.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   일괄 설정 수정 (superadmin)
   body: { settings: { key: value, ... } }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/batch', authSuperAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object')
      return res.status(400).json({ error: 'settings 객체가 필요합니다.' });

    const db = await getDb();
    const updated = [];

    for (const [key, value] of Object.entries(settings)) {
      let v = String(value);
      if (key === 'dangun_coin_rate') {
        const rate = parseFloat(value);
        if (isNaN(rate) || rate < 0) continue;
        v = (Math.round(rate * 100) / 100).toFixed(2);
      }
      const existing = await db.get('SELECT id FROM system_settings WHERE setting_key=?', [key]);
      if (existing) {
        await db.run(
          `UPDATE system_settings SET setting_value=?, updated_by=?, updated_at=datetime('now','localtime') WHERE setting_key=?`,
          [v, req.admin.id, key]
        );
      } else {
        await db.run(
          `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?,?,?)`,
          [key, v, req.admin.id]
        );
      }
      updated.push({ key, value: v });
    }

    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'batch_settings',?)`,
      [req.admin.id, `일괄 설정 변경: ${updated.map(u => u.key).join(', ')}`]);

    return res.json({ message: `${updated.length}개 설정 저장 완료`, updated });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUB-ADMIN 관리
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* GET /api/settings/admins — sub-admin 목록 */
router.get('/admins', authSuperAdmin, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT id, admin_id, name, email, role, status, last_login, created_at
       FROM admins ORDER BY role DESC, id ASC`
    );
    return res.json({ admins: rows, total: rows.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* POST /api/settings/admins — sub-admin 생성 */
router.post('/admins', authSuperAdmin, async (req, res) => {
  try {
    let { admin_id, password, name, email } = req.body;
    
    // 값 다듬기 (공백 등 제거)
    admin_id = (admin_id || '').trim();
    name = (name || '').trim();
    email = (email || '').trim();
    password = password || '';

    // 백엔드 측 필수값 및 길이 이중 검증 추가
    if (!admin_id || !password || !name)
      return res.status(400).json({ error: '관리자 아이디, 비밀번호, 이름은 필수 항목입니다.' });

    if (password.length < 8)
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });

    // 영문과 숫자만 허용하는 기본 정규식 검증 추가
    if (!/^[a-zA-Z0-9_]+$/.test(admin_id)) {
      return res.status(400).json({ error: '관리자 아이디는 영문자, 숫자, 언더바(_)만 사용할 수 있습니다.' });
    }

    const db  = await getDb();
    const dup = await db.get('SELECT id FROM admins WHERE admin_id=?', [admin_id]);
    if (dup) return res.status(409).json({ error: '이미 사용 중인 관리자 아이디입니다.' });

    const hashed = bcrypt.hashSync(password, 10);
    const finalEmail = email || `${admin_id}@dangun.internal`;

    const result = await db.run(
      `INSERT INTO admins (admin_id, password, name, email, role, status)
       VALUES (?, ?, ?, ?, 'subadmin', 'active')`,
      [admin_id, hashed, name, finalEmail]
    );

    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'create_subadmin',?)`,
      [req.admin.id, `서브관리자 생성: ${admin_id} (${name})`]);

    return res.status(201).json({
      message: `서브관리자 '${name}(${admin_id})'이 정상적으로 생성되었습니다.`,
      id: result.lastID, admin_id, name, role: 'subadmin', status: 'active'
    });
  } catch (e) {
    console.error('[API Error - Admin Create]', e);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다. (' + e.message + ')' });
  }
});

/* PATCH /api/settings/admins/:id/password — 비밀번호 재설정 */
router.patch('/admins/:id/password', authSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 8)
      return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });

    const db    = await getDb();
    const admin = await db.get('SELECT id, admin_id, role FROM admins WHERE id=?', [id]);
    if (!admin) return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
    if (admin.role === 'superadmin' && req.admin.id !== Number(id))
      return res.status(403).json({ error: '다른 superadmin의 비밀번호는 변경할 수 없습니다.' });

    const hashed = bcrypt.hashSync(new_password, 10);
    await db.run(
      `UPDATE admins SET password=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [hashed, id]
    );

    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'reset_password',?)`,
      [req.admin.id, `비밀번호 재설정: 관리자 ID ${admin.admin_id}`]);

    return res.json({ message: '비밀번호가 안전하게 재설정되었습니다.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* PATCH /api/settings/admins/:id/status — 상태 변경 */
router.patch('/admins/:id/status', authSuperAdmin, async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;

    if (!['active', 'inactive', 'suspended'].includes(status))
      return res.status(400).json({ error: '올바르지 않은 상태 값입니다.' });

    const db    = await getDb();
    const admin = await db.get('SELECT id, admin_id, role FROM admins WHERE id=?', [id]);
    if (!admin) return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
    if (admin.role === 'superadmin')
      return res.status(403).json({ error: 'superadmin 상태는 변경할 수 없습니다.' });

    await db.run(
      `UPDATE admins SET status=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [status, id]
    );

    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'change_admin_status',?)`,
      [req.admin.id, `관리자 상태 변경: ${admin.admin_id} → ${status}`]);

    return res.json({ message: `관리자 상태가 '${status}'(으)로 변경되었습니다.`, status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* DELETE /api/settings/admins/:id — sub-admin 삭제 */
router.delete('/admins/:id', authSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db    = await getDb();
    const admin = await db.get('SELECT id, admin_id, role FROM admins WHERE id=?', [id]);
    if (!admin) return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
    if (admin.role === 'superadmin')
      return res.status(403).json({ error: 'superadmin 계정은 삭제할 수 없습니다.' });
    if (Number(id) === req.admin.id)
      return res.status(400).json({ error: '현재 로그인 중인 본인 계정은 삭제할 수 없습니다.' });

    await db.run('DELETE FROM admins WHERE id=?', [id]);

    await db.run(`INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,'delete_subadmin',?)`,
      [req.admin.id, `서브관리자 삭제: ${admin.admin_id}`]);

    return res.json({ message: `서브관리자 '${admin.admin_id}' 계정이 삭제되었습니다.` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
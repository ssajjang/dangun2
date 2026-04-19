'use strict';
/**
 * DANGUN - DB 백업 / 복원 API
 *
 * POST /api/backup/export   → 전체 DB를 JSON으로 백업 (파일 저장 + 다운로드 응답)
 * GET  /api/backup/list     → 저장된 백업 파일 목록
 * POST /api/backup/restore  → 업로드된 JSON 백업 파일로 DB 복원
 * DELETE /api/backup/:filename → 특정 백업 파일 삭제
 */
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { getDb } = require('../../database/db');
const { authAdmin } = require('../middleware/auth');

const router = express.Router();

// 백업 저장 디렉토리 (프로젝트 루트 기준, 서버 재배포 후에도 유지)
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '../../backups');

// 디렉토리 없으면 생성
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 백업 대상 테이블 목록 (순서 중요: FK 의존 순서)
const BACKUP_TABLES = [
  'admins',
  'members',
  'member_wallets',
  'investments',
  'weekly_payouts',
  'rank_commissions',
  'withdrawal_requests',
  'referral_tree',
  'system_settings',
  'activity_logs',
];

// 복원 시 데이터를 삽입할 테이블 순서 (FK 순서 유지)
const RESTORE_TABLES = [
  'system_settings',
  'admins',
  'members',
  'member_wallets',
  'investments',
  'weekly_payouts',
  'rank_commissions',
  'withdrawal_requests',
  'referral_tree',
  'activity_logs',
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/backup/export  ── DB 전체 JSON 백업
   - 파일을 BACKUP_DIR에 저장
   - 응답: JSON 파일 다운로드
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/export', authAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const backup = {
      meta: {
        version:    '1.0',
        platform:   'DANGUN',
        exported_at: new Date().toISOString(),
        exported_by: req.admin.admin_id,
        tables:      BACKUP_TABLES,
      },
      data: {}
    };

    // 테이블별 전체 데이터 추출
    for (const table of BACKUP_TABLES) {
      try {
        const rows = await db.all(`SELECT * FROM ${table}`);
        backup.data[table] = rows;
      } catch (e) {
        console.warn(`[backup] 테이블 ${table} 조회 실패 (무시):`, e.message);
        backup.data[table] = [];
      }
    }

    // 파일명: dangun_backup_YYYYMMDD_HHMMSS.json
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `dangun_backup_${ts}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    const json = JSON.stringify(backup, null, 2);
    fs.writeFileSync(filepath, json, 'utf8');

    // 활동 로그
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,?,?)`,
      [req.admin.id, 'db_backup_export', `DB 백업 생성: ${filename} (용량: ${(json.length/1024).toFixed(1)} KB)`]
    );

    // 파일 다운로드 응답
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Filename', filename);
    res.setHeader('X-Backup-Size', json.length);
    return res.send(json);

  } catch (e) {
    console.error('POST /backup/export error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/backup/list  ── 저장된 백업 파일 목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/list', authAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') && f.startsWith('dangun_backup_'))
      .map(f => {
        const fp   = path.join(BACKUP_DIR, f);
        const stat = fs.statSync(fp);
        return {
          filename:   f,
          size:       stat.size,
          size_kb:    (stat.size / 1024).toFixed(1),
          created_at: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at)); // 최신순

    return res.json({ count: files.length, files, backup_dir: BACKUP_DIR });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/backup/download/:filename  ── 저장된 백업 파일 다운로드
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.get('/download/:filename', authAdmin, (req, res) => {
  try {
    // 경로 순회 공격 방지
    const filename = path.basename(req.params.filename);
    if (!filename.startsWith('dangun_backup_') || !filename.endsWith('.json')) {
      return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
    }
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: '백업 파일을 찾을 수 없습니다.' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.sendFile(filepath);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POST /api/backup/restore  ── JSON 백업 파일로 DB 복원
   body: { filename: 'dangun_backup_XXX.json', confirm_text: 'RESTORE' }
   또는 body에 JSON 데이터 직접 전송 (json_data 필드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.post('/restore', authAdmin, async (req, res) => {
  try {
    const { filename, confirm_text, json_data } = req.body;

    if (confirm_text !== 'RESTORE') {
      return res.status(400).json({ error: "확인 문구로 'RESTORE'를 입력하세요." });
    }

    let backup;

    if (json_data) {
      // 직접 전송된 JSON 데이터
      try {
        backup = typeof json_data === 'string' ? JSON.parse(json_data) : json_data;
      } catch(pe) {
        return res.status(400).json({ error: 'JSON 파싱 실패: ' + pe.message });
      }
    } else if (filename) {
      // 서버에 저장된 파일
      const safeFile = path.basename(filename);
      if (!safeFile.startsWith('dangun_backup_') || !safeFile.endsWith('.json')) {
        return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
      }
      const filepath = path.join(BACKUP_DIR, safeFile);
      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: '백업 파일을 찾을 수 없습니다.' });
      }
      backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } else {
      return res.status(400).json({ error: 'filename 또는 json_data 중 하나가 필요합니다.' });
    }

    if (!backup || !backup.data || !backup.meta) {
      return res.status(400).json({ error: '유효하지 않은 백업 파일 형식입니다.' });
    }

    const db = await getDb();
    const result = { restored: {}, skipped: {}, errors: {} };

    // 외래키 임시 비활성화 후 순서대로 복원
    await db.run('PRAGMA foreign_keys = OFF');

    for (const table of RESTORE_TABLES) {
      const rows = backup.data[table];
      if (!rows || !Array.isArray(rows)) { result.skipped[table] = true; continue; }
      if (rows.length === 0) { result.restored[table] = 0; continue; }

      try {
        // 기존 데이터 전체 삭제 (admins 제외: 현재 관리자 계정 보호)
        if (table === 'admins') {
          // admins는 현재 로그인한 관리자가 없는 경우만 전체 복원
          // 기존 admins는 유지하고 없는 계정만 INSERT
          let cnt = 0;
          for (const row of rows) {
            try {
              const cols = Object.keys(row);
              const vals = cols.map(c => row[c]);
              await db.run(
                `INSERT OR IGNORE INTO admins (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,
                vals
              );
              cnt++;
            } catch(re) { /* 중복 무시 */ }
          }
          result.restored[table] = cnt;
          continue;
        }

        await db.run(`DELETE FROM ${table}`);

        let cnt = 0;
        for (const row of rows) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const vals = cols.map(c => row[c]);
          await db.run(
            `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,
            vals
          );
          cnt++;
        }
        result.restored[table] = cnt;
      } catch(te) {
        console.error(`[backup restore] 테이블 ${table} 복원 실패:`, te.message);
        result.errors[table] = te.message;
      }
    }

    await db.run('PRAGMA foreign_keys = ON');

    // 복원 로그 기록
    try {
      await db.run(
        `INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,?,?)`,
        [req.admin.id, 'db_backup_restore',
         `DB 복원 완료 (소스: ${filename || 'direct'}, 복원: ${JSON.stringify(result.restored)})`]
      );
    } catch(le) { /* 로그 실패는 무시 */ }

    return res.json({
      message: 'DB 복원이 완료되었습니다.',
      source:  backup.meta,
      result,
    });

  } catch (e) {
    console.error('POST /backup/restore error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DELETE /api/backup/:filename  ── 백업 파일 삭제
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
router.delete('/:filename', authAdmin, async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!filename.startsWith('dangun_backup_') || !filename.endsWith('.json')) {
      return res.status(400).json({ error: '유효하지 않은 파일명입니다.' });
    }
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    fs.unlinkSync(filepath);

    const db = await getDb();
    await db.run(
      `INSERT INTO activity_logs (actor_type,actor_id,action,description) VALUES ('admin',?,?,?)`,
      [req.admin.id, 'db_backup_delete', `백업 파일 삭제: ${filename}`]
    );

    return res.json({ message: `백업 파일 '${filename}'이 삭제되었습니다.` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

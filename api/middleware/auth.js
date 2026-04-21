'use strict';
const jwt    = require('jsonwebtoken');
const { getDb } = require('../../database/db');

const SECRET = process.env.JWT_SECRET || 'dangun_dev_secret_change_this';

function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, SECRET, { expiresIn });
}

async function authMember(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'member') return res.status(403).json({ error: '회원 전용 API입니다.' });

    const db     = await getDb();
    const member = await db.get('SELECT id,user_id,name,rank,status FROM members WHERE id=?', [decoded.id]);
    if (!member) return res.status(403).json({ error: '존재하지 않는 회원입니다.' });
    if (member.status === 'suspended') return res.status(403).json({ error: '정지된 계정입니다.' });

    req.user = member;
    next();
  } catch (e) {
    console.error('[Auth Error - Member]', e.message);
    return res.status(401).json({ error: '인증 토큰이 유효하지 않거나 만료되었습니다.' });
  }
}

async function authAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });

    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: '관리자 전용 API입니다.' });

    const db    = await getDb();
    const admin = await db.get('SELECT id,admin_id,name,role,status FROM admins WHERE id=?', [decoded.id]);
    if (!admin || admin.status !== 'active') return res.status(403).json({ error: '관리자 권한이 없거나 정지되었습니다.' });

    req.admin = admin;
    next();
  } catch (e) {
    console.error('[Auth Error - Admin]', e.message);
    return res.status(401).json({ error: '인증 토큰이 유효하지 않거나 만료되었습니다.' });
  }
}

/**
 * authSuperAdmin — superadmin 전용 미들웨어
 * role이 'superadmin'인 관리자만 허용 (대소문자 방어 로직 추가)
 */
async function authSuperAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });

    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: '관리자 전용 API입니다.' });

    const db    = await getDb();
    const admin = await db.get('SELECT id,admin_id,name,role,status FROM admins WHERE id=?', [decoded.id]);
    if (!admin || admin.status !== 'active') return res.status(403).json({ error: '관리자 권한이 없거나 정지되었습니다.' });
    
    // [개선] 대소문자 차이로 인한 Silent 블록 차단
    if (!admin.role || admin.role.toLowerCase() !== 'superadmin') {
      return res.status(403).json({ error: '최고관리자(superadmin) 전용 기능입니다.' });
    }

    req.admin = admin;
    next();
  } catch (e) {
    console.error('[Auth Error - SuperAdmin]', e.message);
    return res.status(401).json({ error: '인증 토큰이 유효하지 않거나 만료되었습니다.' });
  }
}

async function authAny(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const decoded = jwt.verify(token, SECRET);
    const db = await getDb();

    if (decoded.type === 'admin') {
      const admin = await db.get('SELECT id,admin_id,name,role,status FROM admins WHERE id=?', [decoded.id]);
      if (!admin) return res.status(403).json({ error: '존재하지 않는 관리자입니다.' });
      req.admin = admin;
    } else {
      const user = await db.get('SELECT id,user_id,name,rank,status FROM members WHERE id=?', [decoded.id]);
      if (!user) return res.status(403).json({ error: '존재하지 않는 회원입니다.' });
      req.user = user;
    }
    next();
  } catch (e) {
    console.error('[Auth Error - Any]', e.message);
    return res.status(401).json({ error: '인증 토큰이 유효하지 않거나 만료되었습니다.' });
  }
}

module.exports = { signToken, authMember, authAdmin, authSuperAdmin, authAny };
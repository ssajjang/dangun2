'use strict';
/**
 * DANGUN 금융플랫폼 - Express 서버
 * DB: sqlite3 + sqlite (Promise 래퍼) - 네이티브 빌드 불필요
 */
const path = require('path');
const fs   = require('fs');
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

// Railway 환경에서는 process.env.PORT를 우선 사용하며, 없으면 8080을 기본값으로 설정합니다.
const PORT = parseInt(process.env.PORT, 10) || 8080;
const app  = express();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💡 [추가] Proxy 설정 (Cloudflare/Railway 환경 필수)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 이 설정이 있어야 express-rate-limit이 Cloudflare의 IP 정보를 신뢰합니다.
app.set('trust proxy', true);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 헬스체크 - 가장 먼저 (DB 없이 즉시 응답)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    platform: 'DANGUN 금융플랫폼',
    version: '1.0.0',
    time: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    port: PORT,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Middleware
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('[:date[clf]] :method :url :status :response-time ms'));
}

// Rate Limiting
const apiLimiter  = rateLimit({ windowMs: 15*60*1000, max: 300, message: { error: '요청이 너무 많습니다.' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20,  message: { error: '로그인 시도가 너무 많습니다.' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/login',       authLimiter);
app.use('/api/auth/admin/login', authLimiter);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 포트 먼저 열기 (헬스체크 통과용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🏦 DANGUN 서버 시작: http://0.0.0.0:${PORT}\n`);

  // ── DB 초기화 (서버 기동 후 실행) ──
  try {
    const { initDb } = require('./database/db');
    await initDb();
    console.log('✅ DB 연결 완료');
  } catch (e) {
    console.error('❌ DB 연결 오류:', e.message);
  }

  // ── 마이그레이션 ──
  try {
    const migrate = require('./database/migrate');
    await migrate();
    console.log('✅ DB 마이그레이션 완료');
  } catch (e) {
    console.error('❌ 마이그레이션 오류:', e.message);
  }

  // ── 스케줄러 ──
  try {
    const { checkAndRun } = require('./scheduler');
    setInterval(checkAndRun, 60 * 1000);
    await checkAndRun();
    console.log('✅ 스케줄러 시작');
  } catch (e) {
    console.error('❌ 스케줄러 오류:', e.message);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API Routes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.use('/api/auth',        require('./api/routes/auth'));
app.use('/api/admin',       require('./api/routes/admin'));
app.use('/api/members',     require('./api/routes/members'));
app.use('/api/investments', require('./api/routes/investments'));
app.use('/api/withdrawals', require('./api/routes/withdrawals'));
app.use('/api/commissions', require('./api/routes/commissions'));
app.use('/api/dashboard',   require('./api/routes/dashboard'));
app.use('/api/backup',      require('./api/routes/backup'));
app.use('/api/settings',    require('./api/routes/settings'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 정적 파일 & SPA Fallback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.use(express.static(path.join(__dirname, '.')));

app.get('/member/*', (req, res) => {
  const file = path.join(__dirname, req.path.endsWith('.html') ? req.path : req.path + '.html');
  res.sendFile(fs.existsSync(file) ? file : path.join(__dirname, 'member/index.html'));
});
app.get('/admin/*', (req, res) => {
  const file = path.join(__dirname, req.path.endsWith('.html') ? req.path : req.path + '.html');
  res.sendFile(fs.existsSync(file) ? file : path.join(__dirname, 'admin/dashboard.html'));
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 404 & 에러 핸들러
app.use('/api/*', (req, res) => res.status(404).json({ error: `API 경로 없음: ${req.path}` }));
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  res.status(500).json({ error: '서버 오류', detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

module.exports = app;
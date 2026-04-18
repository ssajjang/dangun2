'use strict';
/**
 * DANGUN 금융플랫폼 - DB 초기화
 * npm run db:reset 으로 실행
 * ⚠️ 모든 데이터가 삭제됩니다!
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database/dangun.db';

async function resetDb() {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('⚠️  모든 데이터가 삭제됩니다. 계속하려면 "RESET"을 입력하세요: ', ans => {
      rl.close();
      if (ans.trim() !== 'RESET') {
        console.log('취소됨.');
        process.exit(0);
      }
      resolve();
    });
  });

  if (fs.existsSync(DB_PATH)) {
    // 백업 생성
    const backup = DB_PATH.replace('.db', `_backup_${Date.now()}.db`);
    fs.copyFileSync(DB_PATH, backup);
    console.log(`💾 백업 생성: ${backup}`);

    fs.unlinkSync(DB_PATH);
    console.log('🗑️  DB 파일 삭제 완료');
  }

  // 재생성
  const migrate = require('./migrate');
  migrate();
  console.log('✅ DB 초기화 완료 (관리자 계정만 존재)');
}

resetDb().catch(console.error);

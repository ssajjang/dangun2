'use strict';
/**
 * DANGUN - DB 싱글톤 (sqlite3 + sqlite Promise 래퍼)
 * better-sqlite3 대신 sqlite3 사용 (네이티브 빌드 불필요)
 */
const path    = require('path');
const fs      = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dangun.db');
const dbDir   = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let _db = null;

async function getDb() {
  if (!_db) {
    _db = await open({
      filename: path.resolve(DB_PATH),
      driver: sqlite3.Database,
    });
    await _db.exec('PRAGMA journal_mode = WAL');
    await _db.exec('PRAGMA foreign_keys = ON');
    await _db.exec('PRAGMA busy_timeout = 5000');
  }
  return _db;
}

// 동기처럼 쓸 수 있는 래퍼 - 이미 열린 DB 반환 (초기화 후 사용)
let _dbSync = null;
function getDbSync() {
  if (!_dbSync) throw new Error('DB가 아직 초기화되지 않았습니다. initDb()를 먼저 호출하세요.');
  return _dbSync;
}

async function initDb() {
  _dbSync = await getDb();
  return _dbSync;
}

module.exports = { getDb, getDbSync, initDb };

#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  DANGUN 금융플랫폼 - 원클릭 서버 설치 스크립트
#  지원 OS: Ubuntu 20.04 / 22.04 / 24.04 LTS
#  실행: curl -fsSL https://your-domain/install.sh | bash
#        또는: bash install.sh
# ════════════════════════════════════════════════════════════════

set -e

# ── 색상 정의 ─────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── 배너 ──────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       🏦 DANGUN 금융플랫폼               ║"
echo "  ║       원클릭 서버 설치 스크립트           ║"
echo "  ║       Node.js + SQLite3 + Nginx           ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── 루트 확인 ─────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ 루트(root) 권한으로 실행해야 합니다.${NC}"
  echo -e "   ${YELLOW}sudo bash install.sh${NC}"
  exit 1
fi

# ── 변수 설정 ─────────────────────────────────
APP_DIR="/opt/dangun"
APP_USER="dangun"
NODE_VERSION="20"
DOMAIN=""
JWT_SECRET=$(openssl rand -base64 48 | tr -d "=+/" | cut -c1-64)
ADMIN_PW="Admin$(openssl rand -base64 6 | tr -d '=+/')1!"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}설정 입력${NC} (Enter 키: 기본값 사용)"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 도메인 입력
read -p "🌐 도메인 또는 서버 IP (예: dangun.com 또는 123.456.789.0): " input_domain
DOMAIN=${input_domain:-$(curl -s ifconfig.me 2>/dev/null || echo "localhost")}

# 포트 입력
read -p "🔌 포트 번호 [기본값: 3000]: " input_port
PORT=${input_port:-3000}

# 관리자 ID 입력
read -p "👤 관리자 ID [기본값: superadmin]: " input_admin_id
ADMIN_ID=${input_admin_id:-superadmin}

# 관리자 이름 입력
read -p "📝 관리자 이름 [기본값: 최고관리자]: " input_admin_name
ADMIN_NAME=${input_admin_name:-최고관리자}

# 관리자 이메일 입력
read -p "📧 관리자 이메일 [기본값: admin@dangun.com]: " input_admin_email
ADMIN_EMAIL=${input_admin_email:-admin@dangun.com}

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}설치 설정 확인${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  📁 설치 경로:    ${GREEN}${APP_DIR}${NC}"
echo -e "  🌐 도메인/IP:    ${GREEN}${DOMAIN}${NC}"
echo -e "  🔌 포트:         ${GREEN}${PORT}${NC}"
echo -e "  👤 관리자 ID:    ${GREEN}${ADMIN_ID}${NC}"
echo -e "  🔑 관리자 PW:    ${YELLOW}${ADMIN_PW}${NC} (자동 생성, 저장 필수!)"
echo -e "  📧 관리자 이메일: ${GREEN}${ADMIN_EMAIL}${NC}"
echo ""
read -p "계속 진행하시겠습니까? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}설치가 취소되었습니다.${NC}"
  exit 0
fi

# ── 함수 정의 ─────────────────────────────────
log_step() {
  echo ""
  echo -e "${CYAN}▶ $1${NC}"
}

log_ok() {
  echo -e "  ${GREEN}✅ $1${NC}"
}

log_warn() {
  echo -e "  ${YELLOW}⚠️  $1${NC}"
}

# ══════════════════════════════════════════════
# STEP 1: 시스템 패키지 업데이트
# ══════════════════════════════════════════════
log_step "시스템 패키지 업데이트 중..."
apt-get update -qq
apt-get install -y -qq curl wget git unzip nginx openssl ufw
log_ok "시스템 패키지 설치 완료"

# ══════════════════════════════════════════════
# STEP 2: Node.js 설치
# ══════════════════════════════════════════════
log_step "Node.js ${NODE_VERSION} LTS 설치 중..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
  log_ok "Node.js $(node -v) 설치 완료"
else
  log_ok "Node.js $(node -v) 이미 설치됨"
fi

# ══════════════════════════════════════════════
# STEP 3: 앱 사용자 생성
# ══════════════════════════════════════════════
log_step "앱 사용자(${APP_USER}) 생성 중..."
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -m -d ${APP_DIR} -s /bin/bash ${APP_USER}
  log_ok "사용자 ${APP_USER} 생성됨"
else
  log_ok "사용자 ${APP_USER} 이미 존재함"
fi

# ══════════════════════════════════════════════
# STEP 4: 앱 디렉토리 구성
# ══════════════════════════════════════════════
log_step "앱 디렉토리 구성 중..."
mkdir -p ${APP_DIR}/{database,logs,nginx/ssl}

# 현재 디렉토리 파일을 앱 폴더로 복사 (install.sh 실행 위치가 프로젝트 루트인 경우)
if [ -f "./server.js" ]; then
  cp -r ./* ${APP_DIR}/ 2>/dev/null || true
  cp -r ./.env.example ${APP_DIR}/ 2>/dev/null || true
  log_ok "프로젝트 파일 복사 완료"
else
  log_warn "server.js 없음 - 수동으로 파일을 ${APP_DIR}에 복사하세요"
fi

chown -R ${APP_USER}:${APP_USER} ${APP_DIR}
chmod 755 ${APP_DIR}
log_ok "권한 설정 완료"

# ══════════════════════════════════════════════
# STEP 5: 환경변수 파일 생성
# ══════════════════════════════════════════════
log_step ".env 파일 자동 생성 중..."
cat > ${APP_DIR}/.env << EOF
# ════════════════════════════════════════════
#  DANGUN 금융플랫폼 환경변수 (자동 생성됨)
#  생성일: $(date '+%Y-%m-%d %H:%M:%S')
# ════════════════════════════════════════════

NODE_ENV=production
PORT=${PORT}
DB_PATH=${APP_DIR}/database/dangun.db

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

ADMIN_ID=${ADMIN_ID}
ADMIN_PASSWORD=${ADMIN_PW}
ADMIN_NAME=${ADMIN_NAME}
ADMIN_EMAIL=${ADMIN_EMAIL}

SCHEDULER_ENABLED=true
LOG_LEVEL=info
EOF

chmod 600 ${APP_DIR}/.env
chown ${APP_USER}:${APP_USER} ${APP_DIR}/.env
log_ok ".env 파일 생성됨 (권한 600)"

# ══════════════════════════════════════════════
# STEP 6: npm 패키지 설치
# ══════════════════════════════════════════════
log_step "npm 패키지 설치 중... (약 1~2분 소요)"
cd ${APP_DIR}
if [ -f "package.json" ]; then
  sudo -u ${APP_USER} npm install --omit=dev --silent
  log_ok "npm 패키지 설치 완료"
else
  log_warn "package.json 없음 - 파일 복사 후 npm install 수동 실행 필요"
fi

# ══════════════════════════════════════════════
# STEP 7: PM2 설치 및 설정
# ══════════════════════════════════════════════
log_step "PM2 프로세스 매니저 설치 중..."
npm install -g pm2 --silent
log_ok "PM2 설치 완료"

# PM2 ecosystem 파일 생성
cat > ${APP_DIR}/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'dangun-platform',
    script: 'server.js',
    cwd: '/opt/dangun',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '512M',
    env_file: '/opt/dangun/.env',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/opt/dangun/logs/error.log',
    out_file: '/opt/dangun/logs/out.log',
    log_file: '/opt/dangun/logs/combined.log',
    time: true,
    restart_delay: 3000,
    max_restarts: 10
  }]
};
EOF

chown ${APP_USER}:${APP_USER} ${APP_DIR}/ecosystem.config.js
log_ok "PM2 ecosystem 설정 완료"

# ══════════════════════════════════════════════
# STEP 8: systemd 서비스 등록 (PM2 부팅 자동 시작)
# ══════════════════════════════════════════════
log_step "systemd 서비스 등록 중..."
pm2 startup systemd -u ${APP_USER} --hp ${APP_DIR} 2>/dev/null | tail -1 | bash 2>/dev/null || true

# 앱 시작
cd ${APP_DIR}
if [ -f "server.js" ]; then
  sudo -u ${APP_USER} pm2 start ecosystem.config.js
  sudo -u ${APP_USER} pm2 save
  log_ok "PM2 서비스 시작 완료"
fi

# ══════════════════════════════════════════════
# STEP 9: Nginx 설정
# ══════════════════════════════════════════════
log_step "Nginx 리버스 프록시 설정 중..."
cat > /etc/nginx/sites-available/dangun << EOF
# DANGUN 금융플랫폼 Nginx 설정
upstream dangun_app {
    server 127.0.0.1:${PORT};
    keepalive 32;
}

# HTTP → HTTPS 리다이렉트 (SSL 설정 후 주석 해제)
# server {
#     listen 80;
#     server_name ${DOMAIN};
#     return 301 https://\$host\$request_uri;
# }

server {
    listen 80;
    server_name ${DOMAIN};
    
    # 업로드 크기 제한
    client_max_body_size 10M;
    
    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    
    # Gzip 압축
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;
    
    # 정적 파일 캐싱
    location ~* \.(css|js|png|jpg|gif|ico|woff2?)$ {
        proxy_pass http://dangun_app;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    
    # API 프록시
    location /api/ {
        proxy_pass http://dangun_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
    
    # 모든 요청 프록시
    location / {
        proxy_pass http://dangun_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    # 헬스체크
    location /api/health {
        proxy_pass http://dangun_app;
        access_log off;
    }
    
    # 로그
    access_log /opt/dangun/logs/nginx-access.log;
    error_log  /opt/dangun/logs/nginx-error.log;
}
EOF

# 기본 설정 비활성화, dangun 설정 활성화
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/dangun /etc/nginx/sites-enabled/dangun

# Nginx 설정 테스트 및 재시작
nginx -t && systemctl reload nginx
systemctl enable nginx
log_ok "Nginx 설정 완료"

# ══════════════════════════════════════════════
# STEP 10: UFW 방화벽 설정
# ══════════════════════════════════════════════
log_step "방화벽(UFW) 설정 중..."
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow ssh >/dev/null 2>&1
ufw allow 80/tcp >/dev/null 2>&1
ufw allow 443/tcp >/dev/null 2>&1
ufw --force enable >/dev/null 2>&1
log_ok "방화벽 설정 완료 (22, 80, 443 허용)"

# ══════════════════════════════════════════════
# STEP 11: 설치 결과 저장
# ══════════════════════════════════════════════
INSTALL_INFO="${APP_DIR}/INSTALL_INFO.txt"
cat > ${INSTALL_INFO} << EOF
════════════════════════════════════════════════
  DANGUN 금융플랫폼 설치 정보
  설치일시: $(date '+%Y-%m-%d %H:%M:%S')
════════════════════════════════════════════════

[서버 접속 URL]
  http://${DOMAIN}/

[관리자 계정]
  URL: http://${DOMAIN}/admin/dashboard.html
  ID : ${ADMIN_ID}
  PW : ${ADMIN_PW}

[회원 로그인]
  URL: http://${DOMAIN}/

[주요 경로]
  앱 폴더: ${APP_DIR}
  환경변수: ${APP_DIR}/.env
  DB 파일: ${APP_DIR}/database/dangun.db
  로그:    ${APP_DIR}/logs/

[관리 명령어]
  상태 확인: pm2 status
  로그 보기: pm2 logs dangun-platform
  재시작:   pm2 restart dangun-platform
  중지:     pm2 stop dangun-platform

[테스트 데이터 생성]
  cd ${APP_DIR} && node database/seed.js

[DB 초기화 (주의)]
  cd ${APP_DIR} && node database/reset.js

[수동 스케줄러 실행]
  cd ${APP_DIR} && node scheduler.js --now

════════════════════════════════════════════════
  ⚠️  이 파일을 안전한 곳에 보관하세요!
════════════════════════════════════════════════
EOF

chmod 600 ${INSTALL_INFO}
log_ok "설치 정보 저장됨: ${INSTALL_INFO}"

# ══════════════════════════════════════════════
# 완료 메시지
# ══════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       ✅ 설치 완료!                      ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${BOLD}🌐 접속 URL:${NC}"
echo -e "   메인:     ${CYAN}http://${DOMAIN}/${NC}"
echo -e "   관리자:   ${CYAN}http://${DOMAIN}/admin/dashboard.html${NC}"
echo ""
echo -e "${BOLD}👤 관리자 계정:${NC}"
echo -e "   ID: ${GREEN}${ADMIN_ID}${NC}"
echo -e "   PW: ${YELLOW}${ADMIN_PW}${NC}"
echo ""
echo -e "${BOLD}📋 유용한 명령어:${NC}"
echo -e "   ${CYAN}pm2 status${NC}                        # 프로세스 상태"
echo -e "   ${CYAN}pm2 logs dangun-platform${NC}          # 실시간 로그"
echo -e "   ${CYAN}pm2 restart dangun-platform${NC}       # 재시작"
echo -e "   ${CYAN}node ${APP_DIR}/scheduler.js --now${NC} # 즉시 지급 실행"
echo ""
echo -e "${YELLOW}⚠️  보안 필수 사항:${NC}"
echo -e "   1. 관리자 비밀번호 즉시 변경"
echo -e "   2. SSL 인증서 설정: ${CYAN}certbot --nginx -d ${DOMAIN}${NC}"
echo -e "   3. 설치 정보 보관: ${CYAN}cat ${INSTALL_INFO}${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

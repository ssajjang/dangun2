/**
 * DANGUN 금융플랫폼 - 공통 JavaScript
 * theme, toast, sidebar, formatting, API helpers
 * ※ 'use strict' 제거: api.js와 동일 전역 스코프에서 로드되어 const 재선언 충돌 방지
 */

// ============================================================
// Theme Management
// ============================================================
const THEME_KEY = 'dangun_theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  const btn = document.getElementById('theme-btn');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');

  if (theme === 'dark') {
    if (icon) icon.className = 'fas fa-moon';
    if (label) label.textContent = '라이트';
  } else {
    if (icon) icon.className = 'fas fa-sun';
    if (label) label.textContent = '다크';
  }
}

function toggleTheme() {
  const current = getTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// Apply theme on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getTheme());
  initSidebar();
  animateOnScroll();
  initParticles();
});

// ============================================================
// Toast Notifications
// ============================================================
let toastTimer = null;

function showToast(message, type = 'info', duration = 3500) {
  // 방어 코드: 메시지가 객체형태로 넘어오는 오류 방지
  if (typeof message !== 'string') {
    message = (message && message.message) ? message.message : String(message);
  }

  const container = document.getElementById('toast-container');
  // toast-container가 없을 경우 body에 강제로 추가 (화면에 에러가 안나타나는 현상 방지)
  let targetContainer = container;
  if (!targetContainer) {
    targetContainer = document.createElement('div');
    targetContainer.id = 'toast-container';
    document.body.appendChild(targetContainer);
  }

  const icons = {
    success: '✅',
    error:   '❌',
    warning: '⚠️',
    info:    'ℹ️',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="font-size:16px;">${icons[type] || 'ℹ️'}</span>
    <span style="flex:1;">${message}</span>
    <span onclick="this.closest('.toast').remove()" style="cursor:pointer;opacity:0.5;font-size:12px;">✕</span>
  `;

  targetContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 400);
  }, duration);
}

// ============================================================
// Sidebar Toggle (Mobile)
// ============================================================
function initSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.getElementById('sidebar-toggle');

  if (!sidebar) return;

  if (toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Close on outside click
  document.addEventListener('click', e => {
    if (sidebar.classList.contains('mobile-open') &&
        !sidebar.contains(e.target) &&
        e.target !== toggle) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

// ============================================================
// Number Formatting
// ============================================================
function formatMoney(amount, currency = '원') {
  if (amount === null || amount === undefined) return '-';
  return Math.round(Number(amount) || 0).toLocaleString('ko-KR') + currency;
}

function formatMoneyK(amount) {
  const v = Math.round(Number(amount) || 0);
  if (v >= 100000000) return Math.round(v / 100000000 * 10) / 10 + '억';
  if (v >= 10000)     return Math.round(v / 10000) + '만원';
  return Math.round(v).toLocaleString('ko-KR') + '원';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${formatDate(dateStr)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatPercent(val) {
  return Number(val).toFixed(1) + '%';
}

// ============================================================
// Status Badge Helpers
// ============================================================
function statusBadge(status) {
  const map = {
    active:    { label: '활성', cls: 'badge-green' },
    inactive:  { label: '미활성', cls: 'badge-blue' },
    suspended: { label: '정지', cls: 'badge-red' },
    pending:   { label: '대기', cls: 'badge-orange' },
    approved:  { label: '승인', cls: 'badge-blue' },
    paid:      { label: '지급완료', cls: 'badge-green' },
    rejected:  { label: '거절', cls: 'badge-red' },
    cancelled: { label: '취소', cls: 'badge-red' },
    completed: { label: '완료', cls: 'badge-purple' },
  };
  const s = map[status] || { label: status, cls: 'badge-blue' };
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function rankBadge(rank) {
  const map = {
    '일반회원': 'badge-blue',
    '팀장':     'badge-gold',
    '본부장':   'badge-purple',
  };
  return `<span class="badge ${map[rank] || 'badge-blue'}">${rank}</span>`;
}

// ============================================================
// Scroll Animation (IntersectionObserver)
// ============================================================
function animateOnScroll() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.anim-on-scroll').forEach(el => {
    el.classList.remove('visible');
    observer.observe(el);
  });
}

// ============================================================
// Counter Animation (숫자 카운트업)
// ============================================================
function animateCounter(el, target, duration = 1500, prefix = '', suffix = '') {
  const start = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(eased * target);
    el.textContent = prefix + current.toLocaleString('ko-KR') + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function initCounters() {
  document.querySelectorAll('[data-counter]').forEach(el => {
    const target = parseInt(el.dataset.counter);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    animateCounter(el, target, 1500, prefix, suffix);
  });
}

// ============================================================
// Particle Background
// ============================================================
function initParticles() {
  const container = document.querySelector('.particle-bg');
  if (!container) return;

  for (let i = 0; i < 15; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      bottom: -10px;
      width: ${Math.random() * 4 + 2}px;
      height: ${Math.random() * 4 + 2}px;
      animation-duration: ${Math.random() * 12 + 8}s;
      animation-delay: ${Math.random() * 8}s;
    `;
    container.appendChild(p);
  }
}

// ============================================================
// Modal Helpers
// ============================================================
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ============================================================
// Pagination Helper
// ============================================================
function renderPagination(containerId, total, current, limit, onPage) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  const prev = current > 1 ? current - 1 : 1;
  const next = current < totalPages ? current + 1 : totalPages;

  html += `<button class="page-btn" onclick="(${onPage})(${prev})"><i class="fas fa-chevron-left"></i></button>`;

  let start = Math.max(1, current - 2);
  let end   = Math.min(totalPages, current + 2);

  if (start > 1) html += `<button class="page-btn" onclick="(${onPage})(1)">1</button>`;
  if (start > 2) html += `<span style="padding:0 4px;color:var(--text-muted);">…</span>`;

  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="(${onPage})(${i})">${i}</button>`;
  }

  if (end < totalPages - 1) html += `<span style="padding:0 4px;color:var(--text-muted);">…</span>`;
  if (end < totalPages) html += `<button class="page-btn" onclick="(${onPage})(${totalPages})">${totalPages}</button>`;

  html += `<button class="page-btn" onclick="(${onPage})(${next})"><i class="fas fa-chevron-right"></i></button>`;
  html += `<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${total}건 / ${totalPages}페이지</span>`;

  container.innerHTML = html;
}

// ============================================================
// Logout (레거시 호환 - doLogout()으로 위임)
// ============================================================
function logout() {
  localStorage.removeItem('dangun_token');
  localStorage.removeItem('dangun_user');
  localStorage.removeItem('dangun_admin');
  window.location.replace('/index.html');
}

// ============================================================
// Week Progress Bar
// ============================================================
function renderWeekProgress(current, total) {
  const pct = Math.round((current / total) * 100);
  return `
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="progress-bar-wrapper" style="flex:1;">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:var(--accent-gold);white-space:nowrap;">
        ${current}/${total}주
      </span>
    </div>
  `;
}
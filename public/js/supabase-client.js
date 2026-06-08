// ================================================================
// supabase-client.js — Supabase 클라이언트 초기화 (모든 페이지 공유)
// 환경변수는 Netlify Functions를 통해 서버에서 처리
// 클라이언트에서는 PUBLIC 키만 사용
// ================================================================

const SUPABASE_URL = 'https://mvqzdyvoggvxyddhowhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12cXpkeXZvZ2d2eHlkZGhvd2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMzk4MzQsImV4cCI6MjA5NTYxNTgzNH0.yRZO1aPt1AG7b1i0MLb9KxU0T2iLgpxY3QAxfJmjMFU';

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

// 전역 toast 유틸리티
function showToast(message, type = 'info', duration = 3500) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// 날짜 포맷 유틸
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// 플랜 한글 표기
function planLabel(plan) {
  const map = { free: 'Free', starter: 'Starter', pro: 'Pro' };
  return map[plan] || 'Free';
}

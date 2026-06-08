// ================================================================
// auth.js — 인증 모달, 네비게이션, 세션 관리 (모든 페이지 공유)
// ================================================================

let currentUser = null;
let currentProfile = null;

// ── 초기화 ──────────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    currentProfile = await fetchProfile(currentUser.id);
  }

  renderNav();
  setupModalHandlers();

  // 세션 변경 감지 (소셜 로그인 콜백 등)
  _supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      // 신규 유저 → DB 프로필 생성
      await ensureProfile(currentUser);
      currentProfile = await fetchProfile(currentUser.id);
      renderNav();
      closeModal();
      if (typeof onAuthSignIn === 'function') onAuthSignIn(currentUser, currentProfile);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      renderNav();
      if (typeof onAuthSignOut === 'function') onAuthSignOut();
    }
  });
}

// ── 프로필 조회 ─────────────────────────────────────────────────
async function fetchProfile(userId) {
  const { data, error } = await _supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

// ── 신규 유저 프로필 생성 ────────────────────────────────────────
async function ensureProfile(user) {
  const { data: existing } = await _supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .single();

  if (!existing) {
    await _supabase.from('users').insert({
      id: user.id,
      email: user.email,
      plan: 'free',
      daily_usage: 0,
      total_usage: 0,
      usage_reset_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }
}

// ── 네비게이션 렌더 ─────────────────────────────────────────────
function renderNav() {
  const nav = document.getElementById('navRight');
  if (!nav) return;

  if (currentUser && currentProfile) {
    const plan = currentProfile.plan || 'free';
    nav.innerHTML = `
      <div class="nav-user-info">
        <span class="plan-chip ${plan}">${planLabel(plan)}</span>
        <a href="/pages/dashboard.html" class="btn-nav-ghost">대시보드</a>
        ${currentProfile.is_admin ? '<a href="/pages/admin.html" class="btn-nav-ghost">관리자</a>' : ''}
        <button class="btn-nav-ghost" id="navLogout">로그아웃</button>
      </div>
    `;
    document.getElementById('navLogout').addEventListener('click', handleLogout);
  } else {
    nav.innerHTML = `
      <a href="/pages/pricing.html" class="btn-nav-ghost">요금제</a>
      <button class="btn-nav-ghost" id="navLogin" onclick="openModal('login')">로그인</button>
      <button class="btn-nav-primary" onclick="openModal('signup')">무료 시작</button>
    `;
  }
}

// ── 모달 핸들러 ─────────────────────────────────────────────────
function setupModalHandlers() {
  const overlay = document.getElementById('authModal');
  const closeBtn = document.getElementById('modalClose');
  if (!overlay) return;

  closeBtn?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openModal(mode = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  renderAuthContent(mode);
}

function closeModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

// ── 인증 폼 렌더 ────────────────────────────────────────────────
function renderAuthContent(mode) {
  const content = document.getElementById('authContent');
  if (!content) return;

  if (mode === 'login') {
    content.innerHTML = `
      <h2 class="auth-title">로그인</h2>
      <p class="auth-sub">Contenty에 다시 오신 걸 환영해요 👋</p>
      <div id="authMsg"></div>
      <div class="auth-form">
        <input class="auth-input" type="email" id="authEmail" placeholder="이메일" autocomplete="email" />
        <input class="auth-input" type="password" id="authPassword" placeholder="비밀번호" autocomplete="current-password" />
        <button class="btn-auth-primary" id="authSubmitBtn">로그인</button>
        <div class="auth-divider">또는</div>
        <button class="btn-google" id="googleLoginBtn">
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/><path fill="#FBBC05" d="M4.5 10.51a4.8 4.8 0 010-3.02V5.42H1.83a8 8 0 000 7.16l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.42L4.5 7.49a4.77 4.77 0 014.48-3.31z"/></svg>
          Google로 로그인
        </button>
        <p class="auth-switch">계정이 없으신가요? <button onclick="renderAuthContent('signup')">회원가입</button></p>
      </div>
    `;
  } else {
    content.innerHTML = `
      <h2 class="auth-title">회원가입</h2>
      <p class="auth-sub">무료로 시작해보세요. 카드 없이도 OK!</p>
      <div id="authMsg"></div>
      <div class="auth-form">
        <input class="auth-input" type="email" id="authEmail" placeholder="이메일" autocomplete="email" />
        <input class="auth-input" type="password" id="authPassword" placeholder="비밀번호 (8자 이상)" autocomplete="new-password" />
        <input class="auth-input" type="password" id="authPasswordConfirm" placeholder="비밀번호 확인" autocomplete="new-password" />
        <button class="btn-auth-primary" id="authSubmitBtn">회원가입</button>
        <div class="auth-divider">또는</div>
        <button class="btn-google" id="googleLoginBtn">
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/><path fill="#FBBC05" d="M4.5 10.51a4.8 4.8 0 010-3.02V5.42H1.83a8 8 0 000 7.16l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.42L4.5 7.49a4.77 4.77 0 014.48-3.31z"/></svg>
          Google로 시작하기
        </button>
        <p class="auth-switch">이미 계정이 있으신가요? <button onclick="renderAuthContent('login')">로그인</button></p>
      </div>
    `;
  }

  // 이벤트 바인딩
  document.getElementById('authSubmitBtn').addEventListener('click', () => {
    mode === 'login' ? handleEmailLogin() : handleEmailSignup();
  });
  document.getElementById('googleLoginBtn').addEventListener('click', handleGoogleLogin);

  // 엔터 키 제출
  ['authEmail', 'authPassword', 'authPasswordConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        mode === 'login' ? handleEmailLogin() : handleEmailSignup();
      }
    });
  });
}

// ── 인증 함수들 ─────────────────────────────────────────────────
function setAuthMsg(msg, type = 'error') {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.innerHTML = `<div class="auth-${type}">${msg}</div>`;
}

function setAuthLoading(loading) {
  const btn = document.getElementById('authSubmitBtn');
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>처리 중...';
  } else {
    btn.disabled = false;
    btn.textContent = btn.closest('.auth-form')?.querySelector('[id="authPasswordConfirm"]') ? '회원가입' : '로그인';
  }
}

async function handleEmailLogin() {
  const email = document.getElementById('authEmail')?.value?.trim();
  const password = document.getElementById('authPassword')?.value;
  if (!email || !password) { setAuthMsg('이메일과 비밀번호를 입력해주세요.'); return; }

  setAuthLoading(true);
  const { error } = await _supabase.auth.signInWithPassword({ email, password });
  setAuthLoading(false);

  if (error) {
    if (error.message.includes('Invalid login credentials')) {
      setAuthMsg('이메일 또는 비밀번호가 올바르지 않습니다.');
    } else {
      setAuthMsg(error.message);
    }
  }
  // 성공 시 onAuthStateChange가 처리
}

async function handleEmailSignup() {
  const email = document.getElementById('authEmail')?.value?.trim();
  const password = document.getElementById('authPassword')?.value;
  const confirm = document.getElementById('authPasswordConfirm')?.value;

  if (!email || !password) { setAuthMsg('이메일과 비밀번호를 입력해주세요.'); return; }
  if (password.length < 8) { setAuthMsg('비밀번호는 8자 이상이어야 합니다.'); return; }
  if (password !== confirm) { setAuthMsg('비밀번호가 일치하지 않습니다.'); return; }

  setAuthLoading(true);
  const { error } = await _supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin }
  });
  setAuthLoading(false);

  if (error) {
    setAuthMsg(error.message);
  } else {
    setAuthMsg('가입 확인 이메일을 보냈어요! 이메일을 확인해주세요.', 'success');
  }
}

async function handleGoogleLogin() {
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) setAuthMsg(error.message);
}

async function handleLogout() {
  await _supabase.auth.signOut();
  showToast('로그아웃되었습니다.', 'info');
  setTimeout(() => { window.location.href = '/'; }, 500);
}

// ── 자동 실행 ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initAuth);

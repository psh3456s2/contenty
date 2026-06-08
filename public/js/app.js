// ================================================================
// app.js — 메인 페이지 콘텐츠 생성 로직 + 사용량 체크
// ================================================================

const DAILY_LIMITS = { free: 10, starter: 200, pro: Infinity };

// ── 페이지 초기화 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadKeys();
  setupKeyToggle('claudeKey', 'toggleClaude');
  setupKeyToggle('openaiKey', 'toggleOpenAI');
  setupKeyInputListeners();
  setupTabs();

  document.getElementById('generateBtn').addEventListener('click', handleGenerate);
});

// auth.js 콜백 — 로그인 완료 시 호출
function onAuthSignIn(user, profile) {
  renderUsageBanner(profile);
}
function onAuthSignOut() {
  document.getElementById('usageBanner')?.classList.add('hidden');
}

// ── 사용량 배너 ─────────────────────────────────────────────────
function renderUsageBanner(profile) {
  const banner = document.getElementById('usageBanner');
  const text = document.getElementById('usageText');
  if (!banner || !profile) return;

  const plan = profile.plan || 'free';
  const usage = profile.daily_usage || 0;
  const limit = DAILY_LIMITS[plan];

  banner.classList.remove('hidden');

  if (plan === 'pro') {
    text.textContent = `✦ Pro 플랜 — 오늘 ${usage}회 생성 (무제한)`;
    banner.style.borderColor = 'rgba(167,139,250,0.4)';
  } else {
    const remaining = Math.max(0, limit - usage);
    text.textContent = `오늘 남은 생성 횟수: ${remaining}/${limit}회`;
    if (remaining <= 2) banner.style.borderColor = 'rgba(248,113,113,0.5)';
  }
}

// ── API 키 저장/로드 ────────────────────────────────────────────
function loadKeys() {
  const claudeKey = localStorage.getItem('contenty_claude_key');
  const openaiKey = localStorage.getItem('contenty_openai_key');
  const claudeInput = document.getElementById('claudeKey');
  const openaiInput = document.getElementById('openaiKey');
  const claudeHint = document.getElementById('claudeHint');
  const openaiHint = document.getElementById('openaiHint');

  if (claudeKey) {
    claudeInput.value = claudeKey;
    claudeHint.innerHTML = '✅ Claude API 키가 저장되어 있어요.';
    claudeHint.style.color = 'var(--green)';
  }
  if (openaiKey) {
    openaiInput.value = openaiKey;
    openaiHint.innerHTML = '✅ OpenAI API 키가 저장되어 있어요.';
    openaiHint.style.color = 'var(--green)';
  }
}

function setupKeyInputListeners() {
  document.getElementById('claudeKey').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val) {
      localStorage.setItem('contenty_claude_key', val);
      const hint = document.getElementById('claudeHint');
      hint.textContent = '✅ 저장됨';
      hint.style.color = 'var(--green)';
    }
  });
  document.getElementById('openaiKey').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val) {
      localStorage.setItem('contenty_openai_key', val);
      const hint = document.getElementById('openaiHint');
      hint.textContent = '✅ 저장됨';
      hint.style.color = 'var(--green)';
    }
  });
}

function setupKeyToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '숨기기' : '보기';
  });
}

// ── 탭 ──────────────────────────────────────────────────────────
const TABS = ['card', 'blog', 'cafe', 'insta', 'thread'];
let generatedResults = {};

function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderTabContent(btn.dataset.tab);
    });
  });
}

function renderTabContent(tab) {
  const content = document.getElementById('resultsContent');
  if (!content) return;
  const result = generatedResults[tab];
  if (!result) {
    content.innerHTML = `<p style="color:var(--text2)">아직 생성되지 않았어요.</p>`;
    return;
  }
  if (tab === 'card' && Array.isArray(result)) {
    content.innerHTML = result.map((card, i) => `
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem;">
        <div style="font-weight:700;margin-bottom:0.5rem;color:var(--accent)">카드 ${i+1}</div>
        ${card.imageUrl ? `<img src="${card.imageUrl}" alt="카드 이미지" style="width:100%;max-width:400px;border-radius:var(--radius-sm);margin-bottom:0.75rem;display:block;" />` : ''}
        <p>${card.text || ''}</p>
      </div>
    `).join('');
  } else {
    content.innerHTML = `<p style="white-space:pre-wrap">${result}</p>`;
  }
}

// ── 생성 핸들러 ─────────────────────────────────────────────────
async function handleGenerate() {
  const btn = document.getElementById('generateBtn');
  const topic = document.getElementById('topicInput').value.trim();

  if (!topic) { showToast('주제를 입력해주세요.', 'error'); return; }

  const claudeKey = document.getElementById('claudeKey').value.trim();
  if (!claudeKey) { showToast('Claude API 키를 먼저 입력해주세요.', 'error'); return; }

  // ── 사용량 체크 ────────────────────────────────────────────────
  if (currentUser && currentProfile) {
    const plan = currentProfile.plan || 'free';
    const usage = await checkAndResetDailyUsage();
    const limit = DAILY_LIMITS[plan];
    if (usage >= limit) {
      showToast(`오늘 생성 횟수(${limit}회)를 모두 사용했어요.`, 'error');
      setTimeout(() => { window.location.href = '/pages/pricing.html'; }, 1200);
      return;
    }
  } else if (!currentUser) {
    // 비로그인 사용자 → 로그인 유도
    showToast('로그인 후 이용해주세요.', 'info');
    openModal('login');
    return;
  }

  // ── 생성 시작 ─────────────────────────────────────────────────
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>생성 중...';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsContent').innerHTML = '<p style="color:var(--text2)">AI가 콘텐츠를 만들고 있어요... ✦</p>';

  try {
    const response = await fetch('/.netlify/functions/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        claudeKey,
        openaiKey: document.getElementById('openaiKey').value.trim(),
        userId: currentUser?.id,
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `서버 오류 (${response.status})`);
    }

    const data = await response.json();
    generatedResults = data.results || {};

    // 사용량 증가
    if (currentUser) {
      await incrementUsage(currentUser.id);
      currentProfile = await fetchProfile(currentUser.id);
      renderUsageBanner(currentProfile);
    }

    // 첫 번째 탭 표시
    const firstTab = TABS[0];
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === firstTab);
    });
    renderTabContent(firstTab);
    showToast('콘텐츠 생성 완료!', 'success');

  } catch (err) {
    document.getElementById('resultsContent').innerHTML = `<p style="color:var(--red)">오류: ${err.message}</p>`;
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ 생성하기';
  }
}

// ── 사용량 유틸 ─────────────────────────────────────────────────
async function checkAndResetDailyUsage() {
  if (!currentProfile) return 0;

  const lastReset = new Date(currentProfile.usage_reset_at || 0);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (lastReset < todayStart) {
    // 날짜가 바뀌었으면 초기화
    await _supabase.from('users').update({
      daily_usage: 0,
      usage_reset_at: todayStart.toISOString()
    }).eq('id', currentUser.id);
    currentProfile.daily_usage = 0;
  }
  return currentProfile.daily_usage || 0;
}

async function incrementUsage(userId) {
  const { data } = await _supabase
    .from('users')
    .select('daily_usage, total_usage')
    .eq('id', userId)
    .single();

  await _supabase.from('users').update({
    daily_usage: (data?.daily_usage || 0) + 1,
    total_usage: (data?.total_usage || 0) + 1,
  }).eq('id', userId);
}

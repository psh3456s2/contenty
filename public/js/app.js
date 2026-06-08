// ================================================================
// app.js — 메인 페이지 콘텐츠 생성 로직 (채널별 개별 생성)
// ================================================================

const DAILY_LIMITS = { free: 10, starter: 200, pro: Infinity };
const TABS = ['card', 'blog', 'cafe', 'insta', 'thread'];
let generatedResults = {};
let currentChannel = 'blog';

document.addEventListener('DOMContentLoaded', () => {
  loadKeys();
  setupKeyToggle('claudeKey', 'toggleClaude');
  setupKeyToggle('openaiKey', 'toggleOpenAI');
  setupKeyInputListeners();
  setupTabs();
  document.getElementById('generateBtn').addEventListener('click', handleGenerate);
});

function onAuthSignIn(user, profile) { renderUsageBanner(profile); }
function onAuthSignOut() { document.getElementById('usageBanner')?.classList.add('hidden'); }

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
  } else {
    const remaining = Math.max(0, limit - usage);
    text.textContent = `오늘 남은 생성 횟수: ${remaining}/${limit}회`;
    if (remaining <= 2) banner.style.borderColor = 'rgba(248,113,113,0.5)';
  }
}

function loadKeys() {
  const claudeKey = localStorage.getItem('contenty_claude_key');
  const openaiKey = localStorage.getItem('contenty_openai_key');
  if (claudeKey) {
    document.getElementById('claudeKey').value = claudeKey;
    const hint = document.getElementById('claudeHint');
    hint.innerHTML = '✅ Claude API 키가 저장되어 있어요.';
    hint.style.color = 'var(--green)';
  }
  if (openaiKey) {
    document.getElementById('openaiKey').value = openaiKey;
    const hint = document.getElementById('openaiHint');
    hint.innerHTML = '✅ OpenAI API 키가 저장되어 있어요.';
    hint.style.color = 'var(--green)';
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

function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      currentChannel = btn.dataset.tab;
      renderTabContent(currentChannel);
    });
  });
}

function renderTabContent(tab) {
  const content = document.getElementById('resultsContent');
  if (!content) return;
  const result = generatedResults[tab];
  if (!result) {
    content.innerHTML = `<p style="color:var(--text2)">이 채널을 선택하고 생성하기 버튼을 눌러주세요.</p>`;
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

async function handleGenerate() {
  const btn = document.getElementById('generateBtn');
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { showToast('주제를 입력해주세요.', 'error'); return; }

  const claudeKey = document.getElementById('claudeKey').value.trim();
  if (!claudeKey) { showToast('Claude API 키를 먼저 입력해주세요.', 'error'); return; }

  if (!currentUser) {
    showToast('로그인 후 이용해주세요.', 'info');
    openModal('login');
    return;
  }

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
        channel: currentChannel,
        openaiKey: document.getElementById('openaiKey').value.trim(),
        userId: currentUser?.id,
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `서버 오류 (${response.status})`);
    }

    const data = await response.json();
    const newResults = data.results || {};
    generatedResults = { ...generatedResults, ...newResults };

    if (currentUser) {
      currentProfile = await fetchProfile(currentUser.id);
      renderUsageBanner(currentProfile);
    }

    renderTabContent(currentChannel);
    showToast('콘텐츠 생성 완료!', 'success');

  } catch (err) {
    document.getElementById('resultsContent').innerHTML = `<p style="color:var(--red)">오류: ${err.message}</p>`;
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ 생성하기';
  }
}

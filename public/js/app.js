// ================================================================
// app.js — 메인 페이지 콘텐츠 생성 로직 (채널별 개별 생성)
// ================================================================

const DAILY_LIMITS = { free: 10, starter: 200, pro: Infinity };
const TABS = ['card', 'blog', 'cafe', 'insta', 'thread'];
let generatedResults = {};
let currentChannel = 'blog';

document.addEventListener('DOMContentLoaded', () => {
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
    // 로그인 토큰 가져오기 (키 대신 토큰을 보냄)
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
      showToast('로그인이 만료되었어요. 다시 로그인해주세요.', 'error');
      openModal('login');
      return;
    }

    const response = await fetch('/.netlify/functions/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        topic,
        channel: currentChannel,
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

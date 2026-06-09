// ================================================================
// app.js — 메인 페이지 콘텐츠 생성 로직 (여러 채널 동시 생성)
// ================================================================

const DAILY_LIMITS = { free: 10, starter: 70, pro: 200 };
const CHANNEL_LABELS = { blog: '✍️ 블로그', cafe: '☕ 카페', insta: '📸 인스타', thread: '🧵 스레드' };
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
  const limit = DAILY_LIMITS[plan] || DAILY_LIMITS.free;
  const remaining = Math.max(0, limit - usage);
  banner.classList.remove('hidden');
  text.textContent = `오늘 남은 생성 횟수: ${remaining}/${limit}회`;
  if (remaining <= 2) banner.style.borderColor = 'rgba(248,113,113,0.5)';
}

// 채널 선택 탭 — 여러 개 동시 선택(토글) 가능
function setupTabs() {
  document.querySelectorAll('.generate-section .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
    });
  });
}

function getSelectedChannels() {
  return Array.from(document.querySelectorAll('.generate-section .tab.active'))
    .map(btn => btn.dataset.tab);
}

async function handleGenerate() {
  const btn = document.getElementById('generateBtn');
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { showToast('주제를 입력해주세요.', 'error'); return; }

  const channels = getSelectedChannels();
  if (channels.length === 0) {
    showToast('채널을 하나 이상 선택해주세요.', 'error');
    return;
  }

  if (!currentUser) {
    showToast('로그인 후 이용해주세요.', 'info');
    openModal('login');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>생성 중...';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsContent').innerHTML = `<p style="color:var(--text2)">AI가 ${channels.length}개 채널 콘텐츠를 만들고 있어요... ✦</p>`;
  document.getElementById('resultTabs').innerHTML = '';

  try {
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
      body: JSON.stringify({ topic, channels })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `서버 오류 (${response.status})`);
    }

    const data = await response.json();
    generatedResults = data.results || {};

    if (currentUser) {
      currentProfile = await fetchProfile(currentUser.id);
      renderUsageBanner(currentProfile);
    }

    renderResultTabs(Object.keys(generatedResults));
    showToast('콘텐츠 생성 완료!', 'success');

  } catch (err) {
    document.getElementById('resultsContent').innerHTML = `<p style="color:var(--red)">오류: ${err.message}</p>`;
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ 생성하기';
  }
}

function renderResultTabs(channels) {
  const tabsEl = document.getElementById('resultTabs');
  if (!tabsEl) return;
  if (channels.length === 0) { tabsEl.innerHTML = ''; return; }

  tabsEl.innerHTML = channels.map((ch, i) =>
    `<button class="tab ${i === 0 ? 'active' : ''}" data-result-tab="${ch}">${CHANNEL_LABELS[ch] || ch}</button>`
  ).join('');

  tabsEl.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      currentChannel = btn.dataset.resultTab;
      renderResultContent(currentChannel);
    });
  });

  currentChannel = channels[0];
  renderResultContent(currentChannel);
}

function renderResultContent(channel) {
  const content = document.getElementById('resultsContent');
  if (!content) return;
  const result = generatedResults[channel];
  if (!result) {
    content.innerHTML = `<p style="color:var(--text2)">결과가 없어요.</p>`;
    return;
  }
  content.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:0.75rem;">
      <button id="copyBtn" class="btn-toggle" style="cursor:pointer;">📋 복사하기</button>
    </div>
    <p style="white-space:pre-wrap">${escapeHtml(result)}</p>
  `;

  const copyBtn = document.getElementById('copyBtn');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result);
      copyBtn.textContent = '✅ 복사됨!';
      showToast('클립보드에 복사되었어요!', 'success');
      setTimeout(() => { copyBtn.textContent = '📋 복사하기'; }, 2000);
    } catch {
      showToast('복사에 실패했어요. 직접 선택해서 복사해주세요.', 'error');
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

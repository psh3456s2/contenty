// ================================================================
// dashboard.js — 사용자 대시보드
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // 로그인 확인 — 최대 1.5초 대기
  let waited = 0;
  while (!currentUser && waited < 1500) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  if (!currentUser) {
    window.location.href = '/';
    return;
  }
  loadDashboard();
});

function onAuthSignIn(user, profile) {
  loadDashboard();
}

async function loadDashboard() {
  if (!currentUser || !currentProfile) return;

  const profile = currentProfile;
  const plan = profile.plan || 'free';

  document.getElementById('dashUserEmail').textContent = currentUser.email;
  document.getElementById('dashPlan').textContent = planLabel(plan);
  document.getElementById('dashPlan').style.color = plan === 'pro' ? 'var(--accent)' : plan === 'starter' ? 'var(--yellow)' : 'var(--text2)';

  // 사용량
  const LIMITS = { free: 10, starter: 200, pro: '∞' };
  const usage = profile.daily_usage || 0;
  const limit = LIMITS[plan];
  document.getElementById('dashUsage').textContent = usage + '회';
  document.getElementById('dashRemaining').textContent =
    plan === 'pro' ? '∞' : `${Math.max(0, limit - usage)}회`;
  document.getElementById('dashJoined').textContent = formatDate(profile.created_at);

  // 구독 관리 버튼
  if (plan !== 'free') {
    const manageBtn = document.getElementById('manageSubBtn');
    manageBtn.style.display = 'inline-block';
    manageBtn.addEventListener('click', handleManageSubscription);
  }

  // 업그레이드 버튼 (Pro면 숨김)
  if (plan === 'pro') {
    document.getElementById('upgradePlanBtn').style.display = 'none';
  }

  // 생성 히스토리
  loadHistory();
}

async function loadHistory() {
  const { data, error } = await _supabase
    .from('generation_history')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const list = document.getElementById('historyList');
  if (error || !data || data.length === 0) {
    list.innerHTML = '<p class="empty-msg">아직 생성 기록이 없어요.</p>';
    return;
  }

  list.innerHTML = data.map(item => `
    <div class="history-item">
      <span class="history-topic">${item.topic || '(주제 없음)'}</span>
      <span class="history-meta">${formatDate(item.created_at)}</span>
    </div>
  `).join('');
}

async function handleManageSubscription() {
  const btn = document.getElementById('manageSubBtn');
  btn.disabled = true;
  btn.textContent = '처리 중...';
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const res = await fetch('/.netlify/functions/customer-portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const { url } = await res.json();
    window.location.href = url;
  } catch {
    showToast('구독 관리 페이지를 열지 못했습니다.', 'error');
    btn.disabled = false;
    btn.textContent = '구독 관리 (취소/변경)';
  }
}

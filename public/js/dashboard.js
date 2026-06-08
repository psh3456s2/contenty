// ================================================================
// dashboard.js — 사용자 대시보드 + 프로필 설정
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  let waited = 0;
  while (!currentUser && waited < 1500) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  if (!currentUser) { window.location.href = '/'; return; }
  loadDashboard();
});

function onAuthSignIn(user, profile) { loadDashboard(); }

async function loadDashboard() {
  if (!currentUser || !currentProfile) return;
  const profile = currentProfile;
  const plan = profile.plan || 'free';

  // 프로필 렌더
  document.getElementById('profileEmail').textContent = currentUser.email;
  document.getElementById('profileNickname').textContent = profile.nickname || '닉네임 없음';
  document.getElementById('profilePlanBadge').innerHTML = `<span class="plan-chip ${plan}">${planLabel(plan)}</span>`;

  if (profile.avatar_url) {
    document.getElementById('profileAvatar').innerHTML = `<img src="${profile.avatar_url}" alt="프로필" />`;
  }

  // 통계
  const LIMITS = { free: 10, starter: 200, pro: '∞' };
  const usage = profile.daily_usage || 0;
  const limit = LIMITS[plan];
  document.getElementById('dashPlan').textContent = planLabel(plan);
  document.getElementById('dashPlan').style.color = plan === 'pro' ? 'var(--accent)' : plan === 'starter' ? 'var(--yellow)' : 'var(--text2)';
  document.getElementById('dashUsage').textContent = usage + '회';
  document.getElementById('dashRemaining').textContent = plan === 'pro' ? '∞' : `${Math.max(0, limit - usage)}회`;
  document.getElementById('dashJoined').textContent = formatDate(profile.created_at);

  // 구독 버튼
  if (plan !== 'free') {
    const manageBtn = document.getElementById('manageSubBtn');
    manageBtn.style.display = 'inline-block';
    manageBtn.addEventListener('click', handleManageSubscription);
  }
  if (plan === 'pro') document.getElementById('upgradePlanBtn').style.display = 'none';

  // 닉네임 수정
  setupNicknameEdit();

  // 아바타 업로드
  setupAvatarUpload();

  // 히스토리
  loadHistory();
}

// ── 닉네임 수정 ─────────────────────────────────────────────────
function setupNicknameEdit() {
  const editBtn = document.getElementById('editNicknameBtn');
  const form = document.getElementById('nicknameForm');
  const input = document.getElementById('nicknameInput');
  const saveBtn = document.getElementById('saveNicknameBtn');
  const cancelBtn = document.getElementById('cancelNicknameBtn');

  // 현재 닉네임 입력창에 넣기
  input.value = currentProfile?.nickname || '';

  editBtn.addEventListener('click', () => {
    form.classList.remove('hidden');
    input.focus();
  });

  cancelBtn.addEventListener('click', () => {
    form.classList.add('hidden');
  });

  saveBtn.addEventListener('click', async () => {
    const nickname = input.value.trim();
    if (!nickname) { showToast('닉네임을 입력해주세요.', 'error'); return; }
    if (nickname.length > 20) { showToast('닉네임은 20자 이내로 입력해주세요.', 'error'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    const { error } = await _supabase
      .from('users')
      .update({ nickname })
      .eq('id', currentUser.id);

    saveBtn.disabled = false;
    saveBtn.textContent = '저장';

    if (error) {
      showToast('저장 실패: ' + error.message, 'error');
    } else {
      currentProfile.nickname = nickname;
      document.getElementById('profileNickname').textContent = nickname;
      form.classList.add('hidden');
      showToast('닉네임이 저장되었습니다! 😊', 'success');
    }
  });

  // 엔터 키
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });
}

// ── 아바타 업로드 ────────────────────────────────────────────────
function setupAvatarUpload() {
  const avatarInput = document.getElementById('avatarInput');
  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('이미지는 2MB 이하만 가능해요.', 'error'); return; }

    // 미리보기
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('profileAvatar').innerHTML = `<img src="${ev.target.result}" alt="프로필" />`;
    };
    reader.readAsDataURL(file);

    // Supabase Storage 업로드
    const ext = file.name.split('.').pop();
    const path = `avatars/${currentUser.id}.${ext}`;

    const { error: uploadError } = await _supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      // Storage 버킷 없으면 base64로 저장
      const reader2 = new FileReader();
      reader2.onload = async (ev) => {
        const base64 = ev.target.result;
        await _supabase.from('users').update({ avatar_url: base64 }).eq('id', currentUser.id);
        currentProfile.avatar_url = base64;
        showToast('프로필 사진이 저장되었습니다! 😊', 'success');
      };
      reader2.readAsDataURL(file);
      return;
    }

    const { data } = _supabase.storage.from('avatars').getPublicUrl(path);
    await _supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', currentUser.id);
    currentProfile.avatar_url = data.publicUrl;
    showToast('프로필 사진이 저장되었습니다! 😊', 'success');
  });
}

// ── 히스토리 ────────────────────────────────────────────────────
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

// ── 구독 관리 ────────────────────────────────────────────────────
async function handleManageSubscription() {
  const btn = document.getElementById('manageSubBtn');
  btn.disabled = true; btn.textContent = '처리 중...';
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const res = await fetch('/.netlify/functions/customer-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const { url } = await res.json();
    window.location.href = url;
  } catch {
    showToast('구독 관리 페이지를 열지 못했습니다.', 'error');
    btn.disabled = false; btn.textContent = '구독 관리 (취소/변경)';
  }
}

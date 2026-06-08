// ================================================================
// pricing.js — 요금제 페이지 버튼 로직 + Stripe Checkout
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
  // auth.js의 initAuth 완료 후 버튼 업데이트
  setTimeout(updatePricingButtons, 800);
});

// auth 콜백
function onAuthSignIn(user, profile) {
  updatePricingButtons();
}
function onAuthSignOut() {
  updatePricingButtons();
}

// ── 현재 플랜에 맞게 버튼 업데이트 ─────────────────────────────
function updatePricingButtons() {
  const plan = currentProfile?.plan || 'free';

  // Free 버튼
  const freeBtn = document.getElementById('freePlanBtn');
  if (freeBtn) {
    if (!currentUser) {
      freeBtn.textContent = '무료로 시작하기';
      freeBtn.onclick = () => openModal('signup');
    } else if (plan === 'free') {
      freeBtn.textContent = '✓ 현재 플랜';
      freeBtn.classList.add('current-plan');
      freeBtn.disabled = true;
    } else {
      freeBtn.textContent = '다운그레이드 (취소)';
      freeBtn.onclick = handleCancelSubscription;
    }
  }

  // Starter 버튼
  const starterBtn = document.getElementById('starterPlanBtn');
  if (starterBtn) {
    if (!currentUser) {
      starterBtn.textContent = 'Starter 시작하기';
      starterBtn.onclick = () => openModal('signup');
    } else if (plan === 'starter') {
      starterBtn.textContent = '✓ 현재 플랜';
      starterBtn.classList.add('current-plan');
      starterBtn.disabled = true;
    } else {
      starterBtn.textContent = plan === 'pro' ? '다운그레이드' : 'Starter 시작하기';
      starterBtn.onclick = () => handleCheckout('starter');
    }
  }

  // Pro 버튼
  const proBtn = document.getElementById('proPlanBtn');
  if (proBtn) {
    if (!currentUser) {
      proBtn.textContent = 'Pro 시작하기';
      proBtn.onclick = () => openModal('signup');
    } else if (plan === 'pro') {
      proBtn.textContent = '✓ 현재 플랜';
      proBtn.classList.add('current-plan');
      proBtn.disabled = true;
    } else {
      proBtn.textContent = 'Pro 시작하기';
      proBtn.onclick = () => handleCheckout('pro');
    }
  }
}

// ── Stripe Checkout ─────────────────────────────────────────────
async function handleCheckout(plan) {
  if (!currentUser) {
    openModal('login');
    return;
  }

  const btn = plan === 'starter'
    ? document.getElementById('starterPlanBtn')
    : document.getElementById('proPlanBtn');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>연결 중...';
  }

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const response = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ plan, userId: currentUser.id, email: currentUser.email })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '결제 페이지 생성 실패');
    }

    const { url } = await response.json();
    window.location.href = url;

  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = plan === 'starter' ? 'Starter 시작하기' : 'Pro 시작하기';
    }
  }
}

// ── 구독 취소 ────────────────────────────────────────────────────
async function handleCancelSubscription() {
  const confirmed = confirm('구독을 취소하면 현재 결제 기간 종료 후 Free 플랜으로 전환됩니다.\n정말 취소하시겠어요?');
  if (!confirmed) return;

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const response = await fetch('/.netlify/functions/cancel-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ userId: currentUser.id })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '취소 처리 실패');
    }

    showToast('구독이 취소되었습니다. 기간 종료 후 Free로 전환됩니다.', 'success');
    setTimeout(() => window.location.reload(), 1500);

  } catch (err) {
    showToast(err.message, 'error');
  }
}

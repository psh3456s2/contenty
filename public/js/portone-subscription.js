// ================================================================
// public/js/portone-subscription.js
// 구독 취소 (dashboard.html 등에서 사용)
//
// 사용법:
//   <button onclick="cancelSubscription()">구독 해지</button>
//   <script src="/js/portone-subscription.js"></script>
// ================================================================

async function cancelSubscription() {
  if (!confirm('정말 구독을 해지하시겠어요?\n다음 결제일까지는 계속 이용하실 수 있어요.')) {
    return;
  }

  const { data: { session } } = await window.supabaseClient.auth.getSession();
  if (!session) {
    alert('로그인이 필요합니다.');
    return;
  }

  try {
    const res = await fetch('/.netlify/functions/cancel-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || '구독 취소에 실패했습니다.');
      return;
    }

    alert(data.message || '구독이 해지되었습니다.');
    window.location.reload();

  } catch (err) {
    console.error('Cancel error:', err);
    alert('구독 취소 중 오류가 발생했습니다.');
  }
}

window.cancelSubscription = cancelSubscription;

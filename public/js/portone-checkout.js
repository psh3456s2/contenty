// ================================================================
// public/js/portone-checkout.js
// 포트원 V2 — 프론트엔드 정기결제(빌링키) 시작
//
// 사용법: pricing.html의 플랜 버튼에 연결
//   <button onclick="startSubscription('starter')">스타터 구독</button>
//   <button onclick="startSubscription('pro')">프로 구독</button>
//
// 그리고 <head> 또는 </body> 직전에 SDK 로드:
//   <script src="https://cdn.portone.io/v2/browser-sdk.js"></script>
//   <script src="/js/portone-checkout.js"></script>
// ================================================================

// ── 콘솔에서 발급되는 값으로 교체 ────────────────────────────────
// (포트원 콘솔 > 결제 연동 화면에서 확인)
const PORTONE_STORE_ID   = 'store-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX';   // TODO: 교체
const PORTONE_CHANNEL_KEY = 'channel-key-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX'; // TODO: 교체

const PLAN_LABEL = {
  starter: 'Contenty 스타터',
  pro: 'Contenty 프로',
};

async function startSubscription(plan) {
  if (!PLAN_LABEL[plan]) {
    alert('유효하지 않은 플랜입니다.');
    return;
  }

  // ── 1) 로그인 확인 (Supabase 세션) ─────────────────────────────
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  if (!session) {
    alert('로그인이 필요합니다.');
    // 로그인 모달 열기 (auth.js에 openAuthModal 있으면 사용)
    if (typeof openAuthModal === 'function') openAuthModal();
    return;
  }

  const user = session.user;

  try {
    // ── 2) 포트원 빌링키 발급 결제창 호출 ────────────────────────
    const issueResponse = await PortOne.requestIssueBillingKey({
      storeId: PORTONE_STORE_ID,
      channelKey: PORTONE_CHANNEL_KEY,
      billingKeyMethod: 'CARD',
      issueId: `issue-${user.id.slice(0, 8)}-${Date.now()}`,
      issueName: `${PLAN_LABEL[plan]} 정기결제 카드 등록`,
      customer: {
        customerId: user.id,
        email: user.email,
      },
    });

    // 사용자가 취소하거나 실패한 경우
    if (issueResponse.code !== undefined) {
      alert(`카드 등록 실패: ${issueResponse.message}`);
      return;
    }

    const billingKey = issueResponse.billingKey;

    // ── 3) 서버로 빌링키 전송 → 첫 결제 + 예약 등록 ───────────────
    const res = await fetch('/.netlify/functions/issue-billing-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ plan, billingKey }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || '결제에 실패했습니다.');
      return;
    }

    // ── 4) 성공 → 대시보드로 이동 ────────────────────────────────
    window.location.href = data.redirect || `/pages/dashboard.html?payment=success&plan=${plan}`;

  } catch (err) {
    console.error('Subscription error:', err);
    alert('결제 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// 전역 노출
window.startSubscription = startSubscription;

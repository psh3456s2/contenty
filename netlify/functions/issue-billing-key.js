// ================================================================
// netlify/functions/issue-billing-key.js
// 포트원 V2 — 빌링키 저장 + 첫 결제 + 다음달 예약결제 등록
// (기존 create-checkout.js 대체)
//
// 프론트(pricing.html)에서 PortOne.requestIssueBillingKey()로
// 카드 등록 → 발급된 billingKey를 이 함수로 보냄.
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
const PORTONE_API = 'https://api.portone.io';

// 플랜별 월 구독 금액 (KRW)
const PLAN_AMOUNTS = {
  starter: 29000,
  pro: 59000,
};
const PLAN_NAMES = {
  starter: 'Contenty 스타터 (월 구독)',
  pro: 'Contenty 프로 (월 구독)',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  // ── JWT 인증 ──────────────────────────────────────────────────
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return json(401, { error: '인증이 필요합니다.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, { error: '유효하지 않은 토큰입니다.' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: '잘못된 요청입니다.' }); }

  const { plan, billingKey } = body;
  if (!plan || !PLAN_AMOUNTS[plan]) return json(400, { error: '유효하지 않은 플랜입니다.' });
  if (!billingKey) return json(400, { error: '빌링키가 없습니다.' });

  const amount = PLAN_AMOUNTS[plan];
  const customerId = user.id; // 포트원 고객 id로 Supabase user.id 그대로 사용

  try {
    // ── 1) 첫 결제 즉시 실행 ───────────────────────────────────
    const firstPaymentId = `contenty-${plan}-${user.id.slice(0, 8)}-${Date.now()}`;

    const payRes = await fetch(
      `${PORTONE_API}/payments/${encodeURIComponent(firstPaymentId)}/billing-key`,
      {
        method: 'POST',
        headers: {
          'Authorization': `PortOne ${PORTONE_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billingKey,
          orderName: PLAN_NAMES[plan],
          customer: { id: customerId },
          amount: { total: amount },
          currency: 'KRW',
        }),
      }
    );

    const payData = await payRes.json();
    if (!payRes.ok) {
      console.error('First payment failed:', payData);
      return json(402, { error: payData.message || '첫 결제에 실패했습니다.' });
    }

    // ── 2) 다음 달 예약결제 등록 ───────────────────────────────
    const nextBilling = new Date();
    nextBilling.setMonth(nextBilling.getMonth() + 1);
    const nextPaymentId = `contenty-${plan}-${user.id.slice(0, 8)}-${nextBilling.getTime()}`;

    let scheduleId = null;
    try {
      const schedRes = await fetch(
        `${PORTONE_API}/payments/${encodeURIComponent(nextPaymentId)}/schedule`,
        {
          method: 'POST',
          headers: {
            'Authorization': `PortOne ${PORTONE_API_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payment: {
              billingKey,
              orderName: PLAN_NAMES[plan],
              customer: { id: customerId },
              amount: { total: amount },
              currency: 'KRW',
            },
            timeToPay: nextBilling.toISOString(),
          }),
        }
      );
      const schedData = await schedRes.json();
      if (schedRes.ok) {
        scheduleId = schedData.schedule?.id || schedData.id || null;
      } else {
        console.error('Schedule registration failed:', schedData);
        // 예약 실패해도 첫 결제는 됐으므로 진행. 다음 결제는 webhook 재예약으로 보완.
      }
    } catch (e) {
      console.error('Schedule error:', e);
    }

    // ── 3) Supabase 업데이트 ───────────────────────────────────
    const { error: updErr } = await supabase
      .from('users')
      .update({
        plan,
        billing_key: billingKey,
        portone_customer_id: customerId,
        subscription_status: 'active',
        next_billing_at: nextBilling.toISOString(),
        last_schedule_id: scheduleId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updErr) {
      console.error('Supabase update failed:', updErr);
      return json(500, { error: '결제는 완료됐으나 플랜 반영에 실패했습니다. 고객센터에 문의해주세요.' });
    }

    // ── 4) 결제내역 기록 ───────────────────────────────────────
    await supabase.from('payments').insert({
      user_id: user.id,
      payment_id: firstPaymentId,
      plan,
      amount,
      status: 'PAID',
      method: 'card',
      is_recurring: false,
    });

    return json(200, {
      success: true,
      plan,
      message: '결제가 완료되었습니다.',
      redirect: `/pages/dashboard.html?payment=success&plan=${plan}`,
    });

  } catch (err) {
    console.error('issue-billing-key error:', err);
    return json(500, { error: err.message || '결제 처리에 실패했습니다.' });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
function cors204() {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: '',
  };
}

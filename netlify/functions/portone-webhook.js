// ================================================================
// netlify/functions/portone-webhook.js
// 포트원 V2 웹훅 — 예약결제(정기결제) 결과 통보 처리
// (기존 stripe-webhook.js 대체)
//
// 포트원 콘솔 > 결제 연동 > 웹훅 에 이 함수 URL을 등록:
//   https://ddukddak-contenty.co.kr/.netlify/functions/portone-webhook
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
const PORTONE_WEBHOOK_SECRET = process.env.PORTONE_WEBHOOK_SECRET; // 콘솔에서 발급
const PORTONE_API = 'https://api.portone.io';

const PLAN_AMOUNTS = { starter: 29000, pro: 59000 };
const PLAN_NAMES = {
  starter: 'Contenty 스타터 (월 구독)',
  pro: 'Contenty 프로 (월 구독)',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── 웹훅 검증 ─────────────────────────────────────────────────
  // 포트원 V2 웹훅은 @portone/server-sdk의 Webhook.verify 사용을 권장하지만,
  // 의존성 최소화를 위해 여기서는 본문 파싱 후 결제건을 API로 재조회하여 검증.
  let payload;
  try { payload = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: 'Invalid body' };
  }

  // 포트원 웹훅 형식: { type, timestamp, data: { paymentId, ... } }
  const paymentId = payload?.data?.paymentId || payload?.paymentId;
  const type = payload?.type || '';

  if (!paymentId) {
    console.log('No paymentId in webhook:', payload);
    return { statusCode: 200, body: 'ok' }; // 200 반환해야 재전송 방지
  }

  try {
    // ── 실제 결제건을 포트원 API로 재조회 (위변조 방지) ───────────
    const payRes = await fetch(
      `${PORTONE_API}/payments/${encodeURIComponent(paymentId)}`,
      { headers: { 'Authorization': `PortOne ${PORTONE_API_SECRET}` } }
    );
    const payment = await payRes.json();
    if (!payRes.ok) {
      console.error('Payment lookup failed:', payment);
      return { statusCode: 200, body: 'ok' };
    }

    const status = payment.status; // PAID / FAILED / CANCELLED 등
    const customerId = payment.customer?.id;       // = supabase user.id
    const amount = payment.amount?.total;
    const plan = amountToPlan(amount);

    if (!customerId) {
      console.log('No customer id in payment:', paymentId);
      return { statusCode: 200, body: 'ok' };
    }

    console.log(`Webhook: type=${type}, status=${status}, user=${customerId}`);

    // ── 결제 성공 (정기결제 갱신) ──────────────────────────────
    if (status === 'PAID') {
      // 결제내역 기록 (중복 방지)
      await supabase.from('payments').upsert({
        user_id: customerId,
        payment_id: paymentId,
        plan: plan || 'unknown',
        amount: amount || 0,
        status: 'PAID',
        method: 'card',
        is_recurring: true,
      }, { onConflict: 'payment_id' });

      // 다음 달 재예약 + 상태 갱신
      if (plan) {
        const { data: profile } = await supabase
          .from('users')
          .select('billing_key')
          .eq('id', customerId)
          .single();

        const billingKey = profile?.billing_key;
        const nextBilling = new Date();
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        let scheduleId = null;

        if (billingKey) {
          scheduleId = await scheduleNext(billingKey, customerId, plan, nextBilling);
        }

        await supabase
          .from('users')
          .update({
            plan,
            subscription_status: 'active',
            next_billing_at: nextBilling.toISOString(),
            last_schedule_id: scheduleId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', customerId);

        console.log(`✅ Recurring payment OK & rescheduled: user=${customerId}, plan=${plan}`);
      }
    }

    // ── 결제 실패 ──────────────────────────────────────────────
    else if (status === 'FAILED') {
      await supabase
        .from('users')
        .update({ subscription_status: 'past_due', updated_at: new Date().toISOString() })
        .eq('id', customerId);

      await supabase.from('payments').upsert({
        user_id: customerId,
        payment_id: paymentId,
        plan: plan || 'unknown',
        amount: amount || 0,
        status: 'FAILED',
        method: 'card',
        is_recurring: true,
      }, { onConflict: 'payment_id' });

      console.log(`⚠️ Recurring payment FAILED: user=${customerId}`);
      // 필요 시: 사용자에게 결제 실패 안내 메일 발송 로직 추가
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('portone-webhook error:', err);
    // 200을 반환하지 않으면 포트원이 계속 재전송하므로, 로깅 후 200 반환
    return { statusCode: 200, body: 'ok' };
  }
};

// ── 다음 달 예약결제 등록 ────────────────────────────────────────
async function scheduleNext(billingKey, customerId, plan, when) {
  const nextPaymentId = `contenty-${plan}-${customerId.slice(0, 8)}-${when.getTime()}`;
  try {
    const res = await fetch(
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
            amount: { total: PLAN_AMOUNTS[plan] },
            currency: 'KRW',
          },
          timeToPay: when.toISOString(),
        }),
      }
    );
    const data = await res.json();
    if (res.ok) return data.schedule?.id || data.id || null;
    console.error('Reschedule failed:', data);
    return null;
  } catch (e) {
    console.error('Reschedule error:', e);
    return null;
  }
}

function amountToPlan(amount) {
  if (amount === PLAN_AMOUNTS.starter) return 'starter';
  if (amount === PLAN_AMOUNTS.pro) return 'pro';
  return null;
}

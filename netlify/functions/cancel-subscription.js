// ================================================================
// netlify/functions/cancel-subscription.js
// 포트원 V2 — 구독 취소 (다음 예약결제 취소 + 상태 변경)
//
// 정책: 즉시 환불이 아니라, 다음 결제를 막고 이번 달 말까지는 이용 가능.
//       (= Stripe의 cancel_at_period_end 와 동일한 UX)
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
const PORTONE_API = 'https://api.portone.io';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  // ── JWT 인증 ──────────────────────────────────────────────────
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return json(401, { error: '인증이 필요합니다.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, { error: '유효하지 않은 토큰입니다.' });

  try {
    const { data: profile } = await supabase
      .from('users')
      .select('billing_key, subscription_status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.subscription_status !== 'active') {
      return json(400, { error: '활성화된 구독이 없습니다.' });
    }

    const billingKey = profile.billing_key;

    // ── 1) 해당 빌링키로 예약된 모든 결제 취소 ──────────────────
    if (billingKey) {
      try {
        await fetch(`${PORTONE_API}/payment-schedules?billingKey=${encodeURIComponent(billingKey)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `PortOne ${PORTONE_API_SECRET}` },
        });
      } catch (e) {
        console.error('Schedule cancel error (non-fatal):', e);
      }

      // ── 2) 빌링키 삭제 (선택) ─────────────────────────────────
      try {
        await fetch(`${PORTONE_API}/billing-keys/${encodeURIComponent(billingKey)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `PortOne ${PORTONE_API_SECRET}` },
        });
      } catch (e) {
        console.error('Billing key delete error (non-fatal):', e);
      }
    }

    // ── 3) 상태 변경 (이번 달 말까지는 plan 유지, 갱신만 중단) ────
    const { error: updErr } = await supabase
      .from('users')
      .update({
        subscription_status: 'cancelled',
        last_schedule_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updErr) return json(500, { error: '구독 취소 처리에 실패했습니다.' });

    return json(200, {
      success: true,
      message: '구독이 해지되었습니다. 다음 결제일까지 이용 가능합니다.',
    });

  } catch (err) {
    console.error('cancel-subscription error:', err);
    return json(500, { error: err.message || '구독 취소에 실패했습니다.' });
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

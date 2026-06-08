// ================================================================
// netlify/functions/cancel-subscription.js
// 구독 취소 처리
// ================================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return json(401, { error: '인증이 필요합니다.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, { error: '유효하지 않은 토큰입니다.' });

  try {
    const { data: profile } = await supabase
      .from('users')
      .select('stripe_subscription_id')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_subscription_id) {
      return json(400, { error: '활성 구독이 없습니다.' });
    }

    // 기간 종료 후 취소 (cancel_at_period_end: true)
    // 즉시 취소가 아니라 현재 기간 끝까지 사용 가능
    await stripe.subscriptions.update(profile.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    return json(200, { success: true, message: '구독이 취소 예약되었습니다. 현재 결제 기간 종료 후 Free로 전환됩니다.' });

  } catch (err) {
    console.error('Cancel subscription error:', err);
    return json(500, { error: err.message || '구독 취소 처리 실패' });
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

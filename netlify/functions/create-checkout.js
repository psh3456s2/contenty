// ================================================================
// netlify/functions/create-checkout.js
// Stripe Checkout 세션 생성
// ================================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stripe Price ID (Stripe 대시보드에서 생성 후 환경변수에 설정)
const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER, // 월 29,000원 구독 Price ID
  pro: process.env.STRIPE_PRICE_PRO,          // 월 59,000원 구독 Price ID
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  // ── JWT 인증 검증 ────────────────────────────────────────────
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return json(401, { error: '인증이 필요합니다.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, { error: '유효하지 않은 토큰입니다.' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: '잘못된 요청입니다.' }); }

  const { plan, email } = body;
  if (!plan || !PRICE_IDS[plan]) return json(400, { error: '유효하지 않은 플랜입니다.' });

  try {
    // ── Stripe Customer 조회 또는 생성 ──────────────────────────
    const { data: profile } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    // ── Checkout 세션 생성 ───────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.SITE_URL}/pages/dashboard.html?payment=success&plan=${plan}`,
      cancel_url: `${process.env.SITE_URL}/pages/pricing.html?payment=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan,
        },
      },
      locale: 'ko',
      allow_promotion_codes: true,
    });

    return json(200, { url: session.url });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    return json(500, { error: err.message || '결제 페이지 생성에 실패했습니다.' });
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

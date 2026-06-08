// ================================================================
// netlify/functions/customer-portal.js
// Stripe Customer Portal — 구독 관리 페이지 URL 생성
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
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return json(400, { error: 'Stripe 고객 정보가 없습니다.' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.SITE_URL}/pages/dashboard.html`,
    });

    return json(200, { url: portalSession.url });

  } catch (err) {
    console.error('Customer portal error:', err);
    return json(500, { error: err.message || '포털 페이지 생성 실패' });
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

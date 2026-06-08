// ================================================================
// netlify/functions/stripe-webhook.js
// Stripe 웹훅 처리 — 결제 성공/취소 시 DB 플랜 자동 업데이트
// ================================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    // 웹훅 서명 검증 (보안 필수)
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('Stripe webhook event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      // ── 결제 성공 (구독 생성/갱신) ─────────────────────────────
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan;

        if (userId && plan) {
          await updateUserPlan(userId, plan, session.subscription);
          console.log(`✅ Plan updated: user=${userId}, plan=${plan}`);
        }
        break;
      }

      // ── 구독 갱신 성공 ──────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const userId = subscription.metadata?.supabase_user_id;
          const plan = subscription.metadata?.plan;

          if (userId && plan) {
            await updateUserPlan(userId, plan, invoice.subscription);
            console.log(`✅ Subscription renewed: user=${userId}, plan=${plan}`);
          }
        }
        break;
      }

      // ── 결제 실패 ───────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const userId = subscription.metadata?.supabase_user_id;

          if (userId) {
            // 결제 실패해도 즉시 취소하지 않고 Stripe가 재시도
            // 재시도 모두 실패 시 customer.subscription.deleted 이벤트 발생
            console.log(`⚠️ Payment failed for user: ${userId}`);
          }
        }
        break;
      }

      // ── 구독 취소/만료 ──────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const userId = subscription.metadata?.supabase_user_id;

        if (userId) {
          await updateUserPlan(userId, 'free', null);
          console.log(`🔄 Plan downgraded to free: user=${userId}`);
        }
        break;
      }

      // ── 구독 업데이트 (플랜 변경) ───────────────────────────────
      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const userId = subscription.metadata?.supabase_user_id;

        if (userId) {
          // 구독 상태 확인
          if (subscription.status === 'active') {
            // Price ID로 플랜 확인
            const priceId = subscription.items.data[0]?.price?.id;
            const plan = getPlanFromPriceId(priceId);
            if (plan) {
              await updateUserPlan(userId, plan, subscription.id);
              console.log(`🔄 Subscription updated: user=${userId}, plan=${plan}`);
            }
          } else if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
            await updateUserPlan(userId, 'free', null);
            console.log(`🔄 Subscription inactive, downgraded: user=${userId}`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: `Handler Error: ${err.message}` };
  }
};

// ── DB 플랜 업데이트 ─────────────────────────────────────────────
async function updateUserPlan(userId, plan, subscriptionId) {
  const updateData = {
    plan,
    updated_at: new Date().toISOString(),
  };
  if (subscriptionId) {
    updateData.stripe_subscription_id = subscriptionId;
  }
  if (plan === 'free') {
    updateData.stripe_subscription_id = null;
  }

  const { error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', userId);

  if (error) {
    console.error('Failed to update user plan:', error);
    throw error;
  }
}

// ── Price ID → Plan 이름 매핑 ────────────────────────────────────
function getPlanFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_STARTER]: 'starter',
    [process.env.STRIPE_PRICE_PRO]: 'pro',
  };
  return map[priceId] || null;
}

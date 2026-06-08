const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DAILY_LIMITS = { free: 10, starter: 200, pro: Infinity };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: '잘못된 요청입니다.' }); }

  const { topic, claudeKey, channel, userId } = body;
  if (!topic) return json(400, { error: '주제를 입력해주세요.' });
  if (!claudeKey) return json(400, { error: 'Claude API 키가 필요합니다.' });

  if (userId) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: profile } = await supabase.from('users').select('plan, daily_usage, usage_reset_at').eq('id', userId).single();
    if (profile) {
      const plan = profile.plan || 'free';
      const limit = DAILY_LIMITS[plan];
      const lastReset = new Date(profile.usage_reset_at || 0);
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      let usage = profile.daily_usage || 0;
      if (lastReset < todayStart) {
        await supabase.from('users').update({ daily_usage: 0, usage_reset_at: todayStart.toISOString() }).eq('id', userId);
        usage = 0;
      }
      if (usage >= limit) return json(429, { error: `오늘 생성 횟수(${limit}회)를 모두 사용했습니다.` });
    }
  }

  try {
    const targetChannel = channel || 'blog';
    const text = await generateText(claudeKey, buildPrompt(targetChannel, topic));

    if (userId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await supabase.from('generation_history').insert({ user_id: userId, topic, created_at: new Date().toISOString() });
      await supabase.rpc('increment_usage', { p_user_id: userId });
    }

    return json(200, { results: { [targetChannel]: text } });

  } catch (err) {
    console.error('Generate error:', err);
    if (err.message?.includes('401')) return json(401, { error: 'API 키가 올바르지 않습니다.' });
    return json(500, { error: err.message || '생성 중 오류가 발생했습니다.' });
  }
};

async function generateText(apiKey, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(`Claude API 오류: ${err.error?.message || res.status}`); }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function buildPrompt(channel, topic) {
  const prompts = {
    blog: `당신은 전문 마케팅 블로그 라이터입니다. 다음 주제로 네이버 블로그에 최적화된 글을 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 제목 포함 (매력적이고 SEO 친화적)\n- 소제목 3~4개 포함\n- 총 800~1200자\n- 자연스러운 한국어로 작성`,
    cafe: `당신은 네이버 카페 커뮤니티 전문 라이터입니다. 다음 주제로 네이버 카페 게시글을 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 친근하고 일상적인 말투\n- 제목 포함\n- 400~600자\n- 댓글 유도 문구 포함\n- 이모지 적절히 활용`,
    insta: `당신은 인스타그램 마케팅 전문가입니다. 다음 주제로 인스타그램 게시글 캡션을 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 첫 줄은 눈길을 끄는 훅 문장\n- 150~250자 본문\n- 관련 해시태그 15~20개 포함\n- 이모지 활용`,
    thread: `당신은 스레드 SNS 전문 라이터입니다. 다음 주제로 스레드 게시글 시리즈를 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 5개의 연속 게시글\n- 각 게시글은 300자 이내\n- 첫 글은 강렬한 훅\n- 각 글 앞에 번호 표기 (1/5, 2/5 ...)`,
    card: `당신은 카드뉴스 콘텐츠 기획자입니다. 다음 주제로 5장짜리 카드뉴스 텍스트를 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 정확히 5장 작성\n- 각 카드 앞에 "카드 1:", "카드 2:" 형식으로 표기\n- 각 카드는 핵심 메시지 1~2줄 + 설명 2~3줄\n- 카드 1: 주목을 끄는 제목\n- 카드 5: 결론/CTA`,
  };
  return prompts[channel] || prompts.blog;
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}
function cors204() {
  return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
}

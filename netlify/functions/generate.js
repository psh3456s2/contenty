// ================================================================
// netlify/functions/generate.js
// 콘텐츠 생성 서버리스 함수 — API Key를 서버에서 안전하게 처리
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DAILY_LIMITS = { free: 10, starter: 200, pro: Infinity };

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return cors204();
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: '잘못된 요청입니다.' });
  }

  const { topic, claudeKey, openaiKey, userId } = body;

  if (!topic) return json(400, { error: '주제를 입력해주세요.' });
  if (!claudeKey) return json(400, { error: 'Claude API 키가 필요합니다.' });

  // ── 사용량 서버 측 재검증 ─────────────────────────────────────
  if (userId) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: profile } = await supabase
      .from('users')
      .select('plan, daily_usage, usage_reset_at')
      .eq('id', userId)
      .single();

    if (profile) {
      const plan = profile.plan || 'free';
      const limit = DAILY_LIMITS[plan];

      // 날짜 초기화 체크
      const lastReset = new Date(profile.usage_reset_at || 0);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let usage = profile.daily_usage || 0;

      if (lastReset < todayStart) {
        await supabase.from('users').update({
          daily_usage: 0,
          usage_reset_at: todayStart.toISOString()
        }).eq('id', userId);
        usage = 0;
      }

      if (usage >= limit) {
        return json(429, { error: `오늘 생성 횟수(${limit}회)를 모두 사용했습니다. 요금제를 업그레이드하세요.` });
      }
    }
  }

  // ── Claude API 호출 ──────────────────────────────────────────
  try {
    const results = {};

    // 블로그, 카페, 인스타, 스레드 — 동시 생성
    const [blog, cafe, insta, thread] = await Promise.all([
      generateText(claudeKey, buildPrompt('blog', topic)),
      generateText(claudeKey, buildPrompt('cafe', topic)),
      generateText(claudeKey, buildPrompt('insta', topic)),
      generateText(claudeKey, buildPrompt('thread', topic)),
    ]);

    results.blog = blog;
    results.cafe = cafe;
    results.insta = insta;
    results.thread = thread;

    // 카드뉴스 — OpenAI 이미지 포함 (선택적)
    results.card = await generateCardNews(claudeKey, openaiKey, topic);

    // 히스토리 저장
    if (userId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await supabase.from('generation_history').insert({
        user_id: userId,
        topic,
        created_at: new Date().toISOString(),
      });
      // 사용량 증가
      await supabase.rpc('increment_usage', { p_user_id: userId });
    }

    return json(200, { results });

  } catch (err) {
    console.error('Generate error:', err);
    if (err.message?.includes('401') || err.message?.includes('authentication')) {
      return json(401, { error: 'API 키가 올바르지 않습니다. 키를 확인해주세요.' });
    }
    return json(500, { error: err.message || '콘텐츠 생성 중 오류가 발생했습니다.' });
  }
};

// ── Claude 텍스트 생성 ───────────────────────────────────────────
async function generateText(apiKey, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Claude API 오류: ${err.error?.message || res.status}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ── 카드뉴스 생성 ────────────────────────────────────────────────
async function generateCardNews(claudeKey, openaiKey, topic) {
  // 카드뉴스 텍스트 생성
  const textPrompt = buildPrompt('card', topic);
  const cardTexts = await generateText(claudeKey, textPrompt);

  // 텍스트를 5장으로 파싱
  const cards = parseCardTexts(cardTexts);

  // OpenAI 이미지 생성 (키가 있을 때만)
  if (openaiKey) {
    const imagePromises = cards.map((card) =>
      generateImage(openaiKey, `${topic} 마케팅 카드뉴스: ${card.text.substring(0, 100)}`)
        .catch(() => null) // 이미지 실패해도 텍스트는 표시
    );
    const images = await Promise.all(imagePromises);
    cards.forEach((card, i) => {
      if (images[i]) card.imageUrl = images[i];
    });
  }

  return cards;
}

// ── OpenAI DALL-E 이미지 생성 ────────────────────────────────────
async function generateImage(openaiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: `깔끔하고 세련된 마케팅 배경 이미지. ${prompt}. 텍스트 없음. 미니멀 디자인.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.[0]?.url || null;
}

// ── 카드 텍스트 파싱 ─────────────────────────────────────────────
function parseCardTexts(rawText) {
  const lines = rawText.split('\n').filter(l => l.trim());
  const cards = [];
  let current = '';

  for (const line of lines) {
    if (/^(카드\s*\d+|Card\s*\d+|\[\d+\]|\d+\.)/i.test(line.trim())) {
      if (current.trim()) cards.push({ text: current.trim() });
      current = line.replace(/^(카드\s*\d+|Card\s*\d+|\[\d+\]|\d+\.)/i, '').trim();
    } else {
      current += (current ? '\n' : '') + line;
    }
    if (cards.length >= 4 && current.trim()) {
      cards.push({ text: current.trim() });
      break;
    }
  }
  if (current.trim() && cards.length < 5) cards.push({ text: current.trim() });

  // 5장 보장
  while (cards.length < 5) cards.push({ text: '✦ ' + cards[0]?.text?.substring(0, 80) || '' });
  return cards.slice(0, 5);
}

// ── 프롬프트 빌더 ────────────────────────────────────────────────
function buildPrompt(channel, topic) {
  const prompts = {
    blog: `당신은 전문 마케팅 블로그 라이터입니다.
다음 주제로 네이버 블로그에 최적화된 글을 작성하세요.

주제: ${topic}

요구사항:
- 제목 포함 (매력적이고 SEO 친화적)
- 소제목 3~4개 포함
- 총 800~1200자
- 독자가 공유하고 싶을 만큼 유익하고 흥미롭게
- 자연스러운 한국어로 작성`,

    cafe: `당신은 네이버 카페 커뮤니티 전문 라이터입니다.
다음 주제로 네이버 카페 게시글을 작성하세요.

주제: ${topic}

요구사항:
- 친근하고 일상적인 말투
- 제목 포함
- 400~600자
- 댓글 유도 문구 포함
- 이모지 적절히 활용`,

    insta: `당신은 인스타그램 마케팅 전문가입니다.
다음 주제로 인스타그램 게시글 캡션을 작성하세요.

주제: ${topic}

요구사항:
- 첫 줄은 눈길을 끄는 훅 문장
- 150~250자 본문
- 개행으로 가독성 향상
- 관련 해시태그 15~20개 포함 (#으로 시작)
- 이모지 활용`,

    thread: `당신은 스레드(Threads) SNS 전문 라이터입니다.
다음 주제로 스레드 게시글 시리즈를 작성하세요.

주제: ${topic}

요구사항:
- 5개의 연속 게시글 (스레드)
- 각 게시글은 500자 이내
- 첫 글은 강렬한 훅
- 마지막 글은 CTA(행동 유도)
- 각 글 앞에 번호 표기 (1/5, 2/5 ...)`,

    card: `당신은 카드뉴스 콘텐츠 기획자입니다.
다음 주제로 5장짜리 카드뉴스 텍스트를 작성하세요.

주제: ${topic}

요구사항:
- 정확히 5장 작성
- 각 카드 앞에 "카드 1:", "카드 2:" 형식으로 표기
- 각 카드는 핵심 메시지 1~2줄 + 설명 2~3줄
- 카드 1: 주목을 끄는 제목/훅
- 카드 2~4: 핵심 내용
- 카드 5: 결론/CTA
- 간결하고 임팩트 있는 문장`,
  };

  return prompts[channel] || prompts.blog;
}

// ── 헬퍼 ────────────────────────────────────────────────────────
function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
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

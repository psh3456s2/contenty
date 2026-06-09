const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // 서버에서만 읽음
const DAILY_LIMITS = { free: 10, starter: 70, pro: 200 };
const VALID_CHANNELS = ['blog', 'cafe', 'insta', 'thread'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  // ── 0. 서버 키 존재 확인 ──────────────────────────────────────
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
    return json(500, { error: '서버 설정 오류입니다. 잠시 후 다시 시도해주세요.' });
  }

  // ── 1. 요청 파싱 ──────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: '잘못된 요청입니다.' }); }

  const { topic } = body;
  if (!topic) return json(400, { error: '주제를 입력해주세요.' });

  // 채널 목록 정리 (유효한 채널만, 중복 제거)
  let channels = Array.isArray(body.channels) ? body.channels : (body.channel ? [body.channel] : []);
  channels = [...new Set(channels)].filter(ch => VALID_CHANNELS.includes(ch));
  if (channels.length === 0) return json(400, { error: '생성할 채널을 하나 이상 선택해주세요.' });

  // ── 2. 로그인 강제: 토큰 검증 ─────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: '로그인이 필요합니다.' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(401, { error: '로그인이 만료되었습니다. 다시 로그인해주세요.' });

  const userId = user.id;

  // ── 3. 사용량 검사 (채널 수만큼 필요) ─────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('plan, daily_usage, usage_reset_at')
    .eq('id', userId)
    .single();

  if (profileError || !profile) return json(403, { error: '사용자 정보를 찾을 수 없습니다.' });

  const plan = profile.plan || 'free';
  const limit = DAILY_LIMITS[plan];
  const lastReset = new Date(profile.usage_reset_at || 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  let usage = profile.daily_usage || 0;

  // 날짜 바뀌면 사용량 리셋
  if (lastReset < todayStart) {
    await supabase.from('users')
      .update({ daily_usage: 0, usage_reset_at: todayStart.toISOString() })
      .eq('id', userId);
    usage = 0;
  }

  const needed = channels.length; // 선택한 채널 수만큼 차감
  if (usage + needed > limit) {
    const remaining = Math.max(0, limit - usage);
    return json(429, { error: `오늘 남은 생성 횟수는 ${remaining}회인데 ${needed}개 채널을 선택하셨어요. 채널을 줄이거나 요금제를 업그레이드해주세요.` });
  }

  // ── 4. 생성 (채널별로 각각) ───────────────────────────────────
  try {
    const results = {};
    for (const ch of channels) {
      const text = await generateText(buildPrompt(ch, topic));
      results[ch] = text;
      await supabase.from('generation_history').insert({
        user_id: userId, topic, created_at: new Date().toISOString(),
      });
    }

    // 사용량을 채널 수만큼 증가
    for (let i = 0; i < needed; i++) {
      await supabase.rpc('increment_usage', { p_user_id: userId });
    }

    return json(200, { results });

  } catch (err) {
    console.error('Generate error:', err);
    return json(500, { error: '생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
};

async function generateText(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API 오류: ${err.error?.message || res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function buildPrompt(channel, topic) {
  const commonRules = `\n\n[작성 규칙 — 반드시 지킬 것]\n- 마크다운 기호를 절대 사용하지 마세요. ## (제목 기호), ** (굵게 기호), - (목록 기호) 등 어떤 마크다운 문법도 쓰지 마세요.\n- 강조하고 싶을 때는 기호 대신 이모지나 줄바꿈을 활용하세요.\n- 이모지를 반드시 풍부하게 넣어 친근한 느낌을 주세요.\n- 바로 복사해서 붙여넣을 수 있는 완성된 글 형태로 작성하세요.`;

  const prompts = {
    blog: `당신은 전문 마케팅 블로그 라이터입니다. 다음 주제로 네이버 블로그에 최적화된 글을 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 제목 포함 (이모지 1개 포함, SEO 친화적)\n- 소제목 3~4개 (각 소제목에 이모지 포함)\n- 총 800~1200자\n- 이모지를 문단마다 자연스럽게 활용\n- 친근하고 자연스러운 한국어로 작성`,
    cafe: `당신은 네이버 카페 커뮤니티 전문 라이터입니다. 다음 주제로 네이버 카페 게시글을 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 친근하고 일상적인 말투\n- 제목 포함\n- 400~600자\n- 댓글 유도 문구 포함\n- 이모지 적절히 활용`,
    insta: `당신은 인스타그램 마케팅 전문가입니다. 다음 주제로 인스타그램 게시글 캡션을 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 첫 줄은 눈길을 끄는 훅 문장\n- 150~250자 본문\n- 관련 해시태그 15~20개 포함\n- 이모지 활용`,
    thread: `당신은 스레드 SNS 전문 라이터입니다. 다음 주제로 스레드 게시글 시리즈를 작성하세요.\n\n주제: ${topic}\n\n요구사항:\n- 5개의 연속 게시글\n- 각 게시글은 300자 이내\n- 첫 글은 강렬한 훅\n- 각 글 앞에 번호 표기 (1/5, 2/5 ...)`,
  };
  return (prompts[channel] || prompts.blog) + commonRules;
}

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

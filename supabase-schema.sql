-- ================================================================
-- Contenty — Supabase SQL 스키마
-- Supabase SQL Editor에서 순서대로 실행하세요
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. users 테이블
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL,
  plan                    TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro')),
  daily_usage             INTEGER NOT NULL DEFAULT 0,
  total_usage             INTEGER NOT NULL DEFAULT 0,
  usage_reset_at          TIMESTAMPTZ DEFAULT NOW(),
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  is_admin                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_plan ON public.users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users(stripe_customer_id);


-- ────────────────────────────────────────────────────────────────
-- 2. generation_history 테이블
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.generation_history (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_id ON public.generation_history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON public.generation_history(created_at DESC);


-- ────────────────────────────────────────────────────────────────
-- 3. Row Level Security (RLS) 활성화
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_history ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────────
-- 4. users RLS 정책
-- ────────────────────────────────────────────────────────────────

-- 본인 데이터만 조회 가능
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- 본인 데이터만 수정 가능
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- 신규 가입 시 본인 row 삽입 허용
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 관리자는 모든 데이터 조회 가능 (is_admin = true인 사용자)
CREATE POLICY "users_admin_select_all"
  ON public.users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_admin = TRUE
    )
  );

-- 관리자는 모든 사용자 플랜 수정 가능
CREATE POLICY "users_admin_update_all"
  ON public.users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_admin = TRUE
    )
  );


-- ────────────────────────────────────────────────────────────────
-- 5. generation_history RLS 정책
-- ────────────────────────────────────────────────────────────────

-- 본인 히스토리만 조회
CREATE POLICY "history_select_own"
  ON public.generation_history FOR SELECT
  USING (auth.uid() = user_id);

-- 본인 히스토리만 삽입
CREATE POLICY "history_insert_own"
  ON public.generation_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 관리자 전체 조회
CREATE POLICY "history_admin_select"
  ON public.generation_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_admin = TRUE
    )
  );


-- ────────────────────────────────────────────────────────────────
-- 6. Service Role 전용 정책 (Netlify Functions에서 사용)
--    service_role key는 RLS를 우회하므로 별도 정책 불필요
-- ────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────
-- 7. 사용량 증가 RPC 함수 (atomic update)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_usage(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users
  SET
    daily_usage = daily_usage + 1,
    total_usage = total_usage + 1,
    updated_at  = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ────────────────────────────────────────────────────────────────
-- 8. updated_at 자동 갱신 트리거
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────────
-- 9. 관리자 계정 설정 (가입 후 이 쿼리 실행)
-- YOUR_EMAIL 부분을 실제 관리자 이메일로 변경하세요
-- ────────────────────────────────────────────────────────────────
-- UPDATE public.users SET is_admin = TRUE WHERE email = 'YOUR_ADMIN_EMAIL@example.com';


-- ────────────────────────────────────────────────────────────────
-- 10. Google OAuth 설정 확인용 (참고용 — SQL 실행 불필요)
-- Supabase 대시보드 > Authentication > Providers > Google 에서 설정
-- ────────────────────────────────────────────────────────────────
-- Client ID: Google Cloud Console에서 발급
-- Client Secret: Google Cloud Console에서 발급
-- Redirect URL: https://[YOUR_PROJECT].supabase.co/auth/v1/callback

# Contenty — 배포 완전 가이드

> 이 문서를 **위에서 아래로 순서대로** 따라하면 배포가 완료됩니다.

---

## 📁 최종 폴더 구조

```
contenty/
├── netlify.toml                        ← Netlify 설정
├── package.json                        ← 의존성
├── supabase-schema.sql                 ← DB 스키마 (이 파일)
│
├── netlify/
│   └── functions/
│       ├── generate.js                 ← 콘텐츠 생성 (Claude/OpenAI 프록시)
│       ├── create-checkout.js          ← Stripe Checkout 세션 생성
│       ├── stripe-webhook.js           ← Stripe 웹훅 (플랜 자동 변경)
│       ├── cancel-subscription.js      ← 구독 취소
│       └── customer-portal.js          ← Stripe 고객 포털
│
└── public/
    ├── index.html                      ← 메인 페이지
    ├── css/
    │   ├── style.css                   ← 공통 스타일
    │   ├── pricing.css                 ← 요금제 페이지 스타일
    │   ├── dashboard.css               ← 대시보드 스타일
    │   └── admin.css                   ← 관리자 스타일
    ├── js/
    │   ├── supabase-client.js          ← Supabase 초기화 + 유틸
    │   ├── auth.js                     ← 인증 모달 + 세션 관리
    │   ├── app.js                      ← 메인 생성 로직
    │   ├── pricing.js                  ← 요금제 페이지 로직
    │   ├── dashboard.js                ← 대시보드 로직
    │   └── admin.js                    ← 관리자 대시보드
    └── pages/
        ├── pricing.html                ← 요금제 페이지
        ├── dashboard.html              ← 사용자 대시보드
        └── admin.html                  ← 관리자 페이지
```

---

## STEP 1 — Supabase 설정

### 1-1. 프로젝트 생성
1. [supabase.com](https://supabase.com) → 로그인 → **New Project**
2. 프로젝트명: `contenty`, 지역: **Northeast Asia (Seoul)** 선택
3. 데이터베이스 비밀번호 메모해두기

### 1-2. SQL 스키마 실행
1. Supabase 대시보드 → **SQL Editor** → **New query**
2. `supabase-schema.sql` 파일 전체 내용 붙여넣기 → **Run**

### 1-3. Google OAuth 설정
1. [Google Cloud Console](https://console.cloud.google.com) → API 및 서비스 → 사용자 인증 정보
2. **OAuth 2.0 클라이언트 ID** 생성
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI 추가:
     ```
     https://[YOUR_PROJECT_REF].supabase.co/auth/v1/callback
     ```
3. Client ID, Client Secret 복사
4. Supabase 대시보드 → **Authentication** → **Providers** → **Google** → 활성화
5. Client ID, Client Secret 붙여넣기 → Save

### 1-4. API 키 확인
Supabase 대시보드 → **Settings** → **API** 에서:
- `Project URL` → `SUPABASE_URL`
- `anon public` → `SUPABASE_ANON_KEY` (클라이언트용)
- `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY` (서버용, 절대 노출 금지)

### 1-5. supabase-client.js 수정
`public/js/supabase-client.js` 파일에서:
```javascript
const SUPABASE_URL = 'https://xxxx.supabase.co';   // ← 실제 URL로 변경
const SUPABASE_ANON_KEY = 'eyJhbGc...';             // ← 실제 anon key로 변경
```

---

## STEP 2 — Stripe 설정

### 2-1. 계정 및 상품 생성
1. [stripe.com](https://stripe.com) → 회원가입 → 대시보드
2. **Products** → **Add Product**

**Starter 플랜:**
- Name: `Contenty Starter`
- Price: `29000` KRW / month (recurring)
- → **Add Product** 후 생성된 **Price ID** 복사 (`price_xxx...`)

**Pro 플랜:**
- Name: `Contenty Pro`
- Price: `59000` KRW / month (recurring)
- → Price ID 복사

### 2-2. API 키 확인
Stripe 대시보드 → **Developers** → **API keys**:
- `Publishable key` → 프론트엔드용 (현재 미사용)
- `Secret key` → `STRIPE_SECRET_KEY` (서버용, 절대 노출 금지)

### 2-3. 웹훅 설정
1. Stripe 대시보드 → **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL:
   ```
   https://[YOUR_NETLIFY_SITE].netlify.app/.netlify/functions/stripe-webhook
   ```
3. 이벤트 선택:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. **Add endpoint** → **Signing secret** 복사 → `STRIPE_WEBHOOK_SECRET`

### 2-4. Customer Portal 활성화
Stripe 대시보드 → **Settings** → **Billing** → **Customer portal** → **Activate**

---

## STEP 3 — Netlify 배포

### 3-1. GitHub에 코드 올리기
```bash
git init
git add .
git commit -m "feat: add auth, payments, admin"
git remote add origin https://github.com/YOUR_USERNAME/contenty.git
git push -u origin main
```

### 3-2. Netlify 연결
1. [netlify.com](https://netlify.com) → **Add new site** → **Import an existing project**
2. GitHub 연결 → `contenty` 레포 선택
3. Build settings:
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
4. **Deploy site**

### 3-3. 환경변수 설정 (⚠️ 가장 중요)
Netlify 대시보드 → **Site settings** → **Environment variables** → **Add a variable**:

| Key | Value | 설명 |
|-----|-------|------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | Supabase service_role key |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe Secret Key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe 웹훅 서명 시크릿 |
| `STRIPE_PRICE_STARTER` | `price_xxx` | Starter 플랜 Price ID |
| `STRIPE_PRICE_PRO` | `price_xxx` | Pro 플랜 Price ID |
| `SITE_URL` | `https://contenty-official.netlify.app` | 사이트 URL (결제 후 리디렉션) |

> ⚠️ 환경변수 설정 후 반드시 **Trigger deploy** → **Deploy site** 재배포

### 3-4. 웹훅 URL 업데이트
배포 완료 후 실제 Netlify URL로 Stripe 웹훅 URL 업데이트:
```
https://contenty-official.netlify.app/.netlify/functions/stripe-webhook
```

---

## STEP 4 — 관리자 계정 설정

1. 먼저 관리자로 사용할 이메일로 Contenty 회원가입
2. Supabase SQL Editor에서 실행:
```sql
UPDATE public.users 
SET is_admin = TRUE 
WHERE email = 'your-admin@email.com';
```
3. `/admin` 페이지 접근 가능

---

## STEP 5 — 테스트

### 결제 테스트 (Stripe 테스트 모드)
- 테스트 카드: `4242 4242 4242 4242`
- 만료일: 아무 미래 날짜
- CVC: 아무 3자리

### 체크리스트
- [ ] 이메일 회원가입 → 이메일 확인 링크 클릭 → 로그인
- [ ] Google 소셜 로그인
- [ ] Free 플랜으로 10회 생성 → 11번째에 결제 페이지 이동
- [ ] Starter 결제 → 플랜 자동 변경 확인
- [ ] 구독 취소 → Free 전환 확인
- [ ] 관리자 페이지 통계 확인

---

## 🔒 보안 주의사항

1. **절대 코드에 하드코딩 금지**: `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
2. **supabase-client.js의 anon key는 공개 가능** (RLS로 보호됨)
3. **Service Role Key는 Netlify Functions에서만 사용** (클라이언트 노출 금지)
4. **웹훅 서명 검증** (`stripe-webhook.js`에 이미 구현됨)
5. **모든 Functions에서 JWT 토큰 검증** (이미 구현됨)

---

## ❓ 문제 해결

**함수 오류 확인**: Netlify 대시보드 → Functions → 해당 함수 클릭 → Logs

**Stripe 웹훅 미작동**: Stripe 대시보드 → Webhooks → 해당 엔드포인트 → 이벤트 로그 확인

**Supabase RLS 오류**: SQL Editor에서 `SELECT * FROM public.users LIMIT 5;` 실행해 데이터 확인

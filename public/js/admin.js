// ================================================================
// admin.js — 관리자 대시보드
// ================================================================

const PAGE_SIZE = 20;
let allUsers = [];
let filteredUsers = [];
let currentPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
  let waited = 0;
  while (!currentUser && waited < 2000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  checkAdminAccess();
});

function onAuthSignIn(user, profile) {
  checkAdminAccess();
}

function checkAdminAccess() {
  const isAdmin = currentProfile?.is_admin === true;

  if (!currentUser || !isAdmin) {
    document.getElementById('adminMain').style.display = 'none';
    document.getElementById('adminBlocked').style.display = 'block';
    return;
  }

  document.getElementById('adminMain').style.display = 'block';
  document.getElementById('adminBlocked').style.display = 'none';
  loadAdminData();
}

async function loadAdminData() {
  await Promise.all([loadStats(), loadUsers()]);
}

// ── 통계 ────────────────────────────────────────────────────────
async function loadStats() {
  const { data: users, error } = await _supabase
    .from('users')
    .select('plan, daily_usage, created_at');

  if (error || !users) return;

  const total = users.length;
  const paid = users.filter(u => u.plan === 'starter' || u.plan === 'pro').length;
  const starters = users.filter(u => u.plan === 'starter').length;
  const pros = users.filter(u => u.plan === 'pro').length;
  const revenue = (starters * 29000) + (pros * 59000);
  const todayGenerations = users.reduce((sum, u) => sum + (u.daily_usage || 0), 0);

  document.getElementById('statTotal').textContent = total.toLocaleString() + '명';
  document.getElementById('statPaid').textContent = paid.toLocaleString() + '명';
  document.getElementById('statRevenue').textContent = revenue.toLocaleString() + '원';
  document.getElementById('statGenerations').textContent = todayGenerations.toLocaleString() + '회';

  // 플랜 분포
  const frees = users.filter(u => !u.plan || u.plan === 'free').length;
  document.getElementById('planBreakdown').innerHTML = `
    <div class="plan-bar"><div class="plan-bar-label">Free</div><div class="plan-bar-value">${frees}</div></div>
    <div class="plan-bar"><div class="plan-bar-label">Starter</div><div class="plan-bar-value" style="color:var(--yellow)">${starters}</div></div>
    <div class="plan-bar"><div class="plan-bar-label">Pro</div><div class="plan-bar-value" style="color:var(--accent)">${pros}</div></div>
  `;
}

// ── 회원 목록 ────────────────────────────────────────────────────
async function loadUsers() {
  const { data, error } = await _supabase
    .from('users')
    .select('id, email, plan, daily_usage, total_usage, created_at, stripe_customer_id')
    .order('created_at', { ascending: false });

  if (error) {
    document.getElementById('userTableBody').innerHTML =
      `<tr><td colspan="6" class="loading-row" style="color:var(--red)">데이터 로딩 실패: ${error.message}</td></tr>`;
    return;
  }

  allUsers = data || [];
  filteredUsers = [...allUsers];
  renderTable();

  // 검색 & 필터
  document.getElementById('searchInput').addEventListener('input', applyFilter);
  document.getElementById('planFilter').addEventListener('change', applyFilter);
}

function applyFilter() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const planFilter = document.getElementById('planFilter').value;

  filteredUsers = allUsers.filter(u => {
    const matchSearch = !search || (u.email || '').toLowerCase().includes(search);
    const matchPlan = !planFilter || (u.plan || 'free') === planFilter;
    return matchSearch && matchPlan;
  });

  currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('userTableBody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageUsers = filteredUsers.slice(start, start + PAGE_SIZE);

  if (pageUsers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading-row">검색 결과가 없습니다.</td></tr>`;
    renderPagination();
    return;
  }

  tbody.innerHTML = pageUsers.map(u => {
    const plan = u.plan || 'free';
    return `
      <tr>
        <td>${escapeHtml(u.email || '—')}</td>
        <td><span class="plan-tag ${plan}">${planLabel(plan)}</span></td>
        <td>${u.daily_usage || 0}회</td>
        <td>${u.total_usage || 0}회</td>
        <td>${formatDate(u.created_at)}</td>
        <td>
          <select class="plan-filter-select" style="font-size:0.8rem;padding:0.3rem 0.5rem" 
            onchange="adminChangePlan('${u.id}', this.value)">
            <option value="free" ${plan==='free'?'selected':''}>Free</option>
            <option value="starter" ${plan==='starter'?'selected':''}>Starter</option>
            <option value="pro" ${plan==='pro'?'selected':''}>Pro</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');

  renderPagination();
}

function renderPagination() {
  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE);
  const container = document.getElementById('tablePagination');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  container.innerHTML = html;
}

function goPage(p) {
  currentPage = p;
  renderTable();
}

// ── 관리자에서 플랜 직접 변경 ────────────────────────────────────
async function adminChangePlan(userId, newPlan) {
  const { error } = await _supabase
    .from('users')
    .update({ plan: newPlan })
    .eq('id', userId);

  if (error) {
    showToast('플랜 변경 실패: ' + error.message, 'error');
  } else {
    showToast(`플랜이 ${planLabel(newPlan)}으로 변경되었습니다.`, 'success');
    const user = allUsers.find(u => u.id === userId);
    if (user) user.plan = newPlan;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

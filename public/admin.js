let currentToken = localStorage.getItem('adminToken') || '';
let currentUserId = null;
let activityCache = null;
let peopleListQs = '';
let peopleListTitle = 'People';

const $ = (id) => document.getElementById(id);

const authHeaders = () => ({
  Authorization: 'Bearer ' + currentToken,
  'Content-Type': 'application/json',
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout(true);
    throw new Error(data.message || 'Session expired');
  }
  return data;
}

function showAlert(message, type = 'success') {
  const container = $('alertContainer');
  const el = document.createElement('div');
  el.className =
    'p-3 rounded-xl shadow-lg text-sm border ' +
    (type === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : 'bg-rose-50 border-rose-200 text-rose-800');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function fmtShort(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSearchType(raw) {
  const key = String(raw || '').toLowerCase();
  if (key === 'both') return 'Followers + following';
  if (key === 'followers') return 'Followers';
  if (key === 'following') return 'Following';
  if (key === 'stories') return 'Stories';
  return raw || '—';
}

function badge(text, tone = 'slate') {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-blue-100 text-blue-800',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
    indigo: 'bg-indigo-100 text-indigo-800',
  };
  return `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${tones[tone] || tones.slate}">${escapeHtml(text)}</span>`;
}

function kpiCard(label, value, hint = '', action = null) {
  const link = action
    ? `<button type="button" class="mt-2 text-xs font-semibold text-indigo-600 hover:underline js-open-people" data-people-extra="${escapeHtml(JSON.stringify(action.extra || {}))}" data-people-title="${escapeHtml(action.title || 'People')}">View people</button>`
    : '';
  return `
    <div class="bg-white border border-slate-200 rounded-2xl p-4">
      <p class="text-xs uppercase tracking-wide text-slate-500">${escapeHtml(label)}</p>
      <p class="text-2xl font-bold text-slate-900 mt-1">${escapeHtml(String(value ?? 0))}</p>
      ${hint ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(hint)}</p>` : ''}
      ${link}
    </div>`;
}

function uniqueVsVolumeHint(unique, volume, volumeWord, whenIdentified) {
  const people = Number(unique) || 0;
  const visits = Number(volume) || 0;
  if (people === 0 && visits > 0) return `0 identified · ${visits} ${volumeWord}`;
  return whenIdentified;
}

function compactEventProps(props = {}) {
  const skip = new Set(['site', 'siteLabel', 'siteUrl', 'referrerHost', 'ua']);
  const out = {};
  Object.entries(props).forEach(([key, value]) => {
    if (skip.has(key) || value == null || value === '') return;
    out[key] = value;
  });
  return out;
}

function barRows(items, labelKey, countKey = 'count') {
  if (!items?.length) return '<p class="text-slate-400">No data yet</p>';
  const barValue = (item) => {
    const preferred = Number(item[countKey]);
    if (Number.isFinite(preferred) && preferred > 0) return preferred;
    const pageViews = Number(item.pageViews);
    if (Number.isFinite(pageViews) && pageViews > 0) return pageViews;
    const fallback = Number(item.count);
    return Number.isFinite(fallback) ? fallback : 0;
  };
  const max = Math.max(...items.map(barValue), 1);
  return items
    .map((item) => {
      const label = item[labelKey] || '—';
      const count = barValue(item);
      const pct = Math.round((count / max) * 100);
      const site = item.site
        ? `<div class="text-[11px] text-slate-500">${escapeHtml(item.site)}</div>`
        : '';
      const url = item.url
        ? `<div class="text-[11px] text-indigo-600 truncate" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>`
        : '';
      const unique = Number(item.visitors);
      const visits = Number(item.pageViews);
      const extraBits = [];
      if (Number.isFinite(visits) && visits > 0) extraBits.push(`${visits} visits`);
      if (Number.isFinite(unique) && unique > 0 && unique !== count) {
        extraBits.push(`${unique} unique people`);
      }
      const extra = extraBits.length
        ? `<div class="text-[11px] text-slate-500">${escapeHtml(extraBits.join(' · '))}</div>`
        : '';
      const geoLink =
        item.country || item.city
          ? `<button type="button" class="text-[11px] font-medium text-indigo-600 hover:underline js-people-geo" data-country="${escapeHtml(item.country || '')}" data-city="${escapeHtml(item.city || '')}">View people</button>`
          : '';
      return `
        <div>
          <div class="flex justify-between gap-2 mb-1">
            <div class="min-w-0">
              <span class="truncate block">${escapeHtml(label)}</span>
              ${site}${url}${extra}${geoLink}
            </div>
            <span class="text-slate-500 shrink-0">${count}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    })
    .join('');
}

function eventSite(e) {
  return e.site || e.props?.siteLabel || '—';
}

function eventUrl(e) {
  return e.url || e.props?.siteUrl || '';
}

function sparkline(series) {
  if (!series?.length) return '<p class="text-slate-400 text-sm">No events in range</p>';
  const max = Math.max(...series.map((s) => Number(s.count || 0)), 1);
  return series
    .map((s) => {
      const h = Math.max(4, Math.round((Number(s.count || 0) / max) * 48));
      return `<span title="${escapeHtml(String(s.day))}: ${s.count}" style="height:${h}px"></span>`;
    })
    .join('');
}

function getActiveSub(user) {
  const now = Date.now();
  return (user.subscriptions || []).find(
    (s) => s.status === 'active' && s.endDate && new Date(s.endDate).getTime() > now
  );
}

function accessLabel(user) {
  const active = getActiveSub(user);
  if (!active) return badge('Free', 'slate');
  return `${badge(active.plan, 'indigo')} <span class="text-xs text-slate-500">until ${fmtShort(active.endDate)}</span>`;
}

// Auth
async function login() {
  try {
    const admin_login = $('adminLogin').value.trim();
    const admin_password = $('adminPassword').value;
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_login, admin_password }),
    });
    const data = await res.json();
    if (!data.success) {
      showAlert(data.message || 'Login failed', 'error');
      return;
    }
    currentToken = data.token;
    localStorage.setItem('adminToken', currentToken);
    showConsole();
  } catch {
    showAlert('Server connection error', 'error');
  }
}

function logout(silent = false) {
  currentToken = '';
  localStorage.removeItem('adminToken');
  $('adminPanel').style.display = 'none';
  $('loginForm').style.display = 'flex';
  if (!silent) showAlert('Logged out', 'success');
}

function showConsole() {
  $('loginForm').style.display = 'none';
  $('adminPanel').style.display = 'block';
  switchTab('overview');
}

// Tabs
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('tab-active', active);
    tab.classList.toggle('text-white', active);
    tab.classList.toggle('text-slate-400', !active);
    tab.classList.toggle('border-transparent', !active);
  });
  document.querySelectorAll('.tab-content').forEach((el) => {
    el.style.display = 'none';
  });
  const panel = $(tabName + 'Tab');
  if (panel) panel.style.display = 'block';

  if (tabName === 'overview') loadOverview();
  else if (tabName === 'users') loadUsers();
  else if (tabName === 'subscriptions') loadSubscriptions();
  else if (tabName === 'activity') loadActivityDashboard();
  else if (tabName === 'people') loadPeopleList(1);
  else if (tabName === 'blocks') loadBlockedIps();
  else if (tabName === 'searches') loadSearches();
  else if (tabName === 'audits') loadAudits();
}

function compactPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, 2, total - 1, total, current, current - 1, current + 1]);
  const nums = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  nums.forEach((p) => {
    if (prev && p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  });
  return out;
}

function displayPagination(pagination, containerId, loadFn) {
  const container = $(containerId);
  if (!container || !pagination) return;
  container.innerHTML = '';
  const totalPages = Number(pagination.totalPages || 0);
  const current = Number(pagination.currentPage || 1);
  const total = Number(pagination.totalItems ?? pagination.total ?? 0);
  const limit = Number(pagination.limit || 25);
  if (totalPages <= 1 && total <= limit) return;
  const start = total === 0 ? 0 : (current - 1) * limit + 1;
  const end = Math.min(current * limit, total);
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center justify-center gap-3 flex-wrap';
  const info = document.createElement('p');
  info.className = 'text-sm text-slate-500';
  info.textContent = total ? `${start}–${end} of ${total}` : '';
  wrap.appendChild(info);
  if (totalPages <= 1) {
    container.appendChild(wrap);
    return;
  }
  const nav = document.createElement('div');
  nav.className = 'flex items-center gap-1';
  const addBtn = (label, page, opts = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const isCurrent = Boolean(opts.current);
    const disabled = Boolean(opts.disabled || opts.ellipsis);
    btn.disabled = disabled;
    btn.className = isCurrent
      ? 'min-w-[2rem] px-2.5 py-1 rounded-lg border text-sm bg-blue-600 text-white border-blue-600'
      : disabled
        ? 'min-w-[2rem] px-2.5 py-1 rounded-lg border text-sm text-slate-400 border-slate-200 cursor-default'
        : 'min-w-[2rem] px-2.5 py-1 rounded-lg border text-sm bg-white border-slate-300 hover:bg-slate-50';
    if (!disabled && page) btn.addEventListener('click', () => loadFn(page));
    nav.appendChild(btn);
  };
  addBtn('Prev', current - 1, { disabled: current <= 1 });
  compactPageList(current, totalPages).forEach((item) => {
    if (item === '…') addBtn('…', null, { ellipsis: true });
    else addBtn(String(item), item, { current: item === current });
  });
  addBtn('Next', current + 1, { disabled: current >= totalPages });
  wrap.appendChild(nav);
  container.appendChild(wrap);
}

// Overview
async function loadOverview() {
  try {
    const days = $('overviewDays')?.value || '7';
    const [stats, activity] = await Promise.all([
      api('/api/admin/stats'),
      api(`/api/admin/activity/summary?days=${days}`),
    ]);
    if (!stats.success) throw new Error(stats.message || 'stats failed');
    const s = stats.data;
    activityCache = activity.success ? activity.data : null;
    const a = activityCache || {};

    $('statsGrid').innerHTML = [
      kpiCard('Total users', s.totalUsers),
      kpiCard('Paid / comp', s.premiumUsers, `${s.expiringSoon || 0} expiring ≤7d`),
      kpiCard('Active 30d', s.activeUsers, 'last login'),
      kpiCard('Signups 7d', s.recentUsers, `${s.signupsToday || 0} today`),
      kpiCard('Searches 7d', s.searches7d, `${s.searchesToday || 0} today`),
      kpiCard('Stripe linked', s.stripeLinkedUsers || 0),
    ].join('');

    $('overviewSpark').innerHTML = sparkline(a.dailySeries || []);
    $('overviewFunnel').innerHTML = barRows(a.funnel || [], 'step');
    $('overviewPlanMix').innerHTML = barRows(s.planMix || a.planMix || [], 'plan');
    $('overviewFeatures').innerHTML = barRows(a.featureUsage || [], 'event');
    $('overviewEvents').innerHTML = (a.recentEvents || [])
      .slice(0, 20)
      .map((e) => {
        const url = eventUrl(e);
        return `
        <div class="flex justify-between gap-3 border-b border-slate-100 py-2">
          <div class="min-w-0">
            <div class="font-medium truncate">${escapeHtml(e.event)}</div>
            <div class="text-xs text-slate-500 truncate">${escapeHtml(eventSite(e))}</div>
            <div class="text-xs text-indigo-600 truncate" title="${escapeHtml(url || e.path || '')}">${escapeHtml(url || e.path || '—')}</div>
          </div>
          <div class="text-xs text-slate-400 shrink-0">${fmtDate(e.ts)}</div>
        </div>`;
      })
      .join('') || '<p class="text-slate-400">No events yet — browse the app to populate.</p>';

    $('overviewAudits').innerHTML = (a.recentAudits || [])
      .slice(0, 20)
      .map(
        (x) => `
        <div class="border-b border-slate-100 py-2">
          <div class="flex justify-between gap-2">
            <span class="font-medium">${escapeHtml(x.action)}</span>
            <span class="text-xs text-slate-400">${fmtDate(x.createdAt || x.created_at)}</span>
          </div>
          <div class="text-xs text-slate-500">by ${escapeHtml(x.actorLogin || x.actor_login || 'admin')} · target ${escapeHtml(x.targetUserId || x.target_user_id || '—')}</div>
        </div>`
      )
      .join('') || '<p class="text-slate-400">No admin actions yet.</p>';
  } catch (err) {
    console.error(err);
    showAlert('Failed to load overview', 'error');
  }
}

// Users
async function loadUsers(page = 1) {
  try {
    const search = $('userSearch').value.trim();
    const role = $('roleFilter').value;
    let url = `/api/admin/users?page=${page}&limit=15`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (role) url += `&role=${encodeURIComponent(role)}`;
    const data = await api(url);
    if (!data.success) throw new Error(data.message);
    displayUsers(data.data.users);
    displayPagination(data.data.pagination, 'usersPagination', loadUsers);
  } catch (err) {
    console.error(err);
    showAlert('Failed to load users', 'error');
  }
}

function displayUsers(users) {
  const tbody = $('usersTableBody');
  tbody.innerHTML = '';
  users.forEach((user) => {
    const role = user.role === 'premium' ? 'user' : user.role;
    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-50';
    row.innerHTML = `
      <td class="px-3 py-3">
        <div class="font-medium">@${escapeHtml(user.username)}</div>
        <div class="text-xs text-slate-500">${escapeHtml(user.email)}</div>
        <div class="text-[11px] text-slate-400 font-mono">${escapeHtml(user.id)}</div>
      </td>
      <td class="px-3 py-3">${badge(role, role === 'admin' ? 'rose' : 'green')}</td>
      <td class="px-3 py-3">${accessLabel(user)}</td>
      <td class="px-3 py-3">${user.stripeCustomerId ? badge('Linked', 'blue') : badge('None', 'slate')}</td>
      <td class="px-3 py-3 text-slate-500">${fmtShort(user.created_at || user.createdAt)}</td>
      <td class="px-3 py-3 space-x-2 whitespace-nowrap">
        <button class="btn-view text-indigo-600 hover:underline" data-user-id="${user.id}">Details</button>
        <button class="btn-subscription text-emerald-600 hover:underline" data-user-id="${user.id}">Access</button>
        <button class="btn-edit text-blue-600 hover:underline" data-user-id="${user.id}">Edit</button>
        <button class="btn-delete text-rose-600 hover:underline" data-user-id="${user.id}">Delete</button>
      </td>`;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll('.btn-view').forEach((btn) =>
    btn.addEventListener('click', () => openUserDrawer(btn.dataset.userId))
  );
  tbody.querySelectorAll('.btn-subscription').forEach((btn) =>
    btn.addEventListener('click', () => manageSubscription(btn.dataset.userId))
  );
  tbody.querySelectorAll('.btn-edit').forEach((btn) =>
    btn.addEventListener('click', () => editUser(btn.dataset.userId))
  );
  tbody.querySelectorAll('.btn-delete').forEach((btn) =>
    btn.addEventListener('click', () => deleteUser(btn.dataset.userId))
  );
}

async function editUser(userId) {
  currentUserId = userId;
  try {
    const data = await api(`/api/admin/users/${userId}`);
    if (!data.success) throw new Error(data.message);
    const user = data.data.user || data.data;
    $('editUsername').value = user.username || '';
    $('editEmail').value = user.email || '';
    $('editRole').value = user.role === 'premium' ? 'user' : user.role || 'user';
    $('editFirstName').value = user.first_name || user.firstName || '';
    $('editLastName').value = user.last_name || user.lastName || '';
    $('editModal').style.display = 'block';
  } catch {
    showAlert('Failed to load user', 'error');
  }
}

async function saveUser() {
  try {
    const body = {
      username: $('editUsername').value.trim(),
      email: $('editEmail').value.trim(),
      role: $('editRole').value,
      first_name: $('editFirstName').value.trim(),
      last_name: $('editLastName').value.trim(),
    };
    const data = await api(`/api/admin/users/${currentUserId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!data.success) {
      showAlert(data.message || 'Update failed', 'error');
      return;
    }
    showAlert('User updated');
    closeModal();
    loadUsers();
  } catch {
    showAlert('Update failed', 'error');
  }
}

async function deleteUser(userId) {
  if (!confirm('Delete this user and their local subscriptions? This cannot be undone.')) return;
  try {
    const data = await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (!data.success) {
      showAlert(data.message || 'Delete failed', 'error');
      return;
    }
    showAlert('User deleted');
    loadUsers();
    loadOverview();
  } catch {
    showAlert('Delete failed', 'error');
  }
}

// Subscriptions
async function loadSubscriptions(page = 1) {
  try {
    const status = $('statusFilter').value;
    let url = `/api/admin/subscriptions?page=${page}&limit=20`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    const data = await api(url);
    if (!data.success) throw new Error(data.message);
    displaySubscriptions(data.data.subscriptions);
    displayPagination(data.data.pagination, 'subscriptionsPagination', loadSubscriptions);
  } catch {
    showAlert('Failed to load subscriptions', 'error');
  }
}

function displaySubscriptions(subscriptions) {
  const tbody = $('subscriptionsTableBody');
  tbody.innerHTML = '';
  subscriptions.forEach((sub) => {
    const source = sub.stripeSubscriptionId ? 'Stripe' : 'Local/comp';
    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-50';
    row.innerHTML = `
      <td class="px-3 py-3 font-mono text-xs">${sub.id}</td>
      <td class="px-3 py-3">${escapeHtml(sub.user?.username || 'N/A')}<div class="text-xs text-slate-400">${escapeHtml(sub.user?.email || '')}</div></td>
      <td class="px-3 py-3">${badge(sub.plan, 'indigo')}</td>
      <td class="px-3 py-3">${badge(sub.status, sub.status === 'active' ? 'green' : 'amber')}</td>
      <td class="px-3 py-3">${fmtDate(sub.endDate || sub.end_date)}</td>
      <td class="px-3 py-3">${sub.searchesUsed ?? sub.searches_used ?? 0}/${sub.searchesLimit ?? sub.searches_limit ?? '—'}</td>
      <td class="px-3 py-3">${badge(source, source === 'Stripe' ? 'blue' : 'slate')}</td>
      <td class="px-3 py-3">${sub.userId || sub.user_id ? `<button class="text-indigo-600 hover:underline btn-open-user" data-user-id="${sub.userId || sub.user_id}">Open</button>` : ''}</td>`;
    tbody.appendChild(row);
  });
  tbody.querySelectorAll('.btn-open-user').forEach((btn) =>
    btn.addEventListener('click', () => openUserDrawer(btn.dataset.userId))
  );
}

function manageSubscription(userId) {
  currentUserId = userId;
  $('subscriptionModal').style.display = 'block';
}

async function saveSubscription() {
  try {
    const action = $('subscriptionAction').value;
    const plan = $('subscriptionPlan').value;
    const endDate = $('subscriptionEndDate').value;
    const searchesLimit = parseInt($('subscriptionSearchesLimit').value, 10);
    const days = parseInt($('subscriptionDays').value, 10) || 30;
    const body = {
      action,
      plan,
      days,
      endDate: endDate ? new Date(endDate).toISOString() : null,
      searchesLimit: Number.isFinite(searchesLimit) ? searchesLimit : undefined,
    };
    const data = await api(`/api/admin/users/${currentUserId}/subscription`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!data.success) {
      showAlert(data.message || 'Access update failed', 'error');
      return;
    }
    showAlert(data.message || 'Access updated');
    closeModal();
    loadUsers();
    loadSubscriptions();
    loadOverview();
    if ($('userDrawer').style.display !== 'none') openUserDrawer(currentUserId);
  } catch {
    showAlert('Access update failed', 'error');
  }
}

function syncActivityRangeUi() {
  const mode = $('activityDays')?.value || '24h';
  const custom = $('activityCustomRange');
  if (!custom) return;
  custom.style.display = mode === 'custom' ? 'flex' : 'none';
  if (mode === 'custom') {
    const today = new Date().toISOString().slice(0, 10);
    if ($('activityTo') && !$('activityTo').value) $('activityTo').value = today;
    if ($('activityFrom') && !$('activityFrom').value) {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      $('activityFrom').value = d.toISOString().slice(0, 10);
    }
  }
}

function getActivityRangeQuery() {
  const mode = $('activityDays')?.value || '24h';
  if (mode === 'custom') {
    const from = $('activityFrom')?.value || '';
    const to = $('activityTo')?.value || '';
    if (!from && !to) {
      const fallback = new URLSearchParams();
      fallback.set('hours', '24');
      if ($('activityIncludeBots')?.checked) fallback.set('includeBots', '1');
      return fallback.toString();
    }
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    else if (from) params.set('to', from);
    if ($('activityIncludeBots')?.checked) params.set('includeBots', '1');
    return params.toString();
  }
  const params = new URLSearchParams();
  if (mode === '24h') params.set('hours', '24');
  else params.set('days', mode);
  if ($('activityIncludeBots')?.checked) params.set('includeBots', '1');
  return params.toString();
}

// Activity
async function loadActivityDashboard() {
  try {
    syncActivityRangeUi();
    const rangeQs = getActivityRangeQuery();
    const event = $('eventFilter')?.value || '';
    const [summary, events] = await Promise.all([
      api(`/api/admin/activity/summary?${rangeQs}`),
      api(`/api/admin/activity/events?${rangeQs}&limit=80${event ? `&event=${encodeURIComponent(event)}` : ''}`),
    ]);
    if (!summary.success) {
      $('activityKpis').innerHTML = `<p class="text-rose-600 col-span-full">${escapeHtml(summary.message || 'Failed')}</p>`;
      return;
    }
    const s = summary.data;
    activityCache = s;
    if ($('activityRangeHint')) {
      $('activityRangeHint').textContent = s.rangeLabel
        ? `Showing: ${s.rangeLabel} · Events / funnel / stream use this window. DAU/WAU/MAU stay fixed (1d / 7d / 30d). Locations/traffic: ${
            s.includeBots ? 'all visits including API/bots' : 'people only (browsers + searches)'
          }.`
        : '';
    }
    $('activityKpis').innerHTML = [
      kpiCard('Visits', s.pageViewsInRange, 'page views + story loads', {
        extra: { scope: 'visits' },
        title: 'People with visits',
      }),
      kpiCard(
        'Unique visitors',
        s.visitorsInRange,
        uniqueVsVolumeHint(
          s.visitorsInRange,
          s.pageViewsInRange,
          'visits',
          'account, browser, or hashed IP'
        ),
        { extra: { scope: 'all' }, title: 'Unique visitors' }
      ),
      kpiCard('Events', s.eventsInRange, s.rangeLabel || '', {
        extra: { scope: 'all' },
        title: 'People in this range',
      }),
      kpiCard('Searches', s.searchesInRange, s.rangeLabel || '', {
        extra: { scope: 'searches' },
        title: 'People who searched',
      }),
      kpiCard(
        'Unique searchers',
        s.uniqueSearchersInRange,
        uniqueVsVolumeHint(
          s.uniqueSearchersInRange,
          s.searchesInRange,
          'searches',
          'people who searched'
        ),
        { extra: { scope: 'searches' }, title: 'Unique searchers' }
      ),
      kpiCard(
        'DAU',
        s.dau,
        s.dau === 0 && (s.rangeLabel === 'Last 24 hours' || s.rangeDays === 1)
          ? uniqueVsVolumeHint(s.dau, s.pageViewsInRange, 'visits in this window', 'identified · last 1 day')
          : 'identified people · rolling last 1 day',
        { extra: { hours: '24', scope: 'all' }, title: 'DAU people' }
      ),
      kpiCard('WAU', s.wau, 'identified people · rolling last 7 days', {
        extra: { days: '7', scope: 'all' },
        title: 'WAU people',
      }),
      kpiCard('MAU', s.mau, 'identified people · rolling last 30 days', {
        extra: { days: '30', scope: 'all' },
        title: 'MAU people',
      }),
      kpiCard('Paid', s.activePaid, 'active subscriptions now'),
      kpiCard('Upgrades CTA', s.upgradeCtas, s.rangeLabel || ''),
      kpiCard('Checkouts', s.checkoutStarted, s.rangeLabel || ''),
    ].join('');
    bindPeopleKpiLinks();
    $('activityFunnel').innerHTML = barRows(s.funnel || [], 'step');
    $('activityTopEvents').innerHTML = barRows(s.topEvents || [], 'event');
    $('activityTopPages').innerHTML = barRows(s.topPages || [], 'path');
    $('activityTopSearches').innerHTML = barRows(s.topSearchTargets || [], 'username');
    if ($('activityTrafficSources')) {
      $('activityTrafficSources').innerHTML = barRows(s.trafficSources || [], 'source');
    }
    if ($('activityVisitorCountries')) {
      $('activityVisitorCountries').innerHTML = barRows(s.visitorCountries || [], 'source');
    }
    if ($('activityVisitorCities')) {
      $('activityVisitorCities').innerHTML = barRows(s.visitorCities || [], 'source');
    }
    bindPeopleGeoLinks();

    const list = events.success ? events.data.events : s.recentEvents || [];
    const shown = list.length;
    const filteredTotal = events.success ? Number(events.data.total ?? shown) : shown;
    if ($('activityStreamCounts')) {
      const chip = (label, value) =>
        `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-slate-700">${escapeHtml(label)} <strong>${escapeHtml(String(value ?? 0))}</strong></span>`;
      $('activityStreamCounts').innerHTML = [
        chip('Visits', s.pageViewsInRange),
        chip('Unique', s.visitorsInRange),
        chip('Searches', s.searchesInRange),
        chip('Events', s.eventsInRange),
      ].join('');
    }
    $('activityEventStream').innerHTML = `
      <table class="min-w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-3 py-2 text-left w-12">#</th>
            <th class="px-3 py-2 text-left">When <span class="normal-case font-normal text-slate-400">Showing ${shown} of ${filteredTotal}</span></th>
            <th class="px-3 py-2 text-left">Event</th>
            <th class="px-3 py-2 text-left">Site</th>
            <th class="px-3 py-2 text-left">URL</th>
            <th class="px-3 py-2 text-left">User / anon</th>
            <th class="px-3 py-2 text-left">IP</th>
            <th class="px-3 py-2 text-left">Props</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${
            list
              .map((e, index) => {
                const url = eventUrl(e);
                const props = compactEventProps(e.props || {});
                const who = e.userId || e.user_id || e.anonId || e.anon_id || 'unidentified';
                const personKind = e.userId || e.user_id ? 'u' : e.anonId || e.anon_id ? 'a' : '';
                const personId = e.userId || e.user_id || e.anonId || e.anon_id || '';
                const ip = e.clientIp || e.client_ip || e.props?.clientIp || '';
                const whoCell = personKind
                  ? `<button type="button" class="text-indigo-600 hover:underline font-mono text-xs js-open-person" data-kind="${personKind}" data-id="${escapeHtml(personId)}">${escapeHtml(who)}</button>`
                  : `<span class="font-mono text-xs">${escapeHtml(who)}</span>`;
                const propsText = Object.keys(props).length ? JSON.stringify(props) : '—';
                return `
            <tr class="hover:bg-slate-50">
              <td class="px-3 py-2 text-slate-400 tabular-nums">${index + 1}</td>
              <td class="px-3 py-2 whitespace-nowrap text-slate-500">${fmtDate(e.ts)}</td>
              <td class="px-3 py-2">${badge(e.event, 'blue')}</td>
              <td class="px-3 py-2 text-xs">${escapeHtml(eventSite(e))}</td>
              <td class="px-3 py-2 text-xs max-w-[260px]">
                ${
                  url
                    ? `<a class="text-indigo-600 hover:underline break-all" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
                    : escapeHtml(e.path || '—')
                }
              </td>
              <td class="px-3 py-2">${whoCell}</td>
              <td class="px-3 py-2 font-mono text-xs">${escapeHtml(ip || '—')}</td>
              <td class="px-3 py-2 text-xs text-slate-500 truncate max-w-[200px]">${escapeHtml(propsText)}</td>
            </tr>`;
              })
              .join('') ||
            '<tr><td colspan="8" class="px-3 py-6 text-slate-400">No events</td></tr>'
          }
        </tbody>
      </table>`;
    bindPersonLinks($('activityEventStream'));
  } catch (err) {
    console.error(err);
    showAlert('Failed to load activity', 'error');
  }
}

// Searches
function getSearchHistoryFilter() {
  const input = $('searchHistoryQuery');
  if (!input) return '';
  const q = input.value.trim();
  if (!q) return '';
  const login = ($('adminLogin')?.value || 'admin').trim().toLowerCase();
  const isAutofill = !input.dataset.userTyped;
  if (isAutofill && q.toLowerCase() === login) {
    input.value = '';
    return '';
  }
  return q;
}

async function loadSearches(page = 1) {
  try {
    const q = getSearchHistoryFilter();
    let url = `/api/admin/searches?page=${page}&limit=25`;
    if (q) url += `&search=${encodeURIComponent(q)}`;
    const data = await api(url);
    if (!data.success) throw new Error(data.message || 'Failed to load searches');
    const tbody = $('searchesTableBody');
    tbody.innerHTML = '';
    data.data.searches.forEach((s) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50';
      const ip = String(s.clientIp || s.ipAddress || s.ip_address || '')
        .replace(/\/\d+$/, '');
      const anonId = s.anonId || s.anon_id || '';
      const userId = s.userId || s.user_id || s.account?.id || '';
      const whoLabel = s.account
        ? `@${s.account.username}`
        : anonId || 'unidentified';
      const personKind = userId ? 'u' : anonId ? 'a' : '';
      const personId = userId || anonId;
      const whoCell = personKind
        ? `<button type="button" class="text-indigo-600 hover:underline font-mono text-xs js-open-person" data-kind="${personKind}" data-id="${escapeHtml(personId)}">${escapeHtml(whoLabel)}</button>`
        : `<span class="text-slate-400">${escapeHtml(whoLabel)}</span>`;
      const url = s.url || '';
      const target = s.targetUsername || s.target_username || '—';
      const blockBtn = ip
        ? `<button type="button" class="text-rose-600 hover:underline text-sm js-block-person" data-ip="${escapeHtml(ip)}" data-anon="${escapeHtml(anonId)}" data-user="${escapeHtml(userId)}">Block</button>`
        : `<span class="text-slate-400 text-xs">No IP</span>`;
      tr.innerHTML = `
        <td class="px-3 py-3 text-slate-500 whitespace-nowrap">${fmtDate(s.ts || s.created_at || s.createdAt)}</td>
        <td class="px-3 py-3 font-medium">@${escapeHtml(target)}</td>
        <td class="px-3 py-3">${badge(formatSearchType(s.searchType || s.search_type))}</td>
        <td class="px-3 py-3 text-xs">${escapeHtml(s.site || '—')}</td>
        <td class="px-3 py-3 text-xs max-w-[220px]">
          ${
            url
              ? `<a class="text-indigo-600 hover:underline break-all" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
              : '—'
          }
        </td>
        <td class="px-3 py-3">${whoCell}</td>
        <td class="px-3 py-3 font-mono text-xs">${escapeHtml(ip || '—')}</td>
        <td class="px-3 py-3 whitespace-nowrap">${blockBtn}</td>`;
      tbody.appendChild(tr);
    });
    bindPersonLinks(tbody);
    tbody.querySelectorAll('.js-block-person').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await blockVisitorIp(btn.dataset.ip, {
          reason: `Blocked from Searches ${btn.dataset.anon || btn.dataset.user || ''}`.trim(),
          anonId: btn.dataset.anon || null,
          userId: btn.dataset.user || null,
        });
        if (ok) loadSearches(page);
      });
    });
    displayPagination(data.data.pagination, 'searchesPagination', loadSearches);
  } catch (err) {
    console.error(err);
    showAlert(err.message || 'Failed to load searches', 'error');
  }
}

// Audits
async function loadAudits(page = 1) {
  try {
    const action = $('auditActionFilter').value;
    let url = `/api/admin/audits?page=${page}&limit=40`;
    if (action) url += `&action=${encodeURIComponent(action)}`;
    const data = await api(url);
    if (!data.success) throw new Error(data.message);
    const tbody = $('auditsTableBody');
    tbody.innerHTML = '';
    data.data.audits.forEach((a) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50';
      const target = a.targetUserId || a.target_user_id;
      tr.innerHTML = `
        <td class="px-3 py-3 text-slate-500 whitespace-nowrap">${fmtDate(a.createdAt || a.created_at)}</td>
        <td class="px-3 py-3">${escapeHtml(a.actorLogin || a.actor_login)}</td>
        <td class="px-3 py-3">${badge(a.action, 'indigo')}</td>
        <td class="px-3 py-3">${
          target
            ? `<button class="text-indigo-600 hover:underline btn-open-user font-mono text-xs" data-user-id="${target}">${target}</button>`
            : '—'
        }</td>
        <td class="px-3 py-3 text-xs text-slate-500 max-w-xs truncate">${escapeHtml(JSON.stringify(a.payload || {}))}</td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.btn-open-user').forEach((btn) =>
      btn.addEventListener('click', () => openUserDrawer(btn.dataset.userId))
    );
    displayPagination(data.data.pagination, 'auditsPagination', loadAudits);
  } catch {
    showAlert('Failed to load audits', 'error');
  }
}

// User drawer
async function openUserDrawer(userId) {
  currentUserId = userId;
  const drawer = $('userDrawer');
  const body = $('userDrawerBody');
  drawer.style.display = 'block';
  body.innerHTML = 'Loading…';
  try {
    const data = await api(`/api/admin/users/${userId}`);
    if (!data.success) {
      body.innerHTML = `<p class="text-rose-600">${escapeHtml(data.message || 'Failed')}</p>`;
      return;
    }
    const {
      user: u,
      localEntitlement: entitlement,
      stripeCustomerId,
      stripeStatus: stripe,
      searchCount,
      recentSearches: searches = [],
      recentAudits: audits = [],
      activityTimeline = [],
      allSubscriptions = [],
    } = data.data;

    body.innerHTML = `
      <div>
        <p class="section-title mb-2">Identity</p>
        <p class="text-lg font-semibold">@${escapeHtml(u.username)}</p>
        <p>${escapeHtml(u.email || '')}</p>
        <p class="text-slate-500 mt-1">ACL: ${escapeHtml(u.role === 'premium' ? 'user' : u.role)} · Last login: ${fmtDate(u.lastLogin || u.last_login)}</p>
        <p class="font-mono text-[11px] text-slate-400 mt-1">${escapeHtml(u.id)}</p>
      </div>
      <div>
        <p class="section-title mb-2">Local entitlement</p>
        ${
          entitlement
            ? `<p>Plan <strong>${escapeHtml(entitlement.plan)}</strong> · ${escapeHtml(entitlement.status)}</p>
               <p>Ends ${fmtDate(entitlement.endDate)}</p>
               <p>Searches ${entitlement.searchesUsed}/${entitlement.searchesLimit}</p>`
            : '<p class="text-slate-500">None (free)</p>'
        }
      </div>
      <div>
        <p class="section-title mb-2">Stripe (read-only)</p>
        <p class="text-xs break-all">Customer: ${escapeHtml(stripeCustomerId || u.stripeCustomerId || '—')}</p>
        ${
          stripe && !stripe.error
            ? `<p class="mt-1">Status: ${escapeHtml(stripe.status || '—')} · ${escapeHtml(stripe.name || stripe.plan || '')}</p>`
            : `<p class="text-slate-500 mt-1">${escapeHtml(stripe?.error || 'No live Stripe subscription')}</p>`
        }
      </div>
      <div>
        <p class="section-title mb-2">Subscription history</p>
        <ul class="space-y-1 text-xs">
          ${(allSubscriptions || [])
            .map(
              (s) =>
                `<li>${badge(s.plan)} ${badge(s.status, s.status === 'active' ? 'green' : 'amber')} ends ${fmtShort(s.endDate)} ${s.stripeSubscriptionId ? '· Stripe' : '· Local'}</li>`
            )
            .join('') || '<li class="text-slate-400">—</li>'}
        </ul>
      </div>
      <div>
        <p class="section-title mb-2">Searches (${searchCount ?? searches.length})</p>
        <ul class="space-y-1 text-xs">
          ${searches
            .slice(0, 8)
            .map((s) => `<li>@${escapeHtml(s.targetUsername)} · ${escapeHtml(formatSearchType(s.searchType))} · ${fmtDate(s.created_at || s.createdAt)}</li>`)
            .join('') || '<li class="text-slate-400">—</li>'}
        </ul>
      </div>
      <div>
        <p class="section-title mb-2">Activity timeline</p>
        <ul class="space-y-1 text-xs max-h-48 overflow-y-auto">
          ${activityTimeline
            .map((e) => {
              const url = eventUrl(e);
              return `<li><strong>${escapeHtml(e.event)}</strong> · ${escapeHtml(eventSite(e))} · ${
                url
                  ? `<a class="text-indigo-600 hover:underline break-all" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
                  : escapeHtml(e.path || '')
              } · ${fmtDate(e.ts)}</li>`;
            })
            .join('') || '<li class="text-slate-400">No tracked events for this user yet</li>'}
        </ul>
      </div>
      <div>
        <p class="section-title mb-2">Admin actions on this user</p>
        <ul class="space-y-1 text-xs">
          ${audits
            .slice(0, 10)
            .map((a) => `<li>${escapeHtml(a.action)} · ${fmtDate(a.createdAt || a.created_at)}</li>`)
            .join('') || '<li class="text-slate-400">—</li>'}
        </ul>
      </div>`;
  } catch {
    body.innerHTML = '<p class="text-rose-600">Server connection error</p>';
  }
}

function closeUserDrawer() {
  $('userDrawer').style.display = 'none';
}

function bindPeopleKpiLinks() {
  document.querySelectorAll('.js-open-people').forEach((btn) => {
    btn.addEventListener('click', () => {
      let extra = {};
      try {
        extra = JSON.parse(btn.dataset.peopleExtra || '{}');
      } catch {
        extra = {};
      }
      openPeopleList(extra, btn.dataset.peopleTitle || 'People');
    });
  });
}

function bindPeopleGeoLinks() {
  document.querySelectorAll('.js-people-geo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const extra = { scope: 'visits' };
      if (btn.dataset.country) extra.country = btn.dataset.country;
      if (btn.dataset.city) extra.city = btn.dataset.city;
      const title = extra.city
        ? `People in ${extra.city}`
        : `People in ${extra.country || 'location'}`;
      openPeopleList(extra, title);
    });
  });
}

function bindPersonLinks(root) {
  root?.querySelectorAll('.js-open-person').forEach((btn) => {
    btn.addEventListener('click', () => openPersonDrawer(btn.dataset.kind, btn.dataset.id));
  });
}

function openPeopleList(extra = {}, title = 'People') {
  const params = new URLSearchParams();
  if (extra.hours || extra.days) {
    if (extra.hours) params.set('hours', String(extra.hours));
    if (extra.days) params.set('days', String(extra.days));
    if ($('activityIncludeBots')?.checked) params.set('includeBots', '1');
  } else {
    new URLSearchParams(getActivityRangeQuery()).forEach((value, key) => {
      params.set(key, value);
    });
  }
  Object.entries(extra).forEach(([key, value]) => {
    if (key === 'hours' || key === 'days') return;
    if (value != null && value !== '') params.set(key, String(value));
  });
  peopleListQs = params.toString();
  peopleListTitle = title;
  switchTab('people');
}

async function loadPeopleList(page = 1) {
  try {
    if (!peopleListQs) {
      peopleListQs = `${getActivityRangeQuery()}&scope=all`;
    }
    const params = new URLSearchParams(peopleListQs);
    params.set('page', String(page));
    params.set('limit', '50');
    const q = $('peopleSearch')?.value?.trim();
    if (q) params.set('q', q);
    else params.delete('q');
    peopleListQs = params.toString();
    const data = await api(`/api/admin/activity/people?${params.toString()}`);
    if (!data.success) throw new Error(data.message || 'Failed');
    if ($('peopleTitle')) $('peopleTitle').textContent = peopleListTitle;
    if ($('peopleHint')) {
      const bits = [data.data.rangeLabel, `${data.data.pagination?.totalItems || 0} people`];
      if (data.data.scope && data.data.scope !== 'all') bits.push(data.data.scope);
      if (data.data.country) bits.push(data.data.country);
      if (data.data.city) bits.push(data.data.city);
      $('peopleHint').textContent = bits.filter(Boolean).join(' · ');
    }
    const tbody = $('peopleTableBody');
    tbody.innerHTML = '';
    (data.data.people || []).forEach((p) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50';
      const label = p.account
        ? `@${p.account.username}`
        : p.anonId || 'anonymous';
      const loc = [p.city, p.region, p.country].filter(Boolean).join(', ') || '—';
      const kind = p.kind === 'user' ? badge('Account', 'indigo') : badge('Anonymous', 'slate');
      const bot = p.isBot ? ` ${badge('bot/api', 'rose')}` : '';
      const personKind = p.kind === 'user' ? 'u' : 'a';
      const personId = p.kind === 'user' ? p.userId : p.anonId;
      tr.innerHTML = `
        <td class="px-3 py-3">
          <div class="font-medium">${escapeHtml(label)}</div>
          <div class="font-mono text-[11px] text-slate-400">${escapeHtml(p.anonId || p.userId || '')}</div>
        </td>
        <td class="px-3 py-3 font-mono text-xs">${escapeHtml(p.clientIp || '—')}</td>
        <td class="px-3 py-3 text-xs">${escapeHtml(loc)}</td>
        <td class="px-3 py-3">${kind}${bot}</td>
        <td class="px-3 py-3 text-xs">${p.eventCount} events · ${p.visitCount} visits · ${p.searchCount} searches</td>
        <td class="px-3 py-3 text-slate-500 whitespace-nowrap">${fmtDate(p.lastSeen)}</td>
        <td class="px-3 py-3 whitespace-nowrap">
          <button type="button" class="text-indigo-600 hover:underline text-sm js-open-person" data-kind="${personKind}" data-id="${escapeHtml(personId || '')}">Details</button>
          ${
            p.clientIp
              ? `<button type="button" class="ml-3 text-rose-600 hover:underline text-sm js-block-person" data-ip="${escapeHtml(p.clientIp)}" data-anon="${escapeHtml(p.anonId || '')}" data-user="${escapeHtml(p.userId || '')}">Block</button>`
              : `<span class="ml-3 text-slate-400 text-xs" title="No stored IP on this visitor">No IP</span>`
          }
        </td>`;
      tbody.appendChild(tr);
    });
    if (!(data.data.people || []).length) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-6 text-slate-400">No people in this window</td></tr>';
    }
    bindPersonLinks(tbody);
    tbody.querySelectorAll('.js-block-person').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await blockVisitorIp(btn.dataset.ip, {
          reason: `Blocked from People ${btn.dataset.anon || btn.dataset.user || ''}`.trim(),
          anonId: btn.dataset.anon || null,
          userId: btn.dataset.user || null,
        });
        if (ok) loadPeopleList(page);
      });
    });
    displayPagination(data.data.pagination, 'peoplePagination', loadPeopleList);
  } catch (err) {
    console.error(err);
    showAlert('Failed to load people', 'error');
  }
}

async function openPersonDrawer(kind, id) {
  const drawer = $('personDrawer');
  const body = $('personDrawerBody');
  if (!drawer || !body || !kind || !id) return;
  drawer.style.display = 'block';
  body.innerHTML = 'Loading…';
  try {
    const data = await api(`/api/admin/activity/people/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
    if (!data.success) {
      body.innerHTML = `<p class="text-rose-600">${escapeHtml(data.message || 'Failed')}</p>`;
      return;
    }
    const p = data.data;
    const acc = p.account;
    const loc = [p.city, p.region, p.country].filter(Boolean).join(', ') || '—';
    const counts = Object.entries(p.eventCounts || {})
      .map(([event, count]) => `${event}: ${count}`)
      .join(' · ');
    const ipList = (p.ips || []).length
      ? p.ips
          .map(
            (ip) => `<li class="flex flex-wrap items-center gap-2">
              <span class="font-mono">${escapeHtml(ip)}</span>
              <button type="button" class="text-xs font-semibold text-rose-600 hover:underline js-block-ip" data-ip="${escapeHtml(ip)}">Block IP</button>
            </li>`
          )
          .join('')
      : '<li class="text-slate-400">No raw IP on stored events — cannot block until an IP is known</li>';
    const uaList = (p.userAgents || []).length
      ? p.userAgents.map((ua) => `<li class="break-all">${escapeHtml(ua)}</li>`).join('')
      : '<li class="text-slate-400">—</li>';
    const originList = (p.origins || []).length
      ? p.origins.map((o) => `<li class="break-all">${escapeHtml(o)}</li>`).join('')
      : '<li class="text-slate-400">—</li>';
    const eventRows = (p.events || [])
      .map((e) => {
        const ip = e.clientIp || e.props?.clientIp || '—';
        return `<tr class="border-t border-slate-100">
          <td class="py-2 whitespace-nowrap text-slate-500">${fmtDate(e.ts)}</td>
          <td class="py-2">${badge(e.event, 'blue')}</td>
          <td class="py-2 font-mono text-xs">${escapeHtml(ip)}</td>
          <td class="py-2 text-xs break-all">${escapeHtml(e.path || e.url || '—')}</td>
          <td class="py-2 text-xs text-slate-500 break-all">${escapeHtml(JSON.stringify(e.props || {}))}</td>
        </tr>`;
      })
      .join('');
    const searchRows = (p.searches || [])
      .map(
        (s) => `<tr class="border-t border-slate-100">
        <td class="py-2 whitespace-nowrap text-slate-500">${fmtDate(s.createdAt || s.created_at)}</td>
        <td class="py-2">@${escapeHtml(s.targetUsername || s.target_username || '')}</td>
        <td class="py-2 font-mono text-xs">${escapeHtml(s.ipAddress || s.ip_address || '—')}</td>
        <td class="py-2">${escapeHtml(s.status || '—')}</td>
      </tr>`
      )
      .join('');
    const accountBlock = acc
      ? `<div>
          <p class="section-title mb-2">Account</p>
          <p class="text-lg font-semibold">@${escapeHtml(acc.username)}</p>
          <p>${escapeHtml(acc.email || '')}</p>
          <p class="text-xs text-slate-500">id ${escapeHtml(acc.id)}</p>
          <button type="button" class="mt-2 text-sm text-indigo-600 hover:underline" id="personOpenAccount">Open account controls</button>
        </div>`
      : `<div>
          <p class="section-title mb-2">Identity</p>
          <p class="font-semibold">Anonymous visitor</p>
          <p class="font-mono text-xs break-all">${escapeHtml(p.anonId || '')}</p>
        </div>`;
    body.innerHTML = `
      ${accountBlock}
      ${p.note ? `<p class="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2">${escapeHtml(p.note)}</p>` : ''}
      <div>
        <p class="section-title mb-2">Network</p>
        <p><span class="text-slate-500">Location</span> ${escapeHtml(loc)}</p>
        <p><span class="text-slate-500">Client</span> ${escapeHtml(p.clientKind || '—')} ${p.isBot ? badge('bot/api', 'rose') : ''}</p>
        <p><span class="text-slate-500">First / last</span> ${fmtDate(p.firstSeen)} → ${fmtDate(p.lastSeen)}</p>
        <p class="mt-2 text-slate-500">IP addresses</p>
        <ul class="list-disc pl-5 space-y-1">${ipList}</ul>
        ${
          (p.ips || []).length > 1
            ? `<button type="button" class="mt-2 text-xs font-semibold text-rose-700 hover:underline" id="personBlockAllIps">Block all IPs</button>`
            : ''
        }
        ${p.events?.some((e) => e.ipInferred) ? '<p class="text-[11px] text-slate-500 mt-1">Some event rows show an inferred IP from matching search history.</p>' : ''}
        <p class="mt-2 text-slate-500">User agents</p>
        <ul class="list-disc pl-5 space-y-1">${uaList}</ul>
        <p class="mt-2 text-slate-500">Origin / referer hosts</p>
        <ul class="list-disc pl-5 space-y-1">${originList}</ul>
      </div>
      <div>
        <p class="section-title mb-2">Event mix</p>
        <p>${escapeHtml(counts || '—')}</p>
      </div>
      <div>
        <p class="section-title mb-2">Events</p>
        <div class="overflow-x-auto">
          <table class="min-w-full text-xs">
            <thead class="text-slate-500 uppercase"><tr>
              <th class="text-left py-1">When</th><th class="text-left py-1">Event</th>
              <th class="text-left py-1">IP</th><th class="text-left py-1">Path</th><th class="text-left py-1">Props</th>
            </tr></thead>
            <tbody>${eventRows || '<tr><td class="py-3 text-slate-400" colspan="5">None</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div>
        <p class="section-title mb-2">Related searches</p>
        <div class="overflow-x-auto">
          <table class="min-w-full text-xs">
            <thead class="text-slate-500 uppercase"><tr>
              <th class="text-left py-1">When</th><th class="text-left py-1">Target</th>
              <th class="text-left py-1">IP</th><th class="text-left py-1">Status</th>
            </tr></thead>
            <tbody>${searchRows || '<tr><td class="py-3 text-slate-400" colspan="4">None</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    $('personOpenAccount')?.addEventListener('click', () => {
      closePersonDrawer();
      openUserDrawer(acc.id);
    });
    const blockReason = `Blocked from People ${p.anonId || p.userId || ''}`.trim();
    body.querySelectorAll('.js-block-ip').forEach((btn) => {
      btn.addEventListener('click', () =>
        blockVisitorIp(btn.dataset.ip, {
          reason: blockReason,
          anonId: p.anonId,
          userId: p.userId,
        })
      );
    });
    $('personBlockAllIps')?.addEventListener('click', async () => {
      if (!confirm('Block every IP listed for this visitor?')) return;
      for (const ip of p.ips || []) {
        await blockVisitorIp(ip, {
          reason: blockReason,
          anonId: p.anonId,
          userId: p.userId,
          silent: true,
        });
      }
      showAlert('Blocked all listed IPs');
    });
  } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="text-rose-600">${escapeHtml(err.message || 'Failed')}</p>`;
  }
}

function closePersonDrawer() {
  if ($('personDrawer')) $('personDrawer').style.display = 'none';
}

async function blockVisitorIp(ip, { reason = '', anonId = null, userId = null, silent = false } = {}) {
  if (!ip) {
    showAlert('No IP to block', 'error');
    return;
  }
  if (!silent && !confirm(`Block ${ip}? They will lose API access on both sites.`)) return;
  const data = await api('/api/admin/blocks', {
    method: 'POST',
    body: JSON.stringify({ ip, reason, anonId, userId }),
  });
  if (!data.success) {
    showAlert(data.message || 'Block failed', 'error');
    return false;
  }
  if (!silent) showAlert(data.message || 'IP blocked');
  return true;
}

async function loadBlockedIps() {
  try {
    const data = await api('/api/admin/blocks');
    if (!data.success) throw new Error(data.message);
    const tbody = $('blocksTableBody');
    tbody.innerHTML = '';
    const rows = data.data.blocks || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-6 text-slate-400">No blocked IPs</td></tr>';
      return;
    }
    rows.forEach((b) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50';
      const visitor = b.anonId || b.anon_id || b.userId || b.user_id || '—';
      tr.innerHTML = `
        <td class="px-3 py-3 font-mono text-xs">${escapeHtml(b.ip)}</td>
        <td class="px-3 py-3 text-xs">${escapeHtml(b.reason || '—')}</td>
        <td class="px-3 py-3 font-mono text-[11px] text-slate-500">${escapeHtml(visitor)}</td>
        <td class="px-3 py-3">${escapeHtml(b.actorLogin || b.actor_login || '—')}</td>
        <td class="px-3 py-3 text-slate-500 whitespace-nowrap">${fmtDate(b.createdAt || b.created_at)}</td>
        <td class="px-3 py-3">
          <button type="button" class="text-indigo-600 hover:underline text-sm js-unblock-ip" data-ip="${escapeHtml(b.ip)}">Unblock</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.js-unblock-ip').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Unblock ${btn.dataset.ip}?`)) return;
        const res = await api(`/api/admin/blocks/${encodeURIComponent(btn.dataset.ip)}`, {
          method: 'DELETE',
        });
        if (!res.success) {
          showAlert(res.message || 'Unblock failed', 'error');
          return;
        }
        showAlert('IP unblocked');
        loadBlockedIps();
      });
    });
  } catch (err) {
    console.error(err);
    showAlert('Failed to load blocked IPs', 'error');
  }
}

function closeModal() {
  $('editModal').style.display = 'none';
  $('subscriptionModal').style.display = 'none';
  $('passwordModal').style.display = 'none';
}

function openPasswordModal() {
  $('currentAdminPassword').value = '';
  $('newAdminPassword').value = '';
  $('confirmAdminPassword').value = '';
  $('passwordModal').style.display = 'block';
}

async function saveAdminPassword() {
  try {
    const currentPassword = $('currentAdminPassword').value;
    const newPassword = $('newAdminPassword').value;
    const confirmPassword = $('confirmAdminPassword').value;
    if (!currentPassword || !newPassword) {
      showAlert('Enter current and new password', 'error');
      return;
    }
    if (newPassword.length < 8) {
      showAlert('New password must be at least 8 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('New password and confirmation do not match', 'error');
      return;
    }
    const data = await api('/api/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    if (!data.success) {
      showAlert(data.message || 'Password update failed', 'error');
      return;
    }
    showAlert(data.message || 'Password updated');
    closeModal();
  } catch (err) {
    showAlert(err.message || 'Password update failed', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('loginBtn').addEventListener('click', login);
  $('adminPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
  $('logoutBtn').addEventListener('click', () => logout());
  $('changePasswordBtn').addEventListener('click', openPasswordModal);
  $('savePasswordBtn').addEventListener('click', saveAdminPassword);
  $('refreshAllBtn').addEventListener('click', () => {
    const active = document.querySelector('.tab.tab-active')?.dataset.tab || 'overview';
    switchTab(active);
    showAlert('Refreshed');
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'people') {
        peopleListQs = `${getActivityRangeQuery()}&scope=all`;
        peopleListTitle = 'People';
      }
      switchTab(tab.dataset.tab);
    });
  });
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goto));
  });

  $('userSearchBtn')?.addEventListener('click', () => loadUsers(1));
  $('userSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUsers(1);
  });
  $('roleFilter')?.addEventListener('change', () => loadUsers(1));
  $('statusFilter')?.addEventListener('change', () => loadSubscriptions(1));
  $('overviewDays')?.addEventListener('change', loadOverview);
  $('activityDays')?.addEventListener('change', () => {
    syncActivityRangeUi();
    if (($('activityDays')?.value || '') !== 'custom') loadActivityDashboard();
  });
  $('activityRangeApply')?.addEventListener('click', () => {
    if ($('activityDays')) $('activityDays').value = 'custom';
    syncActivityRangeUi();
    loadActivityDashboard();
  });
  $('eventFilter')?.addEventListener('change', loadActivityDashboard);
  $('activityIncludeBots')?.addEventListener('change', loadActivityDashboard);
  $('peopleSearchBtn')?.addEventListener('click', () => loadPeopleList(1));
  $('peopleSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadPeopleList(1);
  });
  $('peopleBackActivity')?.addEventListener('click', () => switchTab('activity'));
  $('blockIpBtn')?.addEventListener('click', async () => {
    const ip = $('blockIpInput')?.value.trim();
    const reason = $('blockReasonInput')?.value.trim();
    await blockVisitorIp(ip, { reason });
    if ($('blockIpInput')) $('blockIpInput').value = '';
    if ($('blockReasonInput')) $('blockReasonInput').value = '';
    loadBlockedIps();
  });
  $('closePersonDrawer')?.addEventListener('click', closePersonDrawer);
  $('personDrawerBackdrop')?.addEventListener('click', closePersonDrawer);

  $('searchHistoryBtn')?.addEventListener('click', () => loadSearches(1));
  $('searchHistoryClear')?.addEventListener('click', () => {
    if ($('searchHistoryQuery')) {
      $('searchHistoryQuery').value = '';
      delete $('searchHistoryQuery').dataset.userTyped;
    }
    loadSearches(1);
  });
  $('searchHistoryQuery')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadSearches(1);
  });
  $('searchHistoryQuery')?.addEventListener('focus', () => {
    $('searchHistoryQuery').removeAttribute('readonly');
  });
  $('searchHistoryQuery')?.addEventListener('input', () => {
    $('searchHistoryQuery').dataset.userTyped = '1';
  });
  $('auditActionFilter')?.addEventListener('change', () => loadAudits(1));

  document.querySelectorAll('.close').forEach((btn) => btn.addEventListener('click', closeModal));
  $('saveUserBtn').addEventListener('click', saveUser);
  $('saveSubscriptionBtn').addEventListener('click', saveSubscription);
  $('closeUserDrawer').addEventListener('click', closeUserDrawer);
  $('userDrawerBackdrop').addEventListener('click', closeUserDrawer);

  $('drawerGrantBtn').addEventListener('click', () => {
    $('subscriptionAction').value = 'grant';
    manageSubscription(currentUserId);
  });
  $('drawerExtendBtn').addEventListener('click', () => {
    $('subscriptionAction').value = 'extend';
    manageSubscription(currentUserId);
  });
  $('drawerRevokeBtn').addEventListener('click', async () => {
    if (!currentUserId || !confirm('Revoke local access only? Stripe stays untouched.')) return;
    $('subscriptionAction').value = 'revoke';
    await saveSubscription();
  });
  $('drawerEditBtn').addEventListener('click', () => editUser(currentUserId));

  window.addEventListener('click', (event) => {
    if (
      event.target === $('editModal') ||
      event.target === $('subscriptionModal') ||
      event.target === $('passwordModal')
    ) {
      closeModal();
    }
  });

  if (currentToken) showConsole();
});

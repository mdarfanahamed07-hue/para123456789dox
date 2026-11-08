'use strict';

const $ = id => document.getElementById(id);
const state = { connected: false, site: '', status: null, plugins: [], themes: [], activeView: 'dashboard', pingTimer: null, toastTimer: null };
const viewTitles = { dashboard: 'Overview', plugins: 'Plugin manager', themes: 'Theme manager', activity: 'Activity log', settings: 'Connection settings' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3800);
}
function setConnection(connected, site = '', status = null) {
  state.connected = Boolean(connected);
  state.site = site || '';
  if (status) state.status = status;
  $('sidebarPulse').classList.toggle('online', state.connected);
  $('sidebarConnection').textContent = state.connected ? 'Connected' : 'Not connected';
  $('sidebarSite').textContent = state.connected ? state.site : 'Connect your WordPress site';
  $('topDot').classList.toggle('online', state.connected);
  $('topStatus').textContent = state.connected ? 'Connected' : 'Offline';
  $('openAdminBtn').disabled = !state.connected;
  $('connectQuick').textContent = state.connected ? '↻ Refresh status' : '＋ Connect website';
  $('metricStatus').textContent = state.connected ? 'Online' : 'Offline';
  $('metricSite').textContent = state.connected ? state.site : 'No website connected';
  if (!state.connected) {
    $('metricWp').textContent = '—'; $('metricPlugins').textContent = '—'; $('metricTheme').textContent = '—';
    $('systemInfo').innerHTML = '<div class="empty-state compact"><span class="empty-icon">⌁</span><b>No site connected</b><small>Connect WordPress to load server information.</small></div>';
  } else if (state.status) {
    renderStatus(state.status);
  }
}
function renderStatus(status) {
  state.status = status;
  $('metricStatus').textContent = 'Online';
  $('metricSite').textContent = status.site_title || state.site;
  $('metricWp').textContent = status.wp_version || '—';
  $('metricPlugins').textContent = String(status.active_plugins ?? '—');
  $('metricTheme').textContent = status.active_theme || '—';
  const rows = [
    ['Site name', status.site_title], ['Website URL', status.site_url], ['WordPress', status.wp_version], ['PHP', status.php_version],
    ['Database engine', status.mysql_version || 'Not reported'], ['PHP memory limit', status.memory_limit], ['Active theme', status.active_theme],
    ['Connector', status.connector_version], ['Network install', status.multisite ? 'Multisite' : 'Single site']
  ];
  $('systemInfo').innerHTML = rows.map(([label, value]) => `<div class="info-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value || '—')}</b></div>`).join('');
}
function navigate(view) {
  if (!viewTitles[view]) return;
  state.activeView = view;
  document.querySelectorAll('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  $('pageTitle').textContent = viewTitles[view];
  if (view === 'plugins') loadPlugins();
  if (view === 'themes') loadThemes();
  if (view === 'activity') loadActivity();
}
function requireConnection() {
  if (state.connected) return true;
  navigate('settings');
  showToast('Connect your WordPress website first.', true);
  return false;
}
async function runBusy(button, label, callback) {
  if (button) { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = label || 'Working…'; }
  try { return await callback(); }
  catch (error) { showToast(error.message || 'The operation failed.', true); throw error; }
  finally { if (button) { button.disabled = false; button.textContent = button.dataset.originalText || 'Done'; } }
}

async function connectFromForm(event) {
  event.preventDefault();
  const button = $('saveConnection');
  $('connectMessage').textContent = 'Verifying your secure connection…';
  await runBusy(button, 'Connecting…', async () => {
    try {
      const result = await window.paradoxCC.connect({ siteUrl: $('siteUrl').value, username: $('wpUsername').value, appPassword: $('wpPassword').value });
      $('wpPassword').value = '';
      $('connectMessage').textContent = `Connected as ${result.user.name || result.user.id}.`;
      setConnection(true, result.siteUrl, result.status);
      startHeartbeat();
      showToast('Paradox Prime connected successfully.');
      await refreshVisibleData();
    } catch (error) {
      $('connectMessage').textContent = error.message;
      $('connectMessage').style.color = 'var(--red)';
      throw error;
    }
  }).catch(() => {});
}
async function restoreConnection() {
  const result = await window.paradoxCC.restoreConnection();
  if (result.connected) {
    $('siteUrl').value = result.siteUrl;
    $('wpPassword').value = '';
    setConnection(true, result.siteUrl, result.status);
    $('connectMessage').textContent = `Secure connection restored${result.user?.name ? ` · ${result.user.name}` : ''}.`;
    startHeartbeat();
  } else {
    setConnection(false, result.siteUrl || '');
    if (result.error) $('connectMessage').textContent = result.error;
    if (result.siteUrl) startHeartbeat();
  }
}
async function disconnect() {
  if (!confirm('Disconnect this desktop app from the saved WordPress site?')) return;
  await window.paradoxCC.disconnect();
  stopHeartbeat();
  $('wpPassword').value = '';
  $('connectMessage').textContent = 'Disconnected. The saved encrypted credential was removed.';
  setConnection(false);
  showToast('Website disconnected.');
}
async function heartbeat() {
  if (!state.site) return;
  try {
    const result = await window.paradoxCC.ping();
    setConnection(true, state.site, result.status);
  } catch (error) {
    setConnection(false, state.site);
    $('connectMessage').textContent = `Connection interrupted: ${error.message}`;
  }
}
function startHeartbeat() {
  stopHeartbeat();
  state.pingTimer = setInterval(heartbeat, 30000);
}
function stopHeartbeat() { if (state.pingTimer) clearInterval(state.pingTimer); state.pingTimer = null; }
async function refreshVisibleData() {
  if (!state.connected) return;
  if (state.activeView === 'plugins') await loadPlugins();
  if (state.activeView === 'themes') await loadThemes();
  if (state.activeView === 'activity') await loadActivity();
}

async function loadPlugins() {
  if (!requireConnection()) return;
  $('pluginList').innerHTML = '<div class="empty-state"><b>Loading plugins…</b></div>';
  try {
    const data = await window.paradoxCC.listPlugins();
    state.plugins = data.plugins || [];
    renderPlugins();
  } catch (error) { $('pluginList').innerHTML = `<div class="empty-state"><b>Could not load plugins</b><small>${escapeHtml(error.message)}</small></div>`; }
}
function renderPlugins() {
  const query = $('pluginSearch').value.trim().toLowerCase();
  const filter = $('pluginFilter').value;
  const items = state.plugins.filter(p => {
    const matches = `${p.name} ${p.basename} ${p.author}`.toLowerCase().includes(query);
    const stateMatch = filter === 'all' || (filter === 'active' && p.active) || (filter === 'inactive' && !p.active) || (filter === 'updates' && p.update_available);
    return matches && stateMatch;
  });
  $('pluginSummary').textContent = `${items.length} shown · ${state.plugins.filter(p => p.active).length} active · ${state.plugins.filter(p => p.update_available).length} updates available`;
  if (!items.length) { $('pluginList').innerHTML = '<div class="empty-state"><span class="empty-icon">▣</span><b>No matching plugins</b><small>Try another filter or search.</small></div>'; return; }
  $('pluginList').innerHTML = items.map(p => {
    const status = p.network_active ? '<span class="tag">NETWORK ACTIVE</span>' : p.active ? '<span class="tag active">ACTIVE</span>' : '<span class="tag inactive">INACTIVE</span>';
    const update = p.update_available ? `<span class="tag update">UPDATE ${escapeHtml(p.new_version)}</span>` : '';
    let controls = '';
    if (p.network_active) controls = '<span class="item-meta">Manage this network plugin in WordPress Network Admin.</span>';
    else if (p.active) controls += `<button class="small-btn" data-action="deactivate" data-slug="${escapeHtml(p.basename)}">Deactivate</button>`;
    else controls += `<button class="small-btn" data-action="activate" data-slug="${escapeHtml(p.basename)}">Activate</button>`;
    if (p.update_available) controls += `<button class="small-btn" data-action="update" data-slug="${escapeHtml(p.basename)}">Update</button>`;
    if (!p.active && !p.network_active) controls += `<button class="small-btn danger" data-action="delete" data-slug="${escapeHtml(p.basename)}">Delete</button>`;
    return `<article class="item-card"><div class="item-mark">▣</div><div class="item-main"><div class="item-title"><b>${escapeHtml(p.name)}</b>${status}${update}</div><div class="item-meta">Version ${escapeHtml(p.version)} · ${escapeHtml(p.author || 'Unknown author')}</div><div class="item-desc">${escapeHtml(p.description || 'No description supplied.')}</div></div><div class="item-actions">${controls}</div></article>`;
  }).join('');
}
async function pluginAction(action, slug, button) {
  if (!requireConnection()) return;
  const label = action.charAt(0).toUpperCase() + action.slice(1);
  if (action === 'delete') {
    const plugin = state.plugins.find(p => p.basename === slug);
    const typed = prompt(`This removes the plugin files for “${plugin?.name || slug}”. It does not erase that plugin's database data. Type DELETE to continue.`);
    if (typed !== 'DELETE') return;
  } else if (action === 'update' && !confirm('Update this plugin on the live website? A full backup is strongly recommended first.')) return;
  else if (action === 'activate' && !confirm('Activate this plugin on the live website? It may change website behaviour.')) return;
  try {
    await runBusy(button, `${label}…`, async () => {
      const result = await window.paradoxCC.pluginAction(action, slug);
      showToast(result.message || `Plugin ${action} completed.`);
      await loadPlugins();
    });
  } catch {}
}
async function installPlugin() {
  if (!requireConnection()) return;
  if (!confirm('Choose a plugin ZIP to upload to your live WordPress site. It will be installed inactive. Continue?')) return;
  try {
    const result = await window.paradoxCC.installPlugin();
    if (result.cancelled) return;
    showToast(result.message || 'Plugin uploaded and installed.');
    await loadPlugins();
  } catch (error) { showToast(error.message, true); }
}

async function loadThemes() {
  if (!requireConnection()) return;
  $('themeList').innerHTML = '<div class="empty-state"><b>Loading themes…</b></div>';
  try {
    const data = await window.paradoxCC.listThemes();
    state.themes = data.themes || [];
    renderThemes();
  } catch (error) { $('themeList').innerHTML = `<div class="empty-state"><b>Could not load themes</b><small>${escapeHtml(error.message)}</small></div>`; }
}
function renderThemes() {
  const query = $('themeSearch').value.trim().toLowerCase();
  const filter = $('themeFilter').value;
  const items = state.themes.filter(t => {
    const matches = `${t.name} ${t.stylesheet} ${t.author}`.toLowerCase().includes(query);
    const stateMatch = filter === 'all' || (filter === 'active' && t.active) || (filter === 'updates' && t.update_available);
    return matches && stateMatch;
  });
  $('themeSummary').textContent = `${items.length} shown · ${state.themes.filter(t => t.active).length} active · ${state.themes.filter(t => t.update_available).length} updates available`;
  if (!items.length) { $('themeList').innerHTML = '<div class="empty-state"><span class="empty-icon">◩</span><b>No matching themes</b><small>Try another filter or search.</small></div>'; return; }
  $('themeList').innerHTML = items.map(t => {
    const status = t.active ? '<span class="tag active">ACTIVE</span>' : '<span class="tag inactive">INACTIVE</span>';
    const update = t.update_available ? `<span class="tag update">UPDATE ${escapeHtml(t.new_version)}</span>` : '';
    let controls = t.active ? '<span class="item-meta">Currently active</span>' : `<button class="small-btn" data-action="activate" data-slug="${escapeHtml(t.stylesheet)}">Activate</button>`;
    if (t.update_available) controls += `<button class="small-btn" data-action="update" data-slug="${escapeHtml(t.stylesheet)}">Update</button>`;
    if (!t.active && !t.parent_active) controls += `<button class="small-btn danger" data-action="delete" data-slug="${escapeHtml(t.stylesheet)}">Delete</button>`;
    return `<article class="item-card"><div class="item-mark">◩</div><div class="item-main"><div class="item-title"><b>${escapeHtml(t.name)}</b>${status}${update}</div><div class="item-meta">Version ${escapeHtml(t.version)} · ${escapeHtml(t.author || 'Unknown author')}</div><div class="item-desc">${escapeHtml(t.description || 'No description supplied.')}</div></div><div class="item-actions">${controls}</div></article>`;
  }).join('');
}
async function themeAction(action, slug, button) {
  if (!requireConnection()) return;
  const theme = state.themes.find(t => t.stylesheet === slug);
  if (action === 'delete') {
    const typed = prompt(`This permanently removes theme files for “${theme?.name || slug}”. Type DELETE to continue.`);
    if (typed !== 'DELETE') return;
  } else if (action === 'update' && !confirm('Update this theme on the live website? Make a full backup first.')) return;
  else if (action === 'activate' && !confirm('Switch your live website to this theme? The site appearance may change immediately.')) return;
  try {
    await runBusy(button, `${action}…`, async () => {
      const result = await window.paradoxCC.themeAction(action, slug);
      showToast(result.message || `Theme ${action} completed.`);
      await loadThemes();
      if (action === 'activate') { try { const ping = await window.paradoxCC.ping(); renderStatus(ping.status); } catch {} }
    });
  } catch {}
}
async function installTheme() {
  if (!requireConnection()) return;
  if (!confirm('Choose a theme ZIP to upload to your live WordPress site. It will be installed but not activated. Continue?')) return;
  try {
    const result = await window.paradoxCC.installTheme();
    if (result.cancelled) return;
    showToast(result.message || 'Theme uploaded and installed.');
    await loadThemes();
  } catch (error) { showToast(error.message, true); }
}

async function loadActivity() {
  if (!requireConnection()) return;
  $('activityRows').innerHTML = '<tr><td colspan="5" class="table-empty">Loading activity…</td></tr>';
  try {
    const data = await window.paradoxCC.listActivity();
    const rows = data.events || [];
    if (!rows.length) { $('activityRows').innerHTML = '<tr><td colspan="5" class="table-empty">No Command Center actions recorded yet.</td></tr>'; return; }
    $('activityRows').innerHTML = rows.map(row => `<tr><td>${escapeHtml(row.time)}</td><td>${escapeHtml(row.user || row.user_id)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target)}</td><td class="${row.success ? 'result-ok' : 'result-fail'}">${row.success ? 'SUCCESS' : 'FAILED'}<div class="item-meta">${escapeHtml(row.message)}</div></td></tr>`).join('');
  } catch (error) { $('activityRows').innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(error.message)}</td></tr>`; }
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('connectQuick').addEventListener('click', () => state.connected ? heartbeat() : navigate('settings'));
  $('connectForm').addEventListener('submit', connectFromForm);
  $('disconnectBtn').addEventListener('click', disconnect);
  $('openAdminBtn').addEventListener('click', async () => { try { await window.paradoxCC.openAdmin(); } catch (error) { showToast(error.message, true); } });
  $('installPluginBtn').addEventListener('click', installPlugin);
  $('installThemeBtn').addEventListener('click', installTheme);
  $('refreshPlugins').addEventListener('click', loadPlugins);
  $('refreshThemes').addEventListener('click', loadThemes);
  $('refreshActivity').addEventListener('click', loadActivity);
  $('pluginSearch').addEventListener('input', renderPlugins);
  $('pluginFilter').addEventListener('change', renderPlugins);
  $('themeSearch').addEventListener('input', renderThemes);
  $('themeFilter').addEventListener('change', renderThemes);
  $('pluginList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) pluginAction(button.dataset.action, button.dataset.slug, button);
  });
  $('themeList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) themeAction(button.dataset.action, button.dataset.slug, button);
  });
}

async function init() {
  bindEvents();
  const version = await window.paradoxCC.version();
  $('appVersion').textContent = version;
  $('footerVersion').textContent = version;
  await restoreConnection();
  if (state.connected) {
    try { await loadPlugins(); } catch {}
    startHeartbeat();
  }
}

window.addEventListener('DOMContentLoaded', () => init().catch(error => showToast(error.message, true)));
window.addEventListener('beforeunload', stopHeartbeat);

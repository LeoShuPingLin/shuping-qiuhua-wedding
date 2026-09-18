'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const cfg = window.WEDDING_APP_CONFIG || {};
const EVENT_ID = cfg.eventId || 'shu-qiu-2026';
const MAX_HISTORY = 20;
let db = null;
let currentSession = null;
let currentMember = null;
let realtimeChannel = null;
let realtimeTimer = null;
let sortables = [];
let history = [];
let loading = false;

const state = {
  settings: { event_id: EVENT_ID, default_capacity: 10, table_prefix: '第', next_table_no: 13 },
  tables: [],
  guests: []
};

const els = {
  authShell: $('#authShell'), app: $('#app'), setupWarning: $('#setupWarning'), loginForm: $('#loginForm'),
  loginEmail: $('#loginEmail'), loginPassword: $('#loginPassword'), loginBtn: $('#loginBtn'), authMsg: $('#authMsg'),
  accountEmail: $('#accountEmail'), accountRole: $('#accountRole'), logoutBtn: $('#logoutBtn'),
  stats: $('#stats'), board: $('#board'), unassigned: $('#unassignedList'), other: $('#otherList'),
  unassignedCount: $('#unassignedCount'), otherCount: $('#otherCount'), search: $('#searchInput'),
  sideFilter: $('#sideFilter'), sizeFilter: $('#sizeFilter'), saveStatus: $('#saveStatus'), lastSync: $('#lastSync'),
  toast: $('#toast'), fileInput: $('#fileInput'), restoreInput: $('#restoreInput'), loadingDialog: $('#loadingDialog'), loadingText: $('#loadingText')
};

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
function normalize(s = '') { return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function sideLabel(side = '') {
  const s = String(side);
  if (s.includes('書平') || s.includes('男方')) return '書平';
  if (s.includes('秋華') || s.includes('女方')) return '秋華';
  return '其他';
}
function attendanceLabel(a) {
  return ({ dinner:'晚宴', ceremony:'僅佛前', declined:'無法出席', unknown:'待確認' })[a] || '待確認';
}
function tableById(id) { return state.tables.find((t) => t.id === id); }
function guestById(id) { return state.guests.find((g) => g.id === id); }
function dinnerGuests() { return state.guests.filter((g) => g.attendance === 'dinner'); }
function tableCount(tableId) {
  return state.guests
    .filter((g) => g.attendance === 'dinner' && g.table_id === tableId)
    .reduce((n, g) => n + (Number(g.party_size) || 1), 0);
}
function nowLabel() { return new Intl.DateTimeFormat('zh-TW', { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date()); }

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 2400);
}
function setStatus(text, kind = 'ok') {
  els.saveStatus.textContent = text;
  els.saveStatus.classList.toggle('status-error', kind === 'error');
  els.saveStatus.classList.toggle('status-saving', kind === 'saving');
  if (kind === 'ok') els.lastSync.textContent = `最後同步 ${nowLabel()}`;
}
function showLoading(text = '處理中…') {
  els.loadingText.textContent = text;
  if (!els.loadingDialog.open) els.loadingDialog.showModal();
}
function hideLoading() { if (els.loadingDialog.open) els.loadingDialog.close(); }

function configIsReady() {
  return /^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl || '') &&
    /^sb_publishable_/.test(cfg.supabasePublishableKey || '');
}

async function init() {
  if (!window.supabase?.createClient) {
    els.setupWarning.hidden = false;
    els.setupWarning.textContent = 'Supabase 元件載入失敗，請確認目前有網路連線。';
    els.loginBtn.disabled = true;
    return;
  }
  if (!configIsReady()) {
    els.setupWarning.hidden = false;
    els.setupWarning.innerHTML = '尚未完成 Supabase 設定。請先依 README 將 <b>Project URL</b> 與 <b>Publishable key</b> 填入 config.js。';
    els.loginBtn.disabled = true;
    return;
  }

  db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  bindStaticControls();
  const { data, error } = await db.auth.getSession();
  if (error) console.warn(error);
  if (data?.session) await openSession(data.session);

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') showLogin();
    if (event === 'SIGNED_IN' && session && session.user.id !== currentSession?.user?.id) openSession(session);
  });
}

function showLogin(message = '') {
  currentSession = null;
  currentMember = null;
  if (realtimeChannel && db) db.removeChannel(realtimeChannel);
  realtimeChannel = null;
  els.app.hidden = true;
  els.authShell.hidden = false;
  els.authMsg.textContent = message;
}

async function openSession(session) {
  currentSession = session;
  els.authMsg.textContent = '';
  showLoading('確認婚禮管理權限…');
  try {
    const { data: member, error } = await db.from('event_members')
      .select('event_id,user_id,role')
      .eq('event_id', EVENT_ID)
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!member) {
      await db.auth.signOut();
      showLogin('這個帳號尚未被加入婚禮管理權限。請依 README 執行 event_members 授權 SQL。');
      return;
    }
    currentMember = member;
    els.accountEmail.textContent = session.user.email || '婚禮管理帳號';
    els.accountRole.textContent = '婚禮管理帳號';
    await loadAll();
    els.authShell.hidden = true;
    els.app.hidden = false;
    window.scrollTo(0, 0);
    subscribeRealtime();
  } catch (err) {
    console.error(err);
    els.authMsg.textContent = '登入成功，但讀取婚禮權限失敗：' + (err.message || err);
    els.authShell.hidden = false;
    els.app.hidden = true;
  } finally {
    hideLoading();
  }
}

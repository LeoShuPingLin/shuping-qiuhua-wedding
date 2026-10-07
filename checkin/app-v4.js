(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const cfg = window.WEDDING_APP_CONFIG || {};
  const EVENT_ID = cfg.eventId || 'shu-qiu-2026';
  const CHECKIN_EMAIL = 'checkin@shuping-qiuhua.com';

  let db = null;
  let session = null;
  let access = null;
  let realtime = null;
  let reloadTimer = null;
  let selectedGuestId = null;
  let activeSuggestion = -1;
  const saving = new Set();
  const state = { tables: [], guests: [], checkins: [] };

  const els = {
    authShell: $('#authShell'), app: $('#app'), loginForm: $('#loginForm'), loginPassword: $('#loginPassword'),
    loginBtn: $('#loginBtn'), authMsg: $('#authMsg'), logoutBtn: $('#logoutBtn'), liveStatus: $('#liveStatus'),
    stats: $('#stats'), search: $('#guestSearch'), clearSearch: $('#clearSearch'), suggestions: $('#searchSuggestions'),
    recentList: $('#recentList'), recentEmpty: $('#recentEmpty'), sheet: $('#guestSheet'), sheetBackdrop: $('#sheetBackdrop'),
    sheetClose: $('#sheetClose'), sheetContent: $('#sheetContent'), toast: $('#toast')
  };

  const escapeHtml = (v = '') => String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = (v = '') => String(v).trim().replace(/\s+/g, ' ').toLowerCase();
  const tableById = (id) => state.tables.find((t) => t.id === id);
  const checkinByGuest = (id) => state.checkins.find((c) => c.guest_id === id);
  const arrived = (g) => Math.max(0, Math.min(+g.party_size || 1, +(checkinByGuest(g.id)?.arrived_count || 0)));

  function configReady() {
    return /^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl || '') && /^sb_publishable_/.test(cfg.supabasePublishableKey || '');
  }
  function timeLabel(iso) {
    if (!iso) return '';
    try { return new Intl.DateTimeFormat('zh-TW', { hour:'2-digit', minute:'2-digit' }).format(new Date(iso)); }
    catch { return ''; }
  }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 1700);
  }
  function setLive(text, tone = 'ok') {
    els.liveStatus.textContent = text;
    els.liveStatus.dataset.tone = tone;
  }

  async function init() {
    if (!window.supabase?.createClient || !configReady()) {
      els.authMsg.textContent = '系統設定尚未完成，請聯絡新人。';
      els.loginBtn.disabled = true;
      return;
    }
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
      auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    bindStatic();
    const { data } = await db.auth.getSession();
    if (data?.session) await openSession(data.session);
    db.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') showLogin();
      if (event === 'SIGNED_IN' && s && s.user.id !== session?.user?.id) openSession(s);
    });
  }

  function showLogin(message = '') {
    session = null;
    access = null;
    if (realtime && db) db.removeChannel(realtime);
    realtime = null;
    closeSheet();
    hideSuggestions();
    els.app.hidden = true;
    els.authShell.hidden = false;
    els.authMsg.textContent = message;
    els.loginPassword.value = '';
  }

  async function openSession(s) {
    session = s;
    els.authMsg.textContent = '確認工作人員權限…';
    try {
      const [ownerRes, staffRes] = await Promise.all([
        db.from('event_members').select('event_id,user_id,role').eq('event_id',EVENT_ID).eq('user_id',s.user.id).maybeSingle(),
        db.from('wedding_checkin_staff').select('event_id,user_id,display_name').eq('event_id',EVENT_ID).eq('user_id',s.user.id).maybeSingle()
      ]);
      const owner = !ownerRes.error && ownerRes.data?.role === 'owner' ? ownerRes.data : null;
      const staff = !staffRes.error ? staffRes.data : null;
      if (!owner && !staff) {
        await db.auth.signOut();
        return showLogin('這組密碼沒有婚宴報到權限。');
      }
      access = owner ? { type:'owner' } : { type:'staff' };
      await loadAll();
      els.authShell.hidden = true;
      els.app.hidden = false;
      subscribeRealtime();
      setTimeout(() => els.search.focus(), 120);
    } catch (err) {
      console.error(err);
      els.authMsg.textContent = '暫時無法讀取報到資料，請稍後再試。';
    }
  }

  async function loadAll({ quiet = false } = {}) {
    if (!db || !session) return;
    if (!quiet) setLive('同步中…', 'busy');
    try {
      const [tablesRes, guestsRes, checkinsRes] = await Promise.all([
        db.from('wedding_tables').select('id,event_id,name,sort_order').eq('event_id',EVENT_ID).order('sort_order',{ascending:true}),
        db.from('wedding_guests').select('id,event_id,name,party_size,side,attendance,companions,notes,table_id,sort_order').eq('event_id',EVENT_ID).eq('attendance','dinner').order('sort_order',{ascending:true}),
        db.from('wedding_checkins').select('event_id,guest_id,arrived_count,reporter_name,updated_at,updated_by').eq('event_id',EVENT_ID)
      ]);
      for (const r of [tablesRes, guestsRes, checkinsRes]) if (r.error) throw r.error;
      state.tables = tablesRes.data || [];
      state.guests = guestsRes.data || [];
      state.checkins = checkinsRes.data || [];
      renderOverview();
      refreshSearchPopup();
      if (selectedGuestId) renderSheet();
      setLive('即時同步', 'ok');
    } catch (err) {
      console.error(err);
      setLive('連線異常', 'error');
      toast('讀取資料失敗，請稍後再試');
    }
  }

  function subscribeRealtime() {
    if (realtime) db.removeChannel(realtime);
    realtime = db.channel(`wedding-checkin-${EVENT_ID}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'wedding_checkins'},scheduleReload)
      .on('postgres_changes',{event:'*',schema:'public',table:'wedding_guests'},scheduleReload)
      .on('postgres_changes',{event:'*',schema:'public',table:'wedding_tables'},scheduleReload)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setLive('即時同步', 'ok');
        if (['CHANNEL_ERROR','TIMED_OUT'].includes(s)) setLive('連線異常', 'error');
      });
  }
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadAll({ quiet:true }), 180);
  }

  function renderOverview() {
    const expected = state.guests.reduce((n,g) => n + (+g.party_size || 1), 0);
    const present = state.guests.reduce((n,g) => n + arrived(g), 0);
    const doneGroups = state.guests.filter((g) => arrived(g) >= (+g.party_size || 1)).length;
    els.stats.innerHTML = [
      ['目前已到', present, 'good'],
      ['尚未到', Math.max(0, expected - present), 'warn'],
      ['完成組數', `${doneGroups}/${state.guests.length}`, '']
    ].map(([label, value, cls]) => `<div class="stat-card ${cls}"><b>${value}</b><span>${label}</span></div>`).join('');
    renderRecent();
  }

  function searchRank(g, q) {
    if (!q) return 99;
    const name = norm(g.name);
    const companions = norm(g.companions || '');
    const table = norm(tableById(g.table_id)?.name || '');
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (companions.includes(q)) return 2;
    if (table.includes(q)) return 3;
    return 99;
  }

  function getMatches(qRaw) {
    const q = norm(qRaw);
    if (!q) return [];
    return state.guests
      .filter((g) => searchRank(g, q) < 99)
      .sort((a,b) => {
        const rank = searchRank(a,q) - searchRank(b,q);
        if (rank) return rank;
        const an = norm(a.name), bn = norm(b.name);
        const pos = an.indexOf(q) - bn.indexOf(q);
        if (pos) return pos;
        return an.localeCompare(bn, 'zh-Hant');
      });
  }

  function statusMeta(g) {
    const expected = +g.party_size || 1;
    const count = arrived(g);
    if (count >= expected) return { text:'已到齊', cls:'done' };
    if (count > 0) return { text:`已到 ${count}/${expected}`, cls:'partial' };
    return { text:'尚未到', cls:'pending' };
  }

  function refreshSearchPopup() {
    const q = els.search.value;
    const matches = getMatches(q);
    els.clearSearch.hidden = !q;
    activeSuggestion = -1;

    if (!q) return hideSuggestions();

    els.search.setAttribute('aria-expanded','true');
    els.suggestions.hidden = false;

    if (!matches.length) {
      els.suggestions.innerHTML = `<div class="suggestion-empty">找不到「${escapeHtml(q)}」<small>可以只輸入姓氏、名字其中一個字，或桌名</small></div>`;
      return;
    }

    const shown = matches.slice(0, 10);
    const rest = matches.length - shown.length;
    els.suggestions.innerHTML = shown.map((g, i) => {
      const t = tableById(g.table_id);
      const expected = +g.party_size || 1;
      const st = statusMeta(g);
      const companion = g.companions ? `<div class="suggestion-companion">同行：${escapeHtml(g.companions)}</div>` : '';
      return `<button type="button" class="suggestion-row" role="option" id="suggestion-${i}" data-suggestion-id="${g.id}" aria-selected="false">
        <div class="suggestion-main">
          <strong>${escapeHtml(g.name)}</strong>
          <div class="suggestion-meta"><span class="table-pill">${escapeHtml(t?.name || '尚未分桌')}</span><span>預計 ${expected} 人</span></div>
          ${companion}
        </div>
        <span class="status-pill ${st.cls}">${st.text}</span>
      </button>`;
    }).join('') + (rest > 0 ? `<div class="suggestion-more">還有 ${rest} 組符合，繼續輸入可縮小範圍</div>` : '');

    els.suggestions.querySelectorAll('[data-suggestion-id]').forEach((btn) => {
      btn.onpointerdown = (e) => e.preventDefault();
      btn.onclick = () => chooseSuggestion(btn.dataset.suggestionId);
    });
  }

  function hideSuggestions() {
    els.search.setAttribute('aria-expanded','false');
    els.search.removeAttribute('aria-activedescendant');
    els.suggestions.hidden = true;
    activeSuggestion = -1;
  }

  function moveSuggestion(delta) {
    const rows = [...els.suggestions.querySelectorAll('[data-suggestion-id]')];
    if (!rows.length) return;
    activeSuggestion = Math.max(-1, Math.min(rows.length - 1, activeSuggestion + delta));
    rows.forEach((row, i) => row.setAttribute('aria-selected', i === activeSuggestion ? 'true' : 'false'));
    if (activeSuggestion >= 0) {
      const row = rows[activeSuggestion];
      els.search.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block:'nearest' });
    } else {
      els.search.removeAttribute('aria-activedescendant');
    }
  }

  function chooseSuggestion(id) {
    const g = state.guests.find((x) => x.id === id);
    if (!g) return;
    selectedGuestId = id;
    hideSuggestions();
    els.search.blur();
    renderSheet();
    openSheet();
  }

  function openSheet() {
    els.sheet.hidden = false;
    els.sheetBackdrop.hidden = false;
    document.body.classList.add('sheet-open');
  }
  function closeSheet({ clearSearch = false } = {}) {
    selectedGuestId = null;
    els.sheet.hidden = true;
    els.sheetBackdrop.hidden = true;
    document.body.classList.remove('sheet-open');
    if (clearSearch) {
      els.search.value = '';
      els.clearSearch.hidden = true;
    }
  }

  function renderSheet() {
    const g = state.guests.find((x) => x.id === selectedGuestId);
    if (!g) return closeSheet();
    const t = tableById(g.table_id);
    const expected = +g.party_size || 1;
    const count = arrived(g);
    const st = statusMeta(g);
    const companion = g.companions ? `<div class="sheet-info-row"><span>同行</span><b>${escapeHtml(g.companions)}</b></div>` : '';
    els.sheetContent.innerHTML = `
      <div class="sheet-title-row">
        <div><span class="sheet-kicker">來賓</span><h2>${escapeHtml(g.name)}</h2></div>
        <span class="status-pill ${st.cls}">${st.text}</span>
      </div>
      <div class="seat-banner"><span>請帶位至</span><strong>${escapeHtml(t?.name || '尚未分桌')}</strong></div>
      <div class="sheet-info-grid">
        <div class="sheet-info-row"><span>預計人數</span><b>${expected} 人</b></div>
        ${companion}
      </div>
      <div class="checkin-box">
        <div class="checkin-label">目前實際到場</div>
        <div class="big-stepper">
          <button type="button" id="sheetMinus" aria-label="減少一人" ${count<=0?'disabled':''}>－</button>
          <strong>${count}</strong>
          <button type="button" id="sheetPlus" aria-label="增加一人" ${count>=expected?'disabled':''}>＋</button>
        </div>
        <div class="checkin-hint">預計 ${expected} 人</div>
        <button type="button" class="arrive-all" id="sheetAll" ${count>=expected?'disabled':''}>${count>=expected?'✓ 已全部到齊':`✓ ${expected} 人全部到齊`}</button>
        ${count>0 ? '<button type="button" class="reset-arrival" id="sheetReset">修正為尚未到</button>' : ''}
      </div>`;

    $('#sheetMinus')?.addEventListener('click', () => saveCount(g, count - 1));
    $('#sheetPlus')?.addEventListener('click', () => saveCount(g, count + 1));
    $('#sheetAll')?.addEventListener('click', async () => {
      const ok = await saveCount(g, expected);
      if (ok) {
        setTimeout(() => {
          closeSheet({ clearSearch:true });
          els.search.focus();
        }, 260);
      }
    });
    $('#sheetReset')?.addEventListener('click', () => saveCount(g, 0));
  }

  async function saveCount(g, next) {
    if (saving.has(g.id)) return false;
    const expected = +g.party_size || 1;
    const count = Math.max(0, Math.min(expected, Number(next) || 0));
    saving.add(g.id);
    setLive('儲存中…', 'busy');

    const old = checkinByGuest(g.id);
    const optimistic = {
      event_id:EVENT_ID, guest_id:g.id, arrived_count:count, reporter_name:'工作人員',
      updated_at:new Date().toISOString(), updated_by:session.user.id
    };
    if (old) Object.assign(old, optimistic); else state.checkins.push(optimistic);
    renderOverview();
    refreshSearchPopup();
    renderSheet();

    try {
      const { error } = await db.from('wedding_checkins').upsert({
        event_id:EVENT_ID, guest_id:g.id, arrived_count:count, reporter_name:'工作人員',
        updated_by:session.user.id, updated_at:new Date().toISOString()
      }, { onConflict:'event_id,guest_id' });
      if (error) throw error;
      setLive('已儲存', 'ok');
      toast(count >= expected ? `${g.name} 已到齊 ✓` : `${g.name}：目前 ${count} 人`);
      return true;
    } catch (err) {
      console.error(err);
      setLive('儲存失敗', 'error');
      toast('回報失敗，請再試一次');
      await loadAll({ quiet:true });
      return false;
    } finally {
      saving.delete(g.id);
    }
  }

  function renderRecent() {
    const recent = [...state.checkins]
      .filter((c) => +(c.arrived_count || 0) > 0)
      .sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 6);

    els.recentEmpty.hidden = recent.length > 0;
    els.recentList.innerHTML = recent.map((c) => {
      const g = state.guests.find((x) => x.id === c.guest_id);
      if (!g) return '';
      const t = tableById(g.table_id);
      const expected = +g.party_size || 1;
      return `<button type="button" class="recent-row" data-recent-id="${g.id}">
        <div><strong>${escapeHtml(g.name)}</strong><span>${escapeHtml(t?.name || '尚未分桌')}</span></div>
        <div><b>${arrived(g)}/${expected}</b><small>${timeLabel(c.updated_at)}</small></div>
      </button>`;
    }).join('');
    els.recentList.querySelectorAll('[data-recent-id]').forEach((btn) => btn.onclick = () => chooseSuggestion(btn.dataset.recentId));
  }

  function bindStatic() {
    els.loginForm.onsubmit = async (e) => {
      e.preventDefault();
      els.loginBtn.disabled = true;
      els.authMsg.textContent = '登入中…';
      const { data, error } = await db.auth.signInWithPassword({ email:CHECKIN_EMAIL, password:els.loginPassword.value });
      els.loginBtn.disabled = false;
      if (error) {
        els.authMsg.textContent = '密碼不正確，請再試一次。';
        els.loginPassword.select();
        return;
      }
      if (data?.session) await openSession(data.session);
    };

    els.logoutBtn.onclick = async () => { await db.auth.signOut(); showLogin(); };
    els.search.oninput = refreshSearchPopup;
    els.search.onfocus = refreshSearchPopup;
    els.search.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggestion(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggestion(-1); }
      else if (e.key === 'Enter' && activeSuggestion >= 0) {
        e.preventDefault();
        const rows = [...els.suggestions.querySelectorAll('[data-suggestion-id]')];
        const row = rows[activeSuggestion];
        if (row) chooseSuggestion(row.dataset.suggestionId);
      } else if (e.key === 'Escape') {
        hideSuggestions();
      }
    };
    els.clearSearch.onclick = () => {
      els.search.value = '';
      hideSuggestions();
      els.clearSearch.hidden = true;
      els.search.focus();
    };
    els.sheetClose.onclick = () => { closeSheet(); els.search.focus(); };
    els.sheetBackdrop.onclick = () => { closeSheet(); els.search.focus(); };
    document.addEventListener('pointerdown', (e) => {
      if (!els.suggestions.hidden && !e.target.closest('.search-combobox')) hideSuggestions();
    });
  }

  init();
})();

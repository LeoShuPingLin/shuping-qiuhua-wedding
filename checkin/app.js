(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const cfg = window.WEDDING_APP_CONFIG || {};
  const EVENT_ID = cfg.eventId || 'shu-qiu-2026';
  let db = null;
  let session = null;
  let member = null;
  let realtime = null;
  let reloadTimer = null;
  let saving = new Set();

  const state = { tables: [], guests: [], checkins: [] };
  const els = {
    authShell: $('#authShell'), app: $('#app'), loginForm: $('#loginForm'), loginEmail: $('#loginEmail'),
    loginPassword: $('#loginPassword'), loginBtn: $('#loginBtn'), authMsg: $('#authMsg'), logoutBtn: $('#logoutBtn'),
    accountEmail: $('#accountEmail'), accountRole: $('#accountRole'), reporterName: $('#reporterName'), saveStatus: $('#saveStatus'),
    stats: $('#stats'), search: $('#searchInput'), tableFilter: $('#tableFilter'), pendingOnly: $('#pendingOnly'),
    clearFilterBtn: $('#clearFilterBtn'), tableChips: $('#tableChips'), guestList: $('#guestList'), toast: $('#toast')
  };

  function escapeHtml(v = '') { return String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function norm(v = '') { return String(v).trim().replace(/\s+/g, ' ').toLowerCase(); }
  function tableById(id) { return state.tables.find((t) => t.id === id); }
  function checkinByGuest(id) { return state.checkins.find((c) => c.guest_id === id); }
  function arrived(g) { return Math.max(0, Math.min(+g.party_size || 1, +(checkinByGuest(g.id)?.arrived_count || 0))); }
  function reporter() { return els.reporterName.value.trim(); }
  function configReady() { return /^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl || '') && /^sb_publishable_/.test(cfg.supabasePublishableKey || ''); }
  function timeLabel(iso) { if (!iso) return ''; try { return new Intl.DateTimeFormat('zh-TW',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); } catch { return ''; } }
  function toast(msg) { els.toast.textContent = msg; els.toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => els.toast.classList.remove('show'), 2200); }
  function status(text, error = false) { els.saveStatus.textContent = text; els.saveStatus.style.color = error ? '#b55f55' : '#668a76'; }

  async function init() {
    if (!window.supabase?.createClient || !configReady()) {
      els.authMsg.textContent = '系統設定尚未完成，請聯絡管理者。';
      els.loginBtn.disabled = true;
      return;
    }
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
      auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    bindStatic();
    const savedReporter = localStorage.getItem('wedding-checkin-reporter') || '';
    els.reporterName.value = savedReporter;
    const { data } = await db.auth.getSession();
    if (data?.session) await openSession(data.session);
    db.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') showLogin();
      if (event === 'SIGNED_IN' && s && s.user.id !== session?.user?.id) openSession(s);
    });
  }

  function showLogin(message = '') {
    session = null; member = null;
    if (realtime && db) db.removeChannel(realtime);
    realtime = null;
    els.app.hidden = true; els.authShell.hidden = false; els.authMsg.textContent = message;
  }

  async function openSession(s) {
    session = s;
    els.authMsg.textContent = '確認權限…';
    try {
      const { data:m, error } = await db.from('event_members').select('event_id,user_id,role').eq('event_id',EVENT_ID).eq('user_id',s.user.id).maybeSingle();
      if (error) throw error;
      if (!m || !['owner','checkin','usher'].includes(m.role)) {
        await db.auth.signOut();
        return showLogin('此帳號沒有婚宴報到權限。');
      }
      member = m;
      els.accountEmail.textContent = s.user.email || '工作人員';
      els.accountRole.textContent = m.role === 'owner' ? '管理者' : '帶位人員';
      if (!els.reporterName.value) els.reporterName.value = (s.user.email || '').split('@')[0];
      await loadAll();
      els.authShell.hidden = true; els.app.hidden = false;
      subscribeRealtime();
    } catch (err) {
      console.error(err);
      els.authMsg.textContent = '讀取權限失敗：' + (err.message || err);
    }
  }

  async function loadAll({quiet=false} = {}) {
    if (!db || !session) return;
    if (!quiet) status('● 同步中…');
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
      render();
      status('● 已同步');
    } catch (err) {
      console.error(err);
      status('● 同步失敗', true);
      if (String(err.message || err).includes('wedding_checkins')) toast('報到資料表尚未建立，請先執行 setup-checkin.sql');
      else toast('讀取資料失敗：' + (err.message || err));
    }
  }

  function subscribeRealtime() {
    if (realtime) db.removeChannel(realtime);
    realtime = db.channel(`wedding-checkin-${EVENT_ID}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'wedding_checkins'},scheduleReload)
      .on('postgres_changes',{event:'*',schema:'public',table:'wedding_guests'},scheduleReload)
      .on('postgres_changes',{event:'*',schema:'public',table:'wedding_tables'},scheduleReload)
      .subscribe((s) => { if (s === 'SUBSCRIBED') status('● 即時同步'); });
  }
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadAll({quiet:true}), 180); }

  function render() {
    renderStats(); renderTableFilter(); renderTableChips(); renderGuests();
  }

  function renderStats() {
    const expected = state.guests.reduce((n,g) => n + (+g.party_size || 1),0);
    const present = state.guests.reduce((n,g) => n + arrived(g),0);
    const doneGroups = state.guests.filter((g) => arrived(g) >= (+g.party_size || 1)).length;
    const partialGroups = state.guests.filter((g) => arrived(g) > 0 && arrived(g) < (+g.party_size || 1)).length;
    els.stats.innerHTML = [
      ['預計總人數', expected, ''], ['目前已到', present, 'good'], ['尚未到', Math.max(0, expected-present), 'warn'], ['完成組數', `${doneGroups} / ${state.guests.length}`, partialGroups ? `good` : 'good']
    ].map(([k,v,c]) => `<div class="stat ${c}"><b>${v}</b><span>${k}</span></div>`).join('');
  }

  function renderTableFilter() {
    const current = els.tableFilter.value || 'all';
    els.tableFilter.innerHTML = '<option value="all">全部桌次</option>' + state.tables.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('') + '<option value="unassigned">尚未分桌</option>';
    if ([...els.tableFilter.options].some((o) => o.value === current)) els.tableFilter.value = current;
  }

  function tablePresent(tid) { return state.guests.filter((g) => g.table_id === tid).reduce((n,g) => n + arrived(g),0); }
  function tableExpected(tid) { return state.guests.filter((g) => g.table_id === tid).reduce((n,g) => n + (+g.party_size || 1),0); }
  function renderTableChips() {
    const active = els.tableFilter.value || 'all';
    els.tableChips.innerHTML = `<button class="table-chip ${active==='all'?'active':''}" data-table-chip="all">全部</button>` + state.tables.map((t) => {
      const p = tablePresent(t.id), e = tableExpected(t.id);
      return `<button class="table-chip ${active===t.id?'active':''}" data-table-chip="${t.id}">${escapeHtml(t.name)} ${p}/${e}</button>`;
    }).join('');
    els.tableChips.querySelectorAll('[data-table-chip]').forEach((b) => b.onclick = () => { els.tableFilter.value = b.dataset.tableChip; renderTableChips(); renderGuests(); });
  }

  function filteredGuests() {
    const q = norm(els.search.value);
    const tf = els.tableFilter.value;
    const pending = els.pendingOnly.checked;
    return state.guests.filter((g) => {
      const t = tableById(g.table_id);
      const matchQ = !q || norm(`${g.name} ${g.companions || ''} ${t?.name || ''}`).includes(q);
      const matchT = tf === 'all' || (tf === 'unassigned' ? !g.table_id : g.table_id === tf);
      const matchP = !pending || arrived(g) < (+g.party_size || 1);
      return matchQ && matchT && matchP;
    }).sort((a,b) => {
      const ai = state.tables.findIndex((t) => t.id === a.table_id), bi = state.tables.findIndex((t) => t.id === b.table_id);
      if (ai !== bi) return ai - bi;
      return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name,'zh-Hant');
    });
  }

  function renderGuests() {
    const guests = filteredGuests();
    if (!guests.length) { els.guestList.innerHTML = '<div class="empty">目前沒有符合條件的來賓</div>'; return; }
    els.guestList.innerHTML = guests.map((g) => {
      const expected = +g.party_size || 1, count = arrived(g), c = checkinByGuest(g.id), t = tableById(g.table_id);
      const cls = count >= expected ? 'done' : count > 0 ? 'partial' : '';
      const label = count >= expected ? '已全到' : count > 0 ? '部分到場' : '尚未到';
      const labelCls = count >= expected ? 'done-text' : count > 0 ? 'partial-text' : '';
      const comp = g.companions ? `<div class="companion">同行：${escapeHtml(g.companions)}</div>` : '';
      const last = c?.updated_at ? `<div class="last-update">最後回報：${escapeHtml(c.reporter_name || '工作人員')} · ${timeLabel(c.updated_at)}</div>` : '';
      return `<article class="guest-card ${cls}" data-guest-id="${g.id}">
        <div><div class="guest-name">${escapeHtml(g.name)}</div><div class="guest-meta"><span class="tag table">${escapeHtml(t?.name || '尚未分桌')}</span><span class="tag">預計 ${expected} 人</span></div>${comp}</div>
        <div class="arrival-summary"><b>${count} / ${expected}</b><span class="${labelCls}">${label}</span></div>
        <div class="arrival-controls">
          <button type="button" data-delta="-1" data-id="${g.id}" ${count<=0?'disabled':''}>－</button>
          <input type="number" min="0" max="${expected}" value="${count}" data-count-input="${g.id}" />
          <button type="button" data-delta="1" data-id="${g.id}" ${count>=expected?'disabled':''}>＋</button>
          <button type="button" class="full-btn" data-full="${g.id}" ${count>=expected?'disabled':''}>全到</button>
        </div>${last}
      </article>`;
    }).join('');
    els.guestList.querySelectorAll('[data-delta]').forEach((b) => b.onclick = () => changeCount(b.dataset.id, +(b.dataset.delta || 0)));
    els.guestList.querySelectorAll('[data-full]').forEach((b) => { b.onclick = () => { const g = state.guests.find((x) => x.id === b.dataset.full); if (g) saveCount(g, +g.party_size || 1); }; });
    els.guestList.querySelectorAll('[data-count-input]').forEach((input) => input.onchange = () => { const g = state.guests.find((x) => x.id === input.dataset.countInput); if (g) saveCount(g, +input.value || 0); });
  }

  async function changeCount(id, delta) {
    const g = state.guests.find((x) => x.id === id); if (!g) return;
    await saveCount(g, arrived(g) + delta);
  }

  async function saveCount(g, next) {
    if (saving.has(g.id)) return;
    const who = reporter();
    if (!who) { toast('請先填「回報人員」名稱'); els.reporterName.focus(); return; }
    localStorage.setItem('wedding-checkin-reporter', who);
    const expected = +g.party_size || 1;
    const count = Math.max(0, Math.min(expected, Number(next) || 0));
    saving.add(g.id); status('● 儲存中…');
    const old = checkinByGuest(g.id);
    if (old) old.arrived_count = count; else state.checkins.push({event_id:EVENT_ID,guest_id:g.id,arrived_count:count,reporter_name:who,updated_at:new Date().toISOString()});
    render();
    try {
      const { error } = await db.from('wedding_checkins').upsert({
        event_id:EVENT_ID, guest_id:g.id, arrived_count:count, reporter_name:who,
        updated_by:session.user.id, updated_at:new Date().toISOString()
      }, { onConflict:'event_id,guest_id' });
      if (error) throw error;
      status('● 已同步');
    } catch (err) {
      console.error(err); toast('回報失敗：' + (err.message || err)); status('● 儲存失敗',true); await loadAll({quiet:true});
    } finally { saving.delete(g.id); }
  }

  function bindStatic() {
    els.loginForm.onsubmit = async (e) => {
      e.preventDefault(); els.loginBtn.disabled = true; els.authMsg.textContent = '登入中…';
      const { data, error } = await db.auth.signInWithPassword({ email:els.loginEmail.value.trim(), password:els.loginPassword.value });
      els.loginBtn.disabled = false;
      if (error) return els.authMsg.textContent = '登入失敗：請確認 Email 與密碼。';
      if (data?.session) await openSession(data.session);
    };
    els.logoutBtn.onclick = async () => { await db.auth.signOut(); showLogin(); };
    els.reporterName.onchange = () => localStorage.setItem('wedding-checkin-reporter', reporter());
    els.search.oninput = renderGuests;
    els.tableFilter.onchange = () => { renderTableChips(); renderGuests(); };
    els.pendingOnly.onchange = renderGuests;
    els.clearFilterBtn.onclick = () => { els.search.value=''; els.tableFilter.value='all'; els.pendingOnly.checked=false; renderTableChips(); renderGuests(); };
  }

  init();
})();
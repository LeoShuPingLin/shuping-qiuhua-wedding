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
  const saving = new Set();
  const state = { tables: [], guests: [], checkins: [] };

  const els = {
    authShell: $('#authShell'), app: $('#app'), loginForm: $('#loginForm'), loginPassword: $('#loginPassword'),
    loginBtn: $('#loginBtn'), authMsg: $('#authMsg'), logoutBtn: $('#logoutBtn'), saveStatus: $('#saveStatus'),
    stats: $('#stats'), search: $('#searchInput'), searchCount: $('#searchCount'), tableFilter: $('#tableFilter'),
    pendingOnly: $('#pendingOnly'), clearFilterBtn: $('#clearFilterBtn'), tableChips: $('#tableChips'),
    guestList: $('#guestList'), toast: $('#toast')
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
    try { return new Intl.DateTimeFormat('zh-TW',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); }
    catch { return ''; }
  }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }
  function status(text, error = false) {
    els.saveStatus.textContent = text;
    els.saveStatus.classList.toggle('error', !!error);
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
        return showLogin('這組密碼沒有婚宴報到權限，請確認是否輸入正確。');
      }
      access = owner ? { type:'owner' } : { type:'staff' };
      await loadAll();
      els.authShell.hidden = true;
      els.app.hidden = false;
      subscribeRealtime();
      setTimeout(() => els.search.focus(), 80);
    } catch (err) {
      console.error(err);
      els.authMsg.textContent = '暫時無法讀取報到資料，請稍後再試。';
    }
  }

  async function loadAll({quiet=false} = {}) {
    if (!db || !session) return;
    if (!quiet) status('同步中…');
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
      status('已同步');
    } catch (err) {
      console.error(err);
      status('同步失敗', true);
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
        if (s === 'SUBSCRIBED') status('即時同步');
        if (['CHANNEL_ERROR','TIMED_OUT'].includes(s)) status('連線異常', true);
      });
  }
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadAll({quiet:true}), 180);
  }

  function render() {
    renderStats();
    renderTableFilter();
    renderTableChips();
    renderGuests();
  }

  function renderStats() {
    const expected = state.guests.reduce((n,g) => n + (+g.party_size || 1),0);
    const present = state.guests.reduce((n,g) => n + arrived(g),0);
    const doneGroups = state.guests.filter((g) => arrived(g) >= (+g.party_size || 1)).length;
    els.stats.innerHTML = [
      ['預計', expected, ''], ['已到', present, 'good'], ['未到', Math.max(0, expected-present), 'warn'], ['完成', `${doneGroups}/${state.guests.length}`, 'good']
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
      return `<button class="table-chip ${active===t.id?'active':''}" data-table-chip="${t.id}">${escapeHtml(t.name)} <b>${p}/${e}</b></button>`;
    }).join('');
    els.tableChips.querySelectorAll('[data-table-chip]').forEach((b) => {
      b.onclick = () => {
        els.tableFilter.value = b.dataset.tableChip;
        renderTableChips();
        renderGuests();
      };
    });
  }

  function matchRank(g, q) {
    if (!q) return 10;
    const name = norm(g.name);
    const companions = norm(g.companions || '');
    const table = norm(tableById(g.table_id)?.name || '');
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (companions.includes(q)) return 2;
    if (table.includes(q)) return 3;
    return 99;
  }

  function filteredGuests() {
    const q = norm(els.search.value);
    const tf = els.tableFilter.value;
    const pending = els.pendingOnly.checked;
    return state.guests.filter((g) => {
      const rank = matchRank(g, q);
      const matchQ = !q || rank < 99;
      const matchT = tf === 'all' || (tf === 'unassigned' ? !g.table_id : g.table_id === tf);
      const matchP = !pending || arrived(g) < (+g.party_size || 1);
      return matchQ && matchT && matchP;
    }).sort((a,b) => {
      if (q) {
        const rankDiff = matchRank(a,q) - matchRank(b,q);
        if (rankDiff) return rankDiff;
        const nameA = norm(a.name), nameB = norm(b.name);
        const posDiff = nameA.indexOf(q) - nameB.indexOf(q);
        if (posDiff) return posDiff;
      }
      const ai = state.tables.findIndex((t) => t.id === a.table_id);
      const bi = state.tables.findIndex((t) => t.id === b.table_id);
      if (ai !== bi) return ai - bi;
      return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name,'zh-Hant');
    });
  }

  function renderGuests() {
    const guests = filteredGuests();
    const q = norm(els.search.value);
    els.searchCount.textContent = q ? `找到 ${guests.length} 組` : `共 ${guests.length} 組`;

    if (!guests.length) {
      els.guestList.innerHTML = `<div class="empty">找不到「${escapeHtml(els.search.value)}」相關來賓<br><small>可試著只輸入姓氏或其中一個字</small></div>`;
      return;
    }

    els.guestList.innerHTML = guests.map((g) => {
      const expected = +g.party_size || 1;
      const count = arrived(g);
      const c = checkinByGuest(g.id);
      const t = tableById(g.table_id);
      const cls = count >= expected ? 'done' : count > 0 ? 'partial' : '';
      const label = count >= expected ? '已全到' : count > 0 ? '部分到場' : '尚未到';
      const labelCls = count >= expected ? 'done-text' : count > 0 ? 'partial-text' : '';
      const comp = g.companions ? `<div class="companion">同行：${escapeHtml(g.companions)}</div>` : '';
      const last = c?.updated_at ? `<div class="last-update">最後更新 ${timeLabel(c.updated_at)}</div>` : '';
      return `<article class="guest-card ${cls}" data-guest-id="${g.id}">
        <div>
          <div class="guest-name">${escapeHtml(g.name)}</div>
          <div class="guest-meta"><span class="tag table">${escapeHtml(t?.name || '尚未分桌')}</span><span class="tag">預計 ${expected} 人</span></div>
          ${comp}
        </div>
        <div class="arrival-summary"><b>${count}/${expected}</b><span class="${labelCls}">${label}</span></div>
        <div class="arrival-controls">
          <button type="button" data-delta="-1" data-id="${g.id}" aria-label="減少一人" ${count<=0?'disabled':''}>－</button>
          <input type="number" min="0" max="${expected}" inputmode="numeric" value="${count}" data-count-input="${g.id}" aria-label="目前到場人數" />
          <button type="button" data-delta="1" data-id="${g.id}" aria-label="增加一人" ${count>=expected?'disabled':''}>＋</button>
          <button type="button" class="full-btn" data-full="${g.id}" ${count>=expected?'disabled':''}>${count>=expected?'✓ 已全到':'✓ 全到'}</button>
        </div>
        ${last}
      </article>`;
    }).join('');

    els.guestList.querySelectorAll('[data-delta]').forEach((b) => b.onclick = () => changeCount(b.dataset.id, +(b.dataset.delta || 0)));
    els.guestList.querySelectorAll('[data-full]').forEach((b) => b.onclick = () => {
      const g = state.guests.find((x) => x.id === b.dataset.full);
      if (g) saveCount(g, +g.party_size || 1);
    });
    els.guestList.querySelectorAll('[data-count-input]').forEach((input) => input.onchange = () => {
      const g = state.guests.find((x) => x.id === input.dataset.countInput);
      if (g) saveCount(g, +input.value || 0);
    });
  }

  async function changeCount(id, delta) {
    const g = state.guests.find((x) => x.id === id);
    if (g) await saveCount(g, arrived(g) + delta);
  }

  async function saveCount(g, next) {
    if (saving.has(g.id)) return;
    const expected = +g.party_size || 1;
    const count = Math.max(0, Math.min(expected, Number(next) || 0));
    saving.add(g.id);
    status('儲存中…');

    const old = checkinByGuest(g.id);
    const optimistic = {
      event_id:EVENT_ID, guest_id:g.id, arrived_count:count, reporter_name:'工作人員',
      updated_at:new Date().toISOString(), updated_by:session.user.id
    };
    if (old) Object.assign(old, optimistic); else state.checkins.push(optimistic);
    render();

    try {
      const { error } = await db.from('wedding_checkins').upsert({
        event_id:EVENT_ID, guest_id:g.id, arrived_count:count, reporter_name:'工作人員',
        updated_by:session.user.id, updated_at:new Date().toISOString()
      }, { onConflict:'event_id,guest_id' });
      if (error) throw error;
      status('已儲存');
      toast(count >= expected ? `${g.name}：已全到 ✓` : `${g.name}：目前 ${count} 人`);
    } catch (err) {
      console.error(err);
      toast('回報失敗，請再試一次');
      status('儲存失敗', true);
      await loadAll({quiet:true});
    } finally {
      saving.delete(g.id);
    }
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
    els.search.oninput = () => renderGuests();
    els.tableFilter.onchange = () => { renderTableChips(); renderGuests(); };
    els.pendingOnly.onchange = renderGuests;
    els.clearFilterBtn.onclick = () => {
      els.search.value = '';
      els.tableFilter.value = 'all';
      els.pendingOnly.checked = false;
      renderTableChips();
      renderGuests();
      els.search.focus();
    };
  }

  init();
})();

(() => {
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

  async function loadAll({ quiet = false } = {}) {
    if (!db || !currentSession || loading) return;
    loading = true;
    if (!quiet) setStatus('● 同步中…', 'saving');
    try {
      const [settingsRes, tablesRes, guestsRes] = await Promise.all([
        db.from('wedding_settings').select('*').eq('event_id', EVENT_ID).single(),
        db.from('wedding_tables').select('*').eq('event_id', EVENT_ID).order('sort_order', { ascending: true }).order('name', { ascending: true }),
        db.from('wedding_guests').select('*').eq('event_id', EVENT_ID).order('sort_order', { ascending: true }).order('name', { ascending: true })
      ]);
      for (const res of [settingsRes, tablesRes, guestsRes]) if (res.error) throw res.error;
      Object.assign(state.settings, settingsRes.data || {});
      state.tables = tablesRes.data || [];
      state.guests = guestsRes.data || [];
      render();
      setStatus('● 已同步', 'ok');
    } catch (err) {
      console.error(err);
      setStatus('● 同步失敗', 'error');
      toast('讀取資料失敗：' + (err.message || err));
    } finally {
      loading = false;
    }
  }

  function subscribeRealtime() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    realtimeChannel = db.channel(`wedding-seating-${EVENT_ID}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'wedding_guests' }, scheduleRealtimeReload)
      .on('postgres_changes', { event:'*', schema:'public', table:'wedding_tables' }, scheduleRealtimeReload)
      .on('postgres_changes', { event:'*', schema:'public', table:'wedding_settings' }, scheduleRealtimeReload)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setStatus('● 已連線', 'ok');
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) setStatus('● 即時同步連線異常', 'error');
      });
  }
  function scheduleRealtimeReload() {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => loadAll({ quiet: true }), 180);
  }

  function updateUndo() { $('#undoBtn').disabled = history.length === 0; }
  function makeBackupPayload() {
    return {
      version: 2,
      eventId: EVENT_ID,
      createdAt: new Date().toISOString(),
      settings: JSON.parse(JSON.stringify(state.settings)),
      tables: JSON.parse(JSON.stringify(state.tables)),
      guests: JSON.parse(JSON.stringify(state.guests))
    };
  }

  function stateSignature() {
    const settings = {
      default_capacity: state.settings.default_capacity,
      table_prefix: state.settings.table_prefix,
      next_table_no: state.settings.next_table_no
    };
    const tables = state.tables.map(({id,name,capacity,is_locked,sort_order}) => ({id,name,capacity,is_locked,sort_order})).sort((a,b) => a.id.localeCompare(b.id));
    const guests = state.guests.map(({id,name,party_size,side,attendance,child_seats,companions,notes,table_id,sort_order,source,source_key}) => ({id,name,party_size,side,attendance,child_seats,companions,notes,table_id,sort_order,source,source_key})).sort((a,b) => a.id.localeCompare(b.id));
    return JSON.stringify({settings,tables,guests});
  }

  async function mutate(label, fn, { takeSnapshot = true, reload = true } = {}) {
    const before = takeSnapshot ? makeBackupPayload() : null;
    setStatus(`● ${label}…`, 'saving');
    try {
      const result = await fn();
      if (result?.error) throw result.error;
      if (reload) await loadAll({ quiet: true });
      if (takeSnapshot && before) {
        history.push({ before, afterSignature: stateSignature() });
        if (history.length > MAX_HISTORY) history.shift();
        updateUndo();
      }
      setStatus('● 已同步', 'ok');
      return true;
    } catch (err) {
      console.error(err);
      setStatus('● 儲存失敗', 'error');
      toast(`${label}失敗：${err.message || err}`);
      await loadAll({ quiet: true });
      return false;
    }
  }

  function render() {
    renderStats();
    renderSidebar();
    renderBoard();
    syncSettings();
    initSortables();
    applyFilters();
    updateUndo();
  }
  function renderStats() {
    const dg = dinnerGuests();
    const total = dg.reduce((n, g) => n + (+g.party_size || 1), 0);
    const assigned = dg.filter((g) => g.table_id).reduce((n, g) => n + (+g.party_size || 1), 0);
    const unassigned = total - assigned;
    const seats = state.tables.reduce((n, t) => n + (+t.capacity || 0), 0);
    const child = dg.reduce((n, g) => n + (+g.child_seats || 0), 0);
    const data = [['晚宴總人數', total], ['已分桌', assigned], ['尚未分桌', unassigned], ['總座位', seats], ['兒童座椅', child]];
    els.stats.innerHTML = data.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  }
  function guestCard(g, locked = false) {
    const side = sideLabel(g.side);
    const sideClass = side === '書平' ? 'shu' : side === '秋華' ? 'qiu' : '';
    const comp = g.companions && normalize(g.companions) !== '無' ? `<div class="companion">同行：${escapeHtml(g.companions)}</div>` : '';
    const notes = g.notes ? `<div class="companion">備註：${escapeHtml(g.notes)}</div>` : '';
    return `<div class="guest ${locked ? 'locked' : ''}" data-guest-id="${g.id}">
      <div class="guest-top"><div class="guest-name">${escapeHtml(g.name)}</div><span class="party">${g.party_size} 人</span><button class="edit-mini" data-edit-guest="${g.id}" title="編輯">✎</button></div>
      <div class="guest-meta"><span class="tag ${sideClass}">${side}</span>${g.child_seats ? `<span class="tag child">兒童椅 ${g.child_seats}</span>` : ''}</div>${comp}${notes}
    </div>`;
  }
  function renderSidebar() {
    const un = state.guests.filter((g) => g.attendance === 'dinner' && !g.table_id);
    const other = state.guests.filter((g) => g.attendance !== 'dinner');
    els.unassigned.innerHTML = un.map((g) => guestCard(g)).join('');
    els.unassigned.classList.toggle('empty', un.length === 0);
    els.other.innerHTML = other.map((g) => guestCard(g, true)).join('');
    els.unassignedCount.textContent = `${un.reduce((n, g) => n + (+g.party_size || 1), 0)} 人 / ${un.length} 組`;
    els.otherCount.textContent = `${other.length} 組`;
    bindGuestClicks();
  }
  function renderBoard() {
    els.board.innerHTML = state.tables.map((t, tableIndex) => {
      const seated = tableCount(t.id);
      const pct = Math.min(100, Math.round(seated / (t.capacity || 1) * 100));
      const full = seated === +t.capacity;
      const over = seated > +t.capacity;
      const guests = state.guests.filter((g) => g.attendance === 'dinner' && g.table_id === t.id);
      return `<section class="table-card ${full ? 'full' : ''} ${over ? 'over' : ''} ${t.is_locked ? 'locked-table' : ''}" data-table-card-id="${t.id}">
        <div class="table-head"><button class="table-drag-handle" type="button" title="拖曳調整桌次位置" aria-label="拖曳調整桌次位置">⋮⋮</button><div class="table-title-wrap">
          <input class="table-name" value="${escapeHtml(t.name)}" data-name-table="${t.id}" ${t.is_locked ? 'disabled' : ''}/>
          <div class="table-status">${seated} / ${t.capacity} 人${full ? ' · 已滿' : over ? ` · 超出 ${seated - t.capacity}` : ` · 剩 ${t.capacity - seated}`}</div>
        </div><div class="table-actions">
          <button class="icon-btn table-step" data-move-table="${t.id}" data-dir="-1" title="往左移一格" aria-label="往左移一格" ${tableIndex === 0 ? 'disabled' : ''}>←</button>
          <button class="icon-btn table-step" data-move-table="${t.id}" data-dir="1" title="往右移一格" aria-label="往右移一格" ${tableIndex === state.tables.length - 1 ? 'disabled' : ''}>→</button>
          <button class="icon-btn ${t.is_locked ? 'active' : ''}" data-lock-table="${t.id}" title="${t.is_locked ? '解鎖' : '鎖定'}">${t.is_locked ? '🔒' : '🔓'}</button>
          <button class="icon-btn" data-cap-table="${t.id}" title="座位上限">↕</button>
          <button class="icon-btn" data-delete-table="${t.id}" title="刪除桌次">×</button>
        </div></div>
        <div class="capacity-bar"><i style="width:${pct}%"></i></div>
        <div class="guest-list ${guests.length ? '' : 'empty'}" data-table-id="${t.id}">${guests.map((g) => guestCard(g, t.is_locked)).join('')}</div>
      </section>`;
    }).join('');
    bindGuestClicks();
    bindTableActions();
  }
  function bindGuestClicks() {
    $$('[data-edit-guest]').forEach((btn) => btn.onclick = (e) => { e.stopPropagation(); openGuest(btn.dataset.editGuest); });
  }
  async function persistTableOrder(orderedIds, label = '調整桌次位置') {
    const cleanIds = orderedIds.filter(Boolean);
    if (cleanIds.length !== state.tables.length) {
      toast('桌次排序資料不完整，已重新載入');
      render();
      return false;
    }
    return mutate(label, async () => {
      for (let i = 0; i < cleanIds.length; i += 1) {
        const { error } = await db.from('wedding_tables')
          .update({ sort_order: (i + 1) * 10 })
          .eq('id', cleanIds[i])
          .eq('event_id', EVENT_ID);
        if (error) throw error;
      }
      return { error: null };
    });
  }

  async function moveTableStep(id, delta) {
    const ids = state.tables.map((t) => t.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await persistTableOrder(ids, delta < 0 ? '桌次往左移' : '桌次往右移');
  }

  function bindTableActions() {
    $$('[data-move-table]').forEach((btn) => btn.onclick = async () => {
      if (btn.disabled) return;
      await moveTableStep(btn.dataset.moveTable, Number(btn.dataset.dir) || 0);
    });
    $$('[data-name-table]').forEach((input) => input.onchange = async () => {
      const t = tableById(input.dataset.nameTable);
      const name = input.value.trim() || t.name;
      if (name === t.name) return;
      await mutate('更新桌名', () => db.from('wedding_tables').update({ name }).eq('id', t.id).eq('event_id', EVENT_ID));
    });
    $$('[data-lock-table]').forEach((btn) => btn.onclick = async () => {
      const t = tableById(btn.dataset.lockTable);
      await mutate(t.is_locked ? '解鎖桌次' : '鎖定桌次', () => db.from('wedding_tables').update({ is_locked: !t.is_locked }).eq('id', t.id).eq('event_id', EVENT_ID));
    });
    $$('[data-cap-table]').forEach((btn) => btn.onclick = async () => {
      const t = tableById(btn.dataset.capTable);
      const v = prompt(`${t.name} 每桌上限`, t.capacity);
      if (v === null || !Number.isFinite(+v) || +v < 1) return;
      const capacity = Math.min(99, Math.max(1, +v));
      await mutate('更新桌次容量', () => db.from('wedding_tables').update({ capacity }).eq('id', t.id).eq('event_id', EVENT_ID));
    });
    $$('[data-delete-table]').forEach((btn) => btn.onclick = async () => {
      const t = tableById(btn.dataset.deleteTable);
      if (t.is_locked) return toast('請先解鎖這一桌');
      const count = tableCount(t.id);
      if (!confirm(`刪除「${t.name}」？${count ? `\n桌內 ${count} 人會回到尚未分桌。` : ''}`)) return;
      await mutate('刪除桌次', () => db.from('wedding_tables').delete().eq('id', t.id).eq('event_id', EVENT_ID));
    });
  }

  function initSortables() {
    sortables.forEach((s) => s.destroy());
    sortables = [];

    const tableSortable = new Sortable(els.board, {
      animation: 180,
      draggable: '.table-card',
      handle: '.table-drag-handle',
      ghostClass: 'table-dragging',
      chosenClass: 'table-chosen',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const ids = [...els.board.querySelectorAll('.table-card')].map((card) => card.dataset.tableCardId);
        const ok = await persistTableOrder(ids);
        if (!ok) render();
      }
    });
    sortables.push(tableSortable);

    $$('.guest-list[data-table-id]').forEach((list) => {
      const tid = list.dataset.tableId || null;
      const t = tid ? tableById(tid) : null;
      const instance = new Sortable(list, {
        group: 'seating', sort: false, animation: 160, delay: 40, delayOnTouchOnly: true,
        touchStartThreshold: 4, disabled: !!t?.is_locked, draggable: '.guest:not(.hidden):not(.locked)', ghostClass: 'dragging',
        onEnd: async (evt) => {
          const g = guestById(evt.item.dataset.guestId);
          if (!g) return render();
          const destId = evt.to.dataset.tableId || null;
          const dest = destId ? tableById(destId) : null;
          if (dest?.is_locked) { toast('這一桌已鎖定'); return render(); }
          if ((g.table_id || null) === destId) return render();
          const ok = await mutate('移動賓客', () => db.from('wedding_guests').update({ table_id: destId }).eq('id', g.id).eq('event_id', EVENT_ID));
          if (ok && dest && tableCount(dest.id) > dest.capacity) toast(`已移入 ${dest.name}，目前超出座位上限`);
        }
      });
      sortables.push(instance);
    });
  }
  function applyFilters() {
    const q = normalize(els.search.value);
    const sf = els.sideFilter.value;
    const zf = els.sizeFilter.value;
    $$('.guest').forEach((card) => {
      const g = guestById(card.dataset.guestId); if (!g) return;
      const text = normalize(`${g.name} ${g.companions || ''} ${g.notes || ''}`);
      const side = sideLabel(g.side), size = +g.party_size || 1;
      const matchQ = !q || text.includes(q);
      const matchS = sf === 'all' || (sf === '其他' ? !['書平','秋華'].includes(side) : side === sf);
      const matchZ = zf === 'all' || (zf === '1' && size === 1) || (zf === '2' && size === 2) || (zf === '3plus' && size >= 3);
      card.classList.toggle('hidden', !(matchQ && matchS && matchZ));
    });
  }
  function syncSettings() {
    $('#defaultCapacity').value = state.settings.default_capacity || 10;
    $('#tablePrefix').value = state.settings.table_prefix || '第';
  }

  function openGuest(id = null) {
    const g = id ? guestById(id) : null;
    $('#guestDialogTitle').textContent = g ? '編輯賓客' : '新增賓客';
    $('#guestId').value = g?.id || '';
    $('#guestName').value = g?.name || '';
    $('#guestPartySize').value = g?.party_size || 1;
    $('#guestSide').value = ['書平','秋華'].includes(sideLabel(g?.side)) ? sideLabel(g?.side) : '其他';
    $('#guestAttendance').value = g?.attendance || 'dinner';
    $('#guestChildSeats').value = g?.child_seats || 0;
    $('#guestCompanions').value = g?.companions || '';
    $('#guestNotes').value = g?.notes || '';
    $('#deleteGuestBtn').style.visibility = g ? 'visible' : 'hidden';
    $('#guestDialog').showModal();
    setTimeout(() => $('#guestName').focus(), 50);
  }

  async function saveGuest() {
    const name = $('#guestName').value.trim();
    if (!name) return toast('請輸入姓名');
    const id = $('#guestId').value;
    const patch = {
      name,
      party_size: Math.max(1, +$('#guestPartySize').value || 1),
      side: $('#guestSide').value,
      attendance: $('#guestAttendance').value,
      child_seats: Math.max(0, +$('#guestChildSeats').value || 0),
      companions: $('#guestCompanions').value.trim(),
      notes: $('#guestNotes').value.trim()
    };
    if (patch.attendance !== 'dinner') patch.table_id = null;
    const ok = await mutate(id ? '更新賓客' : '新增賓客', () => id
      ? db.from('wedding_guests').update(patch).eq('id', id).eq('event_id', EVENT_ID)
      : db.from('wedding_guests').insert({ event_id: EVENT_ID, table_id: null, source: 'manual', ...patch }));
    if (ok) $('#guestDialog').close();
  }
  async function deleteGuest() {
    const id = $('#guestId').value, g = guestById(id);
    if (!g || !confirm(`刪除「${g.name}」？`)) return;
    const ok = await mutate('刪除賓客', () => db.from('wedding_guests').delete().eq('id', id).eq('event_id', EVENT_ID));
    if (ok) $('#guestDialog').close();
  }

  async function bulkAdd() {
    const lines = $('#bulkText').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const rows = lines.map((line, i) => {
      const parts = line.split('|').map((s) => s.trim());
      const name = parts[0]; if (!name) return null;
      return {
        event_id: EVENT_ID, name, party_size: Math.max(1, parseInt(parts[1]) || 1),
        side: parts[2]?.includes('秋華') ? '秋華' : parts[2]?.includes('書平') ? '書平' : '其他',
        attendance: 'dinner', child_seats: 0, companions: '', notes: '', table_id: null,
        source: 'bulk', sort_order: state.guests.length + i + 1
      };
    }).filter(Boolean);
    if (!rows.length) return;
    const ok = await mutate('批次新增', () => db.from('wedding_guests').insert(rows));
    if (ok) { $('#bulkText').value = ''; $('#bulkDialog').close(); toast(`已新增 ${rows.length} 組賓客`); }
  }

  function detectHeader(headers, needles) { return headers.find((h) => needles.some((n) => normalize(h).includes(normalize(n)))); }
  function parseAttendance(s) {
    s = String(s || '');
    if (/無法|不克|不能參加|無法出席/.test(s)) return 'declined';
    if (/晚宴|都可以|一起見證/.test(s)) return 'dinner';
    if (/佛前/.test(s)) return 'ceremony';
    return 'unknown';
  }
  const cnum = { '零':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
  function parsePartySize(raw, companions, attendance) {
    if (attendance !== 'dinner') return 1;
    const s = String(raw || '').replace(/\s/g, ''), c = String(companions || '').replace(/\s/g, '');
    const arab = [...s.matchAll(/(\d+)\s*(?:大|小)/g)].map((m) => +m[1]); if (arab.length >= 2) return arab.reduce((a,b) => a+b,0);
    const zh = [...s.matchAll(/([一二兩三四五六七八九十])(?:大|小)/g)].map((m) => cnum[m[1]]); if (zh.length >= 2) return zh.reduce((a,b) => a+b,0);
    const digit = s.match(/\d+/); if (digit) return Math.max(1, +digit[0]);
    for (const [k,v] of Object.entries(cnum)) if (s.includes(`共${k}位`) || s.includes(`${k}位`) || c.includes(`共${k}位`) || c.includes(`一共${k}位`)) return Math.max(1,v);
    return 1;
  }
  function parseChildSeats(raw) {
    const s = String(raw ?? ''); const d = s.match(/\d+/); if (d) return +d[0];
    for (const [k,v] of Object.entries(cnum)) if (s.includes(k)) return v;
    return 0;
  }
  function possibleDuplicateNames(guests = state.guests) {
    const out = new Set(); const dg = guests.filter((g) => g.attendance === 'dinner');
    for (const a of dg) {
      const comp = normalize(a.companions || '').replace(/[（）()]/g, ' '); if (!comp) continue;
      for (const b of dg) { if (a.id && a.id === b.id) continue; const n = normalize(b.name).replace(/\s/g,''); if (n.length >= 2 && comp.replace(/\s/g,'').includes(n)) out.add(b.name); }
    }
    return [...out];
  }

  async function importSpreadsheet(file) {
    if (!window.XLSX) return toast('Excel 元件載入失敗，請確認網路');
    showLoading('解析 Excel 名單…');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
      if (!rows.length) throw new Error('找不到資料');
      const headers = Object.keys(rows[0]);
      const hName = detectHeader(headers, ['留下您的姓名','姓名']);
      const hSide = detectHeader(headers, ['誰的親友','親友']);
      const hAtt = detectHeader(headers, ['出席情況','出席']);
      const hCount = detectHeader(headers, ['晚宴出席人數','晚宴人數','出席人數']);
      const hComp = detectHeader(headers, ['同行親友','同行者','攜伴']);
      const hChild = detectHeader(headers, ['兒童座椅','兒童椅']);
      if (!hName) throw new Error('找不到「姓名」欄位');

      const existing = new Set(state.guests.map((g) => g.source_key).filter(Boolean));
      const inserts = [];
      let skipped = 0, dinner = 0, people = 0, other = 0;
      for (const row of rows) {
        const name = String(row[hName] || '').trim(); if (!name) continue;
        const companions = String(hComp ? row[hComp] : '').trim();
        const source_key = normalize(name) + '|' + normalize(companions);
        if (existing.has(source_key)) { skipped++; continue; }
        const attendance = parseAttendance(hAtt ? row[hAtt] : '');
        const party_size = parsePartySize(hCount ? row[hCount] : '', companions, attendance);
        const side = sideLabel(hSide ? row[hSide] : '其他');
        const child_seats = parseChildSeats(hChild ? row[hChild] : 0);
        inserts.push({ event_id:EVENT_ID, name, party_size, side, attendance, child_seats, companions, notes:'', table_id:null, source:'excel', source_key });
        existing.add(source_key);
        if (attendance === 'dinner') { dinner++; people += party_size; } else other++;
      }

      if (inserts.length) {
        const ok = await mutate('匯入 Excel', () => db.from('wedding_guests').insert(inserts));
        if (!ok) return;
      }
      const dup = possibleDuplicateNames(state.guests);
      $('#importReport').innerHTML = `新增 <b>${inserts.length}</b> 組資料，其中晚宴 <b>${dinner}</b> 組／<b>${people}</b> 人；非晚宴或待確認 <b>${other}</b> 組。${skipped ? `<br>另有 <b>${skipped}</b> 組與既有匯入資料相同，已略過。` : ''}${dup.length ? `<br><span style="color:#9a5f32">⚠ 疑似有 ${dup.length} 位賓客也出現在其他人的同行欄：${dup.map(escapeHtml).join('、')}。系統不會自動刪除，請人工確認。</span>` : ''}`;
      $('#importDialog').showModal();
    } catch (err) {
      console.error(err); toast('Excel 匯入失敗：' + (err.message || err));
    } finally { hideLoading(); }
  }

  async function autoArrange() {
    const un = state.guests.filter((g) => g.attendance === 'dinner' && !g.table_id);
    if (!un.length) return toast('目前沒有尚未分桌的晚宴賓客');
    const openTables = state.tables.filter((t) => !t.is_locked);
    if (!openTables.length) return toast('沒有可編排的桌次');
    if (!confirm('自動初排會依「書平／秋華／其他」分組並盡量排在一起；完成後仍可手動拖拉，也可以按「復原」。\n\n要開始嗎？')) return;

    const counts = Object.fromEntries(state.tables.map((t) => [t.id, tableCount(t.id)]));
    const tableSides = {};
    state.tables.forEach((t) => {
      const sides = new Set(state.guests.filter((g) => g.table_id === t.id).map((g) => sideLabel(g.side)));
      tableSides[t.id] = sides;
    });
    const assignments = {};
    for (const side of ['書平','秋華','其他']) {
      const guests = un.filter((g) => side === '其他' ? !['書平','秋華'].includes(sideLabel(g.side)) : sideLabel(g.side) === side)
        .sort((a,b) => (+b.party_size || 1) - (+a.party_size || 1));
      for (const g of guests) {
        const size = +g.party_size || 1;
        let candidate = openTables.find((t) => counts[t.id] + size <= t.capacity && (counts[t.id] === 0 || tableSides[t.id].size === 0 || (tableSides[t.id].size === 1 && tableSides[t.id].has(side))));
        if (!candidate) candidate = openTables.find((t) => counts[t.id] + size <= t.capacity);
        if (!candidate) candidate = [...openTables].sort((a,b) => (counts[a.id]-a.capacity) - (counts[b.id]-b.capacity))[0];
        if (candidate) {
          assignments[g.id] = candidate.id;
          counts[candidate.id] += size;
          tableSides[candidate.id].add(side);
        }
      }
    }
    const groups = {};
    Object.entries(assignments).forEach(([gid, tid]) => { (groups[tid] ||= []).push(gid); });
    await mutate('自動初排', async () => {
      const results = await Promise.all(Object.entries(groups).map(([tid, ids]) => db.from('wedding_guests').update({ table_id: tid }).eq('event_id', EVENT_ID).in('id', ids)));
      return results.find((r) => r.error) || { error:null };
    });
    toast('已完成初排，可繼續手動拖拉');
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportExcel() {
    if (!window.XLSX) return toast('Excel 元件載入失敗，請確認網路');
    const rows = state.guests.map((g) => ({
      桌次: g.table_id ? (tableById(g.table_id)?.name || '') : (g.attendance === 'dinner' ? '尚未分桌' : '—'),
      姓名: g.name, 人數: g.party_size, 親友方: sideLabel(g.side), 同行者: g.companions || '',
      兒童座椅: g.child_seats || 0, 出席狀況: attendanceLabel(g.attendance), 備註: g.notes || ''
    })).sort((a,b) => a.桌次.localeCompare(b.桌次, 'zh-Hant'));
    const summary = state.tables.map((t) => ({ 桌次:t.name, 已排人數:tableCount(t.id), 座位上限:t.capacity, 剩餘座位:t.capacity-tableCount(t.id), 狀態:t.is_locked?'已鎖定':'可編輯' }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '排桌總表');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '桌次摘要');
    XLSX.writeFile(wb, `書平秋華_婚宴桌次_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast('已匯出 Excel');
  }
  function backup() {
    downloadBlob(new Blob([JSON.stringify(makeBackupPayload(), null, 2)], { type:'application/json' }), `婚宴桌次雲端備份_${new Date().toISOString().slice(0,10)}.json`);
    toast('備份已下載');
  }
  async function restore(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (payload?.version !== 2 || payload?.eventId !== EVENT_ID || !Array.isArray(payload.tables) || !Array.isArray(payload.guests)) throw new Error('備份格式或婚禮 ID 不符');
      if (!confirm('還原備份會取代目前雲端的所有桌次與賓客資料，確定嗎？')) return;
      showLoading('還原雲端備份…');
      const ok = await mutate('還原備份', () => db.rpc('restore_wedding_snapshot', { target_event_id: EVENT_ID, payload }), { takeSnapshot:true, reload:true });
      if (ok) toast('已還原雲端備份');
    } catch (err) { toast('無法還原：' + (err.message || err)); }
    finally { hideLoading(); }
  }
  async function undo() {
    if (!history.length) return;
    showLoading('檢查雲端最新狀態…');
    try {
      await loadAll({ quiet:true });
      const entry = history[history.length - 1];
      if (stateSignature() !== entry.afterSignature) {
        history = []; updateUndo();
        toast('另一裝置已有新變更；為避免覆蓋對方資料，本次不執行復原');
        return;
      }
      history.pop(); updateUndo();
      els.loadingText.textContent = '復原上一步…';
      const { error } = await db.rpc('restore_wedding_snapshot', { target_event_id: EVENT_ID, payload: entry.before });
      if (error) throw error;
      await loadAll({ quiet:true }); toast('已復原上一步');
    } catch (err) {
      console.error(err); toast('復原失敗：' + (err.message || err));
    } finally { hideLoading(); }
  }

  async function addTable() {
    const n = state.settings.next_table_no || state.tables.length + 1;
    const prefix = (state.settings.table_prefix || '第').trim();
    const name = prefix === '第' ? `第 ${n} 桌` : `${prefix} ${n}`;
    const capacity = +state.settings.default_capacity || 10;
    const next_table_no = n + 1;
    await mutate('新增桌次', async () => {
      const a = await db.from('wedding_tables').insert({ event_id:EVENT_ID, name, capacity, is_locked:false, sort_order:n });
      if (a.error) return a;
      return db.from('wedding_settings').update({ next_table_no }).eq('event_id', EVENT_ID);
    });
  }

  function bindStaticControls() {
    els.loginForm.onsubmit = async (e) => {
      e.preventDefault();
      els.loginBtn.disabled = true; els.authMsg.textContent = '登入中…';
      const { data, error } = await db.auth.signInWithPassword({ email: els.loginEmail.value.trim(), password: els.loginPassword.value });
      els.loginBtn.disabled = false;
      if (error) { els.authMsg.textContent = '登入失敗：請確認 Email 與密碼。'; return; }
      if (data?.session) await openSession(data.session);
    };
    els.logoutBtn.onclick = async () => { await db.auth.signOut(); showLogin(); };
    $('#importBtn').onclick = () => els.fileInput.click();
    els.fileInput.onchange = (e) => { const f = e.target.files[0]; if (f) importSpreadsheet(f); e.target.value = ''; };
    $('#addBtn').onclick = () => openGuest();
    $('#bulkBtn').onclick = () => $('#bulkDialog').showModal();
    $('#addTableBtn').onclick = addTable;
    $('#autoBtn').onclick = autoArrange;
    $('#undoBtn').onclick = undo;
    $('#exportBtn').onclick = exportExcel;
    $('#backupBtn').onclick = backup;
    $('#restoreBtn').onclick = () => els.restoreInput.click();
    els.restoreInput.onchange = (e) => { const f = e.target.files[0]; if (f) restore(f); e.target.value = ''; };
    $('#saveGuestBtn').onclick = saveGuest;
    $('#deleteGuestBtn').onclick = deleteGuest;
    $('#bulkSaveBtn').onclick = bulkAdd;
    els.search.oninput = applyFilters;
    els.sideFilter.onchange = applyFilters;
    els.sizeFilter.onchange = applyFilters;
    $('#defaultCapacity').onchange = async (e) => {
      const default_capacity = Math.max(1, +e.target.value || 10);
      await mutate('更新預設桌容量', () => db.from('wedding_settings').update({ default_capacity }).eq('event_id', EVENT_ID));
    };
    $('#tablePrefix').onchange = async (e) => {
      const table_prefix = e.target.value.trim() || '第';
      await mutate('更新桌名前綴', () => db.from('wedding_settings').update({ table_prefix }).eq('event_id', EVENT_ID));
    };
    $('#applyCapBtn').onclick = async () => {
      const cap = Math.max(1, +$('#defaultCapacity').value || 10);
      const ids = state.tables.filter((t) => !t.is_locked).map((t) => t.id);
      if (!ids.length) return toast('沒有未鎖定桌次');
      await mutate('套用桌次容量', () => db.from('wedding_tables').update({ capacity:cap }).eq('event_id', EVENT_ID).in('id', ids));
      toast(`已將未鎖定桌次設為 ${cap} 人`);
    };
  }

  init();
})();

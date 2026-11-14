'use strict';

/* =========================================================
 * 밴더 주문 → 텔레그램 전송
 * - 모든 데이터(품목, 수량, 설정)는 이 기기의 localStorage에 저장됩니다.
 * - 봇 토큰은 코드/저장소에 넣지 말고, 앱의 [설정]에서 입력하세요.
 * ========================================================= */

const STORAGE_KEY = 'vendorOrder.v1';
const HISTORY_LIMIT = 30;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const uid = () => Math.random().toString(36).slice(2, 10);

function makeItem(name, unit = '', qty = 1, checked = false) {
  return { id: uid(), name, unit, qty, checked };
}

function defaultState() {
  return {
    settings: { storeName: '', botToken: '', chatId: '' },
    vendors: [
      {
        id: uid(), name: '밴더 A', chatId: '', memo: '',
        items: [makeItem('예시 품목 1', '박스'), makeItem('예시 품목 2', 'kg'), makeItem('예시 품목 3', '개')],
      },
      {
        id: uid(), name: '밴더 B', chatId: '', memo: '',
        items: [makeItem('예시 품목 1', '박스'), makeItem('예시 품목 2', '봉')],
      },
    ],
    history: [],
  };
}

function normalize(s) {
  const d = defaultState();
  const out = {
    settings: { ...d.settings, ...(s && s.settings) },
    vendors: Array.isArray(s && s.vendors) ? s.vendors : d.vendors,
    history: Array.isArray(s && s.history) ? s.history : [],
  };
  out.vendors = out.vendors.map((v) => ({
    id: v.id || uid(),
    name: String(v.name || '이름 없음'),
    chatId: String(v.chatId || ''),
    memo: String(v.memo || ''),
    items: (Array.isArray(v.items) ? v.items : []).map((it) => ({
      id: it.id || uid(),
      name: String(it.name || ''),
      unit: String(it.unit || ''),
      qty: toNum(it.qty),
      checked: !!it.checked,
    })),
  }));
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다.', e);
  }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('이 브라우저에 저장할 수 없습니다 (사생활 보호 모드?)', true);
  }
}

let state = load();
let activeId = state.vendors[0] ? state.vendors[0].id : null;
let editMode = false;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toNum(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}
const fmtQty = (n) => String(toNum(n));

const activeVendor = () => state.vendors.find((v) => v.id === activeId) || state.vendors[0];
const findItem = (v, id) => v.items.find((it) => it.id === id);
const orderedItems = (v) => v.items.filter((it) => it.checked && toNum(it.qty) > 0 && it.name.trim());

/* ---------------- 렌더링 ---------------- */

function render() {
  renderTabs();
  renderPanel();
  $('#btn-edit').textContent = editMode ? '완료' : '편집';
  $('#btn-edit').classList.toggle('on', editMode);
  $('.actionbar').hidden = editMode;
}

function renderTabs() {
  const tabs = state.vendors.map((v) => {
    const n = orderedItems(v).length;
    return `<button type="button" class="tab ${v.id === activeId ? 'active' : ''}" data-vendor="${esc(v.id)}">
      ${esc(v.name)}${n ? `<span class="badge">${n}</span>` : ''}</button>`;
  });
  if (editMode) tabs.push('<button type="button" class="tab" data-action="add-vendor">+ 밴더 추가</button>');
  $('#tabs').innerHTML = tabs.join('');
}

function renderPanel() {
  const v = activeVendor();
  const panel = $('#panel');
  if (!v) {
    panel.innerHTML = '<p class="empty">밴더가 없습니다. [편집]에서 밴더를 추가하세요.</p>';
    return;
  }
  activeId = v.id;

  if (editMode) {
    panel.innerHTML = `
      <label class="section-label">밴더 이름</label>
      <input class="vendor-name-input field-input" data-field="vendor-name" type="text" value="${esc(v.name)}" />
      <label class="section-label">품목 (이름 / 단위)</label>
      <ul class="items">${v.items.map((it, i) => editRow(it, i, v.items.length)).join('')}</ul>
      <form class="add-row" data-action="add-item">
        <input name="name" type="text" placeholder="새 품목 이름" autocomplete="off" />
        <input name="unit" class="unit-in" type="text" placeholder="단위" autocomplete="off" />
        <button class="btn primary" type="submit">추가</button>
      </form>
      <div class="vendor-tools">
        <button type="button" class="btn small danger" data-action="delete-vendor">이 밴더 삭제</button>
      </div>`;
    return;
  }

  const rows = v.items.length
    ? v.items.map(itemRow).join('')
    : '<li class="empty">품목이 없습니다. 오른쪽 위 [편집]에서 품목을 추가하세요.</li>';
  panel.innerHTML = `
    <ul class="items">${rows}</ul>
    <label class="section-label" for="memo">메모 (메시지 끝에 붙음)</label>
    <textarea id="memo" class="memo" data-field="memo" placeholder="예: 화요일 오전 배송 부탁드립니다">${esc(v.memo)}</textarea>`;
}

function itemRow(it) {
  return `<li class="item ${it.checked ? 'checked' : ''}" data-item="${esc(it.id)}">
    <input type="checkbox" data-action="toggle" ${it.checked ? 'checked' : ''} aria-label="${esc(it.name)} 선택" />
    <span class="name" data-action="toggle">${esc(it.name)}${it.unit ? `<span class="unit">${esc(it.unit)}</span>` : ''}</span>
    <span class="qty">
      <button type="button" data-action="dec" aria-label="수량 줄이기">−</button>
      <input type="text" inputmode="decimal" data-field="qty" value="${esc(fmtQty(it.qty))}" aria-label="${esc(it.name)} 수량" />
      <button type="button" data-action="inc" aria-label="수량 늘리기">+</button>
    </span>
  </li>`;
}

function editRow(it, i, len) {
  return `<li class="item edit" data-item="${esc(it.id)}">
    <input class="e-name" type="text" data-field="item-name" value="${esc(it.name)}" placeholder="품목 이름" />
    <input class="e-unit" type="text" data-field="item-unit" value="${esc(it.unit)}" placeholder="단위" />
    <span class="e-btns">
      <button type="button" class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
      <button type="button" class="icon-btn" data-action="down" ${i === len - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
      <button type="button" class="icon-btn danger" data-action="del-item" aria-label="삭제">✕</button>
    </span>
  </li>`;
}

/* 한 품목 줄만 다시 그리기 (입력 중 포커스가 날아가지 않도록) */
function refreshItem(v, it) {
  const li = document.querySelector(`.item[data-item="${CSS.escape(it.id)}"]`);
  if (li) {
    li.classList.toggle('checked', it.checked);
    li.querySelector('input[type="checkbox"]').checked = it.checked;
    const q = li.querySelector('[data-field="qty"]');
    if (document.activeElement !== q) q.value = fmtQty(it.qty);
  }
  renderTabs();
}

/* ---------------- 이벤트: 메인 화면 ---------------- */

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.action === 'add-vendor') {
    const name = prompt('새 밴더 이름', `밴더 ${String.fromCharCode(65 + state.vendors.length)}`);
    if (!name || !name.trim()) return;
    const v = { id: uid(), name: name.trim(), chatId: '', memo: '', items: [] };
    state.vendors.push(v);
    activeId = v.id;
    save();
    render();
    return;
  }
  activeId = btn.dataset.vendor;
  render();
});

$('#panel').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const v = activeVendor();
  const li = el.closest('[data-item]');
  const it = li ? findItem(v, li.dataset.item) : null;
  const action = el.dataset.action;

  switch (action) {
    case 'toggle':
      if (!it) return;
      if (e.target.type !== 'checkbox') e.preventDefault();
      it.checked = !it.checked;
      if (it.checked && toNum(it.qty) === 0) it.qty = 1;
      break;
    case 'inc':
      it.qty = toNum(it.qty) + 1;
      it.checked = true;
      break;
    case 'dec':
      it.qty = Math.max(0, toNum(it.qty) - 1);
      if (it.qty === 0) it.checked = false;
      break;
    case 'up':
    case 'down': {
      const i = v.items.indexOf(it);
      const j = action === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= v.items.length) return;
      [v.items[i], v.items[j]] = [v.items[j], v.items[i]];
      save();
      renderPanel();
      return;
    }
    case 'del-item':
      if (!confirm(`'${it.name || '이름 없음'}' 품목을 삭제할까요?`)) return;
      v.items = v.items.filter((x) => x !== it);
      save();
      renderPanel();
      renderTabs();
      return;
    case 'delete-vendor':
      if (!confirm(`'${v.name}' 밴더와 품목을 모두 삭제할까요?`)) return;
      state.vendors = state.vendors.filter((x) => x !== v);
      activeId = state.vendors[0] ? state.vendors[0].id : null;
      save();
      render();
      return;
    default:
      return;
  }
  save();
  refreshItem(v, it);
});

$('#panel').addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const v = activeVendor();
  const li = e.target.closest('[data-item]');
  const it = li ? findItem(v, li.dataset.item) : null;

  if (field === 'memo') v.memo = e.target.value;
  else if (field === 'vendor-name') { v.name = e.target.value; renderTabs(); }
  else if (field === 'item-name') it.name = e.target.value;
  else if (field === 'item-unit') it.unit = e.target.value;
  else if (field === 'qty') {
    it.qty = toNum(e.target.value);
    it.checked = it.qty > 0;
    refreshItem(v, it);
  }
  save();
});

$('#panel').addEventListener('focusout', (e) => {
  if (e.target.dataset.field === 'qty') e.target.value = fmtQty(e.target.value);
  if (e.target.dataset.field === 'vendor-name' && !e.target.value.trim()) {
    activeVendor().name = '이름 없음';
    save();
    render();
  }
});

$('#panel').addEventListener('submit', (e) => {
  if (e.target.dataset.action !== 'add-item') return;
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  const unit = e.target.elements.unit.value.trim();
  if (!name) return;
  activeVendor().items.push(makeItem(name, unit, 1, false));
  save();
  renderPanel();
  $('#panel .add-row input[name="name"]').focus();
});

$('#btn-edit').addEventListener('click', () => {
  editMode = !editMode;
  render();
});

$('#btn-reset').addEventListener('click', () => {
  const v = activeVendor();
  if (!v || !confirm(`'${v.name}'의 체크를 모두 해제할까요? (수량은 유지됩니다)`)) return;
  v.items.forEach((it) => { it.checked = false; });
  save();
  render();
});

/* ---------------- 메시지 & 전송 ---------------- */

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} (${WEEKDAYS[d.getDay()]})`;
}

function buildMessage(v, now = new Date()) {
  const items = orderedItems(v);
  const store = state.settings.storeName.trim();
  const lines = [
    `📦 ${store ? `[${store}] ` : ''}${v.name} 주문`,
    `📅 ${formatDate(now)}`,
    '',
    ...items.map((it, i) => `${i + 1}. ${it.name.trim()} — ${fmtQty(it.qty)}${it.unit.trim() ? ' ' + it.unit.trim() : ''}`),
    '',
    `총 ${items.length}개 품목`,
  ];
  if (v.memo.trim()) lines.push('', `📝 ${v.memo.trim()}`);
  return lines.join('\n');
}

const targetChat = (v) => (v.chatId || '').trim() || (state.settings.chatId || '').trim();

async function tg(method, params) {
  const token = (state.settings.botToken || '').trim();
  if (!token) throw new Error('봇 토큰이 없습니다. [설정]에서 입력하세요.');
  if (!/^\d+:[\w-]+$/.test(token)) throw new Error('봇 토큰 형식이 올바르지 않습니다. (예: 123456789:AA...)');
  let res;
  try {
    // form-urlencoded 로 보내면 브라우저 CORS 사전요청 없이 바로 전송됩니다.
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body: new URLSearchParams(params || {}),
    });
  } catch (e) {
    throw new Error('인터넷 연결을 확인하세요.');
  }
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    const desc = (data && data.description) || `HTTP ${res.status}`;
    throw new Error(explainTelegramError(desc));
  }
  return data.result;
}

function explainTelegramError(desc) {
  if (/Unauthorized/i.test(desc)) return '봇 토큰이 올바르지 않습니다.';
  if (/chat not found/i.test(desc)) return '채팅을 찾을 수 없습니다. 채팅 ID를 확인하고, 봇에게 먼저 메시지를 보냈는지(그룹이면 봇을 초대했는지) 확인하세요.';
  if (/bot was blocked/i.test(desc)) return '봇이 차단되어 있습니다. 텔레그램에서 봇 차단을 해제하세요.';
  if (/webhook/i.test(desc)) return '이 봇에 웹훅이 설정되어 있어 채팅 ID를 조회할 수 없습니다.';
  return `텔레그램 오류: ${desc}`;
}

$('#btn-preview').addEventListener('click', () => {
  const v = activeVendor();
  if (!v) return;
  const n = orderedItems(v).length;
  if (!n) { toast('체크된 품목이 없습니다.', true); return; }
  $('#preview-title').textContent = `${v.name} 주문 미리보기`;
  $('#preview-text').textContent = buildMessage(v);
  const chat = targetChat(v);
  $('#preview-target').textContent = chat ? `받는 채팅 ID: ${chat}` : '⚠ 받는 채팅 ID가 없습니다. [설정]에서 입력하세요.';
  $('#btn-send').disabled = false;
  $('#dlg-preview').showModal();
});

$('#btn-copy').addEventListener('click', async () => {
  const text = $('#preview-text').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했습니다.');
  } catch (e) {
    toast('복사하지 못했습니다.', true);
  }
});

$('#btn-send').addEventListener('click', async () => {
  const v = activeVendor();
  const chat = targetChat(v);
  if (!chat) { toast('받는 채팅 ID가 없습니다. [설정]에서 입력하세요.', true); return; }
  const text = buildMessage(v);
  const btn = $('#btn-send');
  btn.disabled = true;
  btn.textContent = '보내는 중…';
  try {
    await tg('sendMessage', { chat_id: chat, text });
    state.history.unshift({ at: new Date().toISOString(), vendor: v.name, text });
    state.history = state.history.slice(0, HISTORY_LIMIT);
    save();
    $('#dlg-preview').close();
    toast(`✅ ${v.name} 주문을 보냈습니다.`);
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
  } finally {
    btn.textContent = '텔레그램으로 보내기';
  }
});

/* ---------------- 설정 ---------------- */

function openSettings() {
  const s = state.settings;
  $('#set-store').value = s.storeName;
  $('#set-token').value = s.botToken;
  $('#set-chat').value = s.chatId;
  $('#set-token').type = 'password';
  $('#set-show-token').checked = false;
  $('#chat-candidates').innerHTML = '';
  $('#vendor-chats').innerHTML = state.vendors.map((v) => `
    <label class="field"><span>${esc(v.name)}</span>
      <input type="text" data-vendor-chat="${esc(v.id)}" value="${esc(v.chatId)}" placeholder="기본값 사용" autocomplete="off" spellcheck="false" />
    </label>`).join('') || '<p class="hint">밴더가 없습니다.</p>';
  renderHistory();
  $('#dlg-settings').showModal();
}

function renderHistory() {
  const h = state.history;
  $('#history').innerHTML = h.length
    ? h.map((r) => {
      const d = new Date(r.at);
      const when = `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `<details><summary>${esc(when)} · ${esc(r.vendor)}</summary><pre>${esc(r.text)}</pre></details>`;
    }).join('')
    : '<p class="hint">아직 보낸 주문이 없습니다.</p>';
}

/* 설정 창에 입력 중인 값(저장 전)을 사용해 텔레그램을 호출 */
async function withDraftSettings(fn) {
  const saved = state.settings;
  state.settings = { ...saved, botToken: $('#set-token').value.trim(), chatId: $('#set-chat').value.trim() };
  try { return await fn(); } finally { state.settings = saved; }
}

$('#btn-settings').addEventListener('click', openSettings);

$('#set-show-token').addEventListener('change', (e) => {
  $('#set-token').type = e.target.checked ? 'text' : 'password';
});

$('#btn-save-settings').addEventListener('click', () => {
  state.settings.storeName = $('#set-store').value.trim();
  state.settings.botToken = $('#set-token').value.trim();
  state.settings.chatId = $('#set-chat').value.trim();
  document.querySelectorAll('[data-vendor-chat]').forEach((inp) => {
    const v = state.vendors.find((x) => x.id === inp.dataset.vendorChat);
    if (v) v.chatId = inp.value.trim();
  });
  save();
  $('#dlg-settings').close();
  toast('설정을 저장했습니다.');
});

$('#btn-test').addEventListener('click', async () => {
  const chat = $('#set-chat').value.trim();
  if (!chat) { toast('기본 받는 채팅 ID를 먼저 입력하세요.', true); return; }
  try {
    await withDraftSettings(() => tg('sendMessage', { chat_id: chat, text: '✅ 밴더 주문 앱 연결 테스트입니다.' }));
    toast('테스트 메시지를 보냈습니다. 텔레그램을 확인하세요.');
  } catch (e) {
    toast(e.message, true);
  }
});

$('#btn-find-chat').addEventListener('click', async () => {
  const box = $('#chat-candidates');
  box.innerHTML = '<p class="hint">찾는 중…</p>';
  try {
    const updates = await withDraftSettings(() => tg('getUpdates', {}));
    const chats = new Map();
    for (const u of updates) {
      const m = u.message || u.edited_message || u.channel_post || u.my_chat_member || u.edited_channel_post;
      const c = m && m.chat;
      if (c && !chats.has(String(c.id))) {
        const label = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '(이름 없음)';
        chats.set(String(c.id), { id: String(c.id), label, type: c.type });
      }
    }
    if (!chats.size) {
      box.innerHTML = '<p class="hint">찾은 채팅이 없습니다. 텔레그램에서 봇에게 아무 메시지(예: /start)를 보낸 뒤 다시 눌러 주세요. 그룹이면 봇을 초대한 뒤 그룹에 메시지를 남겨 주세요.</p>';
      return;
    }
    const typeName = { private: '개인', group: '그룹', supergroup: '그룹', channel: '채널' };
    box.innerHTML = '<p class="hint">사용할 채팅을 누르면 기본 채팅 ID에 입력됩니다.</p>' +
      [...chats.values()].map((c) => `<button type="button" class="btn small" data-chat-id="${esc(c.id)}">${esc(c.label)} · ${esc(typeName[c.type] || c.type)} · ${esc(c.id)}</button>`).join('');
  } catch (e) {
    box.innerHTML = '';
    toast(e.message, true);
  }
});

$('#chat-candidates').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chat-id]');
  if (!b) return;
  $('#set-chat').value = b.dataset.chatId;
  toast('채팅 ID를 입력했습니다. [저장]을 눌러 주세요.');
});

/* ---------------- 백업 ---------------- */

$('#btn-export').addEventListener('click', () => {
  const data = { ...state, settings: { ...state.settings, botToken: '' }, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vendor-order-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.vendors)) throw new Error('형식 오류');
    if (!confirm('지금 품목/설정을 백업 파일 내용으로 바꿀까요? (봇 토큰은 유지됩니다)')) return;
    const token = state.settings.botToken;
    state = normalize(data);
    if (!state.settings.botToken) state.settings.botToken = token;
    activeId = state.vendors[0] ? state.vendors[0].id : null;
    save();
    $('#dlg-settings').close();
    render();
    toast('백업을 불러왔습니다.');
  } catch (err) {
    toast('백업 파일을 읽지 못했습니다.', true);
  }
});

/* ---------------- 공통 ---------------- */

document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
  });
  // 입력칸에서 Enter 를 눌러도 창이 닫히지 않게
  dlg.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
});

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4500 : 2500);
}

render();

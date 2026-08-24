// =============================================
// db.js - Data Layer (Supabase REST + IndexedDB)
// Nessuna dipendenza da CDN, usa fetch() diretto
// =============================================

const SUPABASE_URL = 'https://bdzlkoylmovqkvhvfdpq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemxrb3lsbW92cWt2aHZmZHBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NjMwNTMsImV4cCI6MjEwMzEzOTA1M30.HmUgYwQP1uJDt8xY0RSDjuRY_1UItyKpLsR2Lr0kbAk';

let db = null;
let isOnline = navigator.onLine;

function sbHeaders() {
  return { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
}

// =============================================
// INIT
// =============================================
async function initDB() {
  db = await openIDB('noleggio2026', 3);
  window.addEventListener('online', () => { isOnline = true; syncPending(); });
  window.addEventListener('offline', () => { isOnline = false; });
}

// =============================================
// IndexedDB
// =============================================
function openIDB(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      ['prezzi','giornate','noleggi','clienti','utenti','syncQueue'].forEach(s => {
        if (!d.objectStoreNames.contains(s)) {
          const opts = s === 'syncQueue' ? { keyPath: 'id', autoIncrement: true } : { keyPath: 'id' };
          d.createObjectStore(s, opts);
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(store, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(store, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPutAll(store, items) {
  return new Promise((resolve, reject) => {
    if (!items || items.length === 0) { resolve(); return; }
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    items.forEach(item => s.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// =============================================
// SUPABASE REST HELPERS
// =============================================
async function sbGet(table, params) {
  if (!isOnline) return null;
  const url = new URL(SUPABASE_URL + '/rest/v1/' + table);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString(), { headers: { ...sbHeaders(), 'Prefer': 'return=representation' } });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function sbInsert(table, data) {
  if (!isOnline) { queueSync({ type: 'insert', table, data }); return data; }
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!resp.ok) throw new Error(await resp.text());
  const result = await resp.json();
  return Array.isArray(result) ? result[0] : result;
}

async function sbUpdate(table, data, id) {
  if (!isOnline) { queueSync({ type: 'update', table, data: { ...data, id } }); return data; }
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + id, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!resp.ok) throw new Error(await resp.text());
  const result = await resp.json();
  return Array.isArray(result) ? result[0] : result;
}

async function sbDelete(table, id) {
  if (!isOnline) { queueSync({ type: 'delete', table, id }); return; }
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + id, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!resp.ok) throw new Error(await resp.text());
}

// =============================================
// SYNC QUEUE
// =============================================
function queueSync(op) {
  idbPut('syncQueue', { ...op, id: undefined, timestamp: Date.now() });
}

async function syncPending() {
  if (!isOnline) return;
  try {
    const pending = await idbGetAll('syncQueue');
    for (const op of pending) {
      if (op.type === 'insert') await sbInsert(op.table, op.data);
      else if (op.type === 'update') await sbUpdate(op.table, op.data, op.data.id);
      else if (op.type === 'delete') await sbDelete(op.table, op.id);
      await idbDelete('syncQueue', op.id);
    }
  } catch (e) { console.error('Sync error:', e); }
}

// =============================================
// AUTH
// =============================================
async function authLogin(username, password) {
  const hash = await sha256(password);
  if (isOnline) {
    const data = await sbGet('utenti', { 'select': '*', 'username': 'eq.' + username });
    if (!data || data.length === 0) throw new Error('Credenziali errate');
    if (data[0].password_hash !== hash) throw new Error('Credenziali errate');
    return { username: data[0].username, role: data[0].role, id: data[0].id };
  }
  const users = await idbGetAll('utenti');
  const user = users.find(u => u.username === username && u.password_hash === hash);
  if (!user) throw new Error('Credenziali errate');
  return { username: user.username, role: user.role, id: user.id };
}

async function authGetUsers() {
  if (isOnline) {
    const data = await sbGet('utenti', { 'select': 'id,username,role,created_at', 'order': 'created_at.asc' });
    if (data) await idbPutAll('utenti', data);
    return data || [];
  }
  return await idbGetAll('utenti');
}

async function authCreateUser(username, password, role) {
  const hash = await sha256(password);
  const data = { username, password_hash: hash, role: role || 'user' };
  const result = await sbInsert('utenti', data);
  if (result) await idbPut('utenti', result);
  return result;
}

async function authDeleteUser(id) {
  await sbDelete('utenti', id);
  await idbDelete('utenti', id);
}

// =============================================
// PREZZI
// =============================================
async function getPrezzi() {
  if (isOnline) {
    const data = await sbGet('prezzi', { 'order': 'tipo_imbarcazione.asc' });
    if (data) await idbPutAll('prezzi', data);
    return data || [];
  }
  return await idbGetAll('prezzi');
}

async function updatePrezzo(id, prezzo_studenti, prezzo_esterni) {
  const result = await sbUpdate('prezzi', { prezzo_studenti, prezzo_esterni }, id);
  if (result) await idbPut('prezzi', result);
  return result;
}

// =============================================
// GIORNATE
// =============================================
async function getGiornate() {
  if (isOnline) {
    const data = await sbGet('giornate', { 'order': 'data.desc' });
    if (data) await idbPutAll('giornate', data);
    return data || [];
  }
  return (await idbGetAll('giornate')).sort((a, b) => b.data.localeCompare(a.data));
}

async function getGiornataByData(data) {
  if (isOnline) {
    const rows = await sbGet('giornate', { 'data': 'eq.' + data });
    return rows && rows.length > 0 ? rows[0] : null;
  }
  const all = await idbGetAll('giornate');
  return all.find(g => g.data === data) || null;
}

async function createGiornata(data, note) {
  const row = { data, note: note || '' };
  const result = await sbInsert('giornate', row);
  if (result) await idbPut('giornate', result);
  return result;
}

async function deleteGiornata(id) {
  await sbDelete('giornate', id);
  await idbDelete('giornate', id);
}

// =============================================
// NOLEGGI
// =============================================
async function getNoleggiByGiornata(giornataId) {
  if (isOnline) {
    const data = await sbGet('noleggi', {
      'giornata_id': 'eq.' + giornataId,
      'order': 'ora_uscita.desc'
    });
    return data || [];
  }
  const all = await idbGetAll('noleggi');
  return all.filter(n => n.giornata_id === giornataId).sort((a, b) => (b.ora_uscita || '').localeCompare(a.ora_uscita || ''));
}

async function createNoleggio(data) {
  const result = await sbInsert('noleggi', data);
  if (result) await idbPut('noleggi', result);
  return result;
}

async function updateNoleggio(id, data) {
  const result = await sbUpdate('noleggi', data, id);
  if (result) await idbPut('noleggi', result);
  return result;
}

async function deleteNoleggio(id) {
  await sbDelete('noleggi', id);
  await idbDelete('noleggi', id);
}

// =============================================
// CLIENTI
// =============================================
async function getClienti(q) {
  if (isOnline) {
    let params = { 'order': 'cognome.asc' };
    if (q) params.nome = 'ilike.*' + encodeURIComponent(q) + '*';
    const data = await sbGet('clienti', params);
    if (data) await idbPutAll('clienti', data);
    return data || [];
  }
  let all = await idbGetAll('clienti');
  if (q) {
    const ql = q.toLowerCase();
    all = all.filter(c => (c.nome + ' ' + c.cognome).toLowerCase().includes(ql));
  }
  return all.sort((a, b) => (a.cognome + a.nome).localeCompare(b.cognome + b.nome));
}

async function searchClienti(q) {
  if (!q || q.length < 2) return [];
  if (isOnline) {
    return await sbGet('clienti', { 'nome': 'ilike.*' + q + '*', 'limit': '10' }) || [];
  }
  const all = await idbGetAll('clienti');
  const ql = q.toLowerCase();
  return all.filter(c => (c.nome + ' ' + c.cognome).toLowerCase().includes(ql)).slice(0, 10);
}

async function createCliente(data) {
  const result = await sbInsert('clienti', data);
  if (result) await idbPut('clienti', result);
  return result;
}

async function updateCliente(id, data) {
  const result = await sbUpdate('clienti', data, id);
  if (result) await idbPut('clienti', result);
  return result;
}

async function deleteCliente(id) {
  await sbDelete('clienti', id);
  await idbDelete('clienti', id);
}

async function getClienteNoleggi(nomeCognome) {
  if (isOnline) {
    const trimmed = nomeCognome.trim();
    const noleggi = await sbGet('noleggi', {
      'nome_cognome': 'ilike.' + trimmed,
      'order': 'created_at.desc'
    }) || [];
    const giornate = await sbGet('giornate', {}) || [];
    const gMap = {};
    giornate.forEach(g => gMap[g.id] = g.data);
    return noleggi.map(n => ({ ...n, data_giornata: gMap[n.giornata_id] || '' }));
  }
  const all = await idbGetAll('noleggi');
  const giornate = await idbGetAll('giornate');
  const gMap = {};
  giornate.forEach(g => gMap[g.id] = g.data);
  const tl = nomeCognome.trim().toLowerCase();
  return all.filter(n => (n.nome_cognome || '').trim().toLowerCase() === tl)
    .map(n => ({ ...n, data_giornata: gMap[n.giornata_id] || '' }))
    .sort((a, b) => (b.data_giornata || '').localeCompare(a.data_giornata || ''));
}

// =============================================
// GIORNATA STATS
// =============================================
async function getGiornataStats(giornataId) {
  const noleggi = await getNoleggiByGiornata(giornataId);
  const totale = noleggi.reduce((s, n) => s + (parseFloat(n.costo) || 0), 0);
  const incassato = noleggi.filter(n => n.pagato).reduce((s, n) => s + (parseFloat(n.costo) || 0), 0);
  return {
    totale_noleggi: noleggi.length,
    incasso_totale: totale,
    incassato: incassato,
    dovuto: totale - incassato
  };
}

// =============================================
// SYNC FROM SUPABASE
// =============================================
async function syncFromSupabase() {
  if (!isOnline) return;
  try {
    const [p, g, n, c, u] = await Promise.all([
      sbGet('prezzi', { 'order': 'tipo_imbarcazione.asc' }),
      sbGet('giornate', { 'order': 'data.desc' }),
      sbGet('noleggi', { 'limit': '10000' }),
      sbGet('clienti', { 'limit': '10000' }),
      sbGet('utenti', { 'select': 'id,username,role,created_at' })
    ]);
    if (p) { await idbClear('prezzi'); await idbPutAll('prezzi', p); }
    if (g) { await idbClear('giornate'); await idbPutAll('giornate', g); }
    if (n) { await idbClear('noleggi'); await idbPutAll('noleggi', n); }
    if (c) { await idbClear('clienti'); await idbPutAll('clienti', c); }
    if (u) { await idbClear('utenti'); await idbPutAll('utenti', u); }
  } catch (e) {
    console.error('Sync error:', e);
  }
}

// =============================================
// UTILITY
// =============================================
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// =============================================
// REALTIME (Supabase WebSocket)
// =============================================
let sbClient = null;
let sbChannel = null;

function startRealtime() {
  if (!window.supabase) return;
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    sbChannel = sbClient.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'noleggi' }, async () => {
        if (typeof loadGiornoData === 'function' && typeof render === 'function') {
          await loadGiornoData();
          render();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'giornate' }, async () => {
        if (typeof loadGiornoData === 'function' && typeof render === 'function') {
          await loadGiornoData();
          render();
        }
      })
      .subscribe();
  } catch (e) {
    console.error('Realtime error:', e);
  }
}

function stopRealtime() {
  if (sbClient) {
    sbClient.removeAllChannels();
    sbClient = null;
    sbChannel = null;
  }
}

let prezzi = [];
let currentData = new Date().toISOString().split('T')[0];
let currentView = 'giorno';
let noleggiCorrenti = [];
let giornataCorrente = null;
let currentUser = null;
let darkMode = localStorage.getItem('darkMode') === 'true';
let showStats = localStorage.getItem('showStats') !== 'false';
let showFormNoleggio = localStorage.getItem('showFormNoleggio') !== 'false';
let autoRefreshSeconds = parseInt(localStorage.getItem('autoRefreshSeconds') || '10');
let autoRefreshTimer = null;
let editingNoleggioId = null;
let editingClienteId = null;
let autocompleteTimer = null;
let expandedCards = new Set();
let searchNoleggiQuery = '';
let filterSoloAperti = false;

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatTempo(t) {
  if (!t || t <= 0) return '0min';
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  if (h === 0) return m + 'min';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'min';
}

function costoDisplay(n, tipologia) {
  if (tipologia === 'ABBONATO' || tipologia === 'PRIVATO') return 'Gratuito';
  return '€' + (parseFloat(n) || 0).toFixed(2);
}

function orarioIncoerente(n) {
  if (!n.ora_uscita || !n.ora_rientro) return false;
  return n.ora_rientro < n.ora_uscita;
}

function calcolaCosto(n) {
  if (n.tipologia === 'ABBONATO' || n.tipologia === 'PRIVATO') return 0;
  const prezzo = prezzi.find(p => p.tipo_imbarcazione === n.tipo_imbarcazione);
  if (!prezzo) return 0;
  const p = n.tessera === 'UNIVERSITARIO' ? parseFloat(prezzo.prezzo_studenti) : parseFloat(prezzo.prezzo_esterni);
  if (!n.ora_uscita || !n.ora_rientro) return 0;
  const [uh, um] = n.ora_uscita.split(':').map(Number);
  const [rh, rm] = n.ora_rientro.split(':').map(Number);
  const minuti = (rh * 60 + rm) - (uh * 60 + um);
  if (minuti <= 0) return 0;
  return p * (minuti / 60);
}

function oggi() {
  return new Date().toISOString().split('T')[0];
}

function formatDateIt(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return dd + '/' + m + '/' + y;
}

function showView(v) {
  if (v === 'prezzi' && currentUser?.role !== 'admin') return;
  currentView = v;
  render();
}

function applyDarkMode() {
  let existing = document.getElementById('dark-mode-css');
  if (!existing) {
    existing = document.createElement('style');
    existing.id = 'dark-mode-css';
    document.head.appendChild(existing);
  }
  if (darkMode) {
    existing.textContent = `
      body { background: #0f172a !important; color: #e2e8f0 !important; }
      .bg-gray-50 { background: #0f172a !important; }
      .bg-white { background: #1e293b !important; }
      .bg-gray-100 { background: #1e293b !important; }
      .text-gray-900 { color: #f1f5f9 !important; }
      .text-gray-800 { color: #e2e8f0 !important; }
      .text-gray-700 { color: #cbd5e1 !important; }
      .text-gray-600 { color: #94a3b8 !important; }
      .text-gray-500 { color: #64748b !important; }
      .text-gray-400 { color: #475569 !important; }
      .border-gray-200 { border-color: #334155 !important; }
      .border-gray-300 { border-color: #475569 !important; }
      .bg-blue-50 { background: #172554 !important; }
      .bg-green-50 { background: #052e16 !important; }
      .bg-red-50 { background: #450a0a !important; }
      .bg-yellow-50 { background: #422006 !important; }
      .bg-gray-50 { background: #1e293b !important; }
      .modal-content { background: #1e293b !important; color: #e2e8f0 !important; }
      input, select, textarea { background: #334155 !important; color: #e2e8f0 !important; border-color: #475569 !important; }
      .noleggio-card { background: #1e293b !important; color: #e2e8f0 !important; }
      .noleggio-card .card-header .nome { color: #f1f5f9 !important; }
      .noleggio-card.pagato { background: #052e16 !important; }
      .noleggio-card.non-rientrato { background: #422006 !important; }
      table { background: #1e293b !important; }
      thead th { background: #334155 !important; color: #94a3b8 !important; }
      tbody tr { border-color: #334155 !important; }
      tbody tr:hover { background: #334155 !important; }
    `;
  } else {
    existing.textContent = '';
  }
}

function toggleDarkMode() {
  darkMode = !darkMode;
  localStorage.setItem('darkMode', darkMode);
  applyDarkMode();
  render();
}

function toggleShowStats() {
  showStats = !showStats;
  localStorage.setItem('showStats', showStats);
  render();
}

function toggleShowFormNoleggio() {
  showFormNoleggio = !showFormNoleggio;
  localStorage.setItem('showFormNoleggio', showFormNoleggio);
  render();
}

function applyColors() {
  let existing = document.getElementById('colors-css');
  if (!existing) {
    existing = document.createElement('style');
    existing.id = 'colors-css';
    document.head.appendChild(existing);
  }
  existing.textContent = '';
}

function toggleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (autoRefreshSeconds > 0) {
    autoRefreshTimer = setInterval(() => {
      if (currentView === 'giorno') loadGiornoData();
    }, autoRefreshSeconds * 1000);
  }
}

function stopTimers() {
  document.querySelectorAll('.live-timer').forEach(el => {
    if (el._timerInterval) clearInterval(el._timerInterval);
  });
}

function startTimers() {
  document.querySelectorAll('.live-timer').forEach(el => {
    const uscita = el.dataset.oraUscita;
    if (!uscita) return;
    function update() {
      const [uh, um] = uscita.split(':').map(Number);
      const now = new Date();
      const elapsed = (now.getHours() * 60 + now.getMinutes() - uh * 60 - um) / 60;
      el.textContent = elapsed > 0 ? formatTempo(elapsed) : '0min';
    }
    update();
    el._timerInterval = setInterval(update, 1000);
  });
}

function setupAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', function () {
    clearTimeout(autocompleteTimer);
    const v = this.value.trim();
    if (v.length < 2) {
      const dd = document.getElementById(inputId + '-dropdown');
      if (dd) dd.remove();
      return;
    }
    autocompleteTimer = setTimeout(async () => {
      const results = await searchClienti(v);
      let dd = document.getElementById(inputId + '-dropdown');
      if (dd) dd.remove();
      if (results.length === 0) return;
      dd = document.createElement('div');
      dd.id = inputId + '-dropdown';
      dd.style.cssText = 'position:absolute;z-index:50;background:white;border:1px solid #e5e7eb;border-radius:8px;max-height:200px;overflow-y:auto;width:100%;box-shadow:0 4px 12px rgba(0,0,0,0.1);';
      results.forEach(c => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;font-size:14px;';
        item.textContent = c.nome + ' ' + c.cognome;
        item.addEventListener('mouseenter', () => item.style.background = '#f3f4f6');
        item.addEventListener('mouseleave', () => item.style.background = 'white');
        item.addEventListener('click', () => {
          input.value = c.nome + ' ' + c.cognome;
          dd.remove();
          const tesseraSel = document.getElementById('select-tessera');
          if (tesseraSel && c.tessera) tesseraSel.value = c.tessera;
        });
        dd.appendChild(item);
      });
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(dd);
    }, 300);
  });
}

async function showLogin() {
  currentUser = null;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4" style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 50%,#3b82f6 100%);">
      <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm fade-in">
        <div class="text-center mb-8">
          <div style="font-size:48px;margin-bottom:8px;">⛵</div>
          <h1 style="font-size:24px;font-weight:800;color:#1e40af;">Noleggio 2026</h1>
          <p style="color:#6b7280;font-size:14px;margin-top:4px;">Gestione Noleggi</p>
        </div>
        <div id="login-error" style="display:none;background:#fee2e2;color:#991b1b;padding:10px;border-radius:8px;font-size:13px;margin-bottom:16px;text-align:center;"></div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;">Username</label>
          <input type="text" id="login-user" style="width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;" placeholder="Username" autocomplete="username">
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;">Password</label>
          <input type="password" id="login-pass" style="width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;" placeholder="Password" autocomplete="current-password">
        </div>
        <button onclick="doLogin()" style="width:100%;padding:12px;background:#2563eb;color:white;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">Accedi</button>
      </div>
    </div>`;
  document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });
}

async function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  if (!u || !p) { errEl.style.display = 'block'; errEl.textContent = 'Inserisci username e password'; return; }
  try {
    currentUser = await authLogin(u, p);
    localStorage.setItem('session', JSON.stringify({ username: u, password: p }));
    await init();
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = e.message || 'Credenziali errate';
  }
}

function logout() {
  localStorage.removeItem('session');
  currentUser = null;
  stopTimers();
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  showLogin();
}

async function init() {
  await initDB();
  const session = JSON.parse(localStorage.getItem('session') || 'null');
  if (session && !currentUser) {
    try {
      currentUser = await authLogin(session.username, session.password);
    } catch (e) {
      showLogin();
      return;
    }
  }
  if (!currentUser) { showLogin(); return; }
  await syncFromSupabase();
  prezzi = await getPrezzi();
  applyDarkMode();
  applyColors();
  toggleAutoRefresh();
  render();
}

async function loadGiornoData() {
  giornataCorrente = await getGiornataByData(currentData);
  if (giornataCorrente) {
    noleggiCorrenti = await getNoleggiByGiornata(giornataCorrente.id);
  } else {
    noleggiCorrenti = [];
  }
}

async function render() {
  stopTimers();
  await loadGiornoData();
  const app = document.getElementById('app');
  const views = { giorno: renderGiorno, persone: renderPersone, storico: renderStorico, prezzi: renderPrezzi, impostazioni: renderImpostazioni };
  const viewHtml = await (views[currentView] || renderGiorno)();
  app.innerHTML = `
    ${renderHeader()}
    <main id="content" style="max-width:1200px;margin:0 auto;padding:16px;">
      ${viewHtml}
    </main>
    ${renderBottomNav()}
  `;
  startTimers();
  if (currentView === 'giorno') {
    const nc = document.getElementById('input-nome-cognome');
    if (nc) setupAutocomplete('input-nome-cognome');
  }
}

function renderHeader() {
  const tabs = [
    { id: 'giorno', label: 'Giornata', icon: '📋' },
    { id: 'persone', label: 'Persone', icon: '👥' },
    { id: 'storico', label: 'Storico', icon: '📊' },
    ...(currentUser?.role === 'admin' ? [{ id: 'prezzi', label: 'Prezzi', icon: '💰' }] : []),
    { id: 'impostazioni', label: 'Impostazioni', icon: '⚙️' }
  ];
  const navPills = tabs.map(t =>
    `<button class="nav-pill ${currentView === t.id ? 'active' : ''}" onclick="showView('${t.id}')">${t.label}</button>`
  ).join('');
  return `
    <header class="app-header" style="padding:12px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;max-width:1200px;margin:0 auto;">
        <div class="header-title">
          <span class="icon">⛵</span>
          <span>Noleggio 2026</span>
        </div>
        <div class="desktop-nav" style="display:flex;gap:6px;align-items:center;">
          ${navPills}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="header-badge">👤 ${esc(currentUser?.username || '')}</span>
          <button class="header-logout" onclick="logout()" title="Esci">⏻</button>
        </div>
      </div>
    </header>`;
}

function renderBottomNav() {
  const tabs = [
    { id: 'giorno', label: 'Giornata', icon: '📋' },
    { id: 'persone', label: 'Persone', icon: '👥' },
    { id: 'storico', label: 'Storico', icon: '📊' },
    ...(currentUser?.role === 'admin' ? [{ id: 'prezzi', label: 'Prezzi', icon: '💰' }] : []),
    { id: 'impostazioni', label: 'Impost.', icon: '⚙️' }
  ];
  return `
    <nav class="bottom-nav mobile-only">
      ${tabs.map(t => `
        <button class="${currentView === t.id ? 'active' : ''}" onclick="showView('${t.id}')">
          <span class="nav-icon">${t.icon}</span>
          <span>${t.label}</span>
        </button>
      `).join('')}
    </nav>`;
}

async function creaGiornata() {
  await createGiornata(currentData);
  await render();
}

async function eliminaGiornata(id) {
  if (!confirm('Eliminare questa giornata e tutti i noleggi associati?')) return;
  await deleteGiornata(id);
  await render();
}

function prevDay() {
  const d = new Date(currentData);
  d.setDate(d.getDate() - 1);
  currentData = d.toISOString().split('T')[0];
  render();
}

function nextDay() {
  const d = new Date(currentData);
  d.setDate(d.getDate() + 1);
  currentData = d.toISOString().split('T')[0];
  render();
}

function goToday() {
  currentData = oggi();
  render();
}

function pickDate(v) {
  currentData = v;
  render();
}

function renderGiorno() {
  const stats = {
    noleggi: noleggiCorrenti.length,
    totale: noleggiCorrenti.reduce((s, n) => s + calcolaCosto(n), 0),
    incassato: noleggiCorrenti.filter(n => n.pagato).reduce((s, n) => s + calcolaCosto(n), 0)
  };
  stats.dovuto = stats.totale - stats.incassato;
  const options = prezzi.map(p => `<option value="${esc(p.tipo_imbarcazione)}">${esc(p.tipo_imbarcazione)}</option>`).join('');
  const now = new Date();
  const timeNow = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  let noleggiHtml = '';
  if (giornataCorrente) {
    if (noleggiCorrenti.length > 0) {
      const filtered0 = filterSoloAperti
        ? noleggiCorrenti.filter(n => !n.ora_rientro)
        : noleggiCorrenti;
      const filtered = searchNoleggiQuery.trim()
        ? filtered0.filter(n => (n.nome_cognome || '').toLowerCase().includes(searchNoleggiQuery.toLowerCase()))
        : filtered0;
      noleggiHtml = `<div style="margin-bottom:12px;"><input type="text" id="search-noleggi" placeholder="🔍 Cerca per nome..." value="${esc(searchNoleggiQuery)}" oninput="cercaNoleggi(this.value)" style="width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;"></div><div id="lista-noleggi">${renderDesktopTable(filtered) + renderMobileCards(filtered)}</div>`;
    } else {
      noleggiHtml = '<div style="text-align:center;padding:40px;color:#9ca3af;">Nessun noleggio oggi</div>';
    }
  }
  return `
    <div class="fade-in">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-ghost" onclick="prevDay()">◀</button>
          <input type="date" value="${esc(currentData)}" onchange="pickDate(this.value)" style="padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <button class="btn btn-ghost" onclick="nextDay()">▶</button>
          <button class="btn btn-primary" onclick="goToday()">Oggi</button>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn ${filterSoloAperti ? 'btn-success' : 'btn-ghost'}" onclick="toggleSoloAperti()" title="Solo non rientrati">⏱ Aperti</button>
          <button class="btn btn-ghost" onclick="render()">🔄</button>
          ${!giornataCorrente ? `<button class="btn btn-success" onclick="creaGiornata()">+ Crea Giornata</button>` : ''}
        </div>
      </div>
      <div style="font-size:22px;font-weight:700;margin-bottom:16px;color:#1e40af;">📅 ${formatDateIt(currentData)}</div>
      ${giornataCorrente ? `
        ${showStats ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#2563eb;">${stats.noleggi}</div>
            <div style="font-size:12px;color:#6b7280;font-weight:600;">Noleggi</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#16a34a;">€${stats.totale.toFixed(2)}</div>
            <div style="font-size:12px;color:#6b7280;font-weight:600;">Totale</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#15803d;">€${stats.incassato.toFixed(2)}</div>
            <div style="font-size:12px;color:#6b7280;font-weight:600;">Incassato</div>
          </div>
          <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#dc2626;">€${stats.dovuto.toFixed(2)}</div>
            <div style="font-size:12px;color:#6b7280;font-weight:600;">Dovuto</div>
          </div>
        </div>` : ''}
        ${showFormNoleggio ? `
        <div class="desktop-only" style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:20px;">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">➕ Nuovo Noleggio</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
            <div style="position:relative;">
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Nome e Cognome</label>
              <input type="text" id="input-nome-cognome" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Nome Cognome">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Tipo Imbarcazione</label>
              <select id="select-tipo" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">${options}</select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Tessera</label>
              <select id="select-tessera" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
                <option value="TESSERATO">Tesserato</option>
                <option value="UNIVERSITARIO">Universitario</option>
                <option value="NON TESSERATO">Non Tesserato</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Tipologia</label>
              <select id="select-tipologia" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
                <option value="NOLEGGIO">Noleggio</option>
                <option value="ABBONATO">Abbonato</option>
                <option value="PRIVATO">Privato</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Quantità</label>
              <input type="number" id="input-quantita" value="1" min="1" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Ora Uscita</label>
              <input type="time" id="input-ora-uscita" value="${timeNow}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Staff</label>
              <input type="text" id="input-staff" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Staff">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Imbarcazione</label>
              <input type="text" id="input-imbarcazione-nr" autocomplete="off" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Nr imbarcazione">
            </div>
          </div>
          <button class="btn btn-success" style="margin-top:12px;width:100%;" onclick="aggiungiNoleggio()">➕ Aggiungi Noleggio</button>
        </div>` : ''}
        ${noleggiHtml}
        <button class="${showFormNoleggio ? 'mobile-only' : ''}" onclick="apriModalNuovoNoleggio()" style="position:fixed;bottom:90px;right:16px;width:56px;height:56px;border-radius:50%;background:#16a34a;color:white;font-size:28px;border:none;box-shadow:0 4px 12px rgba(0,0,0,0.25);cursor:pointer;z-index:100;display:flex;align-items:center;justify-content:center;">+</button>
      ` : `
        <div style="text-align:center;padding:60px 20px;color:#6b7280;">
          <div style="font-size:48px;margin-bottom:16px;">📅</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Nessuna giornata per ${formatDateIt(currentData)}</div>
          <div style="font-size:14px;">Crea una giornata per iniziare ad aggiungere noleggi</div>
        </div>
      `}
    </div>`;
}

function renderDesktopTable(noleggi = noleggiCorrenti) {
  let rows = '';
  noleggi.forEach((n, i) => {
    const costo = calcolaCosto(n);
    const incoerente = orarioIncoerente(n);
    const rowClass = incoerente ? 'row-warning' : (n.pagato ? 'row-pagato' : '');
    const timerHtml = !n.ora_rientro ? `<span class="live-timer" data-ora-uscita="${esc(n.ora_uscita || '')}"></span>` : '-';
    const tempoHtml = n.ora_uscita && n.ora_rientro ? formatTempo(((parseInt(n.ora_rientro.split(':')[0]) * 60 + parseInt(n.ora_rientro.split(':')[1])) - (parseInt(n.ora_uscita.split(':')[0]) * 60 + parseInt(n.ora_uscita.split(':')[1]))) / 60) : '-';
    rows += `
      <tr class="${rowClass}" style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px;font-size:13px;font-weight:600;color:#9ca3af;">${i + 1}</td>
        <td style="padding:10px;font-size:14px;font-weight:600;">${esc(n.nome_cognome)}</td>
        <td style="padding:10px;font-size:13px;"><span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af;">${esc(n.tipo_imbarcazione)}</span></td>
        <td style="padding:10px;font-size:13px;">${esc(n.imbarcazione || '-')}</td>
        <td style="padding:10px;font-size:13px;text-align:center;">${n.quantita || 1}</td>
        <td style="padding:10px;font-size:13px;font-family:monospace;font-weight:600;">${esc(n.ora_uscita || '-')}</td>
        <td style="padding:10px;">${n.ora_rientro ?
          `<input type="time" value="${esc(n.ora_rientro)}" onchange="modificaRientro('${n.id}',this.value)" style="padding:4px 8px;border:2px solid #86efac;border-radius:6px;font-size:13px;width:110px;">` :
          `<button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="registraRientro('${n.id}')">Rientro</button>`}</td>
        <td style="padding:10px;font-size:13px;">${timerHtml}</td>
        <td style="padding:10px;font-size:13px;font-weight:600;">${tempoHtml}</td>
        <td style="padding:10px;font-size:14px;font-weight:700;color:${n.pagato ? '#16a34a' : '#dc2626'};">${costoDisplay(costo, n.tipologia)}</td>
        <td style="padding:10px;text-align:center;"><button onclick="togglePagato('${n.id}',${n.pagato})" style="cursor:pointer;border:none;background:none;font-size:18px;">${n.pagato ? '✅' : '⬜'}</button></td>
        <td style="padding:10px;text-align:center;"><button onclick="toggleAttrezzatura('${n.id}',${n.attrezzatura})" style="cursor:pointer;border:none;background:none;font-size:18px;">${n.attrezzatura ? '✅' : '⬜'}</button></td>
        <td style="padding:10px;text-align:center;"><button onclick="apriModificaNoleggio('${n.id}')" style="cursor:pointer;border:none;background:none;color:#d97706;font-size:16px;">✏️</button></td>
        <td style="padding:10px;text-align:center;"><button onclick="eliminaNoleggio('${n.id}')" style="cursor:pointer;border:none;background:none;color:#dc2626;font-size:16px;">🗑️</button></td>
      </tr>`;
  });
  return `
    <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow-x:auto;margin-bottom:20px;" class="desktop-only">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;">
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">#</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Nome</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Tipo</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Imbarc.</th>
            <th style="padding:12px 10px;text-align:center;color:#6b7280;font-size:12px;">Qta</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Uscita</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Rientro</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Timer</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Tempo</th>
            <th style="padding:12px 10px;text-align:left;color:#6b7280;font-size:12px;">Costo</th>
            <th style="padding:12px 10px;text-align:center;color:#6b7280;font-size:12px;">Pagato</th>
            <th style="padding:12px 10px;text-align:center;color:#6b7280;font-size:12px;">Attrezz.</th>
            <th style="padding:12px 10px;text-align:center;color:#6b7280;font-size:12px;">Modifica</th>
            <th style="padding:12px 10px;text-align:center;color:#6b7280;font-size:12px;">Elimina</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderMobileCards(noleggi = noleggiCorrenti) {
  let cards = '';
  noleggi.forEach((n, i) => {
    const costo = calcolaCosto(n);
    const incoerente = orarioIncoerente(n);
    const cardClass = incoerente ? 'row-warning' : (n.pagato ? 'pagato' : '');
    const tempoHtml = n.ora_uscita && n.ora_rientro ? formatTempo(((parseInt(n.ora_rientro.split(':')[0]) * 60 + parseInt(n.ora_rientro.split(':')[1])) - (parseInt(n.ora_uscita.split(':')[0]) * 60 + parseInt(n.ora_uscita.split(':')[1]))) / 60) : '';
    if (n.ora_rientro && !expandedCards.has(n.id)) {
      cards += `
        <div class="noleggio-card-compact" onclick="toggleCardExpand(${n.id})" style="border-left-color:#22c55e;">
          <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;">${esc(n.nome_cognome)}</span>
          <span class="orario">${esc(n.ora_uscita || '-')} <span class="freccia">→</span> ${esc(n.ora_rientro)}</span>
          ${tempoHtml ? `<span style="font-size:12px;color:#6b7280;">${tempoHtml}</span>` : ''}
          <span style="font-weight:700;color:${n.pagato ? '#16a34a' : '#dc2626'};">${costoDisplay(costo, n.tipologia)}</span>
          <span>${n.pagato ? '✅' : '⬜'}</span>
        </div>`;
      return;
    }
    const timerHtml = !n.ora_rientro ? `<span class="live-timer" data-ora-uscita="${esc(n.ora_uscita || '')}"></span>` : '';
    cards += `
      <div class="noleggio-card ${cardClass}" style="border-left-color:${n.pagato ? '#22c55e' : (incoerente ? '#f59e0b' : '#e5e7eb')};">
        ${n.ora_rientro && expandedCards.has(n.id) ? `<div style="cursor:pointer;font-size:11px;color:#6b7280;margin-bottom:4px;" onclick="toggleCardExpand(${n.id})">▲ Chiudi</div>` : ''}
        <div class="card-header">
          <span class="num">#${i + 1}</span>
          <span class="nome">${esc(n.nome_cognome)}</span>
        </div>
        <div class="card-row">
          <span class="tag" style="background:#dbeafe;color:#1e40af;">${esc(n.tipo_imbarcazione)}</span>
          ${n.tessera ? `<span class="tag" style="background:#f3e8ff;color:#7c3aed;">${esc(n.tessera)}</span>` : ''}
          <span class="tag" style="background:#fef3c7;color:#92400e;">×${n.quantita || 1}</span>
        </div>
        <div class="card-row">
          <span class="orario">${esc(n.ora_uscita || '-')}</span>
          <span class="freccia">→</span>
          ${n.ora_rientro ?
            `<input type="time" value="${esc(n.ora_rientro)}" onchange="modificaRientro('${n.id}',this.value)" style="padding:4px 8px;border:2px solid #86efac;border-radius:6px;font-size:13px;width:110px;">` :
            `<button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="registraRientro('${n.id}')">Rientro</button>`}
          ${timerHtml ? `<span style="margin-left:8px;color:#2563eb;font-weight:600;font-size:13px;">⏱ ${timerHtml}</span>` : ''}
        </div>
        ${tempoHtml ? `<div class="card-row" style="font-size:12px;color:#6b7280;">Tempo: ${tempoHtml}</div>` : ''}
        ${n.imbarcazione ? `<div class="card-row" style="font-size:12px;color:#6b7280;">Imbarc.: ${esc(n.imbarcazione)}</div>` : ''}
        <div class="card-cost" style="color:${n.pagato ? '#16a34a' : '#dc2626'};">${costoDisplay(costo, n.tipologia)}</div>
        <div class="card-actions">
          <button class="btn-edit" onclick="togglePagato('${n.id}',${n.pagato})">${n.pagato ? '✅ Pagato' : '⬜ Pagato'}</button>
          <button class="btn-timer" onclick="toggleAttrezzatura('${n.id}',${n.attrezzatura})">${n.attrezzatura ? '✅ Atrezz.' : '⬜ Atrezz.'}</button>
          <button class="btn-edit" onclick="apriModificaNoleggio('${n.id}')">✏️ Modifica</button>
          <button class="btn-delete" onclick="eliminaNoleggio('${n.id}')">🗑️</button>
        </div>
      </div>`;
  });
  return `<div class="mobile-only" style="margin-bottom:20px;padding-bottom:100px;">${cards}</div>`;
}

function toggleCardExpand(id) {
  if (expandedCards.has(id)) expandedCards.delete(id);
  else expandedCards.add(id);
  render();
}

function cercaNoleggi(q) {
  searchNoleggiQuery = q;
  const container = document.getElementById('lista-noleggi');
  if (container) {
    let filtered = filterSoloAperti
      ? noleggiCorrenti.filter(n => !n.ora_rientro)
      : noleggiCorrenti;
    if (q.trim()) {
      filtered = filtered.filter(n => (n.nome_cognome || '').toLowerCase().includes(q.toLowerCase()));
    }
    container.innerHTML = renderDesktopTable(filtered) + renderMobileCards(filtered);
    startTimers();
  }
}

function toggleSoloAperti() {
  filterSoloAperti = !filterSoloAperti;
  render();
}

async function aggiungiNoleggio() {
  const nome = document.getElementById('input-nome-cognome').value.trim();
  const tipo = document.getElementById('select-tipo').value;
  const tessera = document.getElementById('select-tessera').value;
  const tipologia = document.getElementById('select-tipologia').value;
  const quantita = parseInt(document.getElementById('input-quantita').value) || 1;
  const oraUscita = document.getElementById('input-ora-uscita').value;
  const staff = document.getElementById('input-staff').value.trim();
  const imbarcazione = document.getElementById('input-imbarcazione-nr').value.trim();
  if (!nome) { alert('Inserisci il nome'); return; }
  if (!giornataCorrente) { alert('Crea prima una giornata'); return; }
  const data = {
    giornata_id: giornataCorrente.id,
    nome_cognome: nome,
    tipo_imbarcazione: tipo,
    tessera,
    tipologia,
    quantita,
    ora_uscita: oraUscita,
    ora_rientro: null,
    staff,
    imbarcazione,
    pagato: false,
    attrezzatura: false,
    costo: 0,
    note: ''
  };
  await createNoleggio(data);
  const existing = await searchClienti(nome);
  const exists = existing.some(c => (c.nome + ' ' + c.cognome).trim().toLowerCase() === nome.toLowerCase());
  if (!exists) {
    const parts = nome.split(' ');
    await createCliente({ nome: parts[0] || nome, cognome: parts.slice(1).join(' ') || '', tessera: tessera || 'NON TESSERATO' });
  }
  document.getElementById('input-nome-cognome').value = '';
  document.getElementById('input-imbarcazione-nr').value = '';
  document.getElementById('input-staff').value = '';
  document.getElementById('input-quantita').value = '1';
  await render();
}

function apriModalNuovoNoleggio() {
  const options = prezzi.map(p => `<option value="${esc(p.tipo_imbarcazione)}">${esc(p.tipo_imbarcazione)}</option>`).join('');
  const now = new Date();
  const timeNow = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-nuovo-noleggio';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal-content fade-in">
      <h3 style="font-size:18px;font-weight:700;margin-bottom:16px;">➕ Nuovo Noleggio</h3>
      <div style="display:grid;gap:12px;">
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Nome e Cognome</label><input type="text" id="modal-nome-cognome" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Nome Cognome"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tipo Imbarcazione</label><select id="modal-tipo" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">${options}</select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tessera</label><select id="modal-tessera" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <option value="TESSERATO">Tesserato</option>
          <option value="UNIVERSITARIO">Universitario</option>
          <option value="NON TESSERATO">Non Tesserato</option>
        </select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tipologia</label><select id="modal-tipologia" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <option value="NOLEGGIO">Noleggio</option>
          <option value="ABBONATO">Abbonato</option>
          <option value="PRIVATO">Privato</option>
        </select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Quantità</label><input type="number" id="modal-quantita" value="1" min="1" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Ora Uscita</label><input type="time" id="modal-ora-uscita" value="${timeNow}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Staff</label><input type="text" id="modal-staff" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Staff"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Imbarcazione</label><input type="text" id="modal-imbarcazione" autocomplete="off" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;" placeholder="Nr imbarcazione"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-success" style="flex:1;" onclick="aggiungiNoleggioModal()">➕ Aggiungi</button>
        <button class="btn btn-ghost" style="flex:1;" onclick="document.getElementById('modal-nuovo-noleggio').remove()">Annulla</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setupAutocomplete('modal-nome-cognome');
}

async function aggiungiNoleggioModal() {
  const nome = document.getElementById('modal-nome-cognome').value.trim();
  const tipo = document.getElementById('modal-tipo').value;
  const tessera = document.getElementById('modal-tessera').value;
  const tipologia = document.getElementById('modal-tipologia').value;
  const quantita = parseInt(document.getElementById('modal-quantita').value) || 1;
  const oraUscita = document.getElementById('modal-ora-uscita').value;
  const staff = document.getElementById('modal-staff').value.trim();
  const imbarcazione = document.getElementById('modal-imbarcazione').value.trim();
  if (!nome) { alert('Inserisci il nome'); return; }
  if (!giornataCorrente) { alert('Crea prima una giornata'); return; }
  const data = {
    giornata_id: giornataCorrente.id,
    nome_cognome: nome,
    tipo_imbarcazione: tipo,
    tessera,
    tipologia,
    quantita,
    ora_uscita: oraUscita,
    staff,
    imbarcazione,
    pagato: false,
    attrezzatura: false
  };
  await createNoleggio(data);
  const existing = await searchClienti(nome);
  const exists = existing.some(c => (c.nome + ' ' + c.cognome).trim().toLowerCase() === nome.toLowerCase());
  if (!exists) {
    const parts = nome.split(' ');
    await createCliente({ nome: parts[0] || nome, cognome: parts.slice(1).join(' ') || '', tessera: tessera || 'NON TESSERATO' });
  }
  document.getElementById('modal-nuovo-noleggio').remove();
  await render();
}

async function registraRientro(id) {
  const now = new Date();
  const timeNow = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  await updateNoleggio(id, { ora_rientro: timeNow });
  const n = noleggiCorrenti.find(x => x.id == id);
  if (n) {
    const updated = { ...n, ora_rientro: timeNow };
    updated.costo = calcolaCosto(updated);
    await updateNoleggio(id, { costo: updated.costo });
  }
  await render();
}

async function modificaRientro(id, value) {
  const n = noleggiCorrenti.find(x => x.id == id);
  if (!n) return;
  const updated = { ...n, ora_rientro: value };
  const costo = calcolaCosto(updated);
  await updateNoleggio(id, { ora_rientro: value, costo });
  await render();
}

async function togglePagato(id, current) {
  await updateNoleggio(id, { pagato: !current });
  await render();
}

async function toggleAttrezzatura(id, current) {
  await updateNoleggio(id, { attrezzatura: !current });
  await render();
}

async function eliminaNoleggio(id) {
  if (!confirm('Eliminare questo noleggio?')) return;
  await deleteNoleggio(id);
  await render();
}

async function apriModificaNoleggio(id) {
  editingNoleggioId = id;
  const n = noleggiCorrenti.find(x => x.id == id);
  if (!n) return;
  const options = prezzi.map(p => `<option value="${esc(p.tipo_imbarcazione)}" ${p.tipo_imbarcazione === n.tipo_imbarcazione ? 'selected' : ''}>${esc(p.tipo_imbarcazione)}</option>`).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-noleggio';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal-content fade-in">
      <h3 style="font-size:18px;font-weight:700;margin-bottom:16px;">✏️ Modifica Noleggio</h3>
      <div style="display:grid;gap:12px;">
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Nome</label><input type="text" id="modal-nome" value="${esc(n.nome_cognome)}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tipo</label><select id="modal-tipo" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">${options}</select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tessera</label><select id="modal-tessera" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <option value="TESSERATO" ${n.tessera === 'TESSERATO' ? 'selected' : ''}>Tesserato</option>
          <option value="UNIVERSITARIO" ${n.tessera === 'UNIVERSITARIO' ? 'selected' : ''}>Universitario</option>
          <option value="NON TESSERATO" ${n.tessera === 'NON TESSERATO' ? 'selected' : ''}>Non Tesserato</option>
        </select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tipologia</label><select id="modal-tipologia" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <option value="NOLEGGIO" ${n.tipologia === 'NOLEGGIO' ? 'selected' : ''}>Noleggio</option>
          <option value="ABBONATO" ${n.tipologia === 'ABBONATO' ? 'selected' : ''}>Abbonato</option>
          <option value="PRIVATO" ${n.tipologia === 'PRIVATO' ? 'selected' : ''}>Privato</option>
        </select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Quantità</label><input type="number" id="modal-quantita" value="${n.quantita || 1}" min="1" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Ora Uscita</label><input type="time" id="modal-ora-uscita" value="${esc(n.ora_uscita || '')}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Ora Rientro</label><input type="time" id="modal-ora-rientro" value="${esc(n.ora_rientro || '')}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Staff</label><input type="text" id="modal-staff" value="${esc(n.staff || '')}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Imbarcazione</label><input type="text" id="modal-imbarcazione" value="${esc(n.imbarcazione || '')}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Note</label><textarea id="modal-note" rows="2" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">${esc(n.note || '')}</textarea></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-primary" style="flex:1;" onclick="salvaModificaNoleggio()">💾 Salva</button>
        <button class="btn btn-ghost" style="flex:1;" onclick="document.getElementById('modal-noleggio').remove()">Annulla</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function salvaModificaNoleggio() {
  const id = editingNoleggioId;
  if (!id) return;
  const data = {
    nome_cognome: document.getElementById('modal-nome').value.trim(),
    tipo_imbarcazione: document.getElementById('modal-tipo').value,
    tessera: document.getElementById('modal-tessera').value,
    tipologia: document.getElementById('modal-tipologia').value,
    quantita: parseInt(document.getElementById('modal-quantita').value) || 1,
    ora_uscita: document.getElementById('modal-ora-uscita').value,
    ora_rientro: document.getElementById('modal-ora-rientro').value || null,
    staff: document.getElementById('modal-staff').value.trim(),
    imbarcazione: document.getElementById('modal-imbarcazione').value.trim(),
    note: document.getElementById('modal-note').value.trim()
  };
  const tempN = { ...data, id };
  data.costo = calcolaCosto(tempN);
  await updateNoleggio(id, data);
  document.getElementById('modal-noleggio').remove();
  editingNoleggioId = null;
  await render();
}

async function renderPersone() {
  const clienti = await getClienti();
  let allNoleggi = [];
  if (isOnline) {
    allNoleggi = await sbGet('noleggi', { 'limit': '10000' }) || [];
  } else {
    allNoleggi = await idbGetAll('noleggi');
  }
  const countMap = {};
  allNoleggi.forEach(n => {
    const key = (n.nome_cognome || '').trim().toLowerCase();
    countMap[key] = (countMap[key] || 0) + 1;
  });
  let listHtml = '';
  clienti.forEach(c => {
    const fullName = (c.nome + ' ' + c.cognome).trim();
    const nCount = countMap[fullName.toLowerCase()] || 0;
    listHtml += `
      <div style="background:white;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:15px;font-weight:700;">${esc(c.nome)} ${esc(c.cognome)} <span style="font-size:12px;color:#6b7280;font-weight:400;">(${nCount} noleggi)</span></div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
            ${c.tessera ? `<span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af;">${esc(c.tessera)}</span>` : ''}
            ${c.telefono ? `<span style="font-size:12px;color:#6b7280;">📞 ${esc(c.telefono)}</span>` : ''}
            ${c.email ? `<span style="font-size:12px;color:#6b7280;">✉️ ${esc(c.email)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost" onclick="mostraClienteNoleggi('${esc(c.nome)} ${esc(c.cognome)}')" title="Noleggi">📋</button>
          <button class="btn btn-ghost" onclick="apriModificaCliente('${c.id}')" title="Modifica">✏️</button>
          <button class="btn btn-ghost" onclick="eliminaCliente('${c.id}')" title="Elimina" style="color:#dc2626;">🗑️</button>
        </div>
      </div>`;
  });
  if (clienti.length === 0) {
    listHtml = '<div style="text-align:center;padding:40px;color:#9ca3af;">Nessuna persona registrata</div>';
  }
  return `
    <div class="fade-in">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <h2 style="font-size:22px;font-weight:700;">👥 Persone</h2>
        <button class="btn btn-success" onclick="apriModificaCliente(null)">+ Nuova Persona</button>
      </div>
      <div style="margin-bottom:16px;">
        <input type="text" id="search-persone" placeholder="🔍 Cerca persona..." oninput="cercaPersone()" style="width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;">
      </div>
      <div id="lista-persone">${listHtml}</div>
    </div>`;
}

async function cercaPersone() {
  const q = document.getElementById('search-persone').value.trim();
  const clienti = await getClienti(q);
  const container = document.getElementById('lista-persone');
  if (!container) return;
  let allNoleggi = [];
  if (isOnline) {
    allNoleggi = await sbGet('noleggi', { 'limit': '10000' }) || [];
  } else {
    allNoleggi = await idbGetAll('noleggi');
  }
  const countMap = {};
  allNoleggi.forEach(n => {
    const key = (n.nome_cognome || '').trim().toLowerCase();
    countMap[key] = (countMap[key] || 0) + 1;
  });
  let listHtml = '';
  clienti.forEach(c => {
    const fullName = (c.nome + ' ' + c.cognome).trim();
    const nCount = countMap[fullName.toLowerCase()] || 0;
    listHtml += `
      <div style="background:white;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:15px;font-weight:700;">${esc(c.nome)} ${esc(c.cognome)} <span style="font-size:12px;color:#6b7280;font-weight:400;">(${nCount} noleggi)</span></div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
            ${c.tessera ? `<span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af;">${esc(c.tessera)}</span>` : ''}
            ${c.telefono ? `<span style="font-size:12px;color:#6b7280;">📞 ${esc(c.telefono)}</span>` : ''}
            ${c.email ? `<span style="font-size:12px;color:#6b7280;">✉️ ${esc(c.email)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost" onclick="mostraClienteNoleggi('${esc(c.nome)} ${esc(c.cognome)}')" title="Noleggi">📋</button>
          <button class="btn btn-ghost" onclick="apriModificaCliente('${c.id}')" title="Modifica">✏️</button>
          <button class="btn btn-ghost" onclick="eliminaCliente('${c.id}')" title="Elimina" style="color:#dc2626;">🗑️</button>
        </div>
      </div>`;
  });
  container.innerHTML = listHtml || '<div style="text-align:center;padding:40px;color:#9ca3af;">Nessun risultato</div>';
}

async function apriModificaCliente(id) {
  editingClienteId = id;
  let c = { nome: '', cognome: '', telefono: '', email: '', tessera: 'TESSERATO', note: '' };
  if (id) {
    const clienti = await getClienti();
    c = clienti.find(x => x.id === id) || c;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-cliente';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal-content fade-in">
      <h3 style="font-size:18px;font-weight:700;margin-bottom:16px;">${id ? '✏️ Modifica Persona' : '➕ Nuova Persona'}</h3>
      <div style="display:grid;gap:12px;">
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Nome</label><input type="text" id="modal-c-nome" value="${esc(c.nome)}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Cognome</label><input type="text" id="modal-c-cognome" value="${esc(c.cognome)}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Telefono</label><input type="text" id="modal-c-telefono" value="${esc(c.telefono || '')}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Email</label><input type="email" id="modal-c-email" value="${esc(c.email || '')}" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Tessera</label><select id="modal-c-tessera" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <option value="TESSERATO" ${c.tessera === 'TESSERATO' ? 'selected' : ''}>Tesserato</option>
          <option value="UNIVERSITARIO" ${c.tessera === 'UNIVERSITARIO' ? 'selected' : ''}>Universitario</option>
          <option value="NON TESSERATO" ${c.tessera === 'NON TESSERATO' ? 'selected' : ''}>Non Tesserato</option>
        </select></div>
        <div><label style="font-size:12px;font-weight:600;color:#6b7280;">Note</label><textarea id="modal-c-note" rows="2" style="width:100%;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">${esc(c.note || '')}</textarea></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-primary" style="flex:1;" onclick="salvaCliente()">💾 Salva</button>
        <button class="btn btn-ghost" style="flex:1;" onclick="document.getElementById('modal-cliente').remove()">Annulla</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function salvaCliente() {
  const data = {
    nome: document.getElementById('modal-c-nome').value.trim(),
    cognome: document.getElementById('modal-c-cognome').value.trim(),
    telefono: document.getElementById('modal-c-telefono').value.trim(),
    email: document.getElementById('modal-c-email').value.trim(),
    tessera: document.getElementById('modal-c-tessera').value,
    note: document.getElementById('modal-c-note').value.trim()
  };
  if (!data.nome || !data.cognome) { alert('Inserisci nome e cognome'); return; }
  if (editingClienteId) {
    await updateCliente(editingClienteId, data);
  } else {
    await createCliente(data);
  }
  document.getElementById('modal-cliente').remove();
  editingClienteId = null;
  await render();
}

async function eliminaCliente(id) {
  if (!confirm('Eliminare questa persona?')) return;
  await deleteCliente(id);
  await render();
}

async function mostraClienteNoleggi(nomeCognome) {
  const noleggi = await getClienteNoleggi(nomeCognome);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-storico-noleggi';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  let rows = '';
  noleggi.forEach(n => {
    const costo = calcolaCosto(n);
    rows += `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:8px;font-size:13px;">${formatDateIt(n.data_giornata)}</td>
        <td style="padding:8px;font-size:13px;">${esc(n.tipo_imbarcazione)}</td>
        <td style="padding:8px;font-size:13px;">${esc(n.ora_uscita || '-')} → ${esc(n.ora_rientro || '-')}</td>
        <td style="padding:8px;font-size:13px;font-weight:600;color:${n.pagato ? '#16a34a' : '#dc2626'};">${costoDisplay(costo, n.tipologia)}</td>
        <td style="padding:8px;text-align:center;">${n.pagato ? '✅' : '⬜'}</td>
      </tr>`;
  });
  overlay.innerHTML = `
    <div class="modal-content fade-in" style="max-width:700px;">
      <h3 style="font-size:18px;font-weight:700;margin-bottom:16px;">📋 Noleggi di ${esc(nomeCognome)}</h3>
      ${noleggi.length === 0 ? '<div style="text-align:center;padding:20px;color:#9ca3af;">Nessun noleggio trovato</div>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid #e5e7eb;">
                <th style="padding:8px;text-align:left;color:#6b7280;">Data</th>
                <th style="padding:8px;text-align:left;color:#6b7280;">Tipo</th>
                <th style="padding:8px;text-align:left;color:#6b7280;">Orario</th>
                <th style="padding:8px;text-align:left;color:#6b7280;">Costo</th>
                <th style="padding:8px;text-align:center;color:#6b7280;">Pagato</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`}
      <button class="btn btn-ghost" style="margin-top:12px;width:100%;" onclick="document.getElementById('modal-storico-noleggi').remove()">Chiudi</button>
    </div>`;
  document.body.appendChild(overlay);
}

async function renderStorico() {
  const giornate = await getGiornate();
  let allNoleggi = [];
  if (isOnline) {
    allNoleggi = await sbGet('noleggi', { 'limit': '10000' }) || [];
  } else {
    allNoleggi = await idbGetAll('noleggi');
  }
  const statsByGiornata = {};
  allNoleggi.forEach(n => {
    if (!statsByGiornata[n.giornata_id]) statsByGiornata[n.giornata_id] = { count: 0, totale: 0, incassato: 0 };
    const s = statsByGiornata[n.giornata_id];
    s.count++;
    s.totale += parseFloat(n.costo) || 0;
    if (n.pagato) s.incassato += parseFloat(n.costo) || 0;
  });
  const totaleNoleggi = allNoleggi.length;
  const incassoTotale = allNoleggi.reduce((s, n) => s + (parseFloat(n.costo) || 0), 0);
  const incassato = allNoleggi.filter(n => n.pagato).reduce((s, n) => s + (parseFloat(n.costo) || 0), 0);
  let listHtml = '';
  for (const g of giornate) {
    const gs = statsByGiornata[g.id] || { count: 0, totale: 0, incassato: 0 };
    const dovuto = gs.totale - gs.incassato;
    listHtml += `
      <div style="background:white;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;cursor:pointer;" onclick="currentData='${esc(g.data)}';showView('giorno');">
        <div>
          <div style="font-size:16px;font-weight:700;">📅 ${formatDateIt(g.data)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">${gs.count} noleggi</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="text-align:right;">
            <div style="font-size:15px;font-weight:700;color:#16a34a;">€${gs.totale.toFixed(2)}</div>
            ${dovuto > 0 ? `<div style="font-size:12px;color:#dc2626;">Dovuto: €${dovuto.toFixed(2)}</div>` : ''}
          </div>
          <button class="btn btn-ghost" onclick="event.stopPropagation();eliminaGiornata('${g.id}')" style="color:#dc2626;font-size:16px;">🗑️</button>
        </div>
      </div>`;
  }
  if (giornate.length === 0) {
    listHtml = '<div style="text-align:center;padding:40px;color:#9ca3af;">Nessuna giornata nello storico</div>';
  }
  return `
    <div class="fade-in">
      <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;">📊 Storico</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#2563eb;">${giornate.length}</div>
          <div style="font-size:12px;color:#6b7280;font-weight:600;">Giornate</div>
        </div>
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#7c3aed;">${totaleNoleggi}</div>
          <div style="font-size:12px;color:#6b7280;font-weight:600;">Noleggi Totali</div>
        </div>
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#16a34a;">€${incassato.toFixed(2)}</div>
          <div style="font-size:12px;color:#6b7280;font-weight:600;">Incassato</div>
        </div>
        <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#dc2626;">€${(incassoTotale - incassato).toFixed(2)}</div>
          <div style="font-size:12px;color:#6b7280;font-weight:600;">Dovuto</div>
        </div>
      </div>
      <div id="lista-storico">${listHtml}</div>
    </div>`;
}

function renderPrezzi() {
  let rows = '';
  prezzi.forEach(p => {
    rows += `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px;font-size:14px;font-weight:600;">${esc(p.tipo_imbarcazione)}</td>
        <td style="padding:10px;"><input type="number" step="0.50" min="0" id="prezzo-studenti-${p.id}" value="${p.prezzo_studenti || 0}" style="width:80px;padding:6px 10px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;text-align:right;"></td>
        <td style="padding:10px;"><input type="number" step="0.50" min="0" id="prezzo-esterni-${p.id}" value="${p.prezzo_esterni || 0}" style="width:80px;padding:6px 10px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;text-align:right;"></td>
        <td style="padding:10px;"><button class="btn btn-primary" onclick="salvaPrezzo('${p.id}')">💾</button></td>
      </tr>`;
  });
  return `
    <div class="fade-in">
      <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;">💰 Prezzi</h2>
      <div style="background:white;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="border-bottom:2px solid #e5e7eb;">
              <th style="padding:12px;text-align:left;color:#6b7280;">Tipo Imbarcazione</th>
              <th style="padding:12px;text-align:left;color:#6b7280;">Studenti (€/h)</th>
              <th style="padding:12px;text-align:left;color:#6b7280;">Tesserati/Esterni (€/h)</th>
              <th style="padding:12px;text-align:left;color:#6b7280;">Azione</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function salvaPrezzo(id) {
  const studenti = parseFloat(document.getElementById('prezzo-studenti-' + id).value) || 0;
  const esterni = parseFloat(document.getElementById('prezzo-esterni-' + id).value) || 0;
  await updatePrezzo(id, studenti, esterni);
  prezzi = await getPrezzi();
  alert('Prezzo salvato!');
}

async function renderImpostazioni() {
  let adminHtml = '';
  if (currentUser && currentUser.role === 'admin') {
    const users = await authGetUsers();
    let userListHtml = '';
    users.forEach(u => {
      userListHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid #f3f4f6;">
          <div>
            <span style="font-weight:600;">${esc(u.username)}</span>
            <span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${u.role === 'admin' ? '#fef3c7;color:#92400e' : '#dbeafe;color:#1e40af'};margin-left:8px;">${esc(u.role)}</span>
          </div>
          ${u.username !== currentUser.username ? `<button class="btn btn-ghost" onclick="eliminaUtente('${u.id}')" style="color:#dc2626;font-size:14px;">🗑️</button>` : ''}
        </div>`;
    });
    let dbStatsHtml = '';
    try {
      let allNoleggi = [];
      if (isOnline) {
        allNoleggi = await sbGet('noleggi', { 'limit': '10000' }) || [];
      } else {
        allNoleggi = await idbGetAll('noleggi');
      }
      const allGiornate = isOnline ? (await sbGet('giornate', {})) || [] : await idbGetAll('giornate');
      const allClienti = isOnline ? (await sbGet('clienti', { 'limit': '10000' })) || [] : await idbGetAll('clienti');
      const allPrezzi = isOnline ? (await sbGet('prezzi', {})) || [] : await idbGetAll('prezzi');
      const totaleNoleggi = allNoleggi.length;
      const incassoTotale = allNoleggi.reduce((s, n) => s + (parseFloat(n.costo) || 0), 0);
      const incassato = allNoleggi.filter(n => n.pagato).reduce((s, n) => s + (parseFloat(n.costo) || 0), 0);
      const last10 = allNoleggi.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 10);
      let last10Html = '';
      last10.forEach(n => {
        last10Html += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <span>${esc(n.nome_cognome)}</span>
          <span style="color:#6b7280;">${esc(n.tipo_imbarcazione)}</span>
          <span style="font-weight:600;color:${n.pagato ? '#16a34a' : '#dc2626'};">€${(parseFloat(n.costo) || 0).toFixed(2)}</span>
        </div>`;
      });
      dbStatsHtml = `
        <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:20px;">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">🗄️ Stato Database</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px;">
            <div style="text-align:center;padding:12px;background:#f0f9ff;border-radius:10px;">
              <div style="font-size:24px;font-weight:800;color:#2563eb;">${allGiornate.length}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Giornate</div>
            </div>
            <div style="text-align:center;padding:12px;background:#f5f3ff;border-radius:10px;">
              <div style="font-size:24px;font-weight:800;color:#7c3aed;">${totaleNoleggi}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Noleggi</div>
            </div>
            <div style="text-align:center;padding:12px;background:#f0fdf4;border-radius:10px;">
              <div style="font-size:24px;font-weight:800;color:#16a34a;">${allClienti.length}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Clienti</div>
            </div>
            <div style="text-align:center;padding:12px;background:#fffbeb;border-radius:10px;">
              <div style="font-size:24px;font-weight:800;color:#d97706;">${allPrezzi.length}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Prezzi</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px;">
            <div style="text-align:center;padding:12px;background:#f0fdf4;border-radius:10px;">
              <div style="font-size:20px;font-weight:800;color:#16a34a;">€${incassoTotale.toFixed(2)}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Incasso Totale</div>
            </div>
            <div style="text-align:center;padding:12px;background:#f0fdf4;border-radius:10px;">
              <div style="font-size:20px;font-weight:800;color:#16a34a;">€${incassato.toFixed(2)}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Incassato</div>
            </div>
            <div style="text-align:center;padding:12px;background:#fef2f2;border-radius:10px;">
              <div style="font-size:20px;font-weight:800;color:#dc2626;">€${(incassoTotale - incassato).toFixed(2)}</div>
              <div style="font-size:11px;color:#6b7280;font-weight:600;">Dovuto</div>
            </div>
          </div>
          <h4 style="font-size:14px;font-weight:700;margin-bottom:8px;">Ultimi 10 Noleggi</h4>
          ${last10Html || '<div style="color:#9ca3af;font-size:13px;">Nessun noleggio</div>'}
          <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn btn-primary" onclick="syncFromSupabase();alert('Sincronizzazione completata!')">🔄 Sincronizza DB</button>
            <button class="btn btn-ghost" onclick="esportaDati()">📦 Esporta JSON</button>
          </div>
        </div>`;
    } catch (e) {
      dbStatsHtml = '<div style="background:#fef2f2;border-radius:12px;padding:16px;color:#dc2626;">Errore nel caricamento stats: ' + esc(e.message) + '</div>';
    }
    adminHtml = dbStatsHtml + `
      <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:20px;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">👤 Gestione Utenti</h3>
        <div style="margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr auto;gap:8px;">
          <input type="text" id="new-username" placeholder="Username" style="padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <input type="password" id="new-password" placeholder="Password" style="padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;">
          <button class="btn btn-success" onclick="creaUtente()">+ Aggiungi</button>
        </div>
        <div id="lista-utenti">${userListHtml}</div>
      </div>`;
  }
  return `
    <div class="fade-in">
      <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;">⚙️ Impostazioni</h2>
      <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">🌙 Modalità Scura</h3>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="toggle ${darkMode ? 'active' : ''}" onclick="toggleDarkMode()"></div>
          <span style="font-size:14px;color:#6b7280;">${darkMode ? 'Attiva' : 'Disattiva'}</span>
        </div>
      </div>
      <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">📋 Vista Giornata</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:14px;color:#6b7280;">Mostra statistiche (Noleggi, Totale, Incassato, Dovuto)</span>
            <div class="toggle ${showStats ? 'active' : ''}" onclick="toggleShowStats()"></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:14px;color:#6b7280;">Mostra form inserimento noleggi</span>
            <div class="toggle ${showFormNoleggio ? 'active' : ''}" onclick="toggleShowFormNoleggio()"></div>
          </div>
        </div>
      </div>
      <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">🔄 Aggiornamento Automatico</h3>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label style="font-size:14px;color:#6b7280;">Intervallo (sec):</label>
          <input type="number" id="auto-refresh-interval" value="${autoRefreshSeconds}" min="5" max="300" style="width:80px;padding:8px 12px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px;text-align:center;">
          <button class="btn btn-primary" onclick="salvaAutoRefresh()">Applica</button>
          <span style="font-size:13px;color:${autoRefreshTimer ? '#16a34a' : '#dc2626'};">${autoRefreshTimer ? '✅ Attivo' : '⛔ Disattivo'}</span>
        </div>
      </div>
      <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">🔄 Sincronizzazione</h3>
        <button class="btn btn-primary" onclick="syncFromSupabase();alert('Sincronizzazione completata!')">Sincronizza ora</button>
      </div>
      <div style="background:white;border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">ℹ️ Info</h3>
        <div style="font-size:14px;color:#6b7280;line-height:1.8;">
          <div>Versione: 1.0.0</div>
          <div>Utente: ${esc(currentUser?.username || '-')} (${esc(currentUser?.role || '-')})</div>
          <div>Modalità: ${navigator.onLine ? '🟢 Online' : '🔴 Offline'}</div>
        </div>
      </div>
      ${adminHtml}
    </div>`;
}

function salvaAutoRefresh() {
  autoRefreshSeconds = parseInt(document.getElementById('auto-refresh-interval').value) || 30;
  localStorage.setItem('autoRefreshSeconds', autoRefreshSeconds);
  toggleAutoRefresh();
  render();
}

function esportaDati() {
  const data = { exported: new Date().toISOString(), prezzi, currentData, currentUser: currentUser?.username };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'noleggio2026_export_' + oggi() + '.json';
  a.click();
}

async function creaUtente() {
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;
  if (!username || !password) { alert('Inserisci username e password'); return; }
  try {
    await authCreateUser(username, password, 'user');
    document.getElementById('new-username').value = '';
    document.getElementById('new-password').value = '';
    await render();
  } catch (e) {
    alert('Errore: ' + (e.message || 'Impossibile creare utente'));
  }
}

async function eliminaUtente(id) {
  if (!confirm('Eliminare questo utente?')) return;
  await authDeleteUser(id);
  await render();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('Init error:', err);
    document.getElementById('app').innerHTML = '<div style="padding:20px;color:red;"><h2>Errore</h2><pre>' + err.message + '\n' + err.stack + '</pre></div>';
  });
});

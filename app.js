/* app.js — UI rendering + events. State lives in STATE, logic in EarnLogic, persistence in EarnDB. */

let STATE = EarnDB.load();

const $ = sel => document.querySelector(sel);
const L = EarnLogic;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function save() { EarnDB.save(STATE); }
function saveRender() { save(); render(); }

/* ================= navigation ================= */

let currentView = 'today';

function switchView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  render();
}

document.querySelectorAll('.tab').forEach(t =>
  t.addEventListener('click', () => switchView(t.dataset.view))
);

/* ================= rendering ================= */

function render() {
  const today = L.todayStr();
  renderHeader(today);
  if (currentView === 'today') renderToday(today);
  if (currentView === 'rewards') renderRewards(today);
  if (currentView === 'settings') renderSettings();
}

function renderHeader(today) {
  const el = $('#headerStatus');
  const act = L.activeHabits(STATE.habits);
  if (!act.length) { el.textContent = ''; el.className = 'pill'; el.style.display = 'none'; return; }
  el.style.display = '';
  if (L.unlocked(STATE.habits, STATE.days, today)) {
    el.textContent = 'UNLOCKED';
    el.className = 'pill unlocked';
  } else {
    const p = L.progress(STATE.habits, STATE.days, today);
    el.textContent = `${p.daysToUnlock}d to go`;
    el.className = 'pill';
  }
}

/* ---------- Today view ---------- */

function renderToday(today) {
  const view = $('#view-today');
  const act = L.activeHabits(STATE.habits);

  if (!act.length) {
    view.innerHTML = `
      <div class="empty-state">
        <span class="big">&#127793;</span>
        No habits yet.<br>Define what you need to do — then earn it.
      </div>
      <button class="add-btn" onclick="openHabitModal()">+ Add your first habit</button>`;
    return;
  }

  view.innerHTML = `
    ${bannerHTML(today)}
    ${weekStripHTML(today)}
    <h2 class="section-title">Habits</h2>
    ${act.map(h => habitCardHTML(h, today)).join('')}
    <button class="add-btn" onclick="openHabitModal()">+ Add habit</button>`;
}

function bannerHTML(today) {
  const p = L.progress(STATE.habits, STATE.days, today);
  if (p.unlocked) {
    return `
      <div class="banner unlocked">
        <div class="banner-title">&#127873; Rewards unlocked</div>
        <div class="banner-sub">Every streak is at its milestone. You earned it — go claim one.</div>
      </div>`;
  }
  const minRatio = p.items.length ? Math.min(...p.items.map(i => i.ratio)) : 0;
  const weakName = p.weakest ? esc(p.weakest.habit.name) : '';
  return `
    <div class="banner">
      <div class="banner-title">&#128274; Rewards locked</div>
      <div class="banner-sub">${p.daysToUnlock} day${p.daysToUnlock === 1 ? '' : 's'} to unlock &middot; furthest behind: <b>${weakName}</b></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.round(minRatio * 100)}%"></div></div>
    </div>`;
}

function weekStripHTML(today) {
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const date = L.addDays(today, -i);
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).toLocaleDateString('en', { weekday: 'short' }).slice(0, 2);
    const summary = L.daySummary(STATE.habits, STATE.days, date);
    cells.push(`
      <button class="day-cell${date === today ? ' today' : ''}" onclick="openDayModal('${date}')" title="Edit ${date}">
        <div class="dow">${dow}</div>
        <div class="dom">${d}</div>
        <div class="dot ${summary}"></div>
      </button>`);
  }
  return `<div class="week-strip">${cells.join('')}</div>`;
}

function habitCardHTML(h, today) {
  const s = L.streak(h, STATE.days, today);
  const met = s >= h.milestone;
  const ratio = h.milestone > 0 ? Math.min(1, s / h.milestone) : 1;
  const st = L.status(STATE.days, today, h.id);

  let actions;
  if (h.type === 'do') {
    actions = st === 'done'
      ? `<button class="btn done grow" onclick="setHabitStatus('${h.id}','${today}',null)">&#10003; Done today</button>`
      : `<button class="btn primary grow" onclick="setHabitStatus('${h.id}','${today}','done')">Mark done today</button>`;
  } else {
    actions = st === 'failed'
      ? `<span class="clean-note slipped">Slipped today</span>
         <button class="btn small" onclick="setHabitStatus('${h.id}','${today}',null)">Undo</button>`
      : `<span class="clean-note">Clean today &#10003;</span>
         <button class="btn small danger-ghost" onclick="confirmSlip('${h.id}','${today}')">I slipped</button>`;
  }

  return `
    <div class="habit-card">
      <div class="habit-top">
        <span class="habit-name">${esc(h.name)}</span>
        <span class="chip ${h.type}">${h.type === 'do' ? 'BUILD' : 'QUIT'}</span>
        <button class="icon-btn" onclick="openHabitModal('${h.id}')" title="Edit habit">&#9998;</button>
      </div>
      <div class="habit-streak">
        <span class="${met ? 'met' : ''}">&#128293; ${s}</span>
        <span class="muted">/ ${h.milestone} day milestone${met ? ' — met!' : ''}</span>
      </div>
      <div class="bar"><div class="bar-fill ${met ? 'met' : ''}" style="width:${Math.round(ratio * 100)}%"></div></div>
      <div class="habit-actions">${actions}</div>
    </div>`;
}

/* ---------- Rewards view ---------- */

function renderRewards(today) {
  const view = $('#view-rewards');
  const isUnlocked = L.unlocked(STATE.habits, STATE.days, today);
  const pending = STATE.rewards.filter(r => !r.redeemedAt);
  const redeemed = STATE.rewards.filter(r => r.redeemedAt);

  let html = bannerHTML(today);

  html += '<h2 class="section-title">Rewards</h2>';
  if (!pending.length) {
    html += `<div class="empty-state"><span class="big">&#127873;</span>No rewards defined.<br>Write down what you're working toward.</div>`;
  } else {
    html += pending.map(r => `
      <div class="reward-card ${isUnlocked ? '' : 'locked'}">
        <span class="reward-lock">${isUnlocked ? '&#127873;' : '&#128274;'}</span>
        <span class="reward-text">${esc(r.text)}</span>
        ${isUnlocked
          ? `<button class="btn small primary" onclick="redeemReward('${r.id}')">Redeem</button>`
          : ''}
        <button class="icon-btn" onclick="deleteReward('${r.id}')" title="Delete reward">&#10005;</button>
      </div>`).join('');
  }
  html += `<button class="add-btn" onclick="openRewardModal()">+ Add reward</button>`;

  if (redeemed.length) {
    html += '<h2 class="section-title">Redeemed</h2>';
    html += redeemed.map(r => `
      <div class="reward-card redeemed">
        <span class="reward-lock">&#9989;</span>
        <span class="reward-text">${esc(r.text)}</span>
        <span class="reward-date">${r.redeemedAt.slice(0, 10)}</span>
      </div>`).join('');
  }

  view.innerHTML = html;
}

/* ---------- Settings view ---------- */

function renderSettings() {
  const view = $('#view-settings');
  const archived = STATE.habits.filter(h => h.archivedAt);

  view.innerHTML = `
    <h2 class="section-title">Backup</h2>
    <div class="settings-card">
      <h3>Export / import data</h3>
      <p>Everything lives only on this device. Download a JSON backup regularly — it's your safety net.</p>
      <div class="row">
        <button class="btn" onclick="EarnDB.exportDownload(STATE)">&#11015; Export backup</button>
        <button class="btn" onclick="$('#importFile').click()">&#11014; Import backup</button>
        <input type="file" id="importFile" accept="application/json,.json" style="display:none">
      </div>
    </div>

    ${archived.length ? `
    <h2 class="section-title">Archived habits</h2>
    <div class="settings-card">
      ${archived.map(h => `
        <div class="archived-item">
          <span class="name">${esc(h.name)}</span>
          <button class="btn small" onclick="unarchiveHabit('${h.id}')">Restore</button>
        </div>`).join('')}
    </div>` : ''}

    <h2 class="section-title">Danger zone</h2>
    <div class="settings-card">
      <h3>Reset everything</h3>
      <p>Deletes all habits, history and rewards on this device. Export a backup first.</p>
      <button class="btn danger-ghost" onclick="resetAll()">Delete all data</button>
    </div>

    <p class="small-print">Earn It v1 &middot; all data stored locally in your browser &middot; nothing is sent anywhere.</p>`;

  $('#importFile').addEventListener('change', onImportFile);
}

/* ================= actions ================= */

function setHabitStatus(habitId, date, value) {
  if (!STATE.days[date]) STATE.days[date] = { habits: {} };
  if (!STATE.days[date].habits) STATE.days[date].habits = {};
  if (value === null) delete STATE.days[date].habits[habitId];
  else STATE.days[date].habits[habitId] = value;
  saveRender();
}

function confirmSlip(habitId, date) {
  const h = STATE.habits.find(x => x.id === habitId);
  if (!h) return;
  if (confirm(`Log a slip on "${h.name}" for ${date}?\n\nThis resets its streak to 0 and locks rewards. Honesty now beats a fake streak later.`)) {
    setHabitStatus(habitId, date, 'failed');
  }
}

function redeemReward(id) {
  const r = STATE.rewards.find(x => x.id === id);
  if (!r) return;
  if (confirm(`Redeem "${r.text}"?\n\nYou earned it.`)) {
    r.redeemedAt = new Date().toISOString();
    saveRender();
  }
}

function deleteReward(id) {
  const r = STATE.rewards.find(x => x.id === id);
  if (!r) return;
  if (confirm(`Delete reward "${r.text}"?`)) {
    STATE.rewards = STATE.rewards.filter(x => x.id !== id);
    saveRender();
  }
}

function unarchiveHabit(id) {
  const h = STATE.habits.find(x => x.id === id);
  if (h) { h.archivedAt = null; saveRender(); }
}

function resetAll() {
  if (!confirm('Delete ALL Earn It data on this device?')) return;
  if (!confirm('Last chance — this cannot be undone. Have you exported a backup?')) return;
  STATE = EarnDB.defaults();
  saveRender();
}

function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = EarnDB.parseImport(reader.result);
      const n = imported.habits.length;
      if (confirm(`Import backup with ${n} habit${n === 1 ? '' : 's'}?\n\nThis REPLACES everything currently in the app.`)) {
        STATE = imported;
        saveRender();
        alert('Backup imported.');
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ================= modals ================= */

function openModal(html) {
  $('#modalCard').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalCard').innerHTML = '';
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

/* ---------- habit form ---------- */

let habitFormType = 'do';

function openHabitModal(id) {
  const h = id ? STATE.habits.find(x => x.id === id) : null;
  habitFormType = h ? h.type : 'do';
  openModal(`
    <h3>${h ? 'Edit habit' : 'New habit'}</h3>
    <div class="field">
      <label for="habitName">Habit</label>
      <input type="text" id="habitName" placeholder='e.g. "No porn", "Walk daily", "Read"' value="${h ? esc(h.name) : ''}" maxlength="60">
    </div>
    <div class="field">
      <label>Type</label>
      <div class="seg" id="habitTypeSeg">
        <button class="${habitFormType === 'do' ? 'on' : ''}" onclick="setHabitFormType('do')">Build (do daily)</button>
        <button class="${habitFormType === 'avoid' ? 'on bad' : ''}" onclick="setHabitFormType('avoid')">Quit (avoid)</button>
      </div>
      <div class="seg-hint" id="habitTypeHint">${habitTypeHint()}</div>
    </div>
    <div class="field">
      <label for="habitMilestone">Milestone (days)</label>
      <input type="number" id="habitMilestone" min="1" max="365" inputmode="numeric" value="${h ? h.milestone : 21}">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveHabit(${h ? `'${h.id}'` : 'null'})">${h ? 'Save' : 'Add habit'}</button>
    </div>
    ${h ? `
    <div class="modal-footer-danger">
      <button class="btn" onclick="archiveHabit('${h.id}')">Archive</button>
      <button class="btn danger-ghost" onclick="deleteHabit('${h.id}')">Delete</button>
    </div>
    <p class="small-print">Archive removes it from the unlock condition but keeps its history. Delete erases it and its history.</p>` : ''}
  `);
  setTimeout(() => $('#habitName').focus(), 50);
}

function habitTypeHint() {
  return habitFormType === 'do'
    ? 'You must check it off every day — a missed day breaks the streak.'
    : 'Clean by default — only logging a slip breaks the streak.';
}

function setHabitFormType(type) {
  habitFormType = type;
  const btns = document.querySelectorAll('#habitTypeSeg button');
  btns[0].className = type === 'do' ? 'on' : '';
  btns[1].className = type === 'avoid' ? 'on bad' : '';
  $('#habitTypeHint').textContent = habitTypeHint();
}

function saveHabit(id) {
  const name = $('#habitName').value.trim();
  const milestone = Math.max(1, Math.min(365, parseInt($('#habitMilestone').value, 10) || 21));
  if (!name) { alert('Give the habit a name.'); return; }

  if (id) {
    const h = STATE.habits.find(x => x.id === id);
    if (h) { h.name = name; h.type = habitFormType; h.milestone = milestone; }
  } else {
    STATE.habits.push({
      id: uid(),
      name,
      type: habitFormType,
      milestone,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    });
  }
  closeModal();
  saveRender();
}

function archiveHabit(id) {
  const h = STATE.habits.find(x => x.id === id);
  if (!h) return;
  if (confirm(`Archive "${h.name}"?\n\nIt stops counting toward the reward unlock. History is kept and you can restore it in Settings.`)) {
    h.archivedAt = new Date().toISOString();
    closeModal();
    saveRender();
  }
}

function deleteHabit(id) {
  const h = STATE.habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm(`Delete "${h.name}" AND its whole history?\n\nArchiving is usually the better choice.`)) return;
  STATE.habits = STATE.habits.filter(x => x.id !== id);
  for (const date of Object.keys(STATE.days)) {
    const day = STATE.days[date];
    if (day.habits) delete day.habits[id];
    if (day.habits && !Object.keys(day.habits).length && !day.urges && !day.mood) delete STATE.days[date];
  }
  closeModal();
  saveRender();
}

/* ---------- reward form ---------- */

function openRewardModal() {
  openModal(`
    <h3>New reward</h3>
    <div class="field">
      <label for="rewardText">Reward</label>
      <input type="text" id="rewardText" placeholder='e.g. "Send that message", "Buy that thing"' maxlength="120">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveReward()">Add reward</button>
    </div>
    <p class="small-print">Unlocks only when every active habit streak reaches its milestone.</p>
  `);
  setTimeout(() => $('#rewardText').focus(), 50);
}

function saveReward() {
  const text = $('#rewardText').value.trim();
  if (!text) { alert('Describe the reward.'); return; }
  STATE.rewards.push({ id: uid(), text, createdAt: new Date().toISOString(), redeemedAt: null });
  closeModal();
  saveRender();
}

/* ---------- day editor (retro check-ins) ---------- */

function openDayModal(date) {
  const today = L.todayStr();
  const habits = L.activeHabits(STATE.habits).filter(h => L.createdDay(h) <= date);
  if (!habits.length) return;

  const [y, m, d] = date.split('-').map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });

  openModal(`
    <h3>${date === today ? 'Today' : nice}</h3>
    ${habits.map(h => dayEditRowHTML(h, date)).join('')}
    <div class="modal-actions">
      <button class="btn primary" onclick="closeModal()">Done</button>
    </div>
    <p class="small-print">Fixing a forgotten check-in is honesty. Faking one is only cheating yourself.</p>
  `);
}

function dayEditRowHTML(h, date) {
  const st = L.status(STATE.days, date, h.id);
  const labels = h.type === 'do'
    ? { none: 'Not done', done: 'Done', failed: 'Failed' }
    : { none: 'Clean', done: 'Clean+', failed: 'Slipped' };
  const seg = h.type === 'do'
    ? `
      <button class="${st === null ? 'on' : ''}" onclick="dayEditSet('${h.id}','${date}',null)">${labels.none}</button>
      <button class="${st === 'done' ? 'on good' : ''}" onclick="dayEditSet('${h.id}','${date}','done')">${labels.done}</button>
      <button class="${st === 'failed' ? 'on bad' : ''}" onclick="dayEditSet('${h.id}','${date}','failed')">${labels.failed}</button>`
    : `
      <button class="${st !== 'failed' ? 'on good' : ''}" onclick="dayEditSet('${h.id}','${date}',null)">${labels.none}</button>
      <button class="${st === 'failed' ? 'on bad' : ''}" onclick="dayEditSet('${h.id}','${date}','failed')">${labels.failed}</button>`;
  return `
    <div class="day-edit-habit" id="dayrow-${h.id}">
      <div class="name">${esc(h.name)} <span class="chip ${h.type}">${h.type === 'do' ? 'BUILD' : 'QUIT'}</span></div>
      <div class="seg">${seg}</div>
    </div>`;
}

function dayEditSet(habitId, date, value) {
  if (!STATE.days[date]) STATE.days[date] = { habits: {} };
  if (!STATE.days[date].habits) STATE.days[date].habits = {};
  if (value === null) delete STATE.days[date].habits[habitId];
  else STATE.days[date].habits[habitId] = value;
  save();
  const h = STATE.habits.find(x => x.id === habitId);
  const row = $('#dayrow-' + habitId);
  if (h && row) row.outerHTML = dayEditRowHTML(h, date);
  render();
}

/* ================= boot ================= */

// Re-render when the date rolls over or the app comes back to foreground
let lastRenderedDay = L.todayStr();
function checkDayRollover() {
  const now = L.todayStr();
  if (now !== lastRenderedDay) { lastRenderedDay = now; render(); }
}
setInterval(checkDayRollover, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayRollover(); });

// PWA: service worker + persistent storage (no-ops on file://)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}

render();

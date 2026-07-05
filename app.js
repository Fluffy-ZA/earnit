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

// iOS (incl. installed home-screen PWAs) never supports periodic background sync.
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }

// Credit ledgers for every habit, recomputed once per render
let LEDGERS = {};

function fmtMin(m) {
  m = Math.round(m);
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}
// Format an amount in a habit's own unit (minutes → "1h 30m", checks → count)
function fmtAmt(h, n) { return L.isTimed(h) ? fmtMin(n) : String(n); }

// Short description of a habit's goal, e.g. "3h/day", "3×/week"
function goalLabel(h) {
  const g = L.goalOf(h);
  if (L.isTimed(h)) return `${fmtMin(g)}/${L.isWeekly(h) ? 'week' : 'day'}`;
  if (L.isWeekly(h)) return `${g}×/week`;
  return 'daily';
}

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
  LEDGERS = L.allLedgers(STATE.habits, STATE.days, today);
  renderHeader(today);
  if (currentView === 'today') renderToday(today);
  if (currentView === 'history') renderHistory(today);
  if (currentView === 'rewards') renderRewards(today);
  if (currentView === 'settings') renderSettings();
}

function renderHeader(today) {
  const el = $('#headerStatus');
  const act = L.activeHabits(STATE.habits);
  if (!act.length) { el.textContent = ''; el.className = 'pill'; el.style.display = 'none'; return; }
  el.style.display = '';
  const rs = L.rewardsStatus(STATE.habits, STATE.rewards, STATE.days, today);
  if (rs.anyReady) {
    el.textContent = '🎁 READY';
    el.className = 'pill unlocked';
  } else if (rs.nearest) {
    el.textContent = `${rs.nearest.remaining}d to ${rs.nearest.badge.emoji}`;
    el.className = 'pill';
  } else {
    // no pending rewards — show the weakest habit's next badge
    const b = L.badgeInfo(rs.minStreakDays);
    el.textContent = `${b.next.emoji} in ${Math.max(0, b.next.days - b.streakDays)}d`;
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
    <h2 class="section-title">Daily check-in</h2>
    ${moodCardHTML(today)}
    <h2 class="section-title">Habits</h2>
    ${act.map(h => habitCardHTML(h, today)).join('')}
    <button class="add-btn" onclick="openHabitModal()">+ Add habit</button>`;
}

/* ---------- mood / energy check-in ---------- */

const MOOD_FACES = ['', '\u{1F616}', '\u{1F615}', '\u{1F610}', '\u{1F642}', '\u{1F604}'];
const MOOD_COLORS = ['', '#ef4444', '#f97316', '#f59e0b', '#a3e635', '#22c55e'];

function moodCardHTML(date, ctx = '') {
  const mood = L.moodOn(STATE.days, date) || {};
  const scale = (field, label, icons) => `
    <div class="mood-row">
      <span class="mood-label">${label}</span>
      <div class="mood-scale">
        ${[1,2,3,4,5].map(v => `
          <button class="mood-btn${mood[field] === v ? ' on' : ''}" style="${mood[field] === v ? `border-color:${MOOD_COLORS[v]};color:${MOOD_COLORS[v]}` : ''}"
            onclick="setMood('${date}','${field}',${v},'${ctx}')">${icons ? MOOD_FACES[v] : v}</button>`).join('')}
      </div>
    </div>`;
  return `
    <div class="mood-card">
      ${scale('score', 'Mood', true)}
      ${scale('energy', 'Energy ⚡', false)}
      <input type="text" class="mood-note" id="moodNote-${ctx}${date}" placeholder="Optional note about today…" maxlength="200"
        value="${esc(mood.note || '')}" onchange="setMoodNote('${date}', this.value)">
    </div>`;
}

function ensureDay(date) {
  if (!STATE.days[date]) STATE.days[date] = { habits: {} };
  return STATE.days[date];
}

function setMood(date, field, value, ctx = '') {
  const day = ensureDay(date);
  if (!day.mood) day.mood = {};
  // keep any note typed but not yet committed via change event
  const noteEl = document.getElementById('moodNote-' + ctx + date);
  if (noteEl) day.mood.note = noteEl.value.trim();
  day.mood[field] = (day.mood[field] === value) ? null : value; // tap again to clear
  saveRender();
  // if edited from inside the day modal, refresh the modal copy too
  const modalMood = document.getElementById('modalMood-' + date);
  if (modalMood) modalMood.innerHTML = moodCardHTML(date, 'm-');
}

function setMoodNote(date, value) {
  const day = ensureDay(date);
  if (!day.mood) day.mood = {};
  day.mood.note = value.trim();
  save();
}

/* ---------- urge logging ---------- */

function openUrgeModal(habitId) {
  const h = STATE.habits.find(x => x.id === habitId);
  if (!h) return;
  openModal(`
    <h3>&#128170; Urge resisted &mdash; ${esc(h.name)}</h3>
    <div class="field">
      <label for="urgeNote">What happened? (optional)</label>
      <textarea id="urgeNote" rows="3" placeholder="Where were you, what triggered it, what did you do instead…" maxlength="400"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="logUrge('${h.id}')">Log it</button>
    </div>
    <p class="small-print">Every urge you resist and log is proof it passes. The note helps the weekly review find your triggers.</p>
  `);
}

function logUrge(habitId) {
  const note = ($('#urgeNote') ? $('#urgeNote').value.trim() : '');
  const day = ensureDay(L.todayStr());
  if (!day.urges) day.urges = [];
  day.urges.push({ habitId, note, ts: new Date().toISOString() });
  closeModal();
  saveRender();
}

function deleteUrge(date, index) {
  const day = STATE.days[date];
  if (!day || !day.urges) return;
  day.urges.splice(index, 1);
  if (!day.urges.length) delete day.urges;
  save();
  openDayModal(date); // refresh modal contents
  render();
}

function bannerHTML(today) {
  const rs = L.rewardsStatus(STATE.habits, STATE.rewards, STATE.days, today);
  if (rs.anyReady) {
    const r = rs.ready[0];
    return `
      <div class="banner unlocked">
        <div class="banner-title">&#127873; Reward unlocked</div>
        <div class="banner-sub">Your weakest streak reached ${r.badge.emoji} ${r.badge.label}. You earned it — go claim it.</div>
      </div>`;
  }
  const weakName = rs.weakest ? esc(rs.weakest.name) : '';
  if (!rs.items.length) {
    // no rewards defined yet — show badge progress instead
    const b = L.badgeInfo(rs.minStreakDays);
    return `
      <div class="banner">
        <div class="banner-title">${b.current ? b.current.emoji + ' ' + b.current.label + ' badge' : '🌱 Just getting started'}</div>
        <div class="banner-sub">Next badge ${b.next.emoji} ${b.next.label}${weakName ? ` &middot; behind: <b>${weakName}</b>` : ''}. Add a reward to work toward.</div>
        <div class="bar"><div class="bar-fill" style="width:${Math.round(b.ratio * 100)}%"></div></div>
      </div>`;
  }
  const n = rs.nearest;
  const ratio = n.need > 0 ? Math.min(1, rs.minStreakDays / n.need) : 1;
  return `
    <div class="banner">
      <div class="banner-title">&#128274; Next reward at ${n.badge.emoji} ${n.badge.label}</div>
      <div class="banner-sub">${n.remaining} day${n.remaining === 1 ? '' : 's'} to unlock &ldquo;${esc(n.reward.text)}&rdquo;${weakName ? ` &middot; behind: <b>${weakName}</b>` : ''}</div>
      <div class="bar"><div class="bar-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
    </div>`;
}

function weekStripHTML(today) {
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const date = L.addDays(today, -i);
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).toLocaleDateString('en', { weekday: 'short' }).slice(0, 2);
    const summary = L.daySummary(STATE.habits, STATE.days, date, LEDGERS);
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
  const led = LEDGERS[h.id] || { bank: 0, streak: 0, current: { amount: 0, goal: 1 } };
  const s = led.streak;
  const unitWord = L.isWeekly(h) ? 'week' : 'day';
  const streakDays = s * (L.isWeekly(h) ? 7 : 1);
  const badge = L.badgeInfo(streakDays);
  const remDays = Math.max(0, badge.next.days - streakDays);
  const toNext = L.isWeekly(h) ? `${Math.ceil(remDays / 7)} wk` : `${remDays}d`;
  const st = L.status(STATE.days, today, h.id);
  const frozen = L.onBreak(h, today);

  const urgesToday = L.urgesOn(STATE.days, today).filter(u => u.habitId === h.id).length;
  const urgeBtn = `<button class="btn small urge-btn" onclick="openUrgeModal('${h.id}')" title="Log an urge you resisted">&#128170;${urgesToday ? ` &times;${urgesToday}` : ''}</button>`;

  let actions, progressLine = '';
  if (h.type === 'do') {
    const goal = L.goalOf(h);
    const amt = led.current.amount; // today's or this week's total
    const hit = amt >= goal;
    const span = L.isWeekly(h) ? 'this week' : 'today';

    if (L.isTimed(h)) {
      progressLine = `<div class="amount-line${hit ? ' hit' : ''}">${fmtMin(amt)} <span class="muted">/ ${fmtMin(goal)} ${span}</span>${hit ? ' &#10003;' : ''}</div>`;
      actions = `
        <button class="btn small" onclick="logAmount('${h.id}','${today}',15)">+15m</button>
        <button class="btn small" onclick="logAmount('${h.id}','${today}',30)">+30m</button>
        <button class="btn small" onclick="logAmount('${h.id}','${today}',60)">+1h</button>
        <button class="btn small" onclick="promptMinutes('${h.id}','${today}')">+&hellip;</button>
        ${urgeBtn}`;
    } else if (L.isWeekly(h) || goal > 1) {
      const todayAmt = L.amountOn(STATE.days, today, h.id);
      progressLine = `<div class="amount-line${hit ? ' hit' : ''}">${amt} <span class="muted">/ ${goal} ${span}</span>${hit ? ' &#10003;' : ''}</div>`;
      actions = `
        <button class="btn primary grow" onclick="logAmount('${h.id}','${today}',1)">+ Log 1 today${todayAmt ? ` (${todayAmt})` : ''}</button>
        ${todayAmt ? `<button class="btn small" onclick="logAmount('${h.id}','${today}',-1)" title="Remove one from today">&minus;</button>` : ''}
        ${urgeBtn}`;
    } else {
      const doneToday = st === 'done' || amt >= 1;
      actions = (doneToday
        ? `<button class="btn done grow" onclick="setHabitStatus('${h.id}','${today}',null)">&#10003; Done today</button>`
        : `<button class="btn primary grow" onclick="setHabitStatus('${h.id}','${today}','done')">Mark done today</button>`) + urgeBtn;
    }
  } else {
    actions = st === 'failed'
      ? `<span class="clean-note slipped">Slipped today</span>
         ${urgeBtn}
         <button class="btn small" onclick="setHabitStatus('${h.id}','${today}',null)">Undo</button>`
      : `<span class="clean-note">Clean today &#10003;</span>
         ${urgeBtn}
         <button class="btn small danger-ghost" onclick="confirmSlip('${h.id}','${today}')">I slipped</button>`;
  }

  const goalChip = (h.type === 'do' && (L.isTimed(h) || L.isWeekly(h) || L.goalOf(h) > 1))
    ? `<span class="chip goal">${goalLabel(h)}</span>` : '';
  const breakChip = frozen ? `<span class="chip break">&#10052; ON BREAK</span>` : '';
  const bankChip = (h.type === 'do' && led.bank > 0)
    ? `<span class="bank-chip" title="Banked extra — automatically covers a future short ${unitWord}">&#128179; ${fmtAmt(h, led.bank)} credit</span>` : '';

  return `
    <div class="habit-card${frozen ? ' frozen' : ''}">
      <div class="habit-top">
        <span class="habit-name">${esc(h.name)}</span>
        ${goalChip}
        ${breakChip}
        <span class="chip ${h.type}">${h.type === 'do' ? 'BUILD' : 'QUIT'}</span>
        <button class="icon-btn" onclick="openHabitModal('${h.id}')" title="Edit habit">&#9998;</button>
      </div>
      <div class="habit-streak">
        <span class="badge-emoji" title="${badge.current ? 'Earned: ' + badge.current.label : 'No badge yet'}">${badge.current ? badge.current.emoji : '·'}</span>
        <span class="streak-count">&#128293; ${s}</span>
        <span class="muted">${unitWord}${s === 1 ? '' : 's'}${badge.current ? ' &middot; ' + badge.current.label : ''}</span>
        ${bankChip}
      </div>
      <div class="bar"><div class="bar-fill" style="width:${Math.round(badge.ratio * 100)}%"></div></div>
      <div class="badge-next muted">${badge.next.emoji} ${badge.next.label} in ${toNext}</div>
      ${progressLine}
      <div class="habit-actions">${actions}</div>
    </div>`;
}

/* Add/remove units (sessions or minutes) on a date. Numbers replace any
   'done'/'failed' marker; hitting 0 clears the entry entirely. */
function logAmount(habitId, date, delta) {
  const next = Math.max(0, L.amountOn(STATE.days, date, habitId) + delta);
  const day = ensureDay(date);
  if (!day.habits) day.habits = {};
  if (next === 0) delete day.habits[habitId];
  else day.habits[habitId] = next;
  save();
  // refresh the day-editor row if the day modal is open
  const h = STATE.habits.find(x => x.id === habitId);
  const row = $('#dayrow-' + habitId);
  if (h && row) row.outerHTML = dayEditRowHTML(h, date);
  render();
}

function promptMinutes(habitId, date) {
  const v = prompt('Minutes to add (negative to remove):');
  if (v === null) return;
  const n = parseInt(v, 10);
  if (!n) return;
  logAmount(habitId, date, n);
}

/* ---------- History view (12-week heatmap) ---------- */

function renderHistory(today) {
  const view = $('#view-history');
  if (!STATE.habits.length) {
    view.innerHTML = `<div class="empty-state"><span class="big">&#128197;</span>History appears once you have habits and check-ins.</div>`;
    return;
  }

  const first = L.firstTrackedDay(STATE.habits, STATE.days);
  const thisMonday = L.mondayOf(today);
  const rows = [];
  let lastMonth = '';

  for (let w = 0; w < 12; w++) {
    const monday = L.addDays(thisMonday, -7 * w);
    if (first && L.addDays(monday, 6) < first) break; // nothing tracked that far back
    const [y, m] = monday.split('-').map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short' });
    const label = monthName === lastMonth ? '' : monthName;
    lastMonth = monthName;

    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = L.addDays(monday, i);
      if (date > today) { cells.push('<span class="heat-cell future"></span>'); continue; }
      const summary = L.daySummary(STATE.habits, STATE.days, date, LEDGERS);
      const urges = L.urgesOn(STATE.days, date).length;
      const mood = L.moodOn(STATE.days, date);
      const moodBar = (mood && mood.score)
        ? `<span class="mood-bar" style="background:${MOOD_COLORS[mood.score]}"></span>`
        : '<span class="mood-bar"></span>';
      cells.push(`
        <button class="heat-cell${date === today ? ' today' : ''}" onclick="openDayModal('${date}')" title="${date}">
          <span class="heat-dom">${Number(date.slice(8))}</span>
          <span class="dot ${summary}"></span>
          ${urges ? `<span class="urge-marker">&#128170;${urges > 1 ? urges : ''}</span>` : ''}
          ${moodBar}
        </button>`);
    }
    rows.push(`<div class="heat-row"><span class="heat-label">${label}</span>${cells.join('')}</div>`);
  }

  view.innerHTML = `
    <button class="btn primary wide" onclick="openReviewModal()">&#10024; Weekly Review</button>
    <h2 class="section-title">Last ${rows.length} week${rows.length === 1 ? '' : 's'}</h2>
    <div class="heat-dow-row"><span class="heat-label"></span>${['M','T','W','T','F','S','S'].map(d => `<span class="heat-dow">${d}</span>`).join('')}</div>
    ${rows.join('')}
    <div class="heat-legend">
      <span><span class="dot full"></span> all done</span>
      <span><span class="dot partial"></span> partial</span>
      <span><span class="dot fail"></span> slip/fail</span>
      <span><span class="dot none"></span> missed</span>
      <span><span class="dot break"></span> on break</span>
      <span>&#128170; urge resisted</span>
      <span><span class="mood-bar demo"></span> mood</span>
    </div>
    <p class="small-print">Tap any day to see details or fix a check-in.</p>`;
}

/* ---------- Weekly review ---------- */

const REVIEW_SYSTEM = `You are the weekly-review coach inside "Earn It", a private habit tracker and recovery companion. The user is working to quit compulsive habits and build daily ones. You receive one week of their logged data.

Some build habits are weekly (e.g. gym 3x/week) or measured in minutes rather than check-offs. Doing extra banks "credit" that automatically covers a later short day or week — a day marked "covered by credit" is fine, not a failure. Habits earn escalating badges (1 week, 2 weeks, 1 month, and so on up to 1 year) as the streak grows — celebrate a newly reached badge. A habit can be on a holiday/break: those days are frozen and deliberately don't count for or against the streak, so never treat them as misses.

Write a short weekly review (under 300 words), plain text, short paragraphs, simple hyphen bullets where useful:
1. Open with one genuine, specific encouragement grounded in the data.
2. Point out real patterns (links between urges, missed habits, mood, energy, weekdays). Only claim patterns the data actually supports; if there's too little data, say so gently.
3. If there were slips, be compassionate and practical - a slip is data, not a verdict.
4. End with one small, concrete suggestion for next week.

Speak directly to the user as "you". No headings, no markdown besides hyphens, no medical or diagnostic claims.`;

function buildReviewData() {
  const s = L.weeklyStats(STATE.habits, STATE.days, L.todayStr());
  const lines = [`My logged data for ${s.startDate} to ${s.endDate}:`, ''];

  lines.push('Habits, streaks and badges:');
  for (const h of s.habitStats) {
    const hb = h.habit;
    const bd = L.badgeInfo(h.streakDays);
    const badgeTxt = bd.current ? `${bd.current.label} badge earned` : 'no badge yet';
    const nextTxt = `next badge ${bd.next.label} at ${bd.next.days}d`;
    const brk = (hb.breaks || []).filter(b => b.to >= s.startDate && b.from <= s.endDate);
    if (hb.type === 'do') {
      let l;
      if (L.isWeekly(hb)) {
        l = `- ${hb.name} (build, ${goalLabel(hb)}): streak ${h.streak} week${h.streak === 1 ? '' : 's'} (${badgeTxt}, ${nextTxt}), this week ${fmtAmt(hb, h.weekAmount)} of ${fmtAmt(hb, h.goal)}`;
      } else {
        l = `- ${hb.name} (build, ${goalLabel(hb)}): streak ${h.streak}d (${badgeTxt}, ${nextTxt}), hit goal ${h.done}/${h.expected} days this week`;
        if (L.isTimed(hb)) l += `, ${fmtMin(h.amount)} logged in total`;
        if (h.coveredDates.length) l += `, short but covered by credit on ${h.coveredDates.join(', ')}`;
        if (h.missedDates.length) l += `, missed on ${h.missedDates.join(', ')}`;
      }
      if (h.bank > 0) l += `, credit bank ${fmtAmt(hb, h.bank)}`;
      if (brk.length) l += `, on holiday/break ${brk.map(b => b.from + '..' + b.to).join(', ')}`;
      lines.push(l);
    } else {
      lines.push(`- ${hb.name} (quit): streak ${h.streak}d clean (${badgeTxt}, ${nextTxt}), ${h.failedDates.length ? 'slipped on ' + h.failedDates.join(', ') : 'clean all week'}`);
    }
  }

  lines.push('', `Urges resisted: ${s.urgeTotal}`);
  for (const u of s.urgeLog) lines.push(`- ${u.date} (${u.habit})${u.note ? `: "${u.note}"` : ''}`);

  if (s.moodLog.length) {
    lines.push('', `Mood/energy check-ins (avg mood ${s.moodAvg ?? '-'}/5, avg energy ${s.energyAvg ?? '-'}/5):`);
    for (const m of s.moodLog) {
      lines.push(`- ${m.date}: mood ${m.score ?? '-'}/5, energy ${m.energy ?? '-'}/5${m.note ? `, note: "${m.note}"` : ''}`);
    }
  } else {
    lines.push('', 'No mood check-ins this week.');
  }

  const corr = s.correlations.filter(c => c.urgesPerMissedDay !== null && c.urgesPerDoneDay !== null);
  if (corr.length) {
    lines.push('', 'Urges vs habit completion:');
    for (const c of corr) lines.push(`- days "${c.habit}" was missed: ${c.urgesPerMissedDay} urges/day (${c.missedDays} days); days it was done: ${c.urgesPerDoneDay} urges/day (${c.doneDays} days)`);
  }

  return lines.join('\n');
}

function openReviewModal() {
  const s = L.weeklyStats(STATE.habits, STATE.days, L.todayStr());
  const hasKey = !!STATE.settings.apiKey;
  const latest = (STATE.reviews || [])[0];

  const chips = `
    <div class="review-chips">
      <span class="chip-stat">&#128170; ${s.urgeTotal} urge${s.urgeTotal === 1 ? '' : 's'} resisted</span>
      ${s.moodAvg ? `<span class="chip-stat">mood ${s.moodAvg}/5</span>` : ''}
      ${s.energyAvg ? `<span class="chip-stat">energy &#9889;${s.energyAvg}/5</span>` : ''}
      ${s.habitStats.map(h => `<span class="chip-stat">${esc(h.habit.name)}: ${
        h.habit.type === 'do'
          ? (L.isWeekly(h.habit)
              ? `${fmtAmt(h.habit, h.weekAmount)}/${fmtAmt(h.habit, h.goal)} this wk`
              : `${h.done}/${h.expected}d`)
          : (h.failedDates.length ? `${h.failedDates.length} slip${h.failedDates.length === 1 ? '' : 's'}` : 'clean &#10003;')
      }</span>`).join('')}
    </div>`;

  openModal(`
    <h3>&#10024; Weekly Review</h3>
    <p class="small-print" style="margin-top:-8px">${s.startDate} &rarr; ${s.endDate}</p>
    ${chips}
    <div id="reviewOutput">
      ${latest ? `<p class="small-print">Last review (${latest.ts.slice(0, 10)}):</p><div class="review-text">${esc(latest.text)}</div>` : ''}
    </div>
    <div class="modal-actions">
      ${hasKey
        ? `<button class="btn primary" id="reviewGenBtn" onclick="generateReview()">&#10024; Generate review</button>`
        : `<button class="btn primary" onclick="copyReviewPrompt(this)">&#128203; Copy prompt for Claude</button>`}
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
    ${hasKey
      ? `<p class="small-print">Sends this week's data to Claude using your API key. <button class="linklike" onclick="copyReviewPrompt(this)">Copy the prompt instead</button></p>`
      : `<p class="small-print">Paste the copied prompt into the Claude app for your review — or add an API key in Settings for one-tap reviews here.</p>`}
  `);
}

function copyReviewPrompt(btn) {
  const text = REVIEW_SYSTEM + '\n\n---\n\n' + buildReviewData();
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1600);
  }).catch(() => alert('Could not access the clipboard.'));
}

async function generateReview() {
  const btn = $('#reviewGenBtn');
  const out = $('#reviewOutput');
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  out.innerHTML = '<p class="small-print">Claude is reading your week…</p>';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': STATE.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1500,
        system: REVIEW_SYSTEM,
        messages: [{ role: 'user', content: buildReviewData() }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const msg = err && err.error ? err.error.message : 'HTTP ' + res.status;
      throw new Error(res.status === 401 ? 'Invalid API key — check it in Settings.' : msg);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('The model declined this request — try again later or use the copy-prompt option.');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) throw new Error('Empty response.');
    if (!STATE.reviews) STATE.reviews = [];
    STATE.reviews.unshift({ ts: new Date().toISOString(), weekEnding: L.todayStr(), text, source: 'claude' });
    save();
    out.innerHTML = `<div class="review-text">${esc(text)}</div>`;
  } catch (e) {
    const offline = !navigator.onLine;
    out.innerHTML = `<p class="review-error">${offline ? 'You appear to be offline.' : 'Could not generate: ' + esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Generate review';
  }
}

/* ---------- Rewards view ---------- */

function renderRewards(today) {
  const view = $('#view-rewards');
  const rs = L.rewardsStatus(STATE.habits, STATE.rewards, STATE.days, today);
  const byId = {}; rs.items.forEach(i => byId[i.reward.id] = i);
  const pending = STATE.rewards.filter(r => !r.redeemedAt);
  const redeemed = STATE.rewards.filter(r => r.redeemedAt);

  let html = bannerHTML(today);

  html += '<h2 class="section-title">Rewards</h2>';
  if (!pending.length) {
    html += `<div class="empty-state"><span class="big">&#127873;</span>No rewards defined.<br>Write down what you're working toward.</div>`;
  } else {
    html += pending.map(r => {
      const it = byId[r.id] || { unlocked: false, badge: L.badgeByDays(L.rewardBadgeDays(r)), remaining: 0 };
      return `
      <div class="reward-card ${it.unlocked ? '' : 'locked'}">
        <span class="reward-lock">${it.unlocked ? '&#127873;' : it.badge.emoji}</span>
        <span class="reward-text">${esc(r.text)}</span>
        <span class="reward-badge" title="Unlocks when your weakest habit reaches ${it.badge.label}">${it.badge.emoji} ${it.badge.label}${it.unlocked ? '' : ` &middot; ${it.remaining}d`}</span>
        ${it.unlocked
          ? `<button class="btn small primary" onclick="redeemReward('${r.id}')">Redeem</button>`
          : ''}
        <button class="icon-btn" onclick="deleteReward('${r.id}')" title="Delete reward">&#10005;</button>
      </div>`;
    }).join('');
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

  const key = STATE.settings.apiKey || '';
  const rem = STATE.settings.reminders;

  view.innerHTML = `
    <h2 class="section-title">AI weekly review</h2>
    <div class="settings-card">
      <h3>Claude API key</h3>
      <p>Enables one-tap weekly reviews. Your week's data is sent to Anthropic only when you tap Generate. Get a key at <b>console.anthropic.com</b> (a few dollars of credit lasts a long time — each review costs about 2 cents). Stored only on this device.</p>
      <div class="row">
        <input type="password" id="apiKeyInput" class="key-input" placeholder="sk-ant-…" value="${esc(key)}" autocomplete="off">
        <button class="btn small" onclick="saveApiKey()">Save</button>
        ${key ? `<button class="btn small" onclick="testApiKey(this)">Test</button>` : ''}
      </div>
      <p class="small-print" id="apiKeyStatus">${key ? 'Key saved ✓' : 'No key — the review screen offers a copy-paste prompt instead.'}</p>
    </div>

    <h2 class="section-title">Reminders</h2>
    <div class="settings-card">
      <h3>Daily check-in reminder</h3>
      ${isIOS() ? `
        <p>iOS doesn't let any web app — installed or not — schedule its own background reminders. That's an Apple platform restriction, not a bug here; no setting in Earn It can change it. Real push notifications would need Earn It to have a server sending them, which it deliberately doesn't (everything stays local on your device).</p>
        <p>The free workaround that actually works: add a <b>Personal Automation</b> in the iOS Shortcuts app — "At a scheduled time" &rarr; "Show notification" (or "Open App" &rarr; Earn It). It runs entirely on your phone, no code or server involved.</p>
        <p class="small-print">Settings app &middot; Shortcuts &middot; Automation &middot; + &middot; Time of Day.</p>
      ` : `
        <p>Best effort: on Android Chrome (installed app) the browser wakes up roughly once or twice a day to nudge you — the exact time is up to the browser. For a reminder at an exact time, a normal phone alarm is still the most reliable.</p>
        <div class="row">
          <button class="btn" onclick="enableReminders()">${rem ? 'Re-enable reminders' : '&#128276; Enable reminders'}</button>
        </div>
        <p class="small-print">${rem === 'periodic' ? 'Background reminders active ✓' : rem === 'granted' ? 'Notifications allowed, but this browser/device didn’t grant background scheduling yet — use a phone alarm meanwhile.' : ''}</p>
      `}
    </div>

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

/* ---------- API key + reminders ---------- */

function saveApiKey() {
  const val = $('#apiKeyInput').value.trim();
  STATE.settings.apiKey = val || undefined;
  save();
  render();
}

async function testApiKey(btn) {
  btn.disabled = true;
  btn.textContent = '…';
  const status = $('#apiKeyStatus');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': STATE.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    status.textContent = res.ok ? 'Key works ✓' : (res.status === 401 ? 'Key rejected — check for typos.' : 'API error: HTTP ' + res.status);
  } catch (e) {
    status.textContent = 'Could not reach the API — are you online?';
  }
  btn.disabled = false;
  btn.textContent = 'Test';
}

async function enableReminders() {
  if (!('Notification' in window)) { alert('Notifications are not supported in this browser.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('Notifications were not allowed. You can change this in your browser/site settings.'); return; }

  let periodic = false;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (st.state === 'granted') {
          await reg.periodicSync.register('earnit-reminder', { minInterval: 18 * 60 * 60 * 1000 });
          periodic = true;
        }
      }
      reg.showNotification('Earn It', {
        body: periodic
          ? 'Reminders on — you’ll get a nudge about your daily check-in. \u{1F4AA}'
          : 'Notifications enabled. This browser can’t schedule background reminders, so set a phone alarm too.',
        icon: 'icons/icon-192.png',
      });
    }
  } catch (e) {
    console.warn('reminder setup', e);
  }

  STATE.settings.reminders = periodic ? 'periodic' : 'granted';
  saveRender();
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
let habitFormMeasure = 'check';
let habitFormPer = 'day';

function openHabitModal(id) {
  const h = id ? STATE.habits.find(x => x.id === id) : null;
  habitFormType = h ? h.type : 'do';
  habitFormMeasure = h && h.measure === 'minutes' ? 'minutes' : 'check';
  habitFormPer = h && h.per === 'week' ? 'week' : 'day';
  openModal(`
    <h3>${h ? 'Edit habit' : 'New habit'}</h3>
    <div class="field">
      <label for="habitName">Habit</label>
      <input type="text" id="habitName" placeholder='e.g. "No porn", "Gym", "Read"' value="${h ? esc(h.name) : ''}" maxlength="60">
    </div>
    <div class="field">
      <label>Type</label>
      <div class="seg" id="habitTypeSeg">
        <button class="${habitFormType === 'do' ? 'on' : ''}" onclick="setHabitFormType('do')">Build (do)</button>
        <button class="${habitFormType === 'avoid' ? 'on bad' : ''}" onclick="setHabitFormType('avoid')">Quit (avoid)</button>
      </div>
      <div class="seg-hint" id="habitTypeHint">${habitTypeHint()}</div>
    </div>
    <div id="habitDoOpts" ${habitFormType === 'avoid' ? 'style="display:none"' : ''}>
      <div class="field">
        <label>Measure</label>
        <div class="seg" id="habitMeasureSeg">
          <button class="${habitFormMeasure === 'check' ? 'on' : ''}" onclick="setHabitFormMeasure('check')">Check-off</button>
          <button class="${habitFormMeasure === 'minutes' ? 'on' : ''}" onclick="setHabitFormMeasure('minutes')">Minutes</button>
        </div>
      </div>
      <div class="field">
        <label>Frequency</label>
        <div class="seg" id="habitPerSeg">
          <button class="${habitFormPer === 'day' ? 'on' : ''}" onclick="setHabitFormPer('day')">Daily</button>
          <button class="${habitFormPer === 'week' ? 'on' : ''}" onclick="setHabitFormPer('week')">Weekly</button>
        </div>
      </div>
      <div class="field">
        <label for="habitGoal" id="habitGoalLabel">${goalFieldLabel()}</label>
        <input type="number" id="habitGoal" min="1" max="10000" inputmode="numeric" value="${h ? L.goalOf(h) : 1}">
        <div class="seg-hint">e.g. gym 3&times;/week, or 180 minutes of study per day. Doing extra banks credit that automatically covers a future short day or week.</div>
      </div>
    </div>
    <div class="field">
      <label for="habitStart">Started on</label>
      <input type="date" id="habitStart" max="${L.todayStr()}" value="${h ? L.createdDay(h) : L.todayStr()}">
      <div class="seg-hint">Backdate this if you've already been at it. Quit habits count clean from this date automatically; for build habits, tick off the past days in the week strip or History.</div>
    </div>
    ${h && h.type === 'do' ? habitBreaksHTML(h) : ''}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveHabit(${h ? `'${h.id}'` : 'null'})">${h ? 'Save' : 'Add habit'}</button>
    </div>
    ${h ? `
    <div class="modal-footer-danger">
      <button class="btn" onclick="archiveHabit('${h.id}')">Archive</button>
      <button class="btn danger-ghost" onclick="deleteHabit('${h.id}')">Delete</button>
    </div>
    <p class="small-print">Archive removes it from the reward unlock but keeps its history. Delete erases it and its history.${h.type === 'do' ? ' Badges climb automatically — no milestone to set.' : ''}</p>` : ''}
    ${!h ? `<p class="small-print">Badges are earned automatically as your streak grows (🌱 1 week → 👑 1 year). Save first, then re-open to add holiday breaks.</p>` : ''}
  `);
  setTimeout(() => $('#habitName').focus(), 50);
}

/* Per-habit holiday/break ranges — frozen days that neither break nor grow the streak. */
function habitBreaksHTML(h) {
  const bs = h.breaks || [];
  const list = bs.length
    ? bs.map((b, i) => `
      <div class="break-item">
        <span>&#10052; ${b.from} &rarr; ${b.to}</span>
        <button class="icon-btn" onclick="removeHabitBreak('${h.id}',${i})" title="Remove">&#10005;</button>
      </div>`).join('')
    : `<p class="small-print">No breaks yet. Add a holiday range (e.g. December) to freeze this streak — those days won't break it or add to it.</p>`;
  const today = L.todayStr();
  return `
    <div class="field" id="habitBreaks">
      <label>Holidays / breaks &#10052;</label>
      ${list}
      <div class="break-add">
        <input type="date" id="breakFrom" value="${today}">
        <span class="muted">&rarr;</span>
        <input type="date" id="breakTo" value="${today}">
        <button class="btn small" onclick="addHabitBreak('${h.id}')">Add</button>
      </div>
    </div>`;
}

function addHabitBreak(id) {
  const h = STATE.habits.find(x => x.id === id);
  if (!h) return;
  const from = ($('#breakFrom').value || '').trim();
  const to = ($('#breakTo').value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { alert('Pick both dates.'); return; }
  const lo = from <= to ? from : to, hi = from <= to ? to : from;
  if (!h.breaks) h.breaks = [];
  h.breaks.push({ from: lo, to: hi });
  h.breaks.sort((a, b) => (a.from < b.from ? -1 : 1));
  saveRender();
  const c = $('#habitBreaks');
  if (c) c.outerHTML = habitBreaksHTML(h);
}

function removeHabitBreak(id, index) {
  const h = STATE.habits.find(x => x.id === id);
  if (!h || !h.breaks) return;
  h.breaks.splice(index, 1);
  saveRender();
  const c = $('#habitBreaks');
  if (c) c.outerHTML = habitBreaksHTML(h);
}

function habitTypeHint() {
  return habitFormType === 'do'
    ? 'Hit the goal each day (or week) — extra effort banks credit that covers a short one later.'
    : 'Clean by default — only logging a slip breaks the streak.';
}

function goalFieldLabel() {
  return (habitFormMeasure === 'minutes' ? 'Minutes' : 'Times')
    + ' per ' + (habitFormPer === 'week' ? 'week' : 'day');
}

function updateHabitFormLabels() {
  const gl = $('#habitGoalLabel');
  if (gl) gl.textContent = goalFieldLabel();
}

function setHabitFormType(type) {
  habitFormType = type;
  const btns = document.querySelectorAll('#habitTypeSeg button');
  btns[0].className = type === 'do' ? 'on' : '';
  btns[1].className = type === 'avoid' ? 'on bad' : '';
  $('#habitTypeHint').textContent = habitTypeHint();
  const opts = $('#habitDoOpts');
  if (opts) opts.style.display = type === 'do' ? '' : 'none';
  updateHabitFormLabels();
}

function setHabitFormMeasure(m) {
  habitFormMeasure = m;
  const btns = document.querySelectorAll('#habitMeasureSeg button');
  btns[0].className = m === 'check' ? 'on' : '';
  btns[1].className = m === 'minutes' ? 'on' : '';
  updateHabitFormLabels();
}

function setHabitFormPer(p) {
  habitFormPer = p;
  const btns = document.querySelectorAll('#habitPerSeg button');
  btns[0].className = p === 'day' ? 'on' : '';
  btns[1].className = p === 'week' ? 'on' : '';
  updateHabitFormLabels();
}

function saveHabit(id) {
  const name = $('#habitName').value.trim();
  if (!name) { alert('Give the habit a name.'); return; }

  const measure = habitFormType === 'do' ? habitFormMeasure : 'check';
  const per = habitFormType === 'do' ? habitFormPer : 'day';
  const goalEl = $('#habitGoal');
  const goal = habitFormType === 'do'
    ? Math.max(1, Math.min(10000, parseInt(goalEl ? goalEl.value : '1', 10) || 1))
    : 1;

  let start = ($('#habitStart').value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > L.todayStr()) start = L.todayStr();
  const createdAt = start + 'T00:00:00';

  if (id) {
    const h = STATE.habits.find(x => x.id === id);
    if (h) {
      h.name = name; h.type = habitFormType; h.createdAt = createdAt;
      h.measure = measure; h.per = per; h.goal = goal;
    }
  } else {
    STATE.habits.push({
      id: uid(),
      name,
      type: habitFormType,
      measure,
      per,
      goal,
      createdAt,
      archivedAt: null,
      breaks: [],
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
    if (day.urges) {
      day.urges = day.urges.filter(u => u.habitId !== id);
      if (!day.urges.length) delete day.urges;
    }
    const empty = (!day.habits || !Object.keys(day.habits).length) && !day.urges && !day.mood;
    if (empty) delete STATE.days[date];
  }
  closeModal();
  saveRender();
}

/* ---------- reward form ---------- */

function openRewardModal() {
  const opts = L.BADGES.map(b => `<option value="${b.days}"${b.days === 28 ? ' selected' : ''}>${b.emoji} ${b.label}</option>`).join('');
  openModal(`
    <h3>New reward</h3>
    <div class="field">
      <label for="rewardText">Reward</label>
      <input type="text" id="rewardText" placeholder='e.g. "Send that message", "Buy that thing"' maxlength="120">
    </div>
    <div class="field">
      <label for="rewardBadge">Unlock at badge</label>
      <select id="rewardBadge" class="select">${opts}</select>
      <div class="seg-hint">Unlocks once your weakest active habit reaches this badge. Bigger reward &rarr; pick a higher badge.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveReward()">Add reward</button>
    </div>
  `);
  setTimeout(() => $('#rewardText').focus(), 50);
}

function saveReward() {
  const text = $('#rewardText').value.trim();
  if (!text) { alert('Describe the reward.'); return; }
  const badge = parseInt($('#rewardBadge').value, 10) || 28;
  STATE.rewards.push({ id: uid(), text, badge, createdAt: new Date().toISOString(), redeemedAt: null });
  closeModal();
  saveRender();
}

/* ---------- day editor (retro check-ins) ---------- */

function openDayModal(date) {
  const today = L.todayStr();
  const habits = L.activeHabits(STATE.habits).filter(h => L.createdDay(h) <= date);

  const [y, m, d] = date.split('-').map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });

  const urges = L.urgesOn(STATE.days, date);
  const habitName = id => { const h = STATE.habits.find(x => x.id === id); return h ? h.name : '(deleted habit)'; };
  const urgesHTML = urges.length ? `
    <h2 class="section-title">Urges resisted</h2>
    ${urges.map((u, i) => `
      <div class="urge-item">
        <div class="urge-body">
          <b>&#128170; ${esc(habitName(u.habitId))}</b> <span class="muted">${(u.ts || '').slice(11, 16)}</span>
          ${u.note ? `<div class="urge-note">${esc(u.note)}</div>` : ''}
        </div>
        <button class="icon-btn" onclick="deleteUrge('${date}',${i})" title="Delete">&#10005;</button>
      </div>`).join('')}` : '';

  openModal(`
    <h3>${date === today ? 'Today' : nice}</h3>
    ${habits.map(h => dayEditRowHTML(h, date)).join('')}
    ${urgesHTML}
    <h2 class="section-title">Mood &amp; energy</h2>
    <div id="modalMood-${date}">${moodCardHTML(date, 'm-')}</div>
    <div class="modal-actions">
      <button class="btn primary" onclick="closeModal()">Done</button>
    </div>
    <p class="small-print">Fixing a forgotten check-in is honesty. Faking one is only cheating yourself.</p>
  `);
}

function dayEditRowHTML(h, date) {
  const st = L.status(STATE.days, date, h.id);
  const amt = L.amountOn(STATE.days, date, h.id);
  let control;
  if (h.type === 'avoid') {
    control = `<div class="seg">
      <button class="${st !== 'failed' ? 'on good' : ''}" onclick="dayEditSet('${h.id}','${date}',null)">Clean</button>
      <button class="${st === 'failed' ? 'on bad' : ''}" onclick="dayEditSet('${h.id}','${date}','failed')">Slipped</button>
    </div>`;
  } else if (L.isTimed(h)) {
    control = `<div class="amount-edit">
      <input type="number" min="0" max="10000" inputmode="numeric" value="${amt || ''}" placeholder="0"
        onchange="dayEditSetAmount('${h.id}','${date}',this.value)">
      <span class="muted">minutes (goal ${goalLabel(h)})</span>
    </div>`;
  } else if (L.isWeekly(h) || L.goalOf(h) > 1) {
    control = `<div class="stepper">
      <button class="btn small" onclick="logAmount('${h.id}','${date}',-1)" ${amt ? '' : 'disabled'}>&minus;</button>
      <span class="stepper-count">${amt}</span>
      <button class="btn small" onclick="logAmount('${h.id}','${date}',1)">+</button>
      <span class="muted">${L.isWeekly(h) ? `that day (goal ${goalLabel(h)})` : `of ${L.goalOf(h)} that day`}</span>
    </div>`;
  } else {
    const isDone = st === 'done' || amt >= 1;
    control = `<div class="seg">
      <button class="${!isDone && st !== 'failed' ? 'on' : ''}" onclick="dayEditSet('${h.id}','${date}',null)">Not done</button>
      <button class="${isDone ? 'on good' : ''}" onclick="dayEditSet('${h.id}','${date}','done')">Done</button>
      <button class="${st === 'failed' ? 'on bad' : ''}" onclick="dayEditSet('${h.id}','${date}','failed')">Failed</button>
    </div>`;
  }
  const frozen = L.onBreak(h, date)
    ? `<div class="break-tag">&#10052; On break this day — frozen, doesn't count for or against the streak.</div>` : '';
  return `
    <div class="day-edit-habit${frozen ? ' frozen' : ''}" id="dayrow-${h.id}">
      <div class="name">${esc(h.name)} <span class="chip ${h.type}">${h.type === 'do' ? 'BUILD' : 'QUIT'}</span></div>
      ${control}
      ${frozen}
    </div>`;
}

function dayEditSetAmount(habitId, date, value) {
  const n = Math.max(0, Math.min(10000, parseInt(value, 10) || 0));
  logAmount(habitId, date, n - L.amountOn(STATE.days, date, habitId));
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

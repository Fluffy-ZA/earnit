/* logic.js — pure functions only (no DOM, no storage).
   Streaks are always computed from the day log, never stored. */

const EarnLogic = (() => {

  // Local-time YYYY-MM-DD (never UTC — an 11pm check-in belongs to that day)
  function todayStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return todayStr(new Date(y, m - 1, d + n));
  }

  // 'done' | 'failed' | null for a habit on a given date
  function status(days, date, habitId) {
    const e = days[date];
    return (e && e.habits && e.habits[habitId]) || null;
  }

  function createdDay(habit) {
    return (habit.createdAt || '').slice(0, 10);
  }

  function activeHabits(habits) {
    return habits.filter(h => !h.archivedAt);
  }

  /* Current streak length in days.
     'do'    — walk back from today counting consecutive 'done'; an unchecked
               TODAY is pending (doesn't break), but any unchecked PAST day does.
     'avoid' — every day since creation (or since the last 'failed' day) counts
               as clean; only an explicit 'failed' breaks it. */
  function streak(habit, days, today) {
    const created = createdDay(habit);
    if (!created || created > today) return 0;
    let count = 0;
    let d = today;

    if (habit.type === 'do') {
      const t = status(days, d, habit.id);
      if (t === 'failed') return 0;
      if (t === 'done') count++;
      d = addDays(d, -1);
      while (d >= created) {
        if (status(days, d, habit.id) !== 'done') break;
        count++;
        d = addDays(d, -1);
      }
      return count;
    }

    // avoid
    while (d >= created) {
      if (status(days, d, habit.id) === 'failed') break;
      count++;
      d = addDays(d, -1);
    }
    return count;
  }

  // All active habits at/over their milestone → rewards unlocked.
  // No active habits → nothing earned, stays locked.
  function unlocked(habits, days, today) {
    const act = activeHabits(habits);
    return act.length > 0 && act.every(h => streak(h, days, today) >= h.milestone);
  }

  // Per-habit progress + overall days-to-unlock
  function progress(habits, days, today) {
    const act = activeHabits(habits);
    const items = act.map(h => {
      const s = streak(h, days, today);
      return {
        habit: h,
        streak: s,
        ratio: h.milestone > 0 ? Math.min(1, s / h.milestone) : 1,
        remaining: Math.max(0, h.milestone - s),
      };
    });
    const daysToUnlock = items.length ? Math.max(...items.map(i => i.remaining)) : null;
    const weakest = items.length
      ? items.reduce((a, b) => (b.remaining > a.remaining ? b : a))
      : null;
    return { items, daysToUnlock, weakest, unlocked: unlocked(habits, days, today) };
  }

  /* Summary of one calendar day across habits that existed then:
     'fail' if anything failed, 'full' if every do-habit done (or only avoid
     habits, all clean), 'partial' if some done, 'none' otherwise. */
  function daySummary(habits, days, date) {
    const act = activeHabits(habits).filter(h => createdDay(h) <= date);
    if (!act.length) return 'empty';
    let done = 0, expected = 0, failed = 0;
    for (const h of act) {
      const s = status(days, date, h.id);
      if (s === 'failed') failed++;
      if (h.type === 'do') {
        expected++;
        if (s === 'done') done++;
      }
    }
    if (failed) return 'fail';
    if (expected === 0 || done === expected) return 'full';
    if (done > 0) return 'partial';
    return 'none';
  }

  // Monday of the week containing dateStr (heatmap rows align Mon–Sun)
  function mondayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
    return addDays(dateStr, -((dow + 6) % 7));
  }

  function urgesOn(days, date) {
    const e = days[date];
    return (e && e.urges) || [];
  }

  function moodOn(days, date) {
    const e = days[date];
    return (e && e.mood) || null;
  }

  // Earliest date with any meaning: first habit creation or first logged day
  function firstTrackedDay(habits, days) {
    const dates = habits.map(createdDay).concat(Object.keys(days)).filter(Boolean);
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  }

  /* Aggregate the last `span` days ending at endDate — feeds the weekly review. */
  function weeklyStats(habits, days, endDate, span = 7) {
    const act = activeHabits(habits);
    const dates = [];
    for (let i = span - 1; i >= 0; i--) dates.push(addDays(endDate, -i));

    const habitStats = act.map(h => {
      const created = createdDay(h);
      let done = 0, expected = 0;
      const failedDates = [], missedDates = [];
      for (const d of dates) {
        if (created > d) continue;
        const s = status(days, d, h.id);
        if (h.type === 'do') {
          expected++;
          if (s === 'done') done++;
          else if (s === 'failed') failedDates.push(d);
          else if (d !== endDate) missedDates.push(d); // today pending isn't a miss
        } else if (s === 'failed') {
          failedDates.push(d);
        }
      }
      return { habit: h, done, expected, failedDates, missedDates, streak: streak(h, days, endDate) };
    });

    let urgeTotal = 0;
    const urgeLog = [], moodLog = [];
    for (const d of dates) {
      for (const u of urgesOn(days, d)) {
        urgeTotal++;
        const h = habits.find(x => x.id === u.habitId);
        urgeLog.push({ date: d, habit: h ? h.name : 'unknown', note: u.note || '' });
      }
      const m = moodOn(days, d);
      if (m && (m.score || m.energy || m.note)) {
        moodLog.push({ date: d, score: m.score || null, energy: m.energy || null, note: m.note || '' });
      }
    }

    const avg = a => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
    const moodAvg = avg(moodLog.map(m => m.score).filter(Boolean));
    const energyAvg = avg(moodLog.map(m => m.energy).filter(Boolean));

    // urges/day on days a build-habit was missed vs done — the "more urges when you skip walking" signal
    const correlations = habitStats
      .filter(s => s.habit.type === 'do')
      .map(s => {
        let onMissed = 0, onDone = 0, missedN = 0, doneN = 0;
        for (const d of dates) {
          if (createdDay(s.habit) > d) continue;
          const st = status(days, d, s.habit.id);
          const n = urgesOn(days, d).length;
          if (st === 'done') { doneN++; onDone += n; }
          else if (d !== endDate) { missedN++; onMissed += n; }
        }
        return {
          habit: s.habit.name,
          missedDays: missedN,
          doneDays: doneN,
          urgesPerMissedDay: missedN ? +(onMissed / missedN).toFixed(2) : null,
          urgesPerDoneDay: doneN ? +(onDone / doneN).toFixed(2) : null,
        };
      });

    return { span, startDate: dates[0], endDate, habitStats, urgeTotal, urgeLog, moodLog, moodAvg, energyAvg, correlations };
  }

  return { todayStr, addDays, status, createdDay, activeHabits, streak, unlocked, progress, daySummary, mondayOf, urgesOn, moodOn, firstTrackedDay, weeklyStats };
})();

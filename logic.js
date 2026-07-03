/* logic.js — pure functions only (no DOM, no storage).
   Streaks and credit banks are always computed from the day log, never stored. */

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

  // Monday of the week containing dateStr (weekly habits + heatmap align Mon–Sun)
  function mondayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
    return addDays(dateStr, -((dow + 6) % 7));
  }

  /* Raw log value for a habit on a date:
     'failed' (avoid slip / explicit fail), 'done' (v1 check), a number
     (v2: completions for check habits, minutes for timed), or null. */
  function status(days, date, habitId) {
    const e = days[date];
    const v = e && e.habits ? e.habits[habitId] : null;
    return (v === undefined || v === null) ? null : v;
  }

  // Units logged on a date: completions (check) or minutes (timed). 'done' = 1.
  function amountOn(days, date, habitId) {
    const v = status(days, date, habitId);
    if (v === 'done') return 1;
    return (typeof v === 'number' && v > 0) ? v : 0;
  }

  function createdDay(habit) {
    return (habit.createdAt || '').slice(0, 10);
  }

  function activeHabits(habits) {
    return habits.filter(h => !h.archivedAt);
  }

  function goalOf(h) {
    return (typeof h.goal === 'number' && h.goal > 0) ? h.goal : 1;
  }
  function isWeekly(h) { return h.type === 'do' && h.per === 'week'; }
  function isTimed(h) { return h.type === 'do' && h.measure === 'minutes'; }

  // 'avoid': every day since creation (or since the last 'failed' day) is clean
  function avoidStreak(habit, days, today) {
    const created = createdDay(habit);
    if (!created || created > today) return 0;
    let count = 0;
    let d = today;
    while (d >= created) {
      if (status(days, d, habit.id) === 'failed') break;
      count++;
      d = addDays(d, -1);
    }
    return count;
  }

  /* The credit ledger — the heart of build habits.
     Walk every period (day or Mon–Sun week) since creation in order:
       - hitting the goal banks the surplus as credit,
       - falling short automatically spends credit to cover the gap,
       - short with an empty bank = a real miss (streak breaks there).
     An explicit 'failed' day is deliberate and is never covered by credit.
     The current period is pending: it counts once the goal is met, but an
     unfinished today/week never breaks anything.
     Returns { bank, streak, unit, statuses: {periodKey: 'done'|'covered'|'missed'|'failed'|'pending'},
               current: {amount, goal} } — all derived, nothing stored. */
  function ledger(h, days, today) {
    const goal = goalOf(h);
    const created = createdDay(h);
    if (h.type !== 'do' || !created || created > today) {
      return { bank: 0, streak: h.type === 'avoid' ? avoidStreak(h, days, today) : 0,
               unit: 'day', statuses: {}, current: { amount: 0, goal } };
    }

    let bank = 0;
    const statuses = {};
    const seq = [];

    if (h.per === 'week') {
      const thisMon = mondayOf(today);
      let mon = mondayOf(created);
      while (mon <= thisMon) {
        let amt = 0;
        for (let i = 0; i < 7; i++) {
          const d = addDays(mon, i);
          if (d >= created && d <= today) amt += amountOn(days, d, h.id);
        }
        let st;
        if (amt >= goal) { st = 'done'; bank += amt - goal; }
        else if (mon === thisMon) st = 'pending';
        else {
          const need = goal - amt;
          if (bank >= need) { bank -= need; st = 'covered'; }
          else st = 'missed';
        }
        statuses[mon] = st;
        seq.push({ key: mon, st, amt });
        mon = addDays(mon, 7);
      }
    } else {
      let d = created;
      while (d <= today) {
        const raw = status(days, d, h.id);
        const amt = amountOn(days, d, h.id);
        let st;
        if (raw === 'failed') st = 'failed';
        else if (amt >= goal) { st = 'done'; bank += amt - goal; }
        else if (d === today) st = 'pending';
        else {
          const need = goal - amt;
          if (bank >= need) { bank -= need; st = 'covered'; }
          else st = 'missed';
        }
        statuses[d] = st;
        seq.push({ key: d, st, amt });
        d = addDays(d, 1);
      }
    }

    let streak = 0;
    for (let i = seq.length - 1; i >= 0; i--) {
      const st = seq[i].st;
      if (st === 'pending') continue; // only ever the current period
      if (st === 'done' || st === 'covered') streak++;
      else break;
    }

    const cur = seq[seq.length - 1];
    return {
      bank, streak, statuses,
      unit: h.per === 'week' ? 'week' : 'day',
      current: { amount: cur ? cur.amt : 0, goal },
    };
  }

  function allLedgers(habits, days, today) {
    const map = {};
    for (const h of habits) map[h.id] = ledger(h, days, today);
    return map;
  }

  // Current streak (days for daily/quit habits, weeks for weekly habits)
  function streak(habit, days, today) {
    if (habit.type === 'avoid') return avoidStreak(habit, days, today);
    return ledger(habit, days, today).streak;
  }

  // All active habits at/over their milestone → rewards unlocked.
  function unlocked(habits, days, today) {
    const act = activeHabits(habits);
    return act.length > 0 && act.every(h => streak(h, days, today) >= h.milestone);
  }

  // Per-habit progress + overall days-to-unlock (weeks converted to days)
  function progress(habits, days, today) {
    const act = activeHabits(habits);
    const items = act.map(h => {
      const s = streak(h, days, today);
      const remaining = Math.max(0, h.milestone - s);
      return {
        habit: h,
        streak: s,
        unit: isWeekly(h) ? 'week' : 'day',
        ratio: h.milestone > 0 ? Math.min(1, s / h.milestone) : 1,
        remaining,
        remainingDays: remaining * (isWeekly(h) ? 7 : 1),
      };
    });
    const daysToUnlock = items.length ? Math.max(...items.map(i => i.remainingDays)) : null;
    const weakest = items.length
      ? items.reduce((a, b) => (b.remainingDays > a.remainingDays ? b : a))
      : null;
    return { items, daysToUnlock, weakest, unlocked: unlocked(habits, days, today) };
  }

  /* Summary of one calendar day for the strips/heatmap:
     'fail' if anything failed/slipped, 'full' if every daily build habit hit
     its goal (or was covered by credit), 'partial' if some, 'none' otherwise.
     Weekly habits only count positively (a golf-free Tuesday isn't a miss). */
  function daySummary(habits, days, date, ledgers) {
    const act = activeHabits(habits).filter(h => createdDay(h) <= date);
    if (!act.length) return 'empty';
    let done = 0, expected = 0, failed = 0;
    for (const h of act) {
      if (h.type === 'avoid') {
        if (status(days, date, h.id) === 'failed') failed++;
      } else if (isWeekly(h)) {
        if (amountOn(days, date, h.id) > 0) { expected++; done++; }
      } else {
        expected++;
        const led = ledgers && ledgers[h.id];
        const st = led ? led.statuses[date] : (amountOn(days, date, h.id) >= goalOf(h) ? 'done' : 'missed');
        if (st === 'done' || st === 'covered') done++;
        else if (st === 'failed') failed++;
      }
    }
    if (failed) return 'fail';
    if (expected === 0) return act.some(h => h.type === 'avoid') ? 'full' : 'none';
    if (done === expected) return 'full';
    if (done > 0) return 'partial';
    return 'none';
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
    const ledgers = allLedgers(act, days, endDate);

    const habitStats = act.map(h => {
      const created = createdDay(h);
      const led = ledgers[h.id];
      let done = 0, expected = 0, amount = 0;
      const failedDates = [], missedDates = [], coveredDates = [];

      if (h.type === 'avoid') {
        for (const d of dates) {
          if (created > d) continue;
          if (status(days, d, h.id) === 'failed') failedDates.push(d);
        }
      } else if (isWeekly(h)) {
        for (const d of dates) amount += amountOn(days, d, h.id);
      } else {
        for (const d of dates) {
          if (created > d) continue;
          expected++;
          amount += amountOn(days, d, h.id);
          const st = led.statuses[d];
          if (st === 'done') done++;
          else if (st === 'covered') { done++; coveredDates.push(d); }
          else if (st === 'failed') failedDates.push(d);
          else if (st === 'missed') missedDates.push(d);
        }
      }

      return {
        habit: h, done, expected, amount,
        failedDates, missedDates, coveredDates,
        streak: led.streak, bank: led.bank,
        weekAmount: led.current.amount, goal: goalOf(h),
      };
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

    // urges/day on days a daily build habit was missed vs done
    const correlations = habitStats
      .filter(s => s.habit.type === 'do' && !isWeekly(s.habit))
      .map(s => {
        const led = ledgers[s.habit.id];
        let onMissed = 0, onDone = 0, missedN = 0, doneN = 0;
        for (const d of dates) {
          if (createdDay(s.habit) > d) continue;
          const st = led.statuses[d];
          const n = urgesOn(days, d).length;
          if (st === 'done' || st === 'covered') { doneN++; onDone += n; }
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

  return { todayStr, addDays, status, amountOn, createdDay, activeHabits, goalOf, isWeekly, isTimed,
           ledger, allLedgers, streak, unlocked, progress, daySummary, mondayOf, urgesOn, moodOn,
           firstTrackedDay, weeklyStats };
})();

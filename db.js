/* db.js — state persistence: load / save / migrate / export / import.
   Single versioned JSON object in localStorage. */

const EarnDB = (() => {
  const KEY = 'earnit_state';
  const VERSION = 3; // v3: habits gained breaks[]; rewards gained badge (day-threshold); milestone retired

  function defaults() {
    return { version: VERSION, habits: [], days: {}, rewards: [], reviews: [], settings: {} };
  }

  // v1 habits were all check-off daily habits; v2 added measure/per/goal; v3 added breaks.
  function migrateHabit(h) {
    return {
      ...h,
      measure: h.measure === 'minutes' ? 'minutes' : 'check',
      per: h.per === 'week' ? 'week' : 'day',
      goal: (typeof h.goal === 'number' && h.goal > 0) ? h.goal : 1,
      breaks: Array.isArray(h.breaks) ? h.breaks : [],
    };
  }

  // v3 rewards carry a badge requirement (in days); older rewards default to ⚡ 21 days.
  function migrateReward(r) {
    return { ...r, badge: (typeof r.badge === 'number' && r.badge > 0) ? r.badge : 21 };
  }

  // Fill any missing top-level fields; future schema bumps hook in here.
  function migrate(s) {
    if (!s || typeof s !== 'object') return defaults();
    const d = defaults();
    return {
      version: VERSION,
      habits: Array.isArray(s.habits) ? s.habits.map(migrateHabit) : d.habits,
      days: (s.days && typeof s.days === 'object') ? s.days : d.days,
      rewards: Array.isArray(s.rewards) ? s.rewards.map(migrateReward) : d.rewards,
      reviews: Array.isArray(s.reviews) ? s.reviews : d.reviews,
      settings: (s.settings && typeof s.settings === 'object') ? s.settings : d.settings,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.error('EarnIt: could not load state, starting fresh', e);
      return defaults();
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function exportDownload(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `earnit-backup-${EarnLogic.todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Parse + validate an imported backup; returns migrated state or throws.
  function parseImport(text) {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object') throw new Error('Not a valid backup file.');
    if (s.version > VERSION) throw new Error(`Backup is from a newer app version (v${s.version}).`);
    if (!Array.isArray(s.habits)) throw new Error('Backup is missing habit data.');
    return migrate(s);
  }

  return { load, save, defaults, exportDownload, parseImport, KEY, VERSION };
})();

// Настройки живут в localStorage, запись маминого голоса — в IndexedDB.
// Всё хранится только на этом телефоне.

const SETTINGS_KEY = 'nightlight.settings.v1';

export const DEFAULTS = {
  color: '#FFBE5C',
  brightness: 0.1,
  effect: 'steady',
  showClock: true,
  noise: 'white',
  music: null,
  noiseVolume: 0.45,
  musicVolume: 0.4,
  timerMinutes: 30,
  timerStopsSound: true,
  timerStopsLight: false,
  cryWake: false,
  crySensitivity: 0.5,
  cryRestartMinutes: 15,
  babyName: '',
  babyBirth: '',
  babyGirl: true,
  // Свои колыбельные: [{ id, name }]; сами записи лежат в IndexedDB.
  userTracks: [],
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { /* приватный режим — просто не запоминаем */ }
}

export function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* нет места или приватный режим */ }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('nightlight', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export const files = {
  get: (key) => tx('readonly', (s) => s.get(key)).catch(() => null),
  put: (key, value) => tx('readwrite', (s) => s.put(value, key)),
  remove: (key) => tx('readwrite', (s) => s.delete(key)),
};

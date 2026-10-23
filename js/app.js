import { SoundEngine, NOISES, MELODIES, soundName } from './sound.js';
import { loadSettings, saveSettings, files } from './store.js';
import { KeepAwake } from './wake.js';
import { CryListener, VoiceRecorder, decodeVoice, micSupported, recorderSupported } from './mic.js';
import { Journal, ageInfo, fmtTimer } from './journal.js';

const PRESETS = [
  { name: 'Тёплый жёлтый', color: '#FFBE5C' },
  { name: 'Янтарный', color: '#FF9838' },
  { name: 'Красный', color: '#FF3D1F' },
  { name: 'Персик', color: '#FFA184' },
  { name: 'Розовый', color: '#FF8DB4' },
  { name: 'Лаванда', color: '#C3A2FF' },
  { name: 'Мята', color: '#97E6C4' },
  { name: 'Небо', color: '#8CCBFF' },
  { name: 'Молочный', color: '#FFE6C7' },
];

const EFFECT_HINTS = {
  steady: 'Ровный мягкий свет.',
  breathe: 'Свет медленно дышит — шесть вдохов в минуту. Подстройте под него своё дыхание: спокойствие мамы передаётся малышу.',
  candle: 'Тёплое живое мерцание, как от свечи.',
  stars: 'Неяркие звёзды тихо мерцают поверх света.',
};

const TIMER_OPTIONS = [
  { min: 15, label: '15 мин' },
  { min: 30, label: '30 мин' },
  { min: 45, label: '45 мин' },
  { min: 60, label: '1 час' },
  { min: 90, label: '1,5 часа' },
  { min: 0, label: 'Без таймера' },
];
const CRY_OPTIONS = [10, 15, 30];
const SOUND_FADE_MS = 60 * 1000;
const LIGHT_FADE_MS = 2 * 60 * 1000;
const TAU = Math.PI * 2;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const settings = loadSettings();
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 250);
}

// ---------- Всплывающие сообщения ----------

const toastEl = $('#toast');
let toastTimer = null;
function toast(text, actionLabel, action) {
  toastEl.querySelector('.toast-text').textContent = text;
  const btn = toastEl.querySelector('.toast-action');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => {
    toastEl.hidden = true;
    if (action) action();
  };
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, actionLabel ? 6000 : 3500);
}

const hudEl = $('#hud');
let hudTimer = null;
function hud(text) {
  hudEl.textContent = text;
  hudEl.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hudEl.classList.remove('show'), 1100);
}

// ---------- Цвет интерфейса подстраивается под цвет ночника ----------

const hexToRgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Оттенок ночника с заданной яркостью: тёмный — затемняем, тусклый — подмешиваем белый.
function shade(rgb, target) {
  const mix = (t) => (t <= 0
    ? rgb.map((c) => c * (1 + t))
    : rgb.map((c) => c + (255 - c) * t));
  let lo = -1, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(mix(mid)) > target) hi = mid; else lo = mid;
  }
  return `rgb(${mix(lo).map((c) => Math.round(Math.max(0, Math.min(255, c)))).join(',')})`;
}

function applyTheme() {
  const rgb = hexToRgb(settings.color);
  const root = document.documentElement.style;
  root.setProperty('--lamp', settings.color);
  root.setProperty('--ink-hi', shade(rgb, 0.62));
  root.setProperty('--ink', shade(rgb, 0.36));
  root.setProperty('--ink-2', shade(rgb, 0.17));
  root.setProperty('--ink-3', shade(rgb, 0.07));
  root.setProperty('--line', `rgba(${rgb.join(',')}, 0.2)`);
  root.setProperty('--tint', `rgba(${rgb.join(',')}, 0.12)`);
  root.setProperty('--star', shade(rgb, 0.6));
}

// ---------- Ночник ----------

const glow = $('#lampGlow');
const starsCanvas = $('#stars');
const lamp = { on: true, fade: 1, raf: null, flicker: 1, flickerTarget: 1, flickerAt: 0 };
let stars = [];

function lampLevel(t) {
  if (!lamp.on) return 0;
  let b = settings.brightness * lamp.fade;
  if (settings.effect === 'breathe') {
    b *= 0.7 + 0.3 * (0.5 - 0.5 * Math.cos((TAU * t) / 10000));
  } else if (settings.effect === 'candle') {
    if (t > lamp.flickerAt) {
      lamp.flickerTarget = Math.random() < 0.1 ? 0.72 + Math.random() * 0.1 : 0.86 + Math.random() * 0.14;
      lamp.flickerAt = t + 60 + Math.random() * 160;
    }
    lamp.flicker += (lamp.flickerTarget - lamp.flicker) * 0.12;
    b *= lamp.flicker;
  }
  return b;
}

function sizeStars() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  starsCanvas.width = Math.round(innerWidth * dpr);
  starsCanvas.height = Math.round(innerHeight * dpr);
  const count = Math.round((innerWidth * innerHeight) / 9000);
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * starsCanvas.width,
    y: Math.random() * starsCanvas.height,
    r: (0.5 + Math.random() * 1.3) * dpr,
    phase: Math.random() * TAU,
    speed: 0.0004 + Math.random() * 0.0012,
  }));
}

let lastStarsDraw = 0;
function drawStars(t) {
  if (t - lastStarsDraw < 50) return;
  lastStarsDraw = t;
  const c = starsCanvas.getContext('2d');
  c.clearRect(0, 0, starsCanvas.width, starsCanvas.height);
  if (!lamp.on) return;
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--star');
  const base = Math.min(1, settings.brightness * 3 + 0.12) * lamp.fade;
  for (const s of stars) {
    c.globalAlpha = base * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase)));
    c.beginPath();
    c.arc(s.x, s.y, s.r, 0, TAU);
    c.fill();
  }
}

function frame(t) {
  glow.style.opacity = lampLevel(t).toFixed(4);
  if (settings.effect === 'stars') drawStars(t);
  const animated = lamp.on && settings.effect !== 'steady';
  lamp.raf = animated ? requestAnimationFrame(frame) : null;
}

function renderLamp() {
  document.body.dataset.effect = settings.effect;
  starsCanvas.hidden = settings.effect !== 'stars';
  if (!lamp.raf) lamp.raf = requestAnimationFrame(frame);
}

function setLightOn(on) {
  lamp.on = on;
  if (on) lamp.fade = 1;
  $('#lightOn').checked = on;
  document.body.classList.toggle('lamp-off', !on);
  renderLamp();
  updateFace();
}

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function setBrightness(value, announce) {
  settings.brightness = Math.max(0.01, Math.min(1, value));
  const pct = Math.round(settings.brightness * 100);
  const input = $('#brightness');
  input.value = pct;
  updateRangeFill(input);
  $('#brightnessOut').textContent = `${pct}%`;
  document.body.classList.toggle('bright-lamp', settings.brightness > 0.45);
  if (!lamp.on) setLightOn(true);
  renderLamp();
  persist();
  if (announce) hud(`Яркость ${pct}%`);
}

function setColor(color, announceName) {
  settings.color = color;
  applyTheme();
  $$('#swatches .swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === color)));
  const custom = $('#customColor');
  const isPreset = PRESETS.some((p) => p.color === color);
  custom.closest('.swatch').setAttribute('aria-checked', String(!isPreset));
  if (!isPreset) custom.value = color.toLowerCase();
  if (!lamp.on) setLightOn(true);
  renderLamp();
  persist();
  if (announceName) hud(announceName);
}

function setEffect(effect) {
  settings.effect = effect;
  $$('#effects button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.effect === effect)));
  $('#effectHint').textContent = EFFECT_HINTS[effect];
  renderLamp();
  persist();
}

function buildLightPanel() {
  const wrap = $('#swatches');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = p.color;
    b.setAttribute('role', 'radio');
    b.style.setProperty('--c', p.color);
    b.innerHTML = `<span class="swatch-dot"></span><span class="swatch-name">${p.name}</span>`;
    b.addEventListener('click', () => setColor(p.color));
    wrap.appendChild(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.setAttribute('role', 'radio');
  custom.innerHTML = '<span class="swatch-dot"><input type="color" id="customColor" aria-label="Свой цвет"></span><span class="swatch-name">Свой цвет</span>';
  wrap.appendChild(custom);
  $('#customColor').addEventListener('input', (e) => setColor(e.target.value.toUpperCase()));

  $('#brightness').addEventListener('input', (e) => setBrightness(Number(e.target.value) / 100));
  $('#lightOn').addEventListener('change', (e) => setLightOn(e.target.checked));
  $$('#effects button').forEach((b) => b.addEventListener('click', () => setEffect(b.dataset.effect)));
  const clock = $('#showClock');
  clock.checked = settings.showClock;
  clock.addEventListener('change', () => {
    settings.showClock = clock.checked;
    persist();
    updateFace();
  });
}

// ---------- Жесты на свету: вверх-вниз — яркость, вбок — цвет, касание — кнопки ----------

function bindGestures() {
  const surface = $('#lamp');
  let g = null;
  surface.addEventListener('pointerdown', (e) => {
    g = { x: e.clientX, y: e.clientY, t: Date.now(), b: settings.brightness, mode: null, id: e.pointerId };
    surface.setPointerCapture(e.pointerId);
  });
  surface.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) g.mode = 'bright';
      else if (Math.abs(dx) > 14) g.mode = 'color';
    }
    if (g.mode === 'bright') setBrightness(g.b - dy / (innerHeight * 0.7), true);
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    if (!g.mode && Date.now() - g.t < 500) onLampTap();
    if (g.mode === 'color' && Math.abs(dx) > 50) {
      let i = PRESETS.findIndex((p) => p.color === settings.color);
      i = (i + (dx < 0 ? 1 : -1) + PRESETS.length) % PRESETS.length;
      setColor(PRESETS[i].color, PRESETS[i].name);
    }
    g = null;
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', () => { g = null; });
}

function onLampTap() {
  if (!lamp.on) setLightOn(true);
  else if (sheetOpen) closeSheet();
}

// ---------- Нижняя панель ----------

let sheetTimer = null;
let sheetOpen = null;

// Открытая шторка сама закрывается через минуту, чтобы не заслонять свет.
function poke() {
  clearTimeout(sheetTimer);
  if (!sheetOpen) return;
  sheetTimer = setTimeout(() => {
    if (!recorder.recording) closeSheet();
  }, 60000);
}

function openSheet(name) {
  sheetOpen = name;
  const sheet = $('#sheet');
  sheet.classList.add('open');
  sheet.removeAttribute('inert');
  $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  sheet.scrollTop = 0;
  document.body.classList.add('sheet-open');
  if (name === 'baby') renderJournal();
  poke();
}

function closeSheet() {
  sheetOpen = null;
  const sheet = $('#sheet');
  sheet.classList.remove('open');
  sheet.setAttribute('inert', '');
  document.body.classList.remove('sheet-open');
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
  poke();
}

function bindChrome() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    if (sheetOpen === t.dataset.tab) closeSheet();
    else openSheet(t.dataset.tab);
  }));
  $('#chrome').addEventListener('pointerdown', poke);
  $('#chrome').addEventListener('input', (e) => {
    if (e.target.type === 'range') updateRangeFill(e.target);
    poke();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen) closeSheet();
  });

  // На iPhone браузер не умеет во весь экран — там переключатель скрыт.
  if (document.fullscreenEnabled) {
    const fs = $('#fullscreen');
    $('#fullscreenRow').hidden = false;
    fs.addEventListener('change', () => {
      if (fs.checked) document.documentElement.requestFullscreen().catch(() => { fs.checked = false; });
      else if (document.fullscreenElement) document.exitFullscreen();
    });
    document.addEventListener('fullscreenchange', () => { fs.checked = Boolean(document.fullscreenElement); });
  }
}

// ---------- Звуки ----------

const engine = new SoundEngine();
engine.layers.noise.id = settings.noise;
engine.layers.music.id = settings.music === 'voice' ? null : settings.music;
engine.layers.noise.volume = settings.noiseVolume;
engine.layers.music.volume = settings.musicVolume;

const keepAwake = new KeepAwake($('#keepAwake'));
const listener = new CryListener(engine);
const recorder = new VoiceRecorder();
let listening = false;

async function startSound({ fromCry = false } = {}) {
  stopListening();
  if (!engine.hasSelection()) {
    settings.noise = settings.noise || 'white';
    engine.setLayer('noise', settings.noise);
    persist();
  }
  keepAwake.enable();
  await engine.play(fromCry ? 5 : 3);
  if (fromCry) startTimer(settings.cryRestartMinutes);
  else if (settings.timerMinutes && !timer.endAt) startTimer(settings.timerMinutes);
}

function stopSound() {
  engine.stop(1.5);
  stopListening();
  if (timer.endAt && !settings.timerStopsLight) cancelTimer();
}

function selectSound(layer, id) {
  if (id === 'voice' && !engine.voiceBuffer) {
    toast('Сначала запишите голос — кнопка ниже');
    $('#recordBtn').focus();
    return;
  }
  const next = settings[layer] === id ? null : id;
  settings[layer] = next;
  persist();
  engine.setLayer(layer, next);
  if (next && !engine.playing) startSound();
}

function buildChips(container, list, layer) {
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = s.id;
    b.textContent = s.name;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => selectSound(layer, s.id));
    container.appendChild(b);
  }
}

function playingTitle() {
  const names = [engine.current('noise'), engine.current('music')].filter(Boolean).map(soundName);
  return names.join(' и ');
}

function updateSoundUI() {
  $$('#noiseChips .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === settings.noise)));
  $$('#musicChips .chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.id === settings.music));
    if (b.dataset.id === 'voice') b.classList.toggle('empty', !engine.voiceBuffer);
  });
  const play = $('#playBtn');
  play.setAttribute('aria-label', engine.playing ? 'Выключить звук' : 'Включить звук');
  play.querySelector('use').setAttribute('href', engine.playing ? '#i-pause' : '#i-play');
  play.classList.toggle('on', engine.playing);
  document.body.classList.toggle('sound-loading', engine.loading > 0);
  updatePill();
}

function updatePill() {
  const pill = $('#nowPlaying');
  const show = engine.playing || listening || Boolean(timer.endAt);
  pill.hidden = !show;
  if (!show) return;
  let text;
  if (engine.playing) text = engine.loading > 0 ? 'Готовлю звук…' : playingTitle();
  else if (listening) text = 'Слушаю малыша';
  else text = 'Таймер';
  pill.querySelector('.np-text').textContent = text;
  pill.querySelector('.np-timer').textContent = timer.endAt ? fmtTimer(timer.endAt - Date.now()) : '';
  pill.querySelector('use').setAttribute('href', engine.playing ? '#i-pause' : (listening ? '#i-mic' : '#i-play'));
  pill.setAttribute('aria-label', engine.playing ? `Выключить: ${text}` : (listening ? 'Перестать слушать' : 'Включить звук'));
}

function bindSoundPanel() {
  buildChips($('#noiseChips'), NOISES, 'noise');
  buildChips($('#musicChips'), MELODIES, 'music');
  $('#playBtn').addEventListener('click', () => (engine.playing ? stopSound() : startSound()));
  $('#nowPlaying').addEventListener('click', () => {
    if (engine.playing) stopSound();
    else if (listening) {
      stopListening();
      toast('Больше не слушаю');
    } else startSound();
  });

  for (const layer of ['noise', 'music']) {
    const input = $(`#${layer}Volume`);
    const out = $(`#${layer}VolumeOut`);
    const key = `${layer}Volume`;
    input.value = Math.round(settings[key] * 100);
    out.textContent = `${input.value}%`;
    input.addEventListener('input', () => {
      settings[key] = Number(input.value) / 100;
      out.textContent = `${input.value}%`;
      engine.setVolume(layer, settings[key]);
      persist();
    });
  }

  if (!recorderSupported()) {
    $('#voiceBox').hidden = true;
    const voiceChip = $('#musicChips .chip[data-id="voice"]');
    if (voiceChip) voiceChip.hidden = true;
  }
  $('#recordBtn').addEventListener('click', toggleRecording);
  $('#deleteVoiceBtn').addEventListener('click', async () => {
    await files.remove('voice').catch(() => {});
    engine.setVoice(null);
    if (settings.music === 'voice') {
      settings.music = null;
      persist();
      engine.setLayer('music', null);
    }
    updateVoiceUI();
    toast('Запись удалена');
  });
  engine.onchange = updateSoundUI;
}

// ---------- Мамин голос ----------

let recTicker = null;
async function toggleRecording() {
  if (recorder.recording) {
    recorder.stop();
    return;
  }
  if (engine.playing) stopSound();
  stopListening();
  try {
    await recorder.start(180, onRecorded);
  } catch (e) {
    toast('Нет доступа к микрофону. Разрешите его в настройках браузера.');
    return;
  }
  const label = $('#recordBtn span');
  $('#recordBtn').classList.add('recording');
  recTicker = setInterval(() => {
    label.textContent = `Остановить ${fmtTimer(Date.now() - recorder.startedAt)}`;
    poke();
  }, 250);
}

async function onRecorded(blob) {
  clearInterval(recTicker);
  $('#recordBtn').classList.remove('recording');
  let buf = null;
  try {
    buf = await decodeVoice(engine.ensureContext(), blob);
  } catch (e) {
    toast('Не получилось прочитать запись. Попробуйте ещё раз.');
  }
  if (buf && buf.duration < 2.5) {
    toast('Почти ничего не слышно. Запишите погромче или подольше.');
  } else if (buf) {
    await files.put('voice', blob).catch(() => {});
    engine.setVoice(buf);
    settings.music = null;
    selectSound('music', 'voice');
    toast('Голос записан и уже звучит');
  }
  updateVoiceUI();
}

function updateVoiceUI() {
  const has = Boolean(engine.voiceBuffer);
  $('#recordBtn span').textContent = has ? 'Записать заново' : 'Записать голос';
  $('#deleteVoiceBtn').hidden = !has;
  updateSoundUI();
}

async function restoreVoice() {
  const blob = await files.get('voice');
  if (!blob) return;
  try {
    engine.setVoice(await decodeVoice(engine.ensureContext(), blob));
    if (settings.music === 'voice') engine.layers.music.id = 'voice';
  } catch (e) { /* запись повреждена — просто не показываем */ }
  updateVoiceUI();
}

// ---------- Таймер сна ----------

const timer = { endAt: null, soundFading: false };

function startTimer(min) {
  if (!min) return;
  timer.endAt = Date.now() + min * 60000;
  timer.soundFading = false;
  engine.restoreLevel();
  lamp.fade = 1;
  renderLamp();
  tick();
}

function cancelTimer() {
  timer.endAt = null;
  if (timer.soundFading) engine.restoreLevel();
  timer.soundFading = false;
  lamp.fade = 1;
  renderLamp();
  tick();
}

function finishTimer() {
  timer.endAt = null;
  timer.soundFading = false;
  let stopped = false;
  if (settings.timerStopsSound && engine.playing) {
    engine.stop(0.3);
    stopped = true;
  }
  if (settings.timerStopsLight) setLightOn(false);
  if (settings.cryWake && stopped) startListening();
}

function tickTimer(now) {
  if (!timer.endAt) return;
  const left = timer.endAt - now;
  if (settings.timerStopsSound && engine.playing && !timer.soundFading && left <= SOUND_FADE_MS) {
    engine.fadeOut(Math.max(0.5, left / 1000));
    timer.soundFading = true;
  }
  if (settings.timerStopsLight && lamp.on) {
    lamp.fade = Math.max(0, Math.min(1, left / LIGHT_FADE_MS));
    renderLamp();
  }
  if (left <= 0) finishTimer();
}

function updateTimerUI() {
  $$('#timerChips .chip').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.min) === settings.timerMinutes)));
  $$('#cryRestartChips .chip').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.min) === settings.cryRestartMinutes)));
  const left = $('#timerLeft');
  left.textContent = timer.endAt ? fmtTimer(timer.endAt - Date.now()) : '';
  let hint;
  if (timer.endAt) hint = 'Таймер идёт. Выберите другое время, чтобы начать отсчёт заново.';
  else if (settings.timerMinutes) hint = 'Отсчёт начнётся, когда включится звук.';
  else if (settings.cryWake) hint = 'Выберите время: слушать малыша ночник начнёт, когда таймер выключит звук.';
  else hint = 'Звук и свет будут работать, пока вы их не выключите.';
  $('#timerHint').textContent = hint;
  $('#cryOptions').classList.toggle('disabled', !settings.cryWake);
  $('#listenStatus').hidden = !listening;
}

function bindTimerPanel() {
  const chips = $('#timerChips');
  for (const o of TIMER_OPTIONS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.min = o.min;
    b.textContent = o.label;
    b.addEventListener('click', () => {
      settings.timerMinutes = o.min;
      persist();
      if (!o.min) cancelTimer();
      else if (engine.playing || timer.endAt || settings.timerStopsLight) startTimer(o.min);
      updateTimerUI();
    });
    chips.appendChild(b);
  }
  const cryChips = $('#cryRestartChips');
  for (const min of CRY_OPTIONS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.min = min;
    b.textContent = `${min} мин`;
    b.addEventListener('click', () => {
      settings.cryRestartMinutes = min;
      persist();
      updateTimerUI();
    });
    cryChips.appendChild(b);
  }

  for (const id of ['timerStopsSound', 'timerStopsLight']) {
    const input = $(`#${id}`);
    input.checked = settings[id];
    input.addEventListener('change', () => {
      settings[id] = input.checked;
      persist();
      if (id === 'timerStopsLight' && !input.checked) {
        lamp.fade = 1;
        renderLamp();
      }
      if (id === 'timerStopsSound' && !input.checked && timer.soundFading) {
        timer.soundFading = false;
        engine.restoreLevel();
      }
    });
  }

  const cry = $('#cryWake');
  if (!micSupported()) {
    cry.disabled = true;
    $('#cryUnsupported').hidden = false;
  }
  cry.checked = settings.cryWake;
  cry.addEventListener('change', async () => {
    settings.cryWake = cry.checked;
    persist();
    if (cry.checked) {
      // Спрашиваем разрешение сразу, пока мама держит телефон в руках.
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        engine.unlock();
        if (!settings.timerStopsSound) {
          settings.timerStopsSound = true;
          $('#timerStopsSound').checked = true;
        }
      } catch (e) {
        cry.checked = false;
        settings.cryWake = false;
        persist();
        toast('Нет доступа к микрофону. Разрешите его в настройках браузера.');
      }
    } else {
      stopListening();
    }
    updateTimerUI();
  });

  const sens = $('#crySensitivity');
  const sensOut = $('#crySensOut');
  const sensLabel = (v) => (v < 0.34 ? 'низкая' : v < 0.67 ? 'средняя' : 'высокая');
  sens.value = Math.round(settings.crySensitivity * 100);
  sensOut.textContent = sensLabel(settings.crySensitivity);
  sens.addEventListener('input', () => {
    settings.crySensitivity = Number(sens.value) / 100;
    sensOut.textContent = sensLabel(settings.crySensitivity);
    persist();
  });
}

async function startListening() {
  if (!micSupported() || listening) return;
  try {
    await listener.start({
      sensitivity: settings.crySensitivity,
      onLevel: (v) => { $('#micLevel').style.transform = `scaleX(${v.toFixed(3)})`; },
      onCry: () => {
        listening = false;
        journal.logCry();
        startSound({ fromCry: true });
        const who = settings.babyName.trim() || journal.word('Малышка', 'Малыш');
        toast(`${who} ${journal.word('проснулась', 'проснулся')} — звук включён на ${settings.cryRestartMinutes} мин`);
        tick();
      },
    });
    listening = true;
  } catch (e) {
    listening = false;
    toast('Не получилось включить микрофон, чтобы слушать малыша.');
  }
  tick();
}

function stopListening() {
  if (!listening && !listener.active) return;
  listener.stop();
  listening = false;
  tick();
}

// ---------- Малыш ----------

const journal = new Journal({
  getSettings: () => settings,
  toast,
  onChange: () => {
    renderJournal();
    updateFace();
  },
});

function renderJournal() {
  if (sheetOpen !== 'baby') return;
  const live = $('#journalLive');
  // Не перерисовываем, пока мама правит время.
  if (live.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  journal.render(live);
}

function updateBabyHeader() {
  const name = settings.babyName.trim();
  $('#babyTitle').textContent = name || 'Малыш';
  const age = ageInfo(settings.babyBirth);
  $('#babyAge').textContent = age ? `${age.label}${age.norm ? `, сон ${age.norm.sleep} в сутки` : ''}` : '';
  $$('#babyGender button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.girl === '1') === settings.babyGirl)));
  $('[data-tab="baby"] span').textContent = name || 'Малыш';
}

function bindBabyPanel() {
  const live = $('#journalLive');
  live.addEventListener('click', (e) => {
    if (journal.handle(e.target)) poke();
  });
  live.addEventListener('change', (e) => {
    const id = e.target.dataset.editStart;
    if (id) {
      journal.editStart(id, e.target.value);
      e.target.blur();
    }
  });
  const name = $('#babyName');
  name.value = settings.babyName;
  name.addEventListener('input', () => {
    settings.babyName = name.value.slice(0, 30);
    persist();
    updateBabyHeader();
  });
  const birth = $('#babyBirth');
  birth.value = settings.babyBirth;
  birth.max = new Date().toISOString().slice(0, 10);
  birth.addEventListener('change', () => {
    settings.babyBirth = birth.value;
    persist();
    updateBabyHeader();
    renderJournal();
  });
  $$('#babyGender button').forEach((b) => b.addEventListener('click', () => {
    settings.babyGirl = b.dataset.girl === '1';
    persist();
    updateBabyHeader();
    renderJournal();
  }));
}

// ---------- Часы и статус на экране ----------

const pad = (n) => String(n).padStart(2, '0');
let lastMinute = -1;

function updateFace() {
  const face = $('#face');
  face.hidden = !settings.showClock;
  const now = new Date();
  $('#clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  // Раз в минуту чуть сдвигаем часы, чтобы не «выжигать» экран.
  if (now.getMinutes() !== lastMinute) {
    lastMinute = now.getMinutes();
    face.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 24)}px`);
    face.style.setProperty('--dy', `${Math.round((Math.random() - 0.5) * 32)}px`);
  }
  const lines = [];
  if (timer.endAt) lines.push(`Таймер ${fmtTimer(timer.endAt - now.getTime())}`);
  if (listening) lines.push('Слушаю малыша');
  const status = journal.faceStatus(now.getTime());
  if (status) lines.push(status);
  if (!lamp.on) lines.push('Коснитесь экрана, чтобы включить свет');
  $('#faceStatus').innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
}

let lastJournalRender = 0;
function tick() {
  const now = Date.now();
  tickTimer(now);
  updateFace();
  updatePill();
  if (sheetOpen === 'timer') updateTimerUI();
  if (sheetOpen === 'baby' && now - lastJournalRender > 1000) {
    lastJournalRender = now;
    renderJournal();
  }
}

// ---------- Запуск ----------

function firstRunHint() {
  try {
    if (localStorage.getItem('nightlight.seen')) return;
    localStorage.setItem('nightlight.seen', '1');
  } catch (e) {
    return;
  }
  setTimeout(() => toast('Ведите пальцем по свету вверх или вниз — меняется яркость, в сторону — цвет.'), 900);
}

function init() {
  applyTheme();
  buildLightPanel();
  bindGestures();
  bindChrome();
  bindSoundPanel();
  bindTimerPanel();
  bindBabyPanel();

  setColor(settings.color);
  setBrightness(settings.brightness);
  setEffect(settings.effect);
  setLightOn(true);
  updateBabyHeader();
  updateSoundUI();
  updateVoiceUI();
  updateTimerUI();
  $$('input[type="range"]').forEach(updateRangeFill);
  sizeStars();
  addEventListener('resize', sizeStars);

  // Первое касание: держим экран включённым и готовим звук.
  const firstTouch = () => {
    keepAwake.enable();
    engine.prepare();
    removeEventListener('pointerdown', firstTouch, true);
  };
  addEventListener('pointerdown', firstTouch, true);
  keepAwake.enable();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      engine.revive();
      tick();
    }
  });

  restoreVoice();
  setInterval(tick, 1000);
  tick();
  poke();
  firstRunHint();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Новая версия подхватывается сразу, если сейчас ничего не играет.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !engine.playing && !listening && !recorder.recording) location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

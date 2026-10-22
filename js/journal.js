// Дневник малыша: сон, кормления, подгузники и окна бодрствования.

import { loadJSON, saveJSON } from './store.js';

const KEY = 'nightlight.journal.v1';
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 45;

const SIDES = { L: 'левая', R: 'правая', B: 'бутылочка' };
const DIAPERS = { wet: 'мокрый', dirty: 'грязный' };

// Ориентиры по возрасту (месяцы): окно бодрствования в минутах и норма сна за сутки.
// Источники: рекомендации AASM и NSF по сну, распространённые таблицы окон бодрствования.
const AGE_NORMS = [
  { months: 1, wake: [35, 60], sleep: '14–17 ч' },
  { months: 3, wake: [60, 90], sleep: '14–17 ч' },
  { months: 4, wake: [75, 120], sleep: '14–17 ч' },
  { months: 5, wake: [75, 120], sleep: '12–16 ч' },
  { months: 7, wake: [120, 180], sleep: '12–16 ч' },
  { months: 10, wake: [150, 210], sleep: '12–16 ч' },
  { months: 12, wake: [180, 240], sleep: '12–16 ч' },
  { months: 14, wake: [180, 240], sleep: '11–14 ч' },
  { months: 24, wake: [240, 360], sleep: '11–14 ч' },
  { months: 36, wake: [300, 360], sleep: '10–13 ч' },
];

export const pad = (n) => String(n).padStart(2, '0');

export function fmtClock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDur(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return 'меньше минуты';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function fmtTimer(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function ago(ms) {
  return ms < 60000 ? 'Только что' : `${fmtDur(ms)} назад`;
}

function fmtMinutes(min) {
  return fmtDur(min * 60000);
}

export function ageInfo(birth, now = Date.now()) {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00`);
  if (Number.isNaN(b.getTime()) || b.getTime() > now) return null;
  const days = Math.floor((now - b.getTime()) / DAY);
  const n = new Date(now);
  let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) months--;
  let label;
  if (days < 14) label = `${days} дн.`;
  else if (months < 2) label = `${Math.floor(days / 7)} нед.`;
  else if (months < 24) label = `${months} мес.`;
  else label = `${Math.floor(months / 12)} г. ${months % 12 ? `${months % 12} мес.` : ''}`.trim();
  const exactMonths = days / 30.44;
  const norm = AGE_NORMS.find((r) => exactMonths < r.months) || null;
  return { days, months, label, norm };
}

let uid = Date.now();
const newId = () => (uid++).toString(36);

export class Journal {
  constructor({ getSettings, toast, onChange }) {
    this.getSettings = getSettings;
    this.toast = toast;
    this.onChange = onChange || (() => {});
    this.events = loadJSON(KEY, []);
    const cutoff = Date.now() - KEEP_DAYS * DAY;
    this.events = this.events.filter((e) => (e.end || e.start) > cutoff || !e.end);
  }

  save() {
    this.events.sort((a, b) => a.start - b.start);
    saveJSON(KEY, this.events);
    this.onChange();
  }

  word(girl, boy) {
    return this.getSettings().babyGirl ? girl : boy;
  }

  active(type) {
    return this.events.find((e) => e.type === type && e.end == null) || null;
  }

  last(type, filter = () => true) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.type === type && filter(e)) return e;
    }
    return null;
  }

  add(ev) {
    const e = { id: newId(), ...ev };
    this.events.push(e);
    this.save();
    return e;
  }

  finish(type) {
    const e = this.active(type);
    if (e) {
      e.end = Date.now();
      this.save();
    }
    return e;
  }

  startFeed(side) {
    const current = this.active('feed');
    if (current && current.side === side) return;
    if (current) current.end = Date.now();
    // Если малыш спал, кормление означает, что он проснулся.
    this.finish('sleep');
    this.add({ type: 'feed', side, start: Date.now(), end: null });
  }

  startSleep() {
    this.finish('feed');
    if (!this.active('sleep')) this.add({ type: 'sleep', start: Date.now(), end: null });
  }

  logCry() {
    this.add({ type: 'cry', start: Date.now(), end: Date.now() });
  }

  remove(id) {
    const i = this.events.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [removed] = this.events.splice(i, 1);
    this.save();
    this.toast('Запись удалена', 'Вернуть', () => {
      this.events.push(removed);
      this.save();
    });
  }

  nextSide() {
    const lastBreast = this.last('feed', (e) => e.side !== 'B');
    if (!lastBreast) return null;
    return lastBreast.side === 'L' ? 'R' : 'L';
  }

  awakeSince() {
    if (this.active('sleep')) return null;
    const s = this.last('sleep');
    return s ? s.end : null;
  }

  summary(now = Date.now()) {
    const from = now - DAY;
    let sleep = 0, feeds = 0, diapers = 0;
    for (const e of this.events) {
      const end = e.end == null ? now : e.end;
      if (e.type === 'sleep') sleep += Math.max(0, Math.min(end, now) - Math.max(e.start, from));
      if (e.start < from) continue;
      if (e.type === 'feed') feeds++;
      if (e.type === 'diaper') diapers++;
    }
    return { sleep, feeds, diapers };
  }

  // Короткая строка для экрана ночника.
  faceStatus(now = Date.now()) {
    const sleeping = this.active('sleep');
    if (sleeping) return `Спит ${fmtDur(now - sleeping.start)}`;
    const feeding = this.active('feed');
    if (feeding) return `Кормление ${fmtTimer(now - feeding.start)}`;
    return '';
  }

  // ----- Отрисовка вкладки «Малыш» -----

  describe(e, now) {
    const dur = e.end != null ? fmtDur(e.end - e.start) : `идёт ${fmtDur(now - e.start)}`;
    switch (e.type) {
      case 'sleep': return `Сон, ${dur}`;
      case 'feed': return e.side === 'B' ? `Бутылочка, ${dur}` : `Кормление, ${SIDES[e.side]} грудь, ${dur}`;
      case 'diaper': return `Подгузник, ${DIAPERS[e.kind]}`;
      case 'cry': return `${this.word('Плакала', 'Плакал')}, звук включён снова`;
      default: return '';
    }
  }

  timeEditor(e) {
    return `<label class="time-edit">начало
      <input type="time" value="${fmtClock(e.start)}" data-edit-start="${e.id}" aria-label="Изменить время начала">
    </label>`;
  }

  renderSleepCard(now, age) {
    const sleeping = this.active('sleep');
    if (sleeping) {
      return `<div class="card">
        <p class="card-title">Сон</p>
        <p class="card-big">Спит ${fmtDur(now - sleeping.start)}</p>
        <p class="card-note">${this.timeEditor(sleeping)}</p>
        <div class="row"><button class="btn primary" data-act="wake">${this.word('Проснулась', 'Проснулся')}</button></div>
      </div>`;
    }
    const since = this.awakeSince();
    let body = '';
    if (since) {
      const awake = now - since;
      body = `<p class="card-big">Не спит ${fmtDur(awake)}</p>`;
      if (age && age.norm) {
        const [lo, hi] = age.norm.wake;
        const min = awake / 60000;
        const pos = Math.min(1, min / (hi * 1.25));
        const loPos = lo / (hi * 1.25);
        const hiPos = 1 / 1.25;
        let advice;
        if (min < lo) advice = `До окна сна ещё ${fmtMinutes(Math.ceil(lo - min))}.`;
        else if (min <= hi) advice = 'Самое время укладывать.';
        else advice = 'Окно бодрствования прошло: малыш может перевозбудиться, укладывайте спокойно и без спешки.';
        body += `<div class="window-bar" role="img" aria-label="Окно бодрствования">
            <span class="window-zone" style="left:${loPos * 100}%;width:${(hiPos - loPos) * 100}%"></span>
            <span class="window-now" style="left:${pos * 100}%"></span>
          </div>
          <p class="card-note">Окно бодрствования в ${age.label} — ${fmtMinutes(lo)} – ${fmtMinutes(hi)}. ${advice}</p>`;
      }
    } else {
      body = '<p class="card-note">Нажмите, когда малыш уснёт: начнём считать сон и окна бодрствования.</p>';
    }
    return `<div class="card">
      <p class="card-title">Сон</p>
      ${body}
      <div class="row"><button class="btn primary" data-act="sleep">${this.word('Уснула', 'Уснул')}</button></div>
    </div>`;
  }

  renderFeedCard(now) {
    const feeding = this.active('feed');
    const next = this.nextSide();
    let head;
    if (feeding) {
      const what = feeding.side === 'B' ? 'Бутылочка' : `${SIDES[feeding.side][0].toUpperCase()}${SIDES[feeding.side].slice(1)} грудь`;
      head = `<p class="card-big">${what} <span class="tabular">${fmtTimer(now - feeding.start)}</span></p>
        <p class="card-note">${this.timeEditor(feeding)}</p>`;
    } else {
      const last = this.last('feed');
      head = last
        ? `<p class="card-big">${ago(now - last.start)}</p>
           <p class="card-note">Последнее: ${last.side === 'B' ? 'бутылочка' : `${SIDES[last.side]} грудь`}${last.end ? `, ${fmtDur(last.end - last.start)}` : ''}.${next ? ` Следующая — ${SIDES[next]}.` : ''}</p>`
        : '<p class="card-note">Нажмите грудь или бутылочку, когда начнёте кормить. Таймер подскажет, с какой стороны начать в следующий раз.</p>';
    }
    const sideBtn = (side, label) => {
      const cls = feeding && feeding.side === side ? 'btn on' : (!feeding && next === side ? 'btn suggested' : 'btn');
      return `<button class="${cls}" data-act="feed" data-side="${side}" aria-pressed="${Boolean(feeding && feeding.side === side)}">${label}</button>`;
    };
    return `<div class="card">
      <p class="card-title">Кормление</p>
      ${head}
      <div class="row split">${sideBtn('L', 'Левая')}${sideBtn('R', 'Правая')}${sideBtn('B', 'Бутылочка')}</div>
      ${feeding ? '<div class="row"><button class="btn primary" data-act="feed-end">Закончить</button></div>' : ''}
    </div>`;
  }

  renderDiaperCard(now) {
    const last = this.last('diaper');
    return `<div class="card">
      <p class="card-title">Подгузник</p>
      ${last ? `<p class="card-note">Последний: ${ago(now - last.start).toLowerCase()}, ${DIAPERS[last.kind]}.</p>` : ''}
      <div class="row split">
        <button class="btn" data-act="diaper" data-kind="wet">Мокрый</button>
        <button class="btn" data-act="diaper" data-kind="dirty">Грязный</button>
      </div>
    </div>`;
  }

  renderLog(now) {
    const from = now - DAY;
    const recent = this.events.filter((e) => (e.end == null ? now : e.end) >= from).slice().reverse();
    if (!recent.length) {
      return '<p class="hint">Здесь появятся сон, кормления и подгузники за последние сутки.</p>';
    }
    const s = this.summary(now);
    const items = recent.map((e) => `<li>
        <time>${fmtClock(e.start)}</time>
        <span>${this.describe(e, now)}</span>
        <button class="icon-btn small" data-act="remove" data-id="${e.id}" aria-label="Удалить запись">
          <svg aria-hidden="true"><use href="#i-close"/></svg>
        </button>
      </li>`).join('');
    return `<p class="summary">Сон ${fmtDur(s.sleep)}, кормлений ${s.feeds}, подгузников ${s.diapers}.</p>
      <ul class="log">${items}</ul>`;
  }

  render(root) {
    const now = Date.now();
    const age = ageInfo(this.getSettings().babyBirth, now);
    root.innerHTML = `
      ${this.renderSleepCard(now, age)}
      ${this.renderFeedCard(now)}
      ${this.renderDiaperCard(now)}
      <h3>За последние сутки</h3>
      ${this.renderLog(now)}`;
  }

  // Делегирование кликов из вкладки.
  handle(target) {
    const btn = target.closest('[data-act]');
    if (!btn) return false;
    const act = btn.dataset.act;
    if (act === 'sleep') this.startSleep();
    else if (act === 'wake') this.finish('sleep');
    else if (act === 'feed') this.startFeed(btn.dataset.side);
    else if (act === 'feed-end') this.finish('feed');
    else if (act === 'diaper') {
      const e = this.add({ type: 'diaper', kind: btn.dataset.kind, start: Date.now(), end: Date.now() });
      this.toast(`Записано: подгузник ${DIAPERS[e.kind]}`, 'Отменить', () => {
        this.events = this.events.filter((x) => x.id !== e.id);
        this.save();
      });
    } else if (act === 'remove') this.remove(btn.dataset.id);
    return true;
  }

  // Мама нажала «Уснула» позже, чем малыш уснул, — поправим время.
  editStart(id, hhmm) {
    const e = this.events.find((x) => x.id === id);
    if (!e || !/^\d\d:\d\d$/.test(hhmm)) return;
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
    e.start = d.getTime();
    this.save();
  }
}

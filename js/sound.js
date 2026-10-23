// Звуковой движок. Все звуки синтезируются прямо в телефоне —
// никаких аудиофайлов, всё работает без интернета.
// Каждый звук — это буфер, который зацикливается без щелчков на стыке.

const TAU = Math.PI * 2;

export const NOISES = [
  { id: 'white', name: 'Белый шум' },
  { id: 'pink', name: 'Розовый шум' },
  { id: 'brown', name: 'Коричневый шум' },
  { id: 'rain', name: 'Дождь' },
  { id: 'ocean', name: 'Море' },
  { id: 'heart', name: 'Сердце мамы' },
  { id: 'shush', name: 'Шшш' },
  { id: 'dryer', name: 'Фен' },
  { id: 'fan', name: 'Вентилятор' },
];

export const MELODIES = [
  { id: 'radost', name: 'Спи, моя радость' },
  { id: 'brahms', name: 'Брамс' },
  { id: 'kindlein', name: 'Спи, малютка' },
  { id: 'twinkle', name: 'Звёздочка' },
  { id: 'silent', name: 'Тихая ночь' },
  { id: 'moon', name: 'Лунный свет' },
  { id: 'goodmoon', name: 'Добрый месяц' },
  { id: 'moonrise', name: 'Взошла луна' },
  { id: 'musicbox', name: 'Шкатулка' },
  { id: 'medley', name: 'Все по кругу' },
];

export function soundName(id) {
  const item = [...NOISES, ...MELODIES].find((s) => s.id === id);
  return item ? item.name : '';
}

// ---------- DSP-кирпичики ----------

const white = () => Math.random() * 2 - 1;

function pinkGen() {
  // Фильтр Пола Келлета: точная аппроксимация розового шума.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = white();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}

function brownGen() {
  let last = 0;
  return () => {
    last = (last + 0.02 * white()) / 1.02;
    return last * 3.5;
  };
}

class Biquad {
  constructor(type, freq, q, sr) {
    const w0 = (TAU * freq) / sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    } else {
      b0 = alpha; b1 = 0; b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
    this.z1 = 0; this.z2 = 0;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// Однополюсный фильтр с переменной частотой среза (для «дышащего» моря).
function onePoleCoef(freq, sr) {
  return 1 - Math.exp((-TAU * freq) / sr);
}

// Генерирует n + fade сэмплов и сворачивает хвост в начало
// равномощным кроссфейдом: петля звучит бесшовно.
function seamless(n, sr, fill) {
  const fade = Math.floor(sr * 0.5);
  const raw = new Float32Array(n + fade);
  for (let i = 0; i < n + fade; i++) raw[i] = fill(i);
  const out = raw.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = (i / fade) * (Math.PI / 2);
    out[i] = raw[i] * Math.sin(t) + raw[n + i] * Math.cos(t);
  }
  return out;
}

// Приводит все звуки к одной громкости, не давая пикам упереться в потолок.
function normalize(channels, targetRms = 0.16) {
  let sum = 0, peak = 0, count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    count += ch.length;
  }
  const rms = Math.sqrt(sum / count) || 1;
  const gain = Math.min(targetRms / rms, 0.95 / (peak || 1));
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  return channels;
}

const smooth = (x) => x * x * (3 - 2 * x);

// ---------- Шумы ----------

function makeWhite(sr) {
  const n = sr * 12;
  const ch = () => {
    const lp = new Biquad('lowpass', 14000, 0.7, sr);
    return seamless(n, sr, () => lp.process(white()));
  };
  return normalize([ch(), ch()]);
}

function makePink(sr) {
  const n = sr * 12;
  const ch = () => {
    const p = pinkGen();
    return seamless(n, sr, p);
  };
  return normalize([ch(), ch()]);
}

function makeBrown(sr) {
  const n = sr * 12;
  const ch = () => {
    const b = brownGen();
    const hp = new Biquad('highpass', 25, 0.7, sr);
    return seamless(n, sr, () => hp.process(b()));
  };
  return normalize([ch(), ch()], 0.18);
}

function makeRain(sr) {
  const n = sr * 20;
  const ch = (phase) => {
    const p = pinkGen();
    const b = brownGen();
    const hp = new Biquad('highpass', 450, 0.7, sr);
    const lp = new Biquad('lowpass', 9000, 0.7, sr);
    const body = new Biquad('lowpass', 320, 0.7, sr);
    const bed = seamless(n, sr, () => lp.process(hp.process(p())) + body.process(b()) * 0.35);
    // Медленные «порывы» дождя — периодичны в пределах петли.
    for (let i = 0; i < n; i++) {
      const t = i / n;
      bed[i] *= 0.82 + 0.12 * Math.sin(TAU * 2 * t + phase) + 0.06 * Math.sin(TAU * 5 * t + phase * 2);
    }
    // Капли: короткие отфильтрованные щелчки, записанные по кругу.
    const drops = new Float32Array(n);
    const count = Math.floor((n / sr) * 55);
    for (let d = 0; d < count; d++) {
      const start = Math.floor(Math.random() * n);
      const len = Math.floor(sr * (0.004 + Math.random() * 0.018));
      const bp = new Biquad('bandpass', 1400 + Math.random() * 4600, 3 + Math.random() * 3, sr);
      const amp = Math.pow(Math.random(), 3) * 1.4;
      const tau = len / 4;
      for (let k = 0; k < len; k++) {
        drops[(start + k) % n] += bp.process(white()) * Math.exp(-k / tau) * amp;
      }
    }
    for (let i = 0; i < n; i++) bed[i] += drops[i];
    return bed;
  };
  return normalize([ch(0), ch(1.7)]);
}

function makeOcean(sr) {
  const waves = 5;
  const n = sr * 40; // 5 волн по 8 секунд
  const amps = Array.from({ length: waves }, () => 0.6 + Math.random() * 0.4);
  const env = (i) => {
    const pos = ((i % n) + n) % n;
    const x = (pos / n) * waves;
    const j = Math.floor(x);
    const ph = x - j;
    // Нарастание до гребня на 35% периода, затем долгий откат.
    const w = ph < 0.35 ? (ph / 0.35) * 0.5 : 0.5 + ((ph - 0.35) / 0.65) * 0.5;
    const s = Math.pow((1 - Math.cos(TAU * w)) / 2, 1.5);
    return 0.14 + 0.86 * amps[j] * s;
  };
  // Огибающая меняется медленно — считаем её раз в 32 сэмпла.
  const BLOCK = 32;
  const ch = (shift) => {
    const p = pinkGen();
    const b = brownGen();
    const hp = new Biquad('highpass', 250, 0.7, sr);
    const lowRumble = new Biquad('lowpass', 500, 0.7, sr);
    let lpState = 0, e = 0, k = 0, washGain = 0;
    return seamless(n, sr, (i) => {
      if (i % BLOCK === 0) {
        e = env(i + shift);
        k = onePoleCoef(700 + 5200 * e * e, sr);
        washGain = Math.pow(e, 1.3) * 1.6;
      }
      const rumble = lowRumble.process(b()) * (0.35 + 0.65 * e);
      lpState += k * (hp.process(p()) - lpState);
      return rumble * 0.7 + lpState * washGain;
    });
  };
  return normalize([ch(0), ch(Math.floor(sr * 0.35))]);
}

function makeHeart(sr) {
  const bpm = 72;
  const beat = 60 / bpm;
  const beats = 12;
  const n = Math.round(sr * beat * beats);
  const out = new Float32Array(n);
  const thump = (t0, f1, f2, amp, decay) => {
    const start = Math.floor(t0 * sr);
    const len = Math.floor(sr * 0.22);
    let phase = 0;
    for (let k = 0; k < len; k++) {
      const t = k / sr;
      const f = f2 + (f1 - f2) * Math.exp(-t / 0.05);
      phase += (TAU * f) / sr;
      const e = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / decay);
      // tanh добавляет обертоны — так стук слышен даже в динамике телефона.
      out[(start + k) % n] += Math.tanh(3 * Math.sin(phase)) * e * amp;
    }
  };
  for (let b = 0; b < beats; b++) {
    const t0 = 0.05 + b * beat;
    thump(t0, 100, 55, 1, 0.055);
    thump(t0 + 0.3, 115, 65, 0.65, 0.045);
  }
  const lp = new Biquad('lowpass', 700, 0.7, sr);
  // Прогоняем фильтр дважды: первый проход прогревает его на хвосте петли.
  for (let i = 0; i < n; i++) lp.process(out[i]);
  for (let i = 0; i < n; i++) out[i] = lp.process(out[i]);
  // Мягкий «шум крови» в такт пульсу.
  const b = brownGen();
  const bodyLp = new Biquad('lowpass', 450, 0.7, sr);
  const whoosh = seamless(n, sr, () => bodyLp.process(b()));
  for (let i = 0; i < n; i++) {
    const ph = ((i / sr) % beat) / beat;
    const pulse = Math.pow(Math.sin(Math.PI * Math.sqrt(ph)), 2);
    out[i] = out[i] * 0.8 + whoosh[i] * (0.25 + 0.2 * pulse);
  }
  return normalize([out, out.slice()], 0.2);
}

function makeShush(sr) {
  const cycles = 7;
  const n = Math.round(sr * 1.72 * cycles);
  const amps = Array.from({ length: cycles }, () => 0.85 + Math.random() * 0.15);
  const env = (i) => {
    const x = ((i % n) / n) * cycles;
    const j = Math.floor(x);
    const ph = x - j;
    let e;
    if (ph < 0.08) e = smooth(ph / 0.08);
    else if (ph < 0.62) e = 1 - 0.15 * ((ph - 0.08) / 0.54);
    else if (ph < 0.8) e = 0.85 * (1 - smooth((ph - 0.62) / 0.18));
    else e = 0;
    return 0.06 + 0.94 * e * amps[j];
  };
  const ch = () => {
    const p = pinkGen();
    const bp = new Biquad('bandpass', 2600, 0.9, sr);
    const hp = new Biquad('highpass', 1300, 0.7, sr);
    const hp2 = new Biquad('highpass', 900, 0.7, sr);
    return seamless(n, sr, (i) => (bp.process(white()) * 1.4 + hp2.process(hp.process(p())) * 0.9) * env(i));
  };
  return normalize([ch(), ch()], 0.14);
}

function makeDryer(sr) {
  const dur = 12;
  const n = sr * dur;
  const ch = () => {
    const p = pinkGen();
    const bp = new Biquad('bandpass', 1500, 0.45, sr);
    const hp = new Biquad('highpass', 280, 0.7, sr);
    return seamless(n, sr, () => hp.process(bp.process(white() * 0.7 + p() * 1.2)));
  };
  const chans = [ch(), ch()];
  // Тон моторчика: частоты подобраны так, чтобы целое число периодов уложилось в петлю.
  const f0 = 215;
  const harm = [0.05, 0.03, 0.02, 0.012, 0.008];
  for (const c of chans) {
    let rms = 0;
    for (let i = 0; i < n; i++) rms += c[i] * c[i];
    rms = Math.sqrt(rms / n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let tone = 0;
      for (let h = 0; h < harm.length; h++) tone += harm[h] * Math.sin(TAU * f0 * (h + 1) * t);
      c[i] = c[i] * (1 + 0.03 * Math.sin((TAU * 3 * i) / n)) + tone * rms * 3;
    }
  }
  return normalize(chans);
}

function makeFan(sr) {
  const n = sr * 12;
  const ch = () => {
    const p = pinkGen();
    const b = brownGen();
    const lp = new Biquad('lowpass', 1100, 0.6, sr);
    return seamless(n, sr, () => lp.process(b() * 0.9 + p() * 0.7));
  };
  const chans = [ch(), ch()];
  // Лёгкая пульсация лопастей: 13 Гц × 12 с = 156 целых периодов.
  for (const c of chans) {
    for (let i = 0; i < n; i++) c[i] *= 1 + 0.07 * Math.sin((TAU * 13 * i) / sr);
  }
  return normalize(chans, 0.17);
}

// ---------- Колыбельные (музыкальная шкатулка) ----------

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midiOf(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + accidental;
}

// «E5:.5 G5:1.5 r:2» → [[midi|null, долей]]
function parseTune(str) {
  return str.trim().split(/\s+/).map((tok) => {
    const [n, d] = tok.split(':');
    return [n === 'r' ? null : midiOf(n), Number(d)];
  });
}

const TUNES = {
  // И. Брамс, «Колыбельная», op. 49 № 4 (1868)
  brahms: {
    bpm: 72,
    notes:
      'E5:.5 E5:.5 G5:1.5 E5:.5 E5:1 G5:2 E5:.5 G5:.5 C6:1 B5:1.5 A5:.5 A5:1 G5:1 D5:.5 E5:.5 ' +
      'F5:1 D5:1 D5:.5 E5:.5 F5:2 D5:.5 F5:.5 B5:.5 A5:.5 G5:1 B5:1 C6:2 C5:.5 C5:.5 ' +
      'C6:2 A5:.5 F5:.5 G5:2 E5:.5 C5:.5 F5:1 G5:1 A5:1 G5:2 C5:.5 C5:.5 ' +
      'C6:2 A5:.5 F5:.5 G5:2 E5:.5 C5:.5 F5:1 E5:1 D5:1 C5:3 r:3',
  },
  // «Маленькая звёздочка» — французская народная мелодия
  twinkle: {
    bpm: 70,
    notes:
      'C5:1 C5:1 G5:1 G5:1 A5:1 A5:1 G5:2 F5:1 F5:1 E5:1 E5:1 D5:1 D5:1 C5:2 ' +
      'G5:1 G5:1 F5:1 F5:1 E5:1 E5:1 D5:2 G5:1 G5:1 F5:1 F5:1 E5:1 E5:1 D5:2 ' +
      'C5:1 C5:1 G5:1 G5:1 A5:1 A5:1 G5:2 F5:1 F5:1 E5:1 E5:1 D5:1 D5:1 C5:2 r:2',
  },
  // «Спи, моя радость, усни» — «Schlafe, mein Prinzchen» Б. Флиса (1796),
  // долго считалась колыбельной Моцарта. Ноты: Essen Folksong Collection.
  radost: {
    bpm: 88,
    notes:
      'A5:.5 Bb5:.5 A5:.5 G5:.5 F5:.5 G5:.5 F5:1 r:2 F5:.5 Bb5:.5 Bb5:.5 Bb5:.5 C6:.5 D6:.5 C6:1 r:2 ' +
      'G5:.5 F#5:.5 G5:.5 G5:.5 F5:.5 G5:.5 A5:1 r:2 A5:.5 G5:.5 A5:.5 Bb5:.5 A5:.5 Bb5:.5 C6:1 r:2 ' +
      'D6:.5 C#6:.5 D6:.5 D6:.5 C6:.5 D6:.5 F6:1 r:2 C6:.5 C6:.5 C6:.5 C6:.5 B5:.5 C6:.5 F6:1 r:2 ' +
      'Bb5:.5 C6:.5 Bb5:.5 A5:.5 Bb5:.5 C6:.5 C5:1 r:2 A5:.5 Bb5:.5 A5:.5 G5:.5 F5:.5 G5:.5 F5:1.5 r:1.5',
  },
  // «Тихая ночь» — Ф. Грубер (1818)
  silent: {
    bpm: 66,
    notes:
      'G5:.75 A5:.25 G5:.5 E5:1.5 G5:.75 A5:.25 G5:.5 E5:1.5 D6:1 D6:.5 B5:1.5 C6:1 C6:.5 G5:1.5 ' +
      'A5:1 A5:.5 C6:.75 B5:.25 A5:.5 G5:.75 A5:.25 G5:.5 E5:1.5 A5:1 A5:.5 C6:.75 B5:.25 A5:.5 ' +
      'G5:.75 A5:.25 G5:.5 E5:1.5 D6:1 D6:.5 F6:.75 D6:.25 B5:.5 C6:1.5 E6:1 r:.5 ' +
      'C6:.5 G5:.5 E5:.5 G5:.75 F5:.25 D5:.5 C5:1.5 C5:1 r:.5',
  },
  // «Спи, малютка, спи» (Schlaf, Kindlein, schlaf) — немецкая народная колыбельная
  kindlein: {
    bpm: 66,
    notes:
      'A5:1 G5:.5 G5:.5 F5:1 r:.5 C5:.5 A5:.5 A5:.5 G5:.5 G5:.5 F5:1 r:.5 ' +
      'F5:.5 Bb5:.5 Bb5:.5 G5:.5 G5:.5 C6:.5 C6:.5 A5:.5 A5:.5 Bb5:.5 Bb5:.5 G5:.5 G5:.5 C6:.5 C6:.5 A5:1 ' +
      'Bb5:1 G5:.5 G5:.5 F5:1 r:1',
  },
  // «Добрый месяц» (Guter Mond, du gehst so stille) — немецкая народная песня
  goodmoon: {
    bpm: 72,
    notes:
      'D6:.5 C6:.5 B5:1 B5:1 B5:.5 C6:.5 D6:.5 E6:.5 D6:.5 C6:.5 A5:1 r:1 ' +
      'D6:.5 C6:.5 B5:1 B5:1 A5:.5 G5:.5 A5:.5 B5:.5 G5:2 r:1 ' +
      'A5:.5 B5:.5 C6:1 A5:1 r:1 B5:.5 C6:.5 D6:1 B5:1 r:1 ' +
      'D6:.5 D6:.5 E6:1.5 D6:.5 E6:.5 D6:.5 C6:.5 B5:.5 B5:1 A5:1 r:1 ' +
      'D6:.5 C6:.5 B5:1 B5:1 B5:.5 C6:.5 D6:.5 E6:.5 D6:.5 C6:.5 A5:1 r:1 ' +
      'D6:.5 C6:.5 B5:1 B5:1 A5:.5 G5:.5 A5:.5 B5:.5 G5:2 r:1',
  },
  // «Взошла луна» (Der Mond ist aufgegangen) — И. А. П. Шульц (1790)
  moonrise: {
    bpm: 66,
    notes:
      'G5:1 A5:1 G5:1 C6:1 B5:1 A5:2 G5:1 B5:1 B5:1 B5:1 E6:1 D6:1 C6:2 ' +
      'B5:1 B5:1 B5:1 B5:1 C6:1 B5:1 A5:2 r:1 ' +
      'G5:1 A5:1 G5:1 C6:1 B5:1 A5:2 G5:1 B5:1 B5:1 B5:1 E6:1 D6:1 C6:2 ' +
      'B5:1 B5:1 B5:1 B5:1 C6:1 B5:1 A5:1 A5:1 G5:2 r:1',
  },
  // «При лунном свете» (Au clair de la lune) — французская народная песня
  moon: {
    bpm: 72,
    notes:
      'C5:1 C5:1 C5:1 D5:1 E5:2 D5:2 C5:1 E5:1 D5:1 D5:1 C5:4 ' +
      'C5:1 C5:1 C5:1 D5:1 E5:2 D5:2 C5:1 E5:1 D5:1 D5:1 C5:4 ' +
      'D5:1 D5:1 D5:1 D5:1 A4:2 A4:2 D5:1 C5:1 B4:1 A4:1 G4:4 ' +
      'C5:1 C5:1 C5:1 D5:1 E5:2 D5:2 C5:1 E5:1 D5:1 D5:1 C5:4 r:2',
  },
};

// Нота музыкальной шкатулки: несколько затухающих гармоник.
// Пишется в буфер по кругу, поэтому хвост последней ноты
// плавно переходит в начало петли.
const BELL_SECONDS = 2.8;

function addBell(out, sr, start, midi, vel) {
  const n = out.length;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const len = Math.floor(sr * BELL_SECONDS);
  const pitchScale = Math.pow(523 / f, 0.35);
  const partials = [
    [1, 1, 1.5],
    [2, 0.3, 0.7],
    [3, 0.1, 0.35],
    [4.16, 0.05, 0.2],
    [5.43, 0.025, 0.12],
  ];
  const attack = sr * 0.004;
  for (const [mult, amp, decay] of partials) {
    const freq = f * mult;
    if (freq > sr / 2.2) continue;
    const d = (TAU * freq) / sr;
    const cd = Math.cos(d), sd = Math.sin(d);
    let s = 0, c = 1;
    const r = Math.exp(-1 / (decay * pitchScale * sr));
    let e = amp * vel;
    for (let k = 0; k < len; k++) {
      const a = k < attack ? k / attack : 1;
      out[(start + k) % n] += s * e * a;
      const s2 = s * cd + c * sd;
      c = c * cd - s * sd;
      s = s2;
      e *= r;
    }
  }
}

function makeTune(sr, id) {
  const tune = TUNES[id];
  const notes = parseTune(tune.notes);
  const beat = 60 / tune.bpm;
  const onsets = [];
  let t = 0;
  for (const [midi, d] of notes) {
    if (midi !== null) onsets.push([t, midi]);
    t += d * beat;
  }
  // Последняя нота должна успеть отзвучать: тогда колыбельную можно
  // и зациклить, и сыграть один раз в режиме «Все по кругу».
  const lastOnset = onsets[onsets.length - 1][0];
  const n = Math.round(Math.max(t, lastOnset + BELL_SECONDS + 0.3) * sr);
  const out = new Float32Array(n);
  for (const [start, midi] of onsets) {
    // Лёгкое «человеческое» дыхание в силе и времени.
    const vel = 0.8 + Math.random() * 0.15;
    const jitter = Math.floor((Math.random() - 0.5) * sr * 0.012);
    addBell(out, sr, Math.max(0, Math.floor(start * sr) + jitter), midi, vel);
  }
  // Шкатулка звучит из одной точки — хватит одного канала, вдвое меньше памяти.
  return normalize([out], 0.12);
}

// Бесконечная тихая импровизация на пентатонике — как мобиль над кроваткой.
function makeMusicBox(sr) {
  const dur = 48;
  const n = sr * dur;
  const out = new Float32Array(n);
  const scale = ['G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6'].map(midiOf);
  let idx = 4;
  let t = 0.2;
  while (t < dur - 0.4) {
    if (Math.random() > 0.22) {
      addBell(out, sr, Math.floor(t * sr), scale[idx], 0.55 + Math.random() * 0.35);
      if (Math.random() < 0.15) {
        const low = Math.max(0, idx - 4);
        addBell(out, sr, Math.floor(t * sr), scale[low], 0.35);
      }
    }
    const step = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
    idx = Math.min(scale.length - 1, Math.max(0, idx + step));
    t += Math.random() < 0.18 ? 1.6 : 0.8;
  }
  return normalize([out], 0.11);
}

const BUILDERS = {
  white: makeWhite,
  pink: makePink,
  brown: makeBrown,
  rain: makeRain,
  ocean: makeOcean,
  heart: makeHeart,
  shush: makeShush,
  dryer: makeDryer,
  fan: makeFan,
  musicbox: makeMusicBox,
  ...Object.fromEntries(Object.keys(TUNES).map((id) => [id, (sr) => makeTune(sr, id)])),
};

// Для тестов и предпрослушивания: сгенерировать сырые каналы.
export function renderChannels(id, sr) {
  return BUILDERS[id](sr);
}

function makeImpulse(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.4);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      lp += 0.35 * (white() - lp);
      d[i] = lp * Math.exp(-t / 0.55) * Math.min(1, t / 0.012);
    }
  }
  return buf;
}

// ---------- Плеер ----------

const MAX_GAIN = { noise: 0.9, music: 0.85 };

// Порядок колыбельных в режиме «Все по кругу».
const MEDLEY = ['radost', 'brahms', 'kindlein', 'twinkle', 'silent', 'moon', 'goodmoon', 'moonrise'];
// Живому голосу и готовым песням почти не нужно эха, шкатулке — побольше.
const isUser = (id) => id.startsWith('u:');
const wetFor = (id) => (isUser(id) ? 0.12 : 0.4);

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.cache = new Map();
    this.pending = new Map();
    // Свои колыбельные (id вида «u:…»): app.js декодирует их по запросу.
    this.userBuffers = new Map();
    this.userIds = [];
    this.loadUser = null;
    this.worker = null;
    this.requests = new Map();
    this.reqId = 0;
    this.loading = 0;
    this.layers = {
      noise: { id: null, volume: 0.45, srcs: [], fade: null, token: 0, timers: [], now: null, next: 0 },
      music: { id: null, volume: 0.4, srcs: [], fade: null, token: 0, timers: [], now: null, next: 0 },
    };
    this.playing = false;
    this.onchange = null;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'playback' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 8;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.layers.noise.gain = ctx.createGain();
    this.layers.noise.gain.connect(this.master);

    const music = this.layers.music;
    music.gain = ctx.createGain();
    music.wet = ctx.createGain();
    music.wet.gain.value = wetFor('');
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx);
    music.gain.connect(this.master);
    music.gain.connect(music.wet).connect(reverb).connect(this.master);

    this.applyVolume('noise');
    this.applyVolume('music');
    return ctx;
  }

  // iOS и Android разрешают звук только после касания экрана.
  async unlock() {
    const ctx = this.ensureContext();
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) { /* не поддерживается */ }
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (e) { /* повторим при следующем касании */ }
    }
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silent.connect(ctx.destination);
    silent.start();
  }

  // Заранее синтезировать выбранные звуки, чтобы «Включить» срабатывало сразу.
  prepare() {
    this.ensureContext();
    for (const l of Object.values(this.layers)) {
      if (l.id) this.getBuffer(l.id === 'medley' ? this.medleyList()[0] : l.id).catch(() => {});
    }
  }

  setVolume(layer, v) {
    this.layers[layer].volume = v;
    if (this.ctx) this.applyVolume(layer);
  }

  applyVolume(layer) {
    const l = this.layers[layer];
    const g = l.volume * l.volume * MAX_GAIN[layer];
    l.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
  }

  medleyList() {
    return [...MEDLEY, ...this.userIds];
  }

  forgetUser(id) {
    this.userBuffers.delete(id);
  }

  // Синтез идёт в фоновом потоке, чтобы интерфейс не подвисал.
  synth(id) {
    const sr = this.ctx.sampleRate;
    if (this.worker === null) {
      try {
        this.worker = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const req = this.requests.get(e.data.reqId);
          if (!req) return;
          this.requests.delete(e.data.reqId);
          if (e.data.error) req.reject(new Error(e.data.error));
          else req.resolve(e.data.chans);
        };
        this.worker.onerror = () => {
          this.worker = false;
          for (const req of this.requests.values()) req.reject(new Error('worker'));
          this.requests.clear();
        };
      } catch (e) {
        this.worker = false;
      }
    }
    if (!this.worker) return Promise.resolve(BUILDERS[id](sr));
    const reqId = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.requests.set(reqId, { resolve, reject });
      this.worker.postMessage({ id, sr, reqId });
    }).catch(() => BUILDERS[id](sr));
  }

  async getBuffer(id) {
    if (isUser(id)) return this.getUserBuffer(id);
    if (this.cache.has(id)) {
      const b = this.cache.get(id);
      this.cache.delete(id);
      this.cache.set(id, b);
      return b;
    }
    if (this.pending.has(id)) return this.pending.get(id);
    const job = this.synth(id).then((chans) => {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(chans.length, chans[0].length, ctx.sampleRate);
      chans.forEach((c, i) => buf.copyToChannel(c, i));
      this.cache.set(id, buf);
      // Держим в памяти не больше четырёх звуков.
      while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
      return buf;
    });
    this.pending.set(id, job);
    try {
      return await job;
    } finally {
      this.pending.delete(id);
    }
  }

  async getUserBuffer(id) {
    if (this.userBuffers.has(id)) {
      const b = this.userBuffers.get(id);
      this.userBuffers.delete(id);
      this.userBuffers.set(id, b);
      return b;
    }
    if (this.pending.has(id)) return this.pending.get(id);
    const job = Promise.resolve(this.loadUser ? this.loadUser(id) : null).then((buf) => {
      if (buf) this.userBuffers.set(id, buf);
      // Песни бывают длинными — держим в памяти не больше двух.
      while (this.userBuffers.size > 2) this.userBuffers.delete(this.userBuffers.keys().next().value);
      return buf;
    });
    this.pending.set(id, job);
    try {
      return await job;
    } finally {
      this.pending.delete(id);
    }
  }

  async startSource(layerName, fadeIn) {
    const l = this.layers[layerName];
    const id = l.id;
    if (!id) return;
    const token = ++l.token;
    const medley = id === 'medley';
    this.loading++;
    this.emit();
    let buf = null;
    try {
      buf = await this.getBuffer(medley ? this.medleyList()[0] : id);
    } finally {
      this.loading--;
      this.emit();
    }
    // Пока звук готовился, его могли выключить или сменить.
    if (!buf || token !== l.token || !this.playing || l.id !== id) return;
    const ctx = this.ctx;
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(0, ctx.currentTime);
    fade.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);
    fade.connect(l.gain);
    l.fade = fade;
    l.srcs = [];
    if (layerName === 'music') {
      l.wet.gain.setTargetAtTime(wetFor(id), ctx.currentTime, 0.1);
    }
    if (medley) {
      l.next = 0;
      this.queueTune(l, token, buf, ctx.currentTime);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(fade);
    // Шум начинаем со случайного места, колыбельную — с начала.
    const offset = layerName === 'noise' ? Math.random() * buf.duration : 0;
    src.start(ctx.currentTime, offset);
    l.srcs.push(src);
  }

  // «Все по кругу»: колыбельные звучат одна за другой без пауз.
  // Следующую готовим заранее и ставим точно на конец текущей.
  queueTune(l, token, buf, when) {
    const ctx = this.ctx;
    const list = this.medleyList();
    const id = list[l.next % list.length];
    l.next++;
    const at = Math.max(when, ctx.currentTime + 0.05);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(l.fade);
    src.start(at);
    src.onended = () => { l.srcs = l.srcs.filter((s) => s !== src); };
    l.srcs.push(src);
    l.timers.push(setTimeout(() => {
      if (token !== l.token) return;
      l.now = id;
      this.emit();
    }, (at - ctx.currentTime) * 1000));
    const end = at + buf.duration;
    l.timers.push(setTimeout(async () => {
      // Если запись не открылась (например, её удалили), берём следующую.
      for (let tries = 0; tries < this.medleyList().length; tries++) {
        if (token !== l.token || !this.playing) return;
        const list = this.medleyList();
        const next = await this.getBuffer(list[l.next % list.length]).catch(() => null);
        if (token !== l.token || !this.playing) return;
        if (next) {
          this.queueTune(l, token, next, end);
          return;
        }
        l.next++;
      }
    }, Math.max(0, (end - ctx.currentTime - 8) * 1000)));
  }

  // Что звучит в слое прямо сейчас (для «Все по кругу» — текущая колыбельная).
  current(layerName) {
    const l = this.layers[layerName];
    return l.id === 'medley' && l.now ? l.now : l.id;
  }

  stopSource(layerName, fadeOut) {
    const l = this.layers[layerName];
    l.token++;
    l.timers.forEach(clearTimeout);
    l.timers = [];
    l.now = null;
    if (!l.fade) return;
    const now = this.ctx.currentTime;
    const { fade } = l;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.linearRampToValueAtTime(0, now + fadeOut);
    for (const src of l.srcs) {
      try { src.stop(now + fadeOut + 0.05); } catch (e) { /* уже остановлен */ }
    }
    l.srcs = [];
    l.fade = null;
  }

  // Сменить звук слоя; если уже играет — плавный переход.
  setLayer(layerName, id) {
    const l = this.layers[layerName];
    if (l.id === id) return;
    l.id = id;
    if (this.playing) {
      this.stopSource(layerName, 1.2);
      if (id) this.startSource(layerName, 1.5);
      if (!this.hasSelection()) this.stop(0.5);
    }
    this.emit();
  }

  hasSelection() {
    return Boolean(this.layers.noise.id || this.layers.music.id);
  }

  async play(fadeIn = 3) {
    await this.unlock();
    if (!this.hasSelection()) return;
    if (this.playing) this.stopAllSources(0.3);
    this.playing = true;
    this.rampMaster(1, 0.1);
    this.emit();
    await Promise.all([this.startSource('noise', fadeIn), this.startSource('music', fadeIn)]);
  }

  stopAllSources(fadeOut) {
    this.stopSource('noise', fadeOut);
    this.stopSource('music', fadeOut);
  }

  rampMaster(target, sec) {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + Math.max(0.1, sec));
  }

  // Плавно убрать общую громкость за sec секунд (для таймера сна).
  fadeOut(sec) {
    if (this.ctx && this.playing) this.rampMaster(0, sec);
  }

  // Отменить затухание, если таймер сбросили.
  restoreLevel() {
    if (this.ctx && this.playing) this.rampMaster(1, 1.5);
  }

  stop(fadeOut = 1.5) {
    if (!this.playing) return;
    if (this.ctx) {
      this.rampMaster(0, fadeOut);
      this.stopAllSources(fadeOut);
    }
    this.playing = false;
    this.emit();
  }

  // После блокировки экрана или звонка iOS может «заморозить» звук.
  async revive() {
    if (this.ctx && this.playing && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (e) { /* ждём касания */ }
    }
  }

  emit() {
    if (this.onchange) this.onchange();
  }
}

// Микрофон: слушаем, не заплакал ли малыш, и записываем мамин голос.
// Звук никуда не отправляется — всё обрабатывается на телефоне.

export function micSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function recorderSupported() {
  return micSupported() && typeof window.MediaRecorder !== 'undefined';
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

// Слушатель плача. Следит за уровнем звука в полосе детского голоса
// (300–3000 Гц) относительно фонового шума комнаты: если громко
// дольше секунды-полторы — значит, малыш проснулся.
export class CryListener {
  constructor(engine) {
    this.engine = engine;
    this.stream = null;
    this.timer = null;
    this.active = false;
  }

  async start({ sensitivity, onCry, onLevel }) {
    if (this.active) return;
    const ctx = this.engine.ensureContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    this.active = true;
    const source = ctx.createMediaStreamSource(this.stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(hp).connect(lp).connect(analyser);
    this.nodes = [source, hp, lp, analyser];

    const data = new Float32Array(analyser.fftSize);
    // Чем выше чувствительность, тем меньше нужно превысить фон.
    const margin = 24 - sensitivity * 16;
    const history = [];
    let floor = null;
    let cooldown = 15; // первые полторы секунды микрофон «осваивается»

    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const db = 20 * Math.log10(Math.sqrt(sum / data.length) + 1e-9);
      if (floor === null) floor = db;
      // Фон быстро опускается и медленно поднимается.
      floor = db < floor ? floor * 0.9 + db * 0.1 : floor * 0.997 + db * 0.003;
      const loud = db > floor + margin && db > -65;
      history.push(loud);
      if (history.length > 30) history.shift();
      if (onLevel) onLevel(Math.max(0, Math.min(1, (db - floor) / (margin * 1.5))));
      if (cooldown > 0) {
        cooldown--;
        return;
      }
      const loudCount = history.filter(Boolean).length;
      if (loudCount >= 12) {
        this.stop();
        onCry();
      }
    }, 100);
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.nodes) this.nodes.forEach((n) => n.disconnect());
    this.nodes = null;
    stopStream(this.stream);
    this.stream = null;
  }
}

// Запись маминой колыбельной или «шшш».
export class VoiceRecorder {
  constructor() {
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  get recording() {
    return Boolean(this.recorder);
  }

  async start(maxSeconds, onDone) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType || mimeType || 'audio/webm' });
      stopStream(this.stream);
      this.stream = null;
      this.recorder = null;
      clearTimeout(this.limit);
      onDone(blob);
    };
    this.recorder.start();
    this.startedAt = Date.now();
    this.limit = setTimeout(() => this.stop(), maxSeconds * 1000);
  }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
}

const TRACK_RATE = 24000;
const MAX_TRACK_SECONDS = 6 * 60;

function decodeAudio(ctx, raw) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(raw, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

// Подготовить запись или песню к зацикливанию: свести в моно 24 кГц
// (так песня занимает в разы меньше памяти), срезать тишину по краям
// и сделать мягкие вход и выход, чтобы на стыке не было щелчка.
export async function decodeTrack(blob, fallbackCtx) {
  const raw = await blob.arrayBuffer();
  let ctx = fallbackCtx;
  try {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    ctx = new Offline(1, 1, TRACK_RATE);
  } catch (e) { /* старый Safari: декодируем в основном контексте */ }
  const decoded = await decodeAudio(ctx, raw);
  const sr = decoded.sampleRate;
  const total = Math.min(decoded.length, sr * MAX_TRACK_SECONDS);
  const ch = new Float32Array(total);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < total; i++) ch[i] += data[i] / decoded.numberOfChannels;
  }
  let start = 0, end = ch.length - 1;
  const gate = 0.01;
  while (start < end && Math.abs(ch[start]) < gate) start++;
  while (end > start && Math.abs(ch[end]) < gate) end--;
  start = Math.max(0, start - Math.floor(sr * 0.05));
  end = Math.min(ch.length - 1, end + Math.floor(sr * 0.2));
  const pause = Math.floor(sr * 1.2);
  const len = Math.max(1, end - start) + pause;
  const out = ctx.createBuffer(1, len, sr);
  const d = out.getChannelData(0);
  const fade = Math.floor(sr * 0.06);
  let peak = 0;
  for (let i = 0; i < end - start; i++) {
    let v = ch[start + i];
    if (i < fade) v *= i / fade;
    const tail = end - start - i;
    if (tail < fade) v *= tail / fade;
    d[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const gain = peak > 0 ? Math.min(4, 0.8 / peak) : 1;
  for (let i = 0; i < d.length; i++) d[i] *= gain;
  return out;
}

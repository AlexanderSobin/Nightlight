// Фоновый поток: синтезирует звуки, не тормозя интерфейс.
import { renderChannels } from './sound.js';

self.onmessage = (e) => {
  const { id, sr, reqId } = e.data;
  try {
    const chans = renderChannels(id, sr);
    self.postMessage({ reqId, chans }, chans.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ reqId, error: String(err) });
  }
};

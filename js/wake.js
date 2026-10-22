// Не даём экрану погаснуть: телефон и есть ночник.
// Основной способ — Screen Wake Lock API. На iPhone дополнительно
// крутим крошечное беззвучное видео: это надёжно работает и в режиме
// «на экране Домой», где Wake Lock в старых iOS не срабатывал.

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class KeepAwake {
  constructor(video) {
    this.video = video;
    this.lock = null;
    this.enabled = false;
    document.addEventListener('visibilitychange', () => {
      if (this.enabled && document.visibilityState === 'visible') this.acquire();
    });
  }

  // Вызывать из обработчика касания: браузеры требуют жест пользователя.
  enable() {
    this.enabled = true;
    return this.acquire();
  }

  async acquire() {
    let ok = false;
    if ('wakeLock' in navigator && !this.lock) {
      try {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
        ok = true;
      } catch (e) {
        this.lock = null;
      }
    } else if (this.lock) {
      ok = true;
    }
    if ((isIOS || !ok) && this.video) {
      try {
        await this.video.play();
        ok = true;
      } catch (e) { /* попробуем при следующем касании */ }
    }
    return ok;
  }
}

/**
 * The app side of the progressive web app: the service worker (offline use and
 * updates), installing, keeping the screen awake while watching, full screen,
 * the media controls on the lock screen, and a note when offline.
 */
import type { Music } from '../audio/music';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Where a waiting new version is offered: on the start card while it is up (next to sound and
 * country), otherwise as a toast. The card can be up before the hall (and this class) exists.
 */
const update: { apply: (() => void) | null; card: ((apply: () => void) => void) | null; toast: ((apply: () => void) => void) | null } = {
  apply: null,
  card: null,
  toast: null,
};
function offerUpdate(apply: () => void): void {
  update.apply = apply;
  (update.card ?? update.toast)?.(apply);
}
/** The start card shows an Update button while it is up; the returned function hands back to the toast. */
export function updateOnCard(show: (apply: () => void) => void): () => void {
  update.card = show;
  if (update.apply) show(update.apply);
  return () => {
    update.card = null;
    if (update.apply) update.toast?.(update.apply);
  };
}

export class Pwa {
  /** Buttons for the control bar (the HUD puts them in its own group). */
  readonly install = el('button', '', 'Install app');
  readonly fullscreen = el('button', '', 'Full screen');
  private toast = el('div', 'toast');
  private installEvent: InstallEvent | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;

  constructor(
    private root: HTMLElement,
    private music: Music,
  ) {
    root.append(this.toast);
    this.install.hidden = true;
    this.install.title = 'Add Sort sim to your home screen or desktop; it then works offline too';
    this.install.onclick = () => void this.doInstall();
    this.fullscreen.title = 'Full screen (key Z)';
    this.fullscreen.onclick = () => void this.toggleFullscreen();
    this.fullscreen.hidden = !document.fullscreenEnabled;
    document.addEventListener('fullscreenchange', () => {
      this.fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    });
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement)?.tagName !== 'INPUT') void this.toggleFullscreen();
    });

    // Install: browsers that support it offer an event; iOS needs "Add to Home Screen" by hand.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e as InstallEvent;
      this.install.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
      this.install.hidden = true;
      this.say('Installed. Sort sim now also works offline.');
    });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !this.standalone();
    if (ios) {
      this.install.hidden = false;
      this.install.onclick = () => this.say('To install: tap Share, then "Add to Home Screen".', 8000);
    }

    // Offline and back online.
    window.addEventListener('offline', () => this.say('Offline: the hall keeps running from the saved app.'));
    window.addEventListener('online', () => this.say('Back online.'));

    // Keep the screen on while the hall is on screen (watching is the point).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.keepAwake();
    });
    void this.keepAwake();

    this.mediaSession();
    if (import.meta.env.PROD) void this.registerWorker();
  }

  /** Running as an installed app (not in a browser tab). */
  private standalone(): boolean {
    return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }

  private async doInstall(): Promise<void> {
    const ev = this.installEvent;
    if (!ev) return;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') this.install.hidden = true;
    this.installEvent = null;
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* not allowed here */
    }
  }

  private async keepAwake(): Promise<void> {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl || this.wakeLock) return;
    try {
      this.wakeLock = await wl.request('screen');
      (this.wakeLock as unknown as EventTarget).addEventListener?.('release', () => (this.wakeLock = null));
    } catch {
      /* refused (battery saver, or not visible) */
    }
  }

  /** Lock screen and media keys: play and pause the music. */
  private mediaSession(): void {
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.metadata = new MediaMetadata({
      title: 'Sort sim',
      artist: 'A parcel hub to music',
      artwork: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    ms.setActionHandler('play', () => {
      this.music.setMuted(false);
      void this.music.start();
      ms.playbackState = 'playing';
    });
    ms.setActionHandler('pause', () => {
      this.music.setMuted(true);
      ms.playbackState = 'paused';
    });
  }

  /** The service worker: offline use; a new version waits until the visitor says "Update". */
  private async registerWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      update.toast = (apply) => this.say('A new version of Sort sim is ready.', 0, 'Update', apply);
      const offer = (w: ServiceWorker) => offerUpdate(() => w.postMessage('skip-waiting'));
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          if (w.state === 'installed' && !navigator.serviceWorker.controller) this.say('Ready to work offline.');
        });
      });
      // Reload only when a new version takes over from an old one (not on the very first install).
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !hadController) return;
        reloading = true;
        location.reload();
      });
      // Look for a new version now and then (an installed app may stay open for hours).
      setInterval(() => void reg.update(), 60 * 60 * 1000);
    } catch {
      /* no service worker (private mode, file://) */
    }
  }

  /** A short message at the top; with an action button, it stays until used or closed. */
  say(text: string, ms = 4000, action?: string, run?: () => void): void {
    const t = this.toast;
    t.replaceChildren(el('span', '', text));
    if (action && run) {
      const b = el('button', 'primary', action);
      b.onclick = () => {
        run();
        t.classList.remove('show');
      };
      const x = el('button', '', 'Later');
      x.onclick = () => t.classList.remove('show');
      t.append(b, x);
    }
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    if (ms > 0) this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  private toastTimer = 0;
}

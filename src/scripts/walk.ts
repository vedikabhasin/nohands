/**
 * Camera for the gallery walk.
 * Scroll position drives a camera through the corridor: walk forward, turn to a painting, hold,
 * turn back, walk on. The scene receives one transform per frame; overlays receive an opacity
 * variable. Pointer or device tilt adds a small look-around. Geometry is computed here and
 * written as inline styles so the CSS corridor and the camera agree.
 */
type Stop = { id: string; index: number; side: number; ratio: number; el: HTMLElement; panel: HTMLElement | null };

export function initWalk() {
  const walkEl = document.querySelector<HTMLElement>('[data-walk]');
  if (!walkEl) return;
  const walk: HTMLElement = walkEl;
  const stage = walk.querySelector<HTMLElement>('[data-stage]')!;
  const scene = walk.querySelector<HTMLElement>('[data-scene]')!;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const indicator = document.querySelector<HTMLElement>('[data-stop-current]');
  const indicatorWrap = document.querySelector<HTMLElement>('[data-indicator]');

  const stops: Stop[] = Array.from(walk.querySelectorAll<HTMLElement>('[data-hung]'))
    .map((el) => ({
      id: el.dataset.hung!,
      index: Number(el.dataset.index),
      side: Number(el.dataset.side),
      ratio: Number(el.dataset.ratio),
      el,
      panel: walk.querySelector<HTMLElement>(`[data-panel="${CSS.escape(el.dataset.hung!)}"]`),
    }))
    .sort((a, b) => a.index - b.index);
  const order = stops.map((s) => s.id);
  const n = stops.length;

  // --- Geometry ----------------------------------------------------------------------------
  let G = geometry();
  function geometry() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw < 900;
    const A = mobile ? 420 : 560; // half the distance between paintings, also the approach length
    const E = A * 0.7; // corridor behind the first approach, so walls surround the visitor at the door
    const D0 = mobile ? A * 0.1 : A * 0.2; // the short walk from the door to the first approach
    const CW = mobile ? vw * 0.6 : Math.min(vw * 0.46, 520);
    const CH = mobile ? vh * 0.75 : Math.min(vh * 0.52, 520);
    const CL = E + A + n * 2 * A + A;
    return {
      vw,
      vh,
      mobile,
      P: mobile ? 800 : 1100,
      A,
      E,
      D0,
      CW,
      CH,
      CL,
      S: mobile ? 0 : vw * 0.2, // painting sits left of centre on desktop
      Y: mobile ? vh * 0.12 : 0, // painting sits high on mobile
      introSpan: vh * 0.5,
      stopSpan: vh * 2.4,
      pw: (ratio: number) => (mobile ? Math.min(vw * 0.68, vh * 0.44 * ratio) : Math.min(vw * 0.42, vh * 0.62 * ratio)),
      z: (i: number) => -(E + A + i * 2 * A),
    };
  }

  function layout() {
    G = geometry();
    walk.style.setProperty('--p', `${G.P}px`);
    walk.style.setProperty('--cw', `${G.CW}px`);
    walk.style.setProperty('--ch', `${G.CH}px`);
    walk.style.setProperty('--cl', `${G.CL}px`);
    walk.style.setProperty('--spacing', `${2 * G.A}px`);
    walk.style.height = `${G.introSpan + n * G.stopSpan + G.vh}px`;
    for (const s of stops) {
      const depth = -G.z(s.index);
      s.el.style.left = `${s.side < 0 ? depth : G.CL - depth}px`;
      s.el.style.setProperty('--pw', `${G.pw(s.ratio)}px`);
    }
  }

  // --- Camera -------------------------------------------------------------------------------
  const smooth = (t: number) => {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  let tiltX = 0;
  let tiltY = 0;
  let current = -1;
  let lastScrolled = -1;

  const setCurrent = (i: number) => {
    if (i === current) return;
    current = i;
    if (indicatorWrap) indicatorWrap.hidden = i < 0;
    if (i >= 0) {
      if (indicator) indicator.textContent = String(i + 1);
      track('wall_view', { work: order[i] });
    }
  };

  function render(scrolled: number) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let phi = 0;
    let active = -1;
    let hold = 0;

    const start = G.z(0) + G.A + G.D0; // camera position at the door
    if (scrolled < G.introSpan) {
      const t = smooth(scrolled / G.introSpan);
      cz = lerp(start, G.z(0) + G.A, t);
    } else {
      const i = Math.min(n - 1, Math.floor((scrolled - G.introSpan) / G.stopSpan));
      const u = Math.max(0, Math.min(1, (scrolled - G.introSpan - i * G.stopSpan) / G.stopSpan));
      const s = stops[i];
      const zi = G.z(i);
      const holdX = s.side * G.CW; // stand at the wall so the frame renders 1:1
      const holdZ = zi + s.side * G.S;
      const holdPhi = s.side * 90;
      if (u < 0.35) {
        const a = smooth(u / 0.35);
        cx = lerp(0, holdX, a);
        cy = lerp(0, G.Y, a);
        cz = lerp(zi + G.A, holdZ, a);
        phi = lerp(0, holdPhi, a);
      } else if (u < 0.65) {
        cx = holdX;
        cy = G.Y;
        cz = holdZ;
        phi = holdPhi;
      } else {
        const b = smooth((u - 0.65) / 0.35);
        cx = lerp(holdX, 0, b);
        cy = lerp(G.Y, 0, b);
        cz = lerp(holdZ, zi - G.A, b);
        phi = lerp(holdPhi, 0, b);
      }
      active = i;
      hold = smooth((u - 0.28) / 0.12) - smooth((u - 0.6) / 0.12);
    }

    scene.style.transform = `rotateX(${tiltX.toFixed(3)}deg) rotateY(${(phi + tiltY).toFixed(3)}deg) translate3d(${(-cx).toFixed(2)}px, ${(-cy).toFixed(2)}px, ${(-cz).toFixed(2)}px)`;

    for (const s of stops) {
      const h = s.index === active ? hold : 0;
      if (!s.panel) continue;
      s.panel.style.setProperty('--h', h.toFixed(3));
      s.panel.classList.toggle('is-view', h > 0.5);
    }
    setCurrent(active);
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      lastScrolled = -walk.getBoundingClientRect().top;
      render(lastScrolled);
    });
  };

  // --- Tilt ---------------------------------------------------------------------------------
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  if (!reduced && finePointer) {
    let raf = 0;
    stage.addEventListener(
      'pointermove',
      (e) => {
        const x = (e.clientX / G.vw) * 2 - 1;
        const y = (e.clientY / G.vh) * 2 - 1;
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0;
            tiltY = x * 1.6;
            tiltX = -y * 1.1;
            render(lastScrolled);
          });
      },
      { passive: true },
    );
    stage.addEventListener('pointerleave', () => {
      tiltX = 0;
      tiltY = 0;
      render(lastScrolled);
    });
  } else if (!reduced && 'DeviceOrientationEvent' in window) {
    let raf = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const gx = clamp(e.gamma / 25);
      const gy = clamp((e.beta - 45) / 30);
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          tiltY = gx * 2;
          tiltX = -gy * 1.4;
          render(lastScrolled);
        });
    };
    const start = () => window.addEventListener('deviceorientation', onOrient, { passive: true });
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      // iOS grants motion access only from a user gesture; ask once on the first touch.
      const ask = () => {
        DOE.requestPermission!().then((state) => state === 'granted' && start()).catch(() => {});
        walk.removeEventListener('touchend', ask);
      };
      walk.addEventListener('touchend', ask, { passive: true });
    } else {
      start();
    }
  }

  // --- Purchase sheet ----------------------------------------------------------------------
  let lastTrigger: HTMLElement | null = null;
  const dialogFor = (id: string) => document.querySelector<HTMLDialogElement>(`[data-dialog="${CSS.escape(id)}"]`);

  function scrollToStop(id: string, behavior: ScrollBehavior) {
    const i = order.indexOf(id);
    if (i < 0) return;
    if (reduced) {
      document.getElementById(`stop-${id}`)?.scrollIntoView({ block: 'start', behavior });
      return;
    }
    const top = walk.offsetTop + G.introSpan + i * G.stopSpan + G.stopSpan * 0.5;
    window.scrollTo({ top, behavior });
  }

  function setAt(id: string | null) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('at', id);
    else url.searchParams.delete('at');
    history.replaceState(null, '', url);
  }

  function open(id: string, source: 'walk' | 'direct' | 'nav', trigger?: HTMLElement) {
    const dialog = dialogFor(id);
    if (!dialog) return;
    if (trigger) lastTrigger = trigger;
    const openDialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (openDialog && openDialog !== dialog) openDialog.close('switch');
    dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true });
    setAt(id);
    scrollToStop(id, 'instant' as ScrollBehavior);
    track('work_open', { work: id, source });
  }

  walk.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
    if (!btn) return;
    open(btn.dataset.open!, 'walk', btn);
  });

  document.querySelectorAll<HTMLDialogElement>('dialog[data-dialog]').forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === dialog) {
        dialog.close();
        return;
      }
      if (t.closest('[data-close]')) dialog.close();
      const prev = t.closest<HTMLElement>('[data-prev]');
      if (prev && prev.dataset.prev) open(prev.dataset.prev, 'nav');
      const next = t.closest<HTMLElement>('[data-next]');
      if (next && next.dataset.next) open(next.dataset.next, 'nav');
    });
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'switch') {
        dialog.returnValue = '';
        return;
      }
      lastTrigger?.focus({ preventScroll: true });
    });
  });

  document.addEventListener('keydown', (e) => {
    const openDialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (!openDialog) return;
    const i = order.indexOf(openDialog.dataset.dialog!);
    if (e.key === 'ArrowRight' && order[i + 1]) open(order[i + 1], 'nav');
    if (e.key === 'ArrowLeft' && order[i - 1]) open(order[i - 1], 'nav');
  });

  // --- Boot ---------------------------------------------------------------------------------
  if (!reduced) {
    layout();
    window.addEventListener('resize', () => {
      layout();
      onScroll();
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  } else if (indicatorWrap) {
    indicatorWrap.hidden = true;
  }

  const at = new URL(location.href).searchParams.get('at');
  if (at && order.includes(at)) scrollToStop(at, 'instant' as ScrollBehavior);

  // Test hook: seek to stop i at progress u (0 wall, 0.5 hold, 1 leaving).
  (window as unknown as { nohandsWalk: unknown }).nohandsWalk = {
    seek(i: number, u: number) {
      window.scrollTo(0, walk.offsetTop + (i < 0 ? G.introSpan * u : G.introSpan + i * G.stopSpan + u * G.stopSpan));
    },
  };

  track('exhibition_view', { exhibition: walk.dataset.walk });
  window.addEventListener('pagehide', () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
  });
}

type Payload = Record<string, unknown>;
function track(event: string, payload: Payload) {
  document.dispatchEvent(new CustomEvent('nohands:track', { detail: { event, ...payload } }));
}

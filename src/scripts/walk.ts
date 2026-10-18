/**
 * Client behaviour for the gallery walk.
 * Each stop is a tall section with a sticky stage. Scroll progress through the stop drives
 * --zoom (wall view to painting view and back) and --view (details on or off). Both are set as
 * CSS variables; every animated property is transform or opacity, so nothing paints on scroll.
 * Also: pointer and device tilt on the painting plane, the purchase sheet, Previous/Next,
 * the ?at={work} deep link, and the position indicator. Analytics hooks dispatch DOM events.
 */
export function initWalk() {
  const walk = document.querySelector<HTMLElement>('[data-walk]');
  if (!walk) return;

  const stops = Array.from(walk.querySelectorAll<HTMLElement>('section[data-stop]'));
  const order = stops.map((s) => s.dataset.stop!);
  const indicator = document.querySelector<HTMLElement>('[data-stop-current]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const smooth = (p: number, a: number, b: number) => {
    const t = Math.max(0, Math.min(1, (p - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // --- Scroll choreography ---------------------------------------------------------------
  let current = -1;
  const setCurrent = (i: number) => {
    if (i === current || i < 0) return;
    current = i;
    if (indicator) indicator.textContent = String(i + 1);
    track('wall_view', { wall: Number(stops[i].dataset.wall), work: order[i] });
  };

  if (reduced) {
    stops.forEach((s) => {
      s.style.setProperty('--zoom', '1');
      s.style.setProperty('--view', '1');
      s.classList.add('is-view');
    });
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setCurrent(stops.indexOf(e.target as HTMLElement))),
      { threshold: 0.5 },
    );
    stops.forEach((s) => io.observe(s));
  } else {
    let ticking = false;
    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      let best = -1;
      let bestDist = Infinity;
      for (const [i, stop] of stops.entries()) {
        const r = stop.getBoundingClientRect();
        if (r.bottom < -vh || r.top > 2 * vh) continue;
        const travel = r.height - vh;
        const p = travel > 0 ? Math.max(0, Math.min(1, -r.top / travel)) : 0.5;
        const zoom = smooth(p, 0, 0.34) - smooth(p, 0.66, 1);
        const view = smooth(p, 0.24, 0.4) - smooth(p, 0.6, 0.76);
        stop.style.setProperty('--zoom', zoom.toFixed(4));
        stop.style.setProperty('--view', view.toFixed(4));
        stop.classList.toggle('is-view', view > 0.55);
        const dist = Math.abs(r.top + Math.min(r.height, vh) / 2 - vh / 2);
        if (r.top <= vh / 2 && r.bottom >= vh / 2 && dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      }
      setCurrent(best);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  // --- Tilt: pointer on desktop, device orientation on mobile ----------------------------
  const setTilt = (el: HTMLElement, tx: number, ty: number) => {
    el.style.setProperty('--tx', tx.toFixed(3));
    el.style.setProperty('--ty', ty.toFixed(3));
  };
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  if (!reduced && finePointer) {
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      for (const stop of stops) {
        const art = stop.querySelector<HTMLElement>('.art');
        if (!art) continue;
        const r = art.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const dx = (px - (r.left + r.width / 2)) / (r.width * 1.5);
        const dy = (py - (r.top + r.height / 2)) / (r.height * 1.5);
        const falloff = Math.max(0, 1 - Math.max(0, Math.hypot(dx, dy) - 0.6));
        setTilt(stop, clamp(dx) * falloff, clamp(dy) * falloff);
      }
    };
    walk.addEventListener(
      'pointermove',
      (e) => {
        px = e.clientX;
        py = e.clientY;
        if (!raf) raf = requestAnimationFrame(apply);
      },
      { passive: true },
    );
    walk.addEventListener('pointerleave', () => stops.forEach((s) => setTilt(s, 0, 0)));
  } else if (!reduced && 'DeviceOrientationEvent' in window) {
    let raf = 0;
    let gx = 0;
    let gy = 0;
    const apply = () => {
      raf = 0;
      stops.forEach((s) => setTilt(s, gx, gy));
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      gx = clamp(e.gamma / 20);
      gy = clamp((e.beta - 40) / 25);
      if (!raf) raf = requestAnimationFrame(apply);
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
    const stop = document.getElementById(`stop-${id}`);
    if (!stop) return;
    const top = stop.offsetTop + (stop.offsetHeight - window.innerHeight) / 2;
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
    const open = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (open && open !== dialog) open.close('switch');
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

  // Deep link: ?at={work} lands in that painting's view.
  const at = new URL(location.href).searchParams.get('at');
  if (at && order.includes(at)) scrollToStop(at, 'instant' as ScrollBehavior);

  track('exhibition_view', { exhibition: walk.dataset.walk });
  window.addEventListener('pagehide', () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
  });
}

type Payload = Record<string, unknown>;
function track(event: string, payload: Payload) {
  document.dispatchEvent(new CustomEvent('nohands:track', { detail: { event, ...payload } }));
}

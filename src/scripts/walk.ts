/**
 * Client behaviour for the gallery walk.
 * - Parallax: sets --p (scroll progress, -1..1) on each wall; the layers translate from it in CSS.
 * - Interactive realism: pointer position (desktop) or device tilt (mobile) sets --tx/--ty on each
 *   painting so its plane and cast shadow respond. Transforms only; nothing paints on scroll.
 * - Detail panel over the walk, Previous/Next, ?at={work} deep link, wall indicator.
 * Analytics hooks dispatch DOM events; the PostHog wiring listens for them (build step 7).
 */
export function initWalk() {
  const walk = document.querySelector<HTMLElement>('[data-walk]');
  if (!walk) return;

  const walls = Array.from(walk.querySelectorAll<HTMLElement>('.wall'));
  const figures = Array.from(walk.querySelectorAll<HTMLElement>('figure[data-work]'));
  const order = figures.map((f) => f.dataset.work!);
  const indicator = document.querySelector<HTMLElement>('[data-wall-current]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // --- Reveal and indicator --------------------------------------------------------------
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        const n = (entry.target as HTMLElement).dataset.wall;
        if (n && indicator && entry.intersectionRatio >= 0.5) {
          indicator.textContent = n;
          track('wall_view', { wall: Number(n) });
        }
      }
    },
    { threshold: [0.15, 0.5] },
  );
  walls.forEach((w) => io.observe(w));

  // --- Parallax --------------------------------------------------------------------------
  if (!reduced) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      for (const wall of walls) {
        const r = wall.getBoundingClientRect();
        if (r.bottom < -vh || r.top > 2 * vh) continue;
        const p = (r.top + r.height / 2 - vh / 2) / vh;
        wall.style.setProperty('--p', Math.max(-1.2, Math.min(1.2, p)).toFixed(4));
      }
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
  const setTilt = (fig: HTMLElement, tx: number, ty: number) => {
    fig.style.setProperty('--tx', tx.toFixed(3));
    fig.style.setProperty('--ty', ty.toFixed(3));
  };
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  if (!reduced && finePointer) {
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      for (const fig of figures) {
        const r = fig.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // Influence fades with distance so only the painting near the pointer responds.
        const dx = (px - cx) / (r.width * 1.5);
        const dy = (py - cy) / (r.height * 1.5);
        const dist = Math.hypot(dx, dy);
        const falloff = Math.max(0, 1 - Math.max(0, dist - 0.6));
        setTilt(fig, clamp(dx) * falloff, clamp(dy) * falloff);
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
    walk.addEventListener('pointerleave', () => figures.forEach((f) => setTilt(f, 0, 0)));
  } else if (!reduced && 'DeviceOrientationEvent' in window) {
    let raf = 0;
    let gx = 0;
    let gy = 0;
    const apply = () => {
      raf = 0;
      for (const fig of figures) setTilt(fig, gx, gy);
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

  // --- Detail panel ----------------------------------------------------------------------
  let lastTrigger: HTMLElement | null = null;

  function dialogFor(id: string) {
    return document.querySelector<HTMLDialogElement>(`[data-dialog="${CSS.escape(id)}"]`);
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
    const current = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (current && current !== dialog) current.close('switch');
    dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true });
    setAt(id);
    // Keep the walk parked at this work behind the panel so closing lands on it.
    document.getElementById(`work-${id}`)?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
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
    const id = openDialog.dataset.dialog!;
    const i = order.indexOf(id);
    if (e.key === 'ArrowRight' && order[i + 1]) open(order[i + 1], 'nav');
    if (e.key === 'ArrowLeft' && order[i - 1]) open(order[i - 1], 'nav');
  });

  // Deep link: ?at={work} lands on that work.
  const at = new URL(location.href).searchParams.get('at');
  if (at && order.includes(at)) {
    document.getElementById(`work-${at}`)?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    walls.forEach((w) => w.classList.add('is-visible'));
  } else if (reduced) {
    walls.forEach((w) => w.classList.add('is-visible'));
  }

  track('exhibition_view', { exhibition: walk.dataset.walk });
  window.addEventListener('pagehide', () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
  });
}

type Payload = Record<string, unknown>;
function track(event: string, payload: Payload) {
  document.dispatchEvent(new CustomEvent('nohands:track', { detail: { event, ...payload } }));
}

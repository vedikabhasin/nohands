/**
 * Camera for the gallery walk.
 * Scroll position drives an eye through the corridor: walk forward, turn to face a painting so
 * its frame lands 1:1 on screen, hold while the facts show, turn back, walk on. The eye never
 * leaves the corridor and never comes closer than the perspective distance to any surface, so
 * nothing crosses the near plane. The scene receives one transform per frame; overlays receive
 * an opacity variable. Geometry is computed here and written as inline styles so the CSS
 * corridor and the camera agree.
 */
type Stop = {
  id: string;
  index: number;
  side: number;
  ratio: number;
  long: number;
  el: HTMLElement;
  panel: HTMLElement | null;
  details: HTMLElement | null;
  pw: number;
  frameH: number;
  y: number;
};

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
  const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) * 16 || 72;

  const stops: Stop[] = Array.from(walk.querySelectorAll<HTMLElement>('[data-hung]'))
    .map((el) => {
      const id = el.dataset.hung!;
      const panel = walk.querySelector<HTMLElement>(`[data-panel="${CSS.escape(id)}"]`);
      return {
        id,
        index: Number(el.dataset.index),
        side: Number(el.dataset.side),
        ratio: Number(el.dataset.ratio),
        long: Number(el.dataset.long),
        el,
        panel,
        details: panel?.querySelector<HTMLElement>('[data-details]') ?? null,
        pw: 0,
        frameH: 0,
        y: 0,
      };
    })
    .sort((a, b) => a.index - b.index);
  const order = stops.map((s) => s.id);
  const n = stops.length;
  const maxLong = Math.max(...stops.map((s) => s.long));

  // --- Geometry ----------------------------------------------------------------------------
  let G = geometry();
  function geometry() {
    // The stage is 100svh, so its box is stable while mobile browser chrome collapses.
    const vw = stage.clientWidth || window.innerWidth;
    const vh = stage.clientHeight || window.innerHeight;
    const mobile = vw < 900;
    const CW = mobile ? vw * 0.72 : Math.min(vw * 0.44, 640); // half corridor width
    const CH = mobile ? vh * 0.7 : Math.min(vh * 0.5, 520); // half corridor height
    // Perspective distance. Must be less than the corridor width so the eye can stand a full
    // perspective distance from a painting while still inside the corridor (that is what makes
    // the held frame 1:1 without anything crossing the near plane).
    const P = Math.min(mobile ? 520 : 900, 2 * CW * 0.8);
    const A = mobile ? P * 1.5 : P * 1.15; // half the spacing between paintings
    const E = A * 0.6; // corridor behind the door
    const D0 = A * 0.35; // the short walk from the door to the first approach
    const CL = E + D0 + n * 2 * A + A; // entry bay + n bays + end bay
    const baseW = mobile ? vw * 0.84 : Math.min(vw * 0.36, vh * 0.6);
    return {
      vw,
      vh,
      mobile,
      P,
      A,
      E,
      D0,
      CW,
      CH,
      CL,
      S: mobile ? 0 : vw * 0.19, // painting sits left of centre on desktop
      introSpan: mobile ? vh * 1.0 : vh * 0.8,
      stopSpan: vh * 2.6,
      z: (i: number) => -(E + D0 + A + i * 2 * A), // world z of painting i (walk goes toward -z)
      zDoor: -E, // eye z at the door (the entry bay runs from 0 to -(E + D0))
      baseW,
    };
  }

  const frameBand = (pw: number) => Math.max(9, Math.min(0.034 * pw, 28));

  function layout() {
    G = geometry();
    walk.style.setProperty('--p', `${G.P}px`);
    walk.style.setProperty('--cw', `${G.CW}px`);
    walk.style.setProperty('--ch', `${G.CH}px`);
    walk.style.setProperty('--zend', `${G.z(n - 1) - 2 * G.A}px`);
    // Bays: entry (door to the first bay), one per painting, and a short end bay.
    const bays = walk.querySelectorAll<HTMLElement>('[data-bay]');
    for (const bay of bays) {
      const key = bay.dataset.bay!;
      let zc: number;
      let len: number;
      if (key === 'entry') {
        len = G.E + G.D0;
        zc = G.z(0) + G.A + len / 2;
      } else if (key === 'end') {
        len = G.A;
        zc = G.z(n - 1) - G.A - len / 2;
      } else {
        len = 2 * G.A;
        zc = G.z(Number(key));
      }
      bay.style.setProperty('--zc', `${zc}px`);
      bay.style.setProperty('--len', `${len}px`);
    }
    walk.style.height = `${G.introSpan + n * G.stopSpan + G.vh}px`;
    const titleH = 40;
    for (const s of stops) {
      // Gentle relative scale: a 16 in painting hangs a little larger than an 11 in one.
      const rel = Math.sqrt(s.long / maxLong);
      let pw = G.baseW * rel;
      if (s.ratio > 1) pw = Math.min(pw * 1.15, G.mobile ? G.vw * 0.84 : G.vw * 0.4);
      const detailsH = s.details?.offsetHeight ?? 190;
      if (G.mobile) {
        // Mobile: title under the header; hanger, frame and facts form one group centred below it.
        const avail = G.vh - headerH - titleH - 24;
        const fit = (w: number) => {
          const hanger = Math.min(0.16 * w, 88);
          return hanger + w / s.ratio + 2 * frameBand(w) + 26 + detailsH;
        };
        if (fit(pw) > avail) {
          // shrink until the group fits
          let lo = 80;
          let hi = pw;
          for (let k = 0; k < 20; k++) {
            const mid = (lo + hi) / 2;
            if (fit(mid) > avail) hi = mid;
            else lo = mid;
          }
          pw = lo;
        }
        const hangerH = Math.min(0.16 * pw, 88);
        const frameH = pw / s.ratio + 2 * frameBand(pw);
        const group = hangerH + frameH + 26 + detailsH;
        const groupTop = headerH + titleH + (avail - group) / 2;
        const center = groupTop + hangerH + frameH / 2;
        s.pw = pw;
        s.frameH = frameH;
        s.y = G.vh / 2 - center;
        s.panel?.style.setProperty('--details-top', `${groupTop + hangerH + frameH + 26}px`);
      } else {
        // Desktop: frame centred in the band between the header (plus hanger) and the bottom margin.
        const bandTop = headerH + 12;
        const bandBottom = G.vh - 36;
        const fit = (w: number) => Math.min(0.16 * w, 88) + w / s.ratio + 2 * frameBand(w);
        if (fit(pw) > bandBottom - bandTop) {
          let lo = 80;
          let hi = pw;
          for (let k = 0; k < 20; k++) {
            const mid = (lo + hi) / 2;
            if (fit(mid) > bandBottom - bandTop) hi = mid;
            else lo = mid;
          }
          pw = lo;
        }
        const hangerH = Math.min(0.16 * pw, 88);
        const frameH = pw / s.ratio + 2 * frameBand(pw);
        const center = bandTop + hangerH + (bandBottom - bandTop - hangerH) / 2;
        s.pw = pw;
        s.frameH = frameH;
        s.y = G.vh / 2 - center;
        s.panel?.style.removeProperty('--details-top');
      }
      s.el.style.setProperty('--pw', `${pw}px`);
      s.el.style.setProperty('--zp', `${G.z(s.index)}px`);
    }
  }

  // --- Camera -------------------------------------------------------------------------------
  const smooth = (t: number) => {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const rad = Math.PI / 180;

  let tiltX = 0;
  let tiltY = 0;
  let current = -1;
  let lastScrolled = 0;

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
    // Eye position (ex, ey, ez) and heading phi (0 = down the corridor, ±90 = facing a wall).
    let ex = 0;
    let ey = 0;
    let ez = 0;
    let phi = 0;
    let active = -1;
    let hold = 0;

    if (scrolled < G.introSpan) {
      const t = smooth(scrolled / G.introSpan);
      ez = lerp(G.zDoor, G.z(0) + G.A, t);
    } else {
      const i = Math.min(n - 1, Math.floor((scrolled - G.introSpan) / G.stopSpan));
      const u = Math.max(0, Math.min(1, (scrolled - G.introSpan - i * G.stopSpan) / G.stopSpan));
      const s = stops[i];
      const zi = G.z(i);
      // Hold: eye one perspective distance from the painting, inside the corridor, facing it.
      const hx = s.side * (G.CW - G.P);
      const hz = zi + s.side * G.S;
      const hphi = s.side * 90;
      if (u < 0.36) {
        const a = smooth(u / 0.36);
        ex = lerp(0, hx, a);
        ey = lerp(0, s.y, a);
        ez = lerp(zi + G.A, hz, a);
        // Turn toward the painting as you approach: the heading eases onto the bearing of the
        // point on the wall you will face at the hold, so the painting stays in view throughout.
        const dx = s.side * G.CW - ex;
        const dz = hz - ez;
        const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 = straight ahead (-z)
        phi = bearing * smooth(a / 0.35);
      } else if (u < 0.64) {
        ex = hx;
        ey = s.y;
        ez = hz;
        phi = hphi;
      } else {
        const b = smooth((u - 0.64) / 0.36);
        ex = lerp(hx, 0, b);
        ey = lerp(s.y, 0, b);
        ez = lerp(hz, zi - G.A, b);
        // Turn back to the path a little ahead of the walk so the next painting comes into view.
        phi = lerp(hphi, 0, smooth(b / 0.7));
      }
      active = i;
      hold = smooth((u - 0.3) / 0.1) - smooth((u - 0.62) / 0.1);
    }

    // The scene origin sits one perspective distance ahead of the eye along the heading.
    // rotateY(phi) maps the heading (0,0,-1) to (sin phi, 0, -cos phi) in world space.
    const cx = ex + G.P * Math.sin(phi * rad);
    const cz = ez - G.P * Math.cos(phi * rad);
    scene.style.transform = `rotateX(${tiltX.toFixed(3)}deg) rotateY(${(phi + tiltY).toFixed(3)}deg) translate3d(${(-cx).toFixed(2)}px, ${(-ey).toFixed(2)}px, ${(-cz).toFixed(2)}px)`;

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
            tiltY = x * 1.2;
            tiltX = -y * 0.8;
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
          tiltY = gx * 1.5;
          tiltX = -gy * 1.0;
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

  /** Close with the exit animation, then resolve. */
  function closeDialog(dialog: HTMLDialogElement, returnValue = '') {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    if (reduced) {
      dialog.close(returnValue);
      return;
    }
    dialog.classList.add('is-closing');
    const done = () => {
      dialog.classList.remove('is-closing');
      dialog.close(returnValue);
    };
    dialog.addEventListener('animationend', done, { once: true });
    setTimeout(done, 320); // safety if the animation does not fire
  }

  function open(id: string, source: 'walk' | 'direct' | 'nav', trigger?: HTMLElement) {
    const dialog = dialogFor(id);
    if (!dialog) return;
    if (trigger) lastTrigger = trigger;
    const openDialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    const show = () => {
      dialog.showModal();
      dialog.scrollTop = 0;
      dialog.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true });
      setAt(id);
      // Park the walk at this painting only when the visitor is not already there.
      if (order[current] !== id) scrollToStop(id, 'instant' as ScrollBehavior);
      track('work_open', { work: id, source });
    };
    if (openDialog && openDialog !== dialog) {
      openDialog.close('switch');
      requestAnimationFrame(show);
    } else {
      show();
    }
  }

  walk.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
    if (!btn) return;
    open(btn.dataset.open!, 'walk', btn);
  });

  document.querySelectorAll<HTMLDialogElement>('dialog[data-dialog]').forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === dialog || t.closest('[data-close]')) {
        closeDialog(dialog);
        return;
      }
      const prev = t.closest<HTMLElement>('[data-prev]');
      if (prev && prev.dataset.prev) open(prev.dataset.prev, 'nav');
      const next = t.closest<HTMLElement>('[data-next]');
      if (next && next.dataset.next) open(next.dataset.next, 'nav');
    });
    dialog.addEventListener('cancel', (e) => {
      // Escape: run the same exit animation.
      e.preventDefault();
      closeDialog(dialog);
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
    // Decode every corridor image up front and repaint once each lands, so a frame never shows
    // an empty picture while the browser decodes on first raster at a new angle.
    for (const img of walk.querySelectorAll<HTMLImageElement>('[data-hung] img')) {
      const done = () => img.decode().then(() => render(lastScrolled)).catch(() => {});
      if (img.complete) done();
      else img.addEventListener('load', done, { once: true });
    }
    let lastW = G.vw;
    let lastH = G.vh;
    window.addEventListener('resize', () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
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

  // Test hook: seek to stop i at progress u (0 approach start, 0.5 hold, 1 leaving); i = -1 for the door.
  (window as unknown as { nohandsWalk: unknown }).nohandsWalk = {
    seek(i: number, u: number) {
      window.scrollTo(0, walk.offsetTop + (i < 0 ? G.introSpan * u : G.introSpan + i * G.stopSpan + u * G.stopSpan));
    },
    state: () => ({ scrolled: lastScrolled, current, G }),
    render: () => {
      lastScrolled = -walk.getBoundingClientRect().top;
      render(lastScrolled);
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

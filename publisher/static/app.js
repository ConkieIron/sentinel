// Progressive enhancement only. Every page is fully readable without this script.
(() => {
  'use strict';
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Content moves between editions, so the browser's restored scroll position on refresh lands
  // mid-page. Fresh visits and refreshes start at the top; only back/forward restores position.
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
    const key = 'sentinel-scroll:' + location.pathname;
    const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    addEventListener('pagehide', () => {
      try {
        sessionStorage.setItem(key, String(Math.round(scrollY)));
      } catch {}
    });
    let saved = null;
    if (nav?.type === 'back_forward') {
      try {
        saved = sessionStorage.getItem(key);
      } catch {}
    }
    if (saved !== null) {
      addEventListener('load', () => scrollTo(0, Number(saved) || 0), { once: true });
    } else if (location.hash) {
      addEventListener(
        'load',
        () => {
          const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
          if (!el) return;
          const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
          scrollTo(0, el.getBoundingClientRect().top + scrollY - offset);
        },
        { once: true },
      );
    } else {
      scrollTo(0, 0);
    }
  }

  // Relative + local times
  const rtf = 'Intl' in window && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }) : null;
  const local = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function relative(ts) {
    const mins = Math.round((ts - Date.now()) / 60000);
    if (!rtf) return local.format(ts);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    if (Math.abs(mins) < 1440) return rtf.format(Math.round(mins / 60), 'hour');
    return rtf.format(Math.round(mins / 1440), 'day');
  }
  function refreshTimes() {
    for (const t of $$('time[data-rel]')) {
      const ts = Date.parse(t.getAttribute('datetime'));
      if (!Number.isFinite(ts)) continue;
      t.textContent = relative(ts);
      t.title = local.format(ts);
    }
  }
  refreshTimes();
  setInterval(refreshTimes, 60000);
  const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const t of $$('time[data-clock]')) {
    const ts = Date.parse(t.getAttribute('datetime'));
    if (Number.isFinite(ts)) t.textContent = clock.format(ts);
  }

  // Masthead rotators (stock markets, world clock): fade to the next item every 5 seconds. Tap for
  // the next one. Taps on touch screens leave focus and a synthetic hover behind, so only a real
  // mouse or keyboard focus pauses them.
  function rotator(el, next, delay = 0) {
    let paused = false;
    const advance = () => {
      el.classList.add('is-switching');
      setTimeout(() => {
        next();
        el.classList.remove('is-switching');
      }, 250);
    };
    setTimeout(() => setInterval(() => !paused && !document.hidden && advance(), 5000), delay);
    el.addEventListener('click', advance);
    el.addEventListener('pointerenter', (e) => (paused = e.pointerType === 'mouse'));
    el.addEventListener('pointerleave', () => (paused = false));
    el.addEventListener('focus', () => (paused = el.matches(':focus-visible')));
    el.addEventListener('blur', () => (paused = false));
  }

  const ticker = document.querySelector('[data-ticker]');
  const tickerItems = ticker ? $$('[data-ticker-item]', ticker) : [];
  if (tickerItems.length > 1) {
    let shown = 0;
    // Offset from the clock so the two never change at the same moment.
    rotator(
      ticker,
      () => {
        tickerItems[shown].hidden = true;
        shown = (shown + 1) % tickerItems.length;
        tickerItems[shown].hidden = false;
      },
      2500,
    );
  }

  // World clock: cycles through major cities.
  const worldClock = document.querySelector('[data-world-clock]');
  if (worldClock) {
    const ZONES = [
      ['London', 'Europe/London'],
      ['New York', 'America/New_York'],
      ['Los Angeles', 'America/Los_Angeles'],
      ['São Paulo', 'America/Sao_Paulo'],
      ['Lagos', 'Africa/Lagos'],
      ['Moscow', 'Europe/Moscow'],
      ['Dubai', 'Asia/Dubai'],
      ['New Delhi', 'Asia/Kolkata'],
      ['Beijing', 'Asia/Shanghai'],
      ['Tokyo', 'Asia/Tokyo'],
      ['Sydney', 'Australia/Sydney'],
    ];
    const formats = ZONES.flatMap(([city, timeZone]) => {
      try {
        const offset = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' });
        return [{ city, time: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), day: new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }), offset }];
      } catch {
        return [];
      }
    });
    const [cityEl, timeEl, metaEl] = ['.wc-city', '.wc-time', '.wc-meta'].map((s) => worldClock.querySelector(s));
    let index = 0;
    function render() {
      const now = new Date();
      const f = formats[index];
      const offset = f.offset.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', 'UTC') || '';
      cityEl.textContent = f.city;
      timeEl.textContent = f.time.format(now);
      metaEl.textContent = `${f.day.format(now)} · ${offset === 'UTC' ? 'UTC+0' : offset}`;
    }
    if (formats.length) {
      render();
      worldClock.hidden = false;
      setInterval(render, 1000);
      rotator(worldClock, () => {
        index = (index + 1) % formats.length;
        render();
      });
    }
  }

  // Category filter + "show more" for incident lists
  for (const list of $$('.story-list')) {
    const size = Number(list.dataset.pageSize) || 25;
    const chips = list.previousElementSibling?.classList.contains('chips') ? list.previousElementSibling : null;
    const stories = $$('.story', list);
    let filter = 'all';
    let hideSocial = false;
    let limit = size;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'show-more';
    list.after(button);

    function apply() {
      const matching = stories.filter((s) => (filter === 'all' || s.dataset.cat === filter) && !(hideSocial && s.dataset.ev === 'social'));
      for (const s of stories) s.hidden = true;
      matching.slice(0, limit).forEach((s) => (s.hidden = false));
      const remaining = matching.length - limit;
      button.hidden = remaining <= 0;
      button.textContent = `Show ${Math.min(remaining, size)} more of ${remaining}`;
    }
    button.addEventListener('click', () => {
      limit += size;
      apply();
    });
    if (chips) {
      chips.hidden = false;
      chips.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        if (chip.dataset.filter === 'verified') {
          hideSocial = !hideSocial;
          chip.setAttribute('aria-pressed', String(hideSocial));
        } else {
          filter = chip.dataset.filter;
          for (const c of $$('.chip', chips)) if (c.dataset.filter !== 'verified') c.setAttribute('aria-pressed', String(c === chip));
        }
        limit = size;
        apply();
      });
    }
    apply();
  }

  // Reveal an incident targeted by a map pin even if it is collapsed or paged out.
  function reveal(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    const details = el.closest('details');
    if (details) details.open = true;
    if (el.hidden) el.hidden = false;
    el.scrollIntoView({ block: 'center' });
    return true;
  }
  if (location.hash.startsWith('#i-')) reveal(location.hash.slice(1));
  window.addEventListener('hashchange', () => location.hash.startsWith('#i-') && reveal(location.hash.slice(1)));

  // Map pin pop-ups
  for (const map of $$('figure.map')) {
    const popup = map.querySelector('.map-popup');
    if (!popup) continue;
    map.addEventListener('click', (e) => {
      const pin = e.target.closest('.pin');
      if (!pin) return;
      e.preventDefault();
      popup.replaceChildren();
      const close = document.createElement('button');
      close.className = 'close';
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      close.addEventListener('click', () => (popup.hidden = true));
      const title = document.createElement('strong');
      title.textContent = pin.dataset.title;
      const meta = document.createElement('div');
      meta.className = 'muted small';
      meta.textContent = pin.dataset.meta;
      const links = document.createElement('div');
      links.className = 'popup-links';
      if (/^https?:\/\//.test(pin.dataset.url || '')) {
        const article = document.createElement('a');
        article.href = pin.dataset.url;
        article.target = '_blank';
        article.rel = 'noopener noreferrer';
        article.textContent = 'Open article ↗';
        links.append(article);
      }
      const summary = document.createElement('a');
      if (document.getElementById('i-' + pin.dataset.id)) {
        summary.href = '#i-' + pin.dataset.id;
        summary.textContent = 'Incident summary ↓';
        summary.addEventListener('click', () => (popup.hidden = true));
        links.append(summary);
      } else if (/^[a-z0-9-]+$/.test(pin.dataset.region || '')) {
        summary.href = `/region/${pin.dataset.region}/#i-${pin.dataset.id}`;
        summary.textContent = 'Incident summary →';
        links.append(summary);
      }
      popup.append(close, title, meta, links);
      popup.hidden = false;
    });
  }

  // Notify when a newer static edition has been published. Live pages check every minute and
  // count the new updates on their story.
  const generated = document.querySelector('meta[name="sentinel-generated"]')?.content;
  const banner = document.querySelector('.update-banner');
  const bannerText = banner?.querySelector('[data-banner-text]');
  const feed = document.querySelector('.live-feed[data-live-id]');
  async function checkEdition() {
    if (document.hidden || !generated || !banner) return;
    try {
      const res = await fetch('/data/meta.json', { cache: 'no-store' });
      if (!res.ok) return;
      const meta = await res.json();
      if (!meta.generatedAt || meta.generatedAt === generated) return;
      if (feed && bannerText) {
        const live = await (await fetch('/data/live.json', { cache: 'no-store' })).json();
        const story = (live.stories || []).find((s) => s.id === feed.dataset.liveId);
        const fresh = story ? story.times.filter((t) => t > Number(feed.dataset.latest)).length : 0;
        if (fresh) bannerText.textContent = `${fresh} new update${fresh === 1 ? '' : 's'}`;
      }
      banner.hidden = false;
    } catch {}
  }
  banner?.querySelector('[data-reload]')?.addEventListener('click', (e) => {
    e.preventDefault();
    location.reload();
  });
  setInterval(checkEdition, (feed ? 1 : 2) * 60000);
  document.addEventListener('visibilitychange', checkEdition);
})();

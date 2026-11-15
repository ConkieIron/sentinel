// Progressive enhancement only. Every page is fully readable without this script.
(() => {
  'use strict';
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const $ = (sel, root = document) => root.querySelector(sel);

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

  // Publisher pictures can be withdrawn or blocked; drop the whole figure rather than show a broken image.
  for (const fig of $$('[data-hide-on-error]')) {
    const img = $('img', fig);
    if (!img) continue;
    const hide = () => {
      fig.hidden = true;
      fig.parentElement.classList.remove('has-figure');
    };
    if (img.complete && !img.naturalWidth) hide();
    else img.addEventListener('error', hide);
  }

  // Phones get shorter pages of lists, and sidebar panels stay folded under the main column.
  const narrow = matchMedia('(max-width: 599px)').matches;
  if (matchMedia('(min-width: 980px)').matches) for (const d of $$('details[data-open-wide]')) d.open = true;

  // Live coverage: the newest updates first, the rest a tap away.
  for (const feed of $$('.live-feed[data-page-size]')) {
    const posts = $$('.live-post', feed);
    const size = narrow ? 12 : Number(feed.dataset.pageSize) || 20;
    let shown = size;
    if (posts.length <= size) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'show-more';
    feed.after(button);
    const apply = () => {
      posts.forEach((p, i) => (p.hidden = i >= shown));
      const remaining = posts.length - shown;
      button.hidden = remaining <= 0;
      const next = Math.min(remaining, size);
      if (remaining > 0) button.textContent = `Show ${next} earlier update${next === 1 ? '' : 's'}${remaining > size ? ` (${remaining} more)` : ''}`;
    };
    button.addEventListener('click', () => {
      shown += size;
      apply();
    });
    apply();
  }

  // Category filter + "show more" for incident lists
  for (const list of $$('.story-list')) {
    const size = narrow ? Math.min(10, Number(list.dataset.pageSize) || 25) : Number(list.dataset.pageSize) || 25;
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
      if (remaining > 0) button.textContent = remaining > size ? `Show ${size} more of ${remaining}` : `Show ${remaining} more`;
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

  // Country search: an exact (or unambiguous) name opens that country's page; anything else
  // falls through to the A–Z list, which filters itself by the query.
  for (const form of $$('[data-country-search]')) {
    const input = $('input', form);
    const options = $$('option', form).map((o) => ({ key: o.value.toLowerCase(), href: o.dataset.href }));
    const find = (value) => {
      const q = value.trim().toLowerCase();
      if (!q) return null;
      const starts = options.filter((o) => o.key.startsWith(q));
      return options.find((o) => o.key === q) || (starts.length === 1 ? starts[0] : null);
    };
    form.addEventListener('submit', (e) => {
      const hit = find(input.value);
      if (hit) {
        e.preventDefault();
        location.href = hit.href;
      }
    });
    // Picking a suggestion from the list goes straight there.
    input.addEventListener('input', (e) => {
      if (e.inputType && e.inputType !== 'insertReplacementText') return;
      const q = input.value.trim().toLowerCase();
      const hit = options.find((o) => o.key === q);
      if (hit) location.href = hit.href;
    });
  }
  const countryList = $('[data-country-list]');
  if (countryList) {
    const input = $('[data-country-search] input');
    const empty = $('[data-country-empty]');
    const rows = $$('li', countryList);
    const filter = () => {
      const q = (input?.value || '').trim().toLowerCase();
      let shown = 0;
      for (const row of rows) {
        row.hidden = Boolean(q) && !row.dataset.name.includes(q);
        if (!row.hidden) shown++;
      }
      if (empty) empty.hidden = shown > 0;
    };
    if (input) {
      input.value = new URLSearchParams(location.search).get('q') || '';
      input.addEventListener('input', filter);
    }
    filter();
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

  // Local Incidents: match GPS to a country centroid on-device, then reveal that country's cards.
  const localRoot = $('[data-local]');
  if (localRoot) {
    const status = $('[data-local-status]', localRoot);
    const result = $('[data-local-result]', localRoot);
    const fallback = $('[data-local-fallback]', localRoot);
    const message = $('[data-local-message]', localRoot);
    const countryEl = $('[data-local-country]', localRoot);
    const labelEl = $('[data-local-label]', localRoot);
    const metaEl = $('[data-local-meta]', localRoot);
    const briefing = $('[data-local-briefing]', localRoot);
    const empty = $('[data-local-empty]');
    const list = $('[data-local-list]');
    const locateBtn = $('[data-local-locate]', localRoot);
    const retryBtn = $('[data-local-retry]', localRoot);
    const items = list ? $$('[data-iso3]', list) : [];
    // v2: catchment scoring replaced pure nearest-centroid (which mis-labelled UK as Jersey).
    const CACHE_KEY = 'sentinel-local-iso3-v2';
    let geo = null;

    // Same rules as publisher/src/localGeo.js: microstate catchments + regional hubs for large
    // countries (so Brighton → UK, not Belgium/Jersey).
    const HUBS = {
      GBR: [
        [54.4, -2.12],
        [51.51, -0.13],
        [52.48, -1.9],
        [53.48, -2.24],
        [55.95, -3.19],
        [54.6, -5.93],
        [51.45, -2.6],
        [50.91, -1.4],
      ],
      FRA: [
        [46.6, 2.5],
        [48.86, 2.35],
        [49.63, -1.62],
        [48.11, -1.68],
        [43.3, 5.37],
        [44.84, -0.58],
        [45.75, 4.85],
        [50.63, 3.06],
      ],
      USA: [
        [39.54, -97.48],
        [40.71, -74.01],
        [34.05, -118.24],
        [41.88, -87.63],
        [29.76, -95.37],
        [33.75, -84.39],
        [47.61, -122.33],
        [25.76, -80.19],
      ],
      CAN: [
        [60.32, -101.91],
        [43.65, -79.38],
        [45.5, -73.57],
        [49.28, -123.12],
        [45.42, -75.69],
        [53.55, -113.49],
      ],
      AUS: [
        [-24.13, 134.05],
        [-33.87, 151.21],
        [-37.81, 144.96],
        [-27.47, 153.03],
        [-31.95, 115.86],
        [-34.93, 138.6],
      ],
      DEU: [
        [51.2, 10.4],
        [52.52, 13.4],
        [48.14, 11.58],
        [50.11, 8.68],
        [53.55, 9.99],
      ],
      ITA: [
        [42.5, 12.5],
        [41.9, 12.5],
        [45.46, 9.19],
        [40.85, 14.27],
        [45.07, 7.69],
      ],
      ESP: [
        [40.2, -3.5],
        [40.42, -3.7],
        [41.39, 2.17],
        [37.39, -5.98],
        [39.47, -0.38],
      ],
    };
    const km = (aLat, aLon, bLat, bLon) => {
      const r = Math.PI / 180;
      const x =
        Math.sin(((bLat - aLat) * r) / 2) ** 2 +
        Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
      return 12742 * Math.asin(Math.sqrt(x));
    };
    const distTo = (lat, lon, c) => {
      const hubs = HUBS[c.iso3];
      if (hubs) {
        let best = Infinity;
        for (const [hLat, hLon] of hubs) best = Math.min(best, km(lat, lon, hLat, hLon));
        return best;
      }
      return km(lat, lon, c.lat, c.lon);
    };
    const nearest = (lat, lon, maxKm = 1500) => {
      let best = null;
      for (const c of geo || []) {
        const d = distTo(lat, lon, c);
        if (d > maxKm) continue;
        const catchKm = c.catchKm || 1100;
        if (d > catchKm) continue;
        if (!best || d < best.d) best = { c, d };
      }
      return best ? best.c : null;
    };
    const setMessage = (text) => {
      if (message) message.textContent = text;
    };
    const showCountry = (country) => {
      try {
        sessionStorage.setItem(CACHE_KEY, country.iso3);
      } catch {}
      if (status) status.hidden = true;
      if (result) result.hidden = false;
      if (fallback) fallback.hidden = true;
      if (labelEl) labelEl.textContent = 'Your location';
      if (countryEl) countryEl.textContent = country.name;
      let shown = 0;
      for (const el of items) {
        const match = el.dataset.iso3 === country.iso3;
        el.hidden = !match;
        if (match) shown++;
      }
      if (metaEl) {
        metaEl.textContent = shown
          ? `${shown} verified incident${shown === 1 ? '' : 's'} in this edition`
          : 'No verified incidents in this country in the current edition';
      }
      if (empty) {
        empty.hidden = shown > 0;
        empty.textContent = shown
          ? ''
          : `No verified incidents were reported in ${country.name} in this edition.`;
      }
      if (briefing) {
        if (country.path) {
          briefing.hidden = false;
          briefing.href = country.path;
          briefing.textContent = `${country.name} briefing →`;
        } else {
          briefing.hidden = true;
        }
      }
    };
    const fail = (text, { showFallback = true } = {}) => {
      if (status) status.hidden = false;
      if (result) result.hidden = true;
      setMessage(text);
      if (locateBtn) {
        locateBtn.disabled = false;
        locateBtn.textContent = 'Try again';
      }
      if (fallback) fallback.hidden = !showFallback;
      for (const el of items) el.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'Use your location above to load local headlines.';
      }
    };
    const locate = () => {
      if (!navigator.geolocation) {
        fail('This browser cannot share a location. Pick a country by name instead.');
        return;
      }
      if (locateBtn) {
        locateBtn.disabled = true;
        locateBtn.textContent = 'Locating…';
      }
      setMessage('Finding your country…');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            if (!geo) {
              const res = await fetch('/data/countries-geo.json', { cache: 'force-cache' });
              if (!res.ok) throw new Error('geo');
              geo = await res.json();
            }
            const country = nearest(pos.coords.latitude, pos.coords.longitude);
            if (!country) {
              fail('Could not match that location to a country. You may be too far offshore — pick a country by name.');
              return;
            }
            showCountry(country);
            if (locateBtn) {
              locateBtn.disabled = false;
              locateBtn.textContent = 'Use my location';
            }
          } catch {
            fail('Could not load the country list. Check your connection and try again.');
          }
        },
        (err) => {
          if (err?.code === 1) {
            fail('Location permission was blocked. Allow location for this site, or pick a country by name.');
          } else if (err?.code === 3) {
            fail('Location timed out. Try again, or pick a country by name.');
          } else {
            fail('Could not read your location. Try again, or pick a country by name.');
          }
        },
        { enableHighAccuracy: false, maximumAge: 600000, timeout: 15000 },
      );
    };
    locateBtn?.addEventListener('click', locate);
    retryBtn?.addEventListener('click', () => {
      try {
        sessionStorage.removeItem(CACHE_KEY);
      } catch {}
      if (status) status.hidden = false;
      if (result) result.hidden = true;
      setMessage('Share your location to see verified incidents reported in your country.');
      if (locateBtn) {
        locateBtn.disabled = false;
        locateBtn.textContent = 'Use my location';
      }
      locate();
    });

    (async () => {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const res = await fetch('/data/countries-geo.json', { cache: 'force-cache' });
          if (res.ok) {
            geo = await res.json();
            const country = geo.find((c) => c.iso3 === cached);
            if (country) {
              showCountry(country);
              return;
            }
          }
        }
        if (navigator.permissions?.query) {
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'granted') locate();
        }
      } catch {}
    })();
  }

  // Notify when a newer static edition has been published. Live pages check every minute and
  // count the new updates on their story. A brand-new Breaking lead also gets a full-screen flash.
  const generated = document.querySelector('meta[name="sentinel-generated"]')?.content;
  const pageBreaking = document.querySelector('meta[name="sentinel-breaking"]')?.content || '';
  const banner = document.querySelector('.update-banner');
  const bannerText = banner?.querySelector('[data-banner-text]');
  const feed = document.querySelector('.live-feed[data-live-id]');
  const flash = $('[data-breaking-flash]');
  const SEEN_BREAKING = 'sentinel-breaking-seen';
  try {
    // Seed so an already-open Breaking story does not flash on the next poll.
    if (pageBreaking && !sessionStorage.getItem(SEEN_BREAKING)) sessionStorage.setItem(SEEN_BREAKING, pageBreaking);
  } catch {}

  let flashTimer = 0;
  function hideBreakingFlash() {
    if (!flash) return;
    flash.hidden = true;
    document.documentElement.style.overflow = '';
    clearTimeout(flashTimer);
  }
  function showBreakingFlash(story) {
    if (!flash || !story?.id || !story.title) return;
    const title = $('[data-bf-title]', flash);
    const link = $('[data-bf-link]', flash);
    if (title) title.textContent = story.title.length > 160 ? story.title.slice(0, 159).replace(/\s+\S*$/, '') + '…' : story.title;
    if (link) {
      link.href = story.path || `/live/${story.id}/`;
      link.focus();
    }
    flash.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(hideBreakingFlash, 10000);
    try {
      sessionStorage.setItem(SEEN_BREAKING, story.id);
    } catch {}
  }
  flash?.querySelector('[data-bf-dismiss]')?.addEventListener('click', hideBreakingFlash);
  flash?.addEventListener('click', (e) => {
    if (e.target === flash) hideBreakingFlash();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && flash && !flash.hidden) hideBreakingFlash();
  });

  async function checkEdition() {
    if (document.hidden || !generated) return;
    try {
      const res = await fetch('/data/meta.json', { cache: 'no-store' });
      if (!res.ok) return;
      const meta = await res.json();
      if (!meta.generatedAt || meta.generatedAt === generated) return;

      let live = null;
      try {
        live = await (await fetch('/data/live.json', { cache: 'no-store' })).json();
      } catch {}
      if (feed && bannerText && live) {
        const story = (live.stories || []).find((s) => s.id === feed.dataset.liveId);
        const fresh = story ? story.times.filter((t) => t > Number(feed.dataset.latest)).length : 0;
        if (fresh) bannerText.textContent = `${fresh} new update${fresh === 1 ? '' : 's'}`;
      }
      const lead = (live?.stories || []).find((s) => s.breaking) || live?.stories?.[0];
      let seen = '';
      try {
        seen = sessionStorage.getItem(SEEN_BREAKING) || '';
      } catch {}
      if (lead?.id && lead.id !== seen) showBreakingFlash(lead);
      if (banner) banner.hidden = false;
    } catch {}
  }
  banner?.querySelector('[data-reload]')?.addEventListener('click', (e) => {
    e.preventDefault();
    location.reload();
  });
  setInterval(checkEdition, (feed ? 1 : 2) * 60000);
  document.addEventListener('visibilitychange', checkEdition);
})();

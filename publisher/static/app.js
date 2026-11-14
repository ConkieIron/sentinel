// Progressive enhancement only. Every page is fully readable without this script.
(() => {
  'use strict';
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Relative + local times
  const rtf = 'Intl' in window && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
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
      summary.href = '#i-' + pin.dataset.id;
      summary.textContent = 'Incident summary ↓';
      summary.addEventListener('click', () => (popup.hidden = true));
      links.append(summary);
      popup.append(close, title, meta, links);
      popup.hidden = false;
    });
  }

  // Notify when a newer static edition has been published.
  const generated = document.querySelector('meta[name="sentinel-generated"]')?.content;
  const banner = document.querySelector('.update-banner');
  async function checkEdition() {
    if (document.hidden || !generated || !banner) return;
    try {
      const res = await fetch('/data/meta.json', { cache: 'no-store' });
      if (!res.ok) return;
      const meta = await res.json();
      if (meta.generatedAt && meta.generatedAt !== generated) banner.hidden = false;
    } catch {}
  }
  banner?.querySelector('[data-reload]')?.addEventListener('click', (e) => {
    e.preventDefault();
    location.reload();
  });
  setInterval(checkEdition, 5 * 60000);
  document.addEventListener('visibilitychange', checkEdition);
})();

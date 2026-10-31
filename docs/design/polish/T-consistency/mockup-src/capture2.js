// The second sweep's parts (section bars, phone headers, tabs, toolbars, fields, tags) from every page of every approved
// mockup into caps2/, clipped from the page at each part's measured box (needs Playwright).
const { chromium } = require('playwright'); const fs = require('fs'); const crypto = require('crypto');
const ROOT = __dirname + '/../../';
const FILES = ['A-frame/frame.html', 'B-arrival/arrival.html', 'C-table/table.html', 'C2-map-menus/map-menus.html', 'C3-gm-panel/gm-panel.html', 'C3-running/running.html', 'C4-C6-player/a-player-in-a-fight.html', 'C5-log-dice/log-and-dice.html', 'D-characters/characters.html', 'E-prep/prep.html', 'E2-maps-tokens/maps-and-tokens.html', 'E3-sound-screen/sound-and-the-screen.html', 'E3-replays/replays.html', 'F-codex/codex.html', 'F-finding-pages/finding-and-pages.html', 'F-story-people/story-and-people.html', 'F3-atlas/the-atlas.html', 'F-time-tools/time-and-tools.html', 'G-compendium/compendium.html', 'G-compendium-pages/compendium-pages.html', 'H-table-screen/table-screen.html', 'I-settings/settings.html', 'I-settings-leftovers/settings-leftovers.html'];
const L = s => s.split(',').map(x => '#v-laptop ' + x.trim()).join(','), P = s => s.split(',').map(x => '#v-phone ' + x.trim()).join(',');
const GROUPS = {
  sbar: [L('.sb'), 300, 30],
  pbar: [P('.pbar'), 200, 30],
  tool: [L('.e-tool') + ',' + P('.e-tool'), 150, 24],
  tabs: [L('.e-tabs, .sh-tabs, .ctabs, .k-tabs') + ',' + P('.e-tabs, .sh-tabs, .ctabs, .k-tabs'), 150, 24],
  field: [L('.e-field, .find, .q-fld') + ',' + P('.e-field, .find, .q-fld'), 80, 20],
  tag: [L('.tag, .e-st, .f-kind, .e-ready, .live-chip, .e-gmtag, .gm-tag') + ',' + P('.tag, .e-st, .f-kind, .e-ready, .live-chip'), 10, 10],
};
(async () => {
  const b = await chromium.launch(); const out = []; const seen = new Set(); const cups = []; const empties = [];
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' });
  for (const f of FILES) {
    for (let k = 0; k < 4; k++) { await p.goto('file://' + ROOT + f); if ((await p.evaluate(() => document.characterSet)) === 'UTF-8') break; } await p.addStyleTag({ content: '.switch-bar,.mbar{position:static!important} html,body,*{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important}' }); await p.waitForTimeout(600);
    const pages = await p.$$eval('#pg-seg button', bs => bs.map(x => [x.dataset.v, x.textContent.trim()])).catch(() => []);
    for (const [v, label] of (pages.length ? pages : [[null, 'default']])) {
      if (v) { await p.click('#pg-seg button[data-v="' + v + '"]').catch(() => {}); await p.waitForTimeout(300); }
      for (const [g, [sel, minW, minH]] of Object.entries(GROUPS)) {
        const els = await p.$$(sel);
        for (const el of els) {
          const box = await el.boundingBox(); if (!box || box.width < minW || box.height < minH) continue;
          const info = await el.evaluate(n => { const fr = n.closest('#v-laptop') ? 'laptop' : 'phone'; const t = n.outerHTML.replace(/\s+/g, ' ').replace(/data:[^"')]+/g, ''); return { fr, html: t.slice(0, 3000), cls: n.className, text: n.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) }; });
          const h = crypto.createHash('md5').update(g + info.html).digest('hex').slice(0, 10);
          if (seen.has(h)) continue; seen.add(h);
          const name = g + '-' + f.split('/')[0] + '-' + (v || 'default') + '-' + h + '.png';
          await el.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(60); const bb = await el.boundingBox(); if (bb) await p.screenshot({ path: __dirname + '/caps2/' + name, clip: bb }).catch(() => {});
          out.push({ g, area: f.split('/')[0], page: label, v, fr: info.fr, file: name, w: Math.round(box.width), h: Math.round(box.height), cls: info.cls, text: info.text });
        }
      }
      // Where each primary (the Cup) sits, and how many a frame shows.
      const c = await p.$$eval('#v-laptop .frame .cup, #v-phone .frame .cup', els => els.filter(e => e.getBoundingClientRect().width > 0).map(e => { const fr = e.closest('#v-laptop') ? 'laptop' : 'phone'; const chain = []; let n = e.parentElement; while (n && !n.classList.contains('frame') && chain.length < 8) { if (typeof n.className === 'string' && n.className) chain.push(n.className.split(' ')[0]); n = n.parentElement; } const r = e.getBoundingClientRect(), F = e.closest('.frame').getBoundingClientRect(); return { fr, text: e.textContent.trim(), chain: chain.join(' < '), x: Math.round((r.left - F.left) / F.width * 100), y: Math.round((r.top - F.top) / F.height * 100) }; }));
      c.forEach(x => cups.push(Object.assign({ area: f.split('/')[0], page: label }, x)));
      // Empty states: short lines that say something is missing.
      const e = await p.$$eval('#v-laptop .frame *, #v-phone .frame *', els => els.filter(n => n.children.length === 0 && /^(No |Nothing |None |Not )/.test(n.textContent.trim()) && n.textContent.trim().length > 12 && n.getBoundingClientRect().width > 0).map(n => ({ fr: n.closest('#v-laptop') ? 'laptop' : 'phone', text: n.textContent.trim().slice(0, 140), cls: n.className, parent: n.parentElement.className, sib: Array.from(n.parentElement.children).map(s => s.className.split(' ')[0] + ':' + s.textContent.trim().slice(0, 30)).join(' | ').slice(0, 200) })));
      e.forEach(x => empties.push(Object.assign({ area: f.split('/')[0], page: label }, x)));
    }
  }
  fs.writeFileSync(__dirname + '/caps2.json', JSON.stringify(out, null, 1));
  fs.writeFileSync(__dirname + '/cups2.json', JSON.stringify(cups, null, 1));
  fs.writeFileSync(__dirname + '/empties2.json', JSON.stringify(empties, null, 1));
  const n = {}; out.forEach(o => { n[o.g] = (n[o.g] || 0) + 1; }); console.log(n, 'cups', cups.length, 'empties', empties.length);
  await b.close();
})();

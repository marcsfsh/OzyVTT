// The fifth sweep's parts (kind cards, bars you act in, tags, closes, steppers, tabs, fields, lamps, step marks, the
// frame's turn order, titles in a page, eyebrows, and Dawn's amber, magenta and violet words) from every page of every
// approved mockup into caps5/, clipped from the page at each part's measured box (needs Playwright).
// The mockups declare no encoding, so each is loaded again until the browser reads it as UTF-8.
const { chromium } = require('playwright'); const fs = require('fs'); const crypto = require('crypto');
const ROOT = __dirname + '/../../';
const FILES = ['A-frame/frame.html', 'B-arrival/arrival.html', 'C-table/table.html', 'C2-map-menus/map-menus.html', 'C3-gm-panel/gm-panel.html', 'C3-running/running.html', 'C4-C6-player/a-player-in-a-fight.html', 'C5-log-dice/log-and-dice.html', 'D-characters/characters.html', 'E-prep/prep.html', 'E2-maps-tokens/maps-and-tokens.html', 'E3-sound-screen/sound-and-the-screen.html', 'E3-replays/replays.html', 'F-codex/codex.html', 'F-finding-pages/finding-and-pages.html', 'F-story-people/story-and-people.html', 'F3-atlas/the-atlas.html', 'F-time-tools/time-and-tools.html', 'G-compendium/compendium.html', 'G-compendium-pages/compendium-pages.html', 'H-table-screen/table-screen.html', 'I-settings/settings.html', 'I-settings-leftovers/settings-leftovers.html'];
const B = s => s.split(';').map(x => x.trim()).flatMap(x => ['#v-laptop ' + x, '#v-phone ' + x]).join(',');
// [selector, min width, min height, pad, clip around the part's parent]
const GROUPS = {
  kcard: [B('.g-kc2; .f-kindc'), 100, 40, 4],
  bar: [B('.f-dbar'), 100, 20, 4],
  tag: [B('.tag:not(.h-tile > .tag):not(.h-lr > .tag); .e-st; .f-all; .f-hid; .g-src; .x-fold; .d-tag; .cond; .b-tag; span.i-meth'), 14, 14, 4],
  close: [B(':is(.e-dh, .ov-h, .i-sh, .qs-h, .q-head, .k-lhead, .sh, .dh) > .e-ico; .toast .x'), 20, 20, 6],
  stepper: [B('.q-step; .e-numf; .i-step'), 40, 20, 6],
  tabs: [B('.sh-tabs; .e-tabs'), 100, 30, 2],
  field: [B('.find; .e-field; .q-fld'), 60, 20, 4],
  lamp: [B('.lamp; .h-dot; .b-lamp; .e-lamp; .x-lamp'), 4, 4, 6, true],
  mark: [B('.d-step; .e-step; .d-dlg .dsteps span'), 40, 20, 4],
  face: [B('.ini'), 100, 30, 2],
  title: [B('.e-h2'), 40, 16, 4],
  eyebrow: [B('.t-field > span:first-child; .t-tl .hd; .y-days small; .w-res .ok; .w-wait'), 8, 8, 6],
};
const SHADES = ['rgb(135, 84, 0)', 'rgb(106, 68, 191)', 'rgb(163, 36, 107)'];
const CSS = '.switch-bar,.mbar{position:static!important} html,body,*{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important}';
(async () => {
  const b = await chromium.launch(); const out = []; const seen = new Set();
  for (const scheme of ['dark', 'light']) {
    const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: scheme });
    for (const f of FILES) {
      const area = f.split('/')[0];
      for (let k = 0; k < 4; k++) { await p.goto('file://' + ROOT + f); if ((await p.evaluate(() => document.characterSet)) === 'UTF-8') break; }
      await p.addStyleTag({ content: CSS }); await p.waitForTimeout(600);
      const pages = await p.$$eval('#pg-seg button', bs => bs.map(x => [x.dataset.v, x.textContent.trim()])).catch(() => []);
      for (const [v, label] of (pages.length ? pages : [[null, 'default']])) {
        if (v) { await p.click('#pg-seg button[data-v="' + v + '"]').catch(() => {}); await p.waitForTimeout(300); }
        const shot = async (g, el, pad, up) => {
          const box = await el.boundingBox(); if (!box) return;
          const info = await el.evaluate((n, up) => { const m = up ? n.parentElement : n; return { fr: n.closest('#v-laptop') ? 'laptop' : 'phone', html: m.outerHTML.replace(/\s+/g, ' ').replace(/data:[^"')]+/g, '').slice(0, 3000), cls: typeof n.className === 'string' ? n.className : (n.getAttribute('class') || ''), up: up ? (typeof m.className === 'string' ? m.className : '') : '', text: m.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) }; }, !!up);
          const h = crypto.createHash('md5').update(g + scheme + area + info.fr + info.html).digest('hex').slice(0, 10);
          if (seen.has(h)) return; seen.add(h);
          await el.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(40);
          const bb = await el.boundingBox(); if (!bb) return;
          let clip = { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad), width: bb.width + pad * 2, height: Math.min(bb.height + pad * 2, 990) };
          if (up) { const pb = await el.evaluate(n => { const r = n.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); clip = { x: Math.max(0, bb.x - pad), y: Math.max(0, Math.min(bb.y, pb.y) - 4), width: Math.min(260, pb.x + pb.w - bb.x + pad * 2), height: Math.min(64, Math.max(bb.height, pb.h) + 8) }; }
          const name = g + '-' + area + '-' + (v || 'default') + '-' + h + '.png';
          await p.screenshot({ path: __dirname + '/caps5/' + name, clip }).catch(() => {});
          out.push({ g, area, page: label, v, fr: info.fr, scheme, file: name, cls: info.cls, up: info.up, text: info.text });
        };
        if (scheme === 'dark') {
          for (const [g, [sel, minW, minH, pad, up]] of Object.entries(GROUPS)) {
            for (const el of await p.$$(sel)) { const box = await el.boundingBox(); if (box && box.width >= minW && box.height >= minH) await shot(g, el, pad, up); }
          }
        } else {
          // Dawn's amber, magenta and violet words: the elements whose own text takes one of the three shades.
          // Words first (four letters or more), one of each, so the wall shows words rather than initials and numbers.
          const n = await p.evaluate(S => { document.querySelectorAll('[data-k5]').forEach(x => x.removeAttribute('data-k5')); const c = [], seen = new Set(); for (const e of document.querySelectorAll('#v-laptop .frame *, #v-phone .frame *')) { const t = Array.from(e.childNodes).filter(x => x.nodeType === 3).map(x => x.textContent).join(' ').trim(); const r = e.getBoundingClientRect(); if (t && r.width > 8 && r.width < 420 && S.includes(getComputedStyle(e).color) && !seen.has(t)) { seen.add(t); c.push([/[A-Za-z]{4}/.test(t) ? 0 : 1, e]); } } c.sort((x, y) => x[0] - y[0]); c.slice(0, 6).forEach(([, e], i) => e.setAttribute('data-k5', i)); return Math.min(6, c.length); }, SHADES);
          for (let i = 0; i < n; i++) { const el = await p.$('[data-k5="' + i + '"]'); if (el) await shot('shade', el, 6, false); }
        }
      }
    }
    await p.close();
  }
  fs.writeFileSync(__dirname + '/caps5.json', JSON.stringify(out, null, 1));
  const n = {}; out.forEach(o => { n[o.g] = (n[o.g] || 0) + 1; }); console.log(n);
  await b.close();
})();

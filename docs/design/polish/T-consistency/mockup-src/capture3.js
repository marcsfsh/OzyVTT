// The third sweep's parts (Base line buttons, ghosts, danger, icon buttons, phone controls, switches and ticks, steps
// rails, groups and the GM ONLY tag) from every page of every approved mockup into caps3/, clipped from the page at each
// part's measured box (needs Playwright).
const { chromium } = require('playwright'); const fs = require('fs'); const crypto = require('crypto');
const ROOT = __dirname + '/../../';
const FILES = ['A-frame/frame.html', 'B-arrival/arrival.html', 'C-table/table.html', 'C2-map-menus/map-menus.html', 'C3-gm-panel/gm-panel.html', 'C3-running/running.html', 'C4-C6-player/a-player-in-a-fight.html', 'C5-log-dice/log-and-dice.html', 'D-characters/characters.html', 'E-prep/prep.html', 'E2-maps-tokens/maps-and-tokens.html', 'E3-sound-screen/sound-and-the-screen.html', 'E3-replays/replays.html', 'F-codex/codex.html', 'F-finding-pages/finding-and-pages.html', 'F-story-people/story-and-people.html', 'F3-atlas/the-atlas.html', 'F-time-tools/time-and-tools.html', 'G-compendium/compendium.html', 'G-compendium-pages/compendium-pages.html', 'H-table-screen/table-screen.html', 'I-settings/settings.html', 'I-settings-leftovers/settings-leftovers.html'];
const L = s => s.split(',').map(x => '#v-laptop ' + x.trim()).join(','), P = s => s.split(',').map(x => '#v-phone ' + x.trim()).join(',');
const GROUPS = {
  base: [L('.e-btn:not(.ghost):not(.on), .q-bl:not(.danger):not(.on), .k-btn:not(.main), .d-btn:not(.ghost), .b-base'), 30, 24, 6],
  ghost: [L('.e-btn.ghost, .d-btn.ghost, .b-ghost') + ',' + P('.e-btn.ghost, .d-btn.ghost, .b-ghost'), 30, 24, 6],
  danger: [L('.i-danger, .i-dtext, .q-bl.danger, .e-btn[style*="danger-text"], .u-mi[style*="danger-text"]') + ',' + P('.i-danger, .q-bl.danger, .u-mi[style*="danger-text"]'), 30, 24, 6],
  icon: [L('.e-ico, .d-ico, .z-ic, .w-play, .r-eye'), 30, 30, 6],
  pbase: [P('.e-btn, .q-bl, .k-btn, .d-btn, .b-base, .cup'), 30, 30, 4],
  sw: [L('.sw, .e-sw, .b-sw') + ',' + P('.sw, .e-sw, .b-sw'), 20, 18, 8],
  tick: [L('.i-sw:has(.e-cbx), .e-cbx, .q-chk') + ',' + P('.e-cbx, .q-chk'), 16, 16, 8],
  steps: [L('.d-steps, .e-steps, .dsteps'), 200, 40, 4],
  group: [L('.i-grp, .e-grp, .q-cr'), 300, 60, 6],
  gm: [L('.tag.gm') + ',' + P('.tag.gm'), 20, 14, 8],
};
(async () => {
  const b = await chromium.launch(); const out = []; const seen = new Set();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' });
  for (const f of FILES) {
    for (let k = 0; k < 4; k++) { await p.goto('file://' + ROOT + f); if ((await p.evaluate(() => document.characterSet)) === 'UTF-8') break; } await p.addStyleTag({ content: '.switch-bar,.mbar{position:static!important} html,body,*{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important}' }); await p.waitForTimeout(600);
    const pages = await p.$$eval('#pg-seg button', bs => bs.map(x => [x.dataset.v, x.textContent.trim()])).catch(() => []);
    for (const [v, label] of (pages.length ? pages : [[null, 'default']])) {
      if (v) { await p.click('#pg-seg button[data-v="' + v + '"]').catch(() => {}); await p.waitForTimeout(300); }
      for (const [g, [sel, minW, minH, pad]] of Object.entries(GROUPS)) {
        const els = await p.$$(sel);
        for (const el of els) {
          const box = await el.boundingBox(); if (!box || box.width < minW || box.height < minH) continue;
          const info = await el.evaluate(n => { const fr = n.closest('#v-laptop') ? 'laptop' : 'phone'; const t = n.outerHTML.replace(/\s+/g, ' ').replace(/data:[^"')]+/g, ''); return { fr, html: t.slice(0, 3000), cls: typeof n.className === 'string' ? n.className : '', text: n.textContent.replace(/\s+/g, ' ').trim().slice(0, 120), ico: n.querySelector('svg path') ? n.querySelector('svg path').getAttribute('d') || '' : '' }; });
          const h = crypto.createHash('md5').update(g + info.fr + info.html).digest('hex').slice(0, 10);
          if (seen.has(h)) continue; seen.add(h);
          const name = g + '-' + f.split('/')[0] + '-' + (v || 'default') + '-' + h + '.png';
          await el.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(40); const bb = await el.boundingBox();
          if (bb) await p.screenshot({ path: __dirname + '/caps3/' + name, clip: { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad), width: bb.width + pad * 2, height: Math.min(bb.height + pad * 2, 990) } }).catch(() => {});
          out.push({ g, area: f.split('/')[0], page: label, v, fr: info.fr, file: name, w: Math.round(box.width), h: Math.round(box.height), cls: info.cls, text: info.text, ico: info.ico });
        }
      }
    }
  }
  fs.writeFileSync(__dirname + '/caps3.json', JSON.stringify(out, null, 1));
  const n = {}; out.forEach(o => { n[o.g] = (n[o.g] || 0) + 1; }); console.log(n);
  await b.close();
})();

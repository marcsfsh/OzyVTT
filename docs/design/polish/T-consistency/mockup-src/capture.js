// Element screenshots drift on these pages, so each part is clipped from the page at its measured box.
// Captures every side list, title row, dialog, menu and phone sheet from the approved mockups into caps/ (needs Playwright).
const { chromium } = require('playwright');
const fs = require('fs'); const crypto = require('crypto');
const ROOT = __dirname + '/../../';
const FILES = ['A-frame/frame.html', 'B-arrival/arrival.html', 'C-table/table.html', 'C2-map-menus/map-menus.html', 'C3-gm-panel/gm-panel.html', 'C3-running/running.html', 'C4-C6-player/a-player-in-a-fight.html', 'C5-log-dice/log-and-dice.html', 'D-characters/characters.html', 'E-prep/prep.html', 'E2-maps-tokens/maps-and-tokens.html', 'E3-sound-screen/sound-and-the-screen.html', 'E3-replays/replays.html', 'F-codex/codex.html', 'F-finding-pages/finding-and-pages.html', 'F-story-people/story-and-people.html', 'F3-atlas/the-atlas.html', 'F-time-tools/time-and-tools.html', 'G-compendium/compendium.html', 'G-compendium-pages/compendium-pages.html', 'H-table-screen/table-screen.html', 'I-settings/settings.html', 'I-settings-leftovers/settings-leftovers.html'];
const GROUPS = {
  side: '#v-laptop .u-rail, #v-laptop .x-rail, #v-laptop .w-rail, #v-laptop .z-tree, #v-laptop .i-rail',
  title: '#v-laptop .e-rec, #v-laptop .t-head, #v-laptop .r-head, #v-laptop .i-head',
  dialog: '#v-laptop .e-dlg, #v-laptop .q-dlg, #v-laptop .u-dlg, #v-laptop .d-dlg',
  menu: '#v-laptop .u-menu, #v-laptop .q-menu, #v-laptop .x-menu, #v-laptop .w-menu, #v-laptop .q-pop, #v-laptop .w-pop, #v-laptop .b-pop, #v-laptop .d-pop',
  sheet: '#v-phone .e-dlg, #v-phone .q-sheet, #v-phone .k-sheet, #v-phone .r-sheet, #v-phone .i-sheet, #v-phone .g-sheet, #v-phone .d-sheet, #v-phone .b-sheet, #v-phone .d-sheetpop, #v-phone .q-dlg, #v-phone .u-dlg'
};
(async () => {
  const b = await chromium.launch(); const out = []; const seen = new Set();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' });
  for (const f of FILES) {
    for (let k = 0; k < 4; k++) { await p.goto('file://' + ROOT + f); if ((await p.evaluate(() => document.characterSet)) === 'UTF-8') break; } await p.addStyleTag({ content: '.switch-bar,.mbar{position:static!important} html,body,*{scroll-behavior:auto!important} *,*::before,*::after{animation:none!important;transition:none!important}' }); await p.waitForTimeout(700);
    const pages = await p.$$eval('#pg-seg button', bs => bs.map(x => [x.dataset.v, x.textContent.trim()])).catch(() => []);
    const list = pages.length ? pages : [[null, 'default']];
    for (const [v, label] of list) {
      if (v) { await p.click('#pg-seg button[data-v="' + v + '"]').catch(() => {}); await p.waitForTimeout(350); }
      for (const [g, sel] of Object.entries(GROUPS)) {
        const els = await p.$$(sel);
        for (const el of els) {
          const box = await el.boundingBox(); if (!box || box.width < 60 || box.height < 40) continue;
          const html = await el.evaluate(n => n.outerHTML.replace(/\s+/g, ' ').slice(0, 4000));
          const h = crypto.createHash('md5').update(g + html).digest('hex').slice(0, 10);
          if (seen.has(h)) continue; seen.add(h);
          const name = g + '-' + f.split('/')[0] + '-' + (v || 'default') + '-' + h + '.png';
          await el.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(60); const bb = await el.boundingBox(); if (bb) await p.screenshot({ path: __dirname + '/caps/' + name, clip: bb }).catch(() => {});
          out.push({ g, area: f.split('/')[0], page: label, file: name, w: Math.round(box.width), h: Math.round(box.height) });
        }
      }
    }
  }
  fs.writeFileSync(__dirname + '/caps.json', JSON.stringify(out, null, 1));
  const c = {}; out.forEach(o => { c[o.g] = (c[o.g] || 0) + 1; }); console.log(c);
  await b.close();
})();

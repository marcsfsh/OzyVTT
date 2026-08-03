/**
 * D23 geometry check — the half of the form-alignment fix that jsdom cannot prove.
 *
 * The primitives' own suite (`packages/ui/src/primitives/forms-band.test.tsx`,
 * `stable-swap.test.tsx`) asserts the STRUCTURE that produces the alignment: the band token, the rules
 * that spend it, the modifier classes, the width reservation. It cannot assert the alignment itself —
 * jsdom loads no stylesheet and lays out no boxes. This script is the other half: it opens the real
 * /styleguide in a real browser and MEASURES.
 *
 * Three facts, each printed with the number it observed so a pass is evidence rather than a claim:
 *   1. In the alignment row, the control tops of Input, Select, Stepper and Switch agree within 1px.
 *   2. A labeled Stepper's controls sit one label band below the row top — it is aligned because it has
 *      the band, not because something else happened to cancel out.
 *   3. The reveal switch's track occupies the identical box before and after a real click. This is the
 *      reported bug in its measurable form: the label swaps a 15-character string for a 19-character one,
 *      and without the reservation the track slid out from under the pointer.
 * All three run at 390px and at 1280px, because the row folds to one column on a phone and the band has
 * to survive the fold.
 *
 * DELIBERATELY NOT WIRED INTO `npm test` — it needs a browser and a running dev server, the same terms
 * `scripts/tap-audit.mjs` sets out and for the same reason.
 *
 *   npm i --no-save playwright-core      # ...or set PLAYWRIGHT_CORE to an existing install
 *   npm run dev                          # in another shell (or any vite serving the client)
 *   node scripts/primitive-align-check.mjs
 *
 * BASE overrides the origin (default http://127.0.0.1:5173); CHROMIUM_PATH overrides the browser.
 */
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const WIDTHS = [390, 1280];

const failures = [];
const pass = (what, observed) => console.log(`  PASS  ${what} — ${observed}`);
const fail = (what, observed) => { failures.push(`${what} — ${observed}`); console.log(`  FAIL  ${what} — ${observed}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });

for (const width of WIDTHS) {
  console.log(`\n@ ${width}px`);
  const page = await browser.newPage({ viewport: { width, height: 1400 } });
  await page.goto(`${BASE}/styleguide.html`, { waitUntil: "networkidle" });
  const row = page.locator(".sg-align-row");
  await row.scrollIntoViewIfNeeded();

  // 1. Every control the same distance below the top of its own grid track.
  //    NOT absolute `top`: the grid folds to one column at 390px, where the four controls are in four
  //    different rows and comparing absolute tops compares nothing. The invariant that holds at every
  //    width is the OFFSET from the track line — and because `.nh-fieldgrid` aligns items to start, the
  //    track line is each item's margin-box top, which is what makes the switch's band (a margin, not
  //    padding) count towards the offset instead of vanishing from it.
  const offsets = await row.evaluate((el) => {
    const offset = (node) => {
      let item = node;
      while (item.parentElement !== el) item = item.parentElement;
      const trackTop = item.getBoundingClientRect().top - parseFloat(getComputedStyle(item).marginTop);
      return Math.round((node.getBoundingClientRect().top - trackTop) * 100) / 100;
    };
    return {
      input: offset(el.querySelector("input.nh-input")),
      select: offset(el.querySelector("select.nh-input")),
      stepper: offset(el.querySelector(".nh-stepper-controls")),
      switchTrack: offset(el.querySelector(".nh-switch-track"))
    };
  });
  const values = [offsets.input, offsets.select, offsets.stepper, offsets.switchTrack];
  const spread = Math.max(...values) - Math.min(...values);
  const seen = `input ${offsets.input} · select ${offsets.select} · stepper ${offsets.stepper} · switch ${offsets.switchTrack} (spread ${spread.toFixed(2)}px)`;
  (spread <= 1 ? pass : fail)("control tops sit one identical band below their track", seen);

  // 2. …and that shared offset IS the label band, not some other number they happen to agree on.
  //    `--nh-label-band` is an unregistered custom property, so `getPropertyValue` hands back the calc()
  //    text rather than pixels — resolve it by making the browser lay a box out at that height.
  const band = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--nh-label-band)";
    document.body.append(probe);
    const px = Math.round(probe.getBoundingClientRect().height * 100) / 100;
    probe.remove();
    return px;
  });
  (Math.abs(offsets.input - band) <= 1 ? pass : fail)(
    "that offset is the label band itself",
    `--nh-label-band resolves to ${band}px; the field's label+gap measures ${offsets.input}px`
  );

  // 3. The reveal switch does not move when clicked.
  const track = page.locator("#reveal .nh-switch[role=switch] .nh-switch-track").first();
  const control = page.locator("#reveal .nh-switch[role=switch]").first();
  await control.scrollIntoViewIfNeeded();
  const box = async () => {
    const b = await track.boundingBox();
    return { x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, w: Math.round(b.width * 100) / 100 };
  };
  const before = await box();
  const labelBefore = (await control.innerText()).trim();
  await control.click();
  await page.waitForTimeout(350); // the thumb transition; the BOX must not have moved even mid-flight
  const after = await box();
  const labelAfter = (await control.innerText()).trim();
  const moved = Math.abs(before.x - after.x) + Math.abs(before.y - after.y) + Math.abs(before.w - after.w);
  (labelBefore !== labelAfter && moved === 0 ? pass : fail)(
    "the reveal track holds its box across a real click",
    `${JSON.stringify(labelBefore)} → ${JSON.stringify(labelAfter)}; track ${JSON.stringify(before)} → ${JSON.stringify(after)}`
  );

  await page.close();
}

await browser.close();
console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);

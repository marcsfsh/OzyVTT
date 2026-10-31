# Builds ../consistency.html from the captures in caps/, caps2/, caps3/, caps4/ and caps5/ (run capture.js to capture5.js
# first): every shared part after the sweeps' fixes.
# The labels come from the sweep as it was shown, ../history/1-sweep.html. Needs Pillow.
import re, json, io, base64, html, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
old = open('../history/1-sweep.html').read()
old2 = re.sub(r'data:image/[^"]+', 'IMG', old)
def alts(sec):
    i = old2.find('id="%s"' % sec); j = old2.find('</section>', i)
    return [html.unescape(a) for a in re.findall(r'alt="([^"]+)"', old2[i:j])]
OLD = {'side': alts('s-h'), 'title': alts('t-h'), 'menu': alts('m-h'), 'sheet': alts('p-h'), 'dialog': alts('d-h')}
REC = set(OLD['title'][:11])
LABEL = {'E2-maps-tokens': 'E2, maps and tokens', 'E3-sound-screen': 'E3, sound', 'F-finding-pages': 'F, finding and pages', 'F-story-people': 'F, story and people', 'F3-atlas': 'F3, the Atlas', 'F-time-tools': 'F, time and tools', 'G-compendium-pages': 'G, its pages', 'I-settings': 'I, settings', 'I-settings-leftovers': 'I, its leftovers', 'E-prep': 'E, prep', 'E3-replays': 'E3, replays', 'F-codex': 'F, the Codex', 'G-compendium': 'G, the Compendium', 'H-table-screen': 'H, table screen', 'C2-map-menus': 'C2, map menus', 'C3-running': 'C3, running', 'C5-log-dice': 'C5, log and dice', 'D-characters': 'D, characters'}
def fixes(g, area, v):
    if g == 'side':
        if area == 'I-settings' or (area == 'F-time-tools' and v == 'tools'): return '1'
        if area == 'F3-atlas' and v == 'downtime2': return '2'
        if area == 'F3-atlas': return '6 7'
    if g == 'title' and ((area == 'F-time-tools' and v in ('lib', 'cal', 'edit')) or (area == 'H-table-screen' and v == 'screen') or (area == 'I-settings-leftovers' and v == 'hist')): return '3'
    if g == 'menu' and area in ('F3-atlas', 'E2-maps-tokens', 'C3-running'): return '4'
    if g == 'sheet': return '5'
    return ''
d = json.load(open('caps.json'))
def fig(o):
    g = o['g']; area = o['area']; v = o['file'][len(g) + 1 + len(area) + 1:-15]
    lab = LABEL.get(area)
    if not lab or (lab + ', ' + o['page']) not in OLD[g]: return None, None
    im = Image.open('caps/' + o['file']).convert('RGB')
    if im.width > 1000: im = im.resize((1000, round(im.height * 1000 / im.width)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82); src = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
    f = fixes(g, area, v)
    alt = html.escape(lab + ', ' + o['page'])
    return (g, (lab + ', ' + o['page']) in REC if g == 'title' else None), '<figure%s><div class="shot"><img src="%s" width="%d" height="%d" alt="%s"></div><figcaption><span class="area">%s</span><span class="page">%s</span>%s</figcaption></figure>' % (' class="on"' if f else '', src, im.width, im.height, alt, html.escape(lab), html.escape(o['page']), ''.join('<span class="flag">%s</span>' % n for n in f.split()) if f else '')
W = {'side': [], 'rec': [], 'head': [], 'menu': [], 'sheet': [], 'dialog': []}
for o in d:
    k, h = fig(o)
    if not k: continue
    g, rec = k
    W['rec' if rec else 'head' if g == 'title' else g].append(h)
print({k: len(v) for k, v in W.items()})

# The second sweep's parts, captured by capture2.js into caps2/. Its labels come from ../history/2-sweep.html.
old2 = re.sub(r'data:image/[^"]+', 'IMG', open('../history/2-sweep.html').read())
def alts2(sec):
    i = old2.find('id="%s"' % sec); j = old2.find('</section>', i)
    return set(html.unescape(a).replace(' (phone)', '') for a in re.findall(r'alt="([^"]+)"', old2[i:j]))
OLD2 = {'sbar': alts2('sb-h'), 'pbar': alts2('ph-h'), 'tabs': alts2('tb-h'), 'tool': alts2('to-h'), 'field': alts2('fi-h'), 'tag': alts2('tg-h')}
LABEL.update({'A-frame': 'A, the frame', 'B-arrival': 'B, arrival', 'C-table': 'C, the table', 'C3-gm-panel': 'C3, the GM panel', 'C4-C6-player': 'C4 and C6, a player', 'E3-replays': 'E3, replays'})
def fixes2(o):
    g, a, p = o['g'], o['area'], o['page']
    if g == 'sbar':
        if a in ('E3-sound-screen', 'E3-replays', 'H-table-screen'): return '2.1'
        if a in ('F-codex', 'F-finding-pages', 'F-story-people', 'F3-atlas'): return '2.3'
        if a in ('G-compendium', 'G-compendium-pages', 'I-settings', 'I-settings-leftovers'): return '2.7'
    if g == 'pbar' and (a, p) in [('F-codex', 'A page (GM)'), ('F-codex', 'A page (player)'), ('F-story-people', 'Downtime and deadlines'), ('F-story-people', 'Adding to the chronicle'), ('F3-atlas', 'The Atlas'), ('G-compendium-pages', "A record's history"), ('H-table-screen', 'A screen open'), ('E3-replays', 'Watching')]: return '2.2'
    if g == 'tabs' and 'Downtime' in o['text'] and a in ('F-codex', 'F-story-people', 'F-time-tools'): return '2.3'
    if g == 'tool':
        if a == 'E3-replays': return '2.4'
        if (a, p) in [('F-finding-pages', 'The pages index'), ('F-story-people', 'Quests'), ('G-compendium', 'Browsing'), ('G-compendium-pages', 'Sharing'), ('E2-maps-tokens', "A map's page")]: return '2.5'
    if g == 'field' and (a, p) in [('E2-maps-tokens', "A map's page"), ('F-finding-pages', 'The pages index'), ('F-story-people', 'Quests'), ('F-story-people', 'Relationships'), ('F3-atlas', 'The Atlas'), ('I-settings-leftovers', 'The API reference')]: return '2.6'
    return ''
W2 = {k: [] for k in OLD2}
for o in (json.load(open('caps2.json')) if os.path.exists('caps2.json') else []):
    lab = LABEL.get(o['area'])
    if o['g'] not in W2 or not lab or (lab + ', ' + o['page']) not in OLD2[o['g']]: continue
    im = Image.open('caps2/' + o['file']).convert('RGB')
    if im.width > 1000: im = im.resize((1000, round(im.height * 1000 / im.width)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82); src = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
    f = fixes2(o)
    W2[o['g']].append('<figure%s><div class="shot"><img src="%s" width="%d" height="%d" alt="%s"></div><figcaption><span class="area">%s</span><span class="page">%s</span>%s</figcaption></figure>' % (' class="on"' if f else '', src, im.width, im.height, html.escape(lab + ', ' + o['page']), html.escape(lab), html.escape(o['page'] + (' (phone)' if o['fr'] == 'phone' and o['g'] != 'pbar' else '')), '<span class="flag">%s</span>' % f if f else ''))
print({k: len(v) for k, v in W2.items()})

# The third sweep's parts, captured by capture3.js into caps3/: one capture per area and part, a cyan 3.n on each a fix
# changed (history/3-sweep.html is the sweep as shown, history/3-before-after.html each fix before and after).
LABEL.update({'A-frame': 'A, the frame', 'B-arrival': 'B, arrival', 'C-table': 'C, the table', 'C3-gm-panel': 'C3, the GM panel', 'C4-C6-player': 'C4 and C6, a player', 'E3-replays': 'E3, replays'})
CFAM = ('C-table', 'C2-map-menus', 'C3-gm-panel', 'C3-running', 'C4-C6-player', 'C5-log-dice')
def fixes3(o):
    g, a, x, v = o['g'], o['area'], o['text'], o['v']
    if g == 'group' and a in ('I-settings', 'I-settings-leftovers', 'F-time-tools'): return '3.1'
    if g == 'danger' and (a in ('I-settings', 'I-settings-leftovers', 'H-table-screen', 'F3-atlas') or 'Revoke' in x): return '3.4'
    if g == 'ghost' and a in ('E2-maps-tokens', 'E3-sound-screen', 'E3-replays', 'F-story-people', 'F-time-tools', 'F3-atlas', 'F-finding-pages', 'G-compendium', 'G-compendium-pages') or (g == 'ghost' and a == 'I-settings' and o['fr'] == 'phone'): return '3.5'
    if g == 'steps' and a == 'D-characters': return '3.7'
    if g == 'sw' and ('e-sw' in o['cls'] or 'b-sw' in o['cls']): return '3.10'
    if g == 'tick' and a in ('I-settings', 'I-settings-leftovers'): return '3.11'
    if g == 'icon' and ('w-play' in o['cls'] or 'r-eye' in o['cls'] or (a == 'E3-sound-screen' and v in ('board', 'now', 'add')) or (a.startswith('G-') and o.get('ico', '').startswith('M14 6l-6 6')) or (a == 'I-settings' and v == 'home')): return '3.12'
    if g == 'base' and (a in CFAM or (a == 'D-characters' and o['cls'].split()[:1] == ['btn']) or (a == 'I-settings' and x == 'Save formula') or (a == 'F-time-tools' and v == 'sess') or (a == 'E3-replays' and x in ('Borin Stoneguard', 'Lyra Emberwise', 'Mirena Dawnbright', 'Goblin Boss', 'Wolf'))): return '3.14'
    if g == 'gm' and a in ('C2-map-menus', 'C4-C6-player', 'C5-log-dice'): return '3.19'
    return ''
W3 = {k: [] for k in ('base', 'ghost', 'danger', 'icon', 'pbase', 'sw', 'tick', 'steps', 'group', 'gm')}
PER = {'base': 2, 'ghost': 2, 'danger': 3, 'icon': 2, 'pbase': 2, 'sw': 1, 'tick': 1, 'steps': 3, 'group': 1, 'gm': 2}
count = {}
for o in (json.load(open('caps3.json')) if os.path.exists('caps3.json') else []):
    lab = LABEL.get(o['area'])
    if o['g'] not in W3 or not lab or not os.path.exists('caps3/' + o['file']): continue
    k = (o['g'], o['area']); count[k] = count.get(k, 0) + 1
    if count[k] > PER[o['g']]: continue
    im = Image.open('caps3/' + o['file']).convert('RGB')
    if im.width > 1000: im = im.resize((1000, round(im.height * 1000 / im.width)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82); src = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
    f = fixes3(o)
    W3[o['g']].append('<figure%s><div class="shot"><img src="%s" width="%d" height="%d" alt="%s"></div><figcaption><span class="area">%s</span><span class="page">%s</span>%s</figcaption></figure>' % (' class="on"' if f else '', src, im.width, im.height, html.escape(lab + ', ' + o['page']), html.escape(lab), html.escape(o['page'] + (' (phone)' if o['fr'] == 'phone' else '')), ''.join('<span class="flag">%s</span>' % x for x in f.split()) if f else ''))
print({k: len(v) for k, v in W3.items()})

# The fourth sweep's parts, captured by capture4.js into caps4/: a cyan 4.n on each a fix changed (history/4-sweep.html is
# the sweep as shown, each fix before and after).
def fixes4(o):
    g, a, c, v, fr = o['g'], o['area'], o['cls'], o['v'], o['fr']
    if g == 'gchip' and a == 'G-compendium': return '4.2'
    if g == 'dtitle' and (a in ('C3-running', 'C5-log-dice', 'E3-replays', 'E3-sound-screen', 'F-story-people', 'F3-atlas', 'F-time-tools', 'G-compendium-pages', 'I-settings-leftovers') or (a == 'I-settings' and fr == 'phone')): return '4.10'
    if g == 'trow' and ((a == 'E-prep' and v == 'grid' and fr == 'laptop') or (a == 'E3-replays' and 'r-head' in c) or (a == 'F-time-tools' and 't-head' in c) or (fr == 'phone' and ((a == 'E3-sound-screen' and v == 'enc') or (a == 'I-settings-leftovers' and v == 'hist')))): return '4.11'
    if g == 'eyebrow': return '4.12'
    if g == 'notice': return '4.13'
    return ''
W4 = {k: [] for k in ('eyebrow', 'notice', 'dtitle', 'trow', 'gchip')}
PER4 = {'eyebrow': 2, 'notice': 2, 'dtitle': 2, 'trow': 2, 'gchip': 4}
count = {}
for o in (json.load(open('caps4.json')) if os.path.exists('caps4.json') else []):
    lab = LABEL.get(o['area'])
    if o['g'] not in W4 or not lab or not os.path.exists('caps4/' + o['file']): continue
    # The record changed on two devices draws its notice under the phone's sheet, where nothing shows it.
    if o['g'] == 'notice' and o['area'] == 'G-compendium-pages' and o['cls'].startswith('z-wait'): continue
    k = (o['g'], o['area']); count[k] = count.get(k, 0) + 1
    if count[k] > PER4[o['g']]: continue
    im = Image.open('caps4/' + o['file']).convert('RGB')
    if im.width > 1000: im = im.resize((1000, round(im.height * 1000 / im.width)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82); src = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
    f = fixes4(o)
    W4[o['g']].append('<figure%s><div class="shot"><img src="%s" width="%d" height="%d" alt="%s"></div><figcaption><span class="area">%s</span><span class="page">%s</span>%s</figcaption></figure>' % (' class="on"' if f else '', src, im.width, im.height, html.escape(lab + ', ' + o['page']), html.escape(lab), html.escape(o['page'] + (' (phone)' if o['fr'] == 'phone' else '')), ''.join('<span class="flag">%s</span>' % x for x in f.split()) if f else ''))
print({k: len(v) for k, v in W4.items()})
# The fifth sweep's parts, captured by capture5.js into caps5/: a cyan 5.n on each a fix changed, by area and frame as
# measured before and after the fix (history/5-sweep.html is the sweep as shown, each fix before and after).
CH5 = {
 'btag': 'B-arrival:l B-arrival:p F-time-tools:l F-time-tools:p I-settings-leftovers:l I-settings-leftovers:p',
 'close': 'C5-log-dice:l E2-maps-tokens:l E2-maps-tokens:p E3-replays:p F-time-tools:p G-compendium-pages:l G-compendium-pages:p G-compendium:p I-settings:l I-settings:p',
 'cond': 'C-table:l C2-map-menus:l C3-gm-panel:l C3-running:l C4-C6-player:l C5-log-dice:l',
 'eyebrow': 'C5-log-dice:l F-story-people:l F-story-people:p F-time-tools:l F3-atlas:p',
 'field': 'C2-map-menus:l C2-map-menus:p C3-running:l C3-running:p C5-log-dice:l C5-log-dice:p F-codex:l F-finding-pages:p F-time-tools:p F3-atlas:p G-compendium:l I-settings-leftovers:p I-settings:p',
 'find': 'F-time-tools:l I-settings-leftovers:l I-settings:l',
 'lamp': 'A-frame:l A-frame:p B-arrival:l C-table:l C-table:p C2-map-menus:l C3-gm-panel:l C3-running:l C4-C6-player:l C5-log-dice:l H-table-screen:l H-table-screen:p',
 'stepper': 'C5-log-dice:l C5-log-dice:p G-compendium:l G-compendium:p',
 'tab': 'A-frame:l A-frame:p C-table:l C2-map-menus:l C3-gm-panel:l C3-gm-panel:p C3-running:l C4-C6-player:l C5-log-dice:l D-characters:l E-prep:l E3-replays:l E3-replays:p E3-sound-screen:l F-codex:l F-codex:p F-finding-pages:p F-story-people:l F-story-people:p F-time-tools:l F-time-tools:p F3-atlas:l F3-atlas:p',
 'tag': 'C5-log-dice:l C5-log-dice:p D-characters:l D-characters:p E-prep:l E-prep:p E2-maps-tokens:l E2-maps-tokens:p E3-sound-screen:l E3-sound-screen:p F-codex:l F-codex:p F-finding-pages:l F-finding-pages:p F-story-people:l F-story-people:p F-time-tools:l F-time-tools:p F3-atlas:l G-compendium-pages:l G-compendium-pages:p G-compendium:l G-compendium:p',
 'title': 'E3-replays:p F-codex:p F-finding-pages:l F-time-tools:p F3-atlas:p G-compendium-pages:l G-compendium-pages:p G-compendium:l G-compendium:p I-settings-leftovers:p',
 'toast': 'A-frame:l H-table-screen:l',
}
CH5 = {k: set(v.split()) for k, v in CH5.items()}
def fixes5(o):
    g, a, c = o['g'], o['area'], ' ' + o['cls'] + ' '
    at = a + ':' + o['fr'][0]
    if g == 'kcard': return '5.3' if a == 'G-compendium' else ''
    if g == 'bar': return '5.6'
    if g == 'tag':
        if ' cond ' in c: return '5.8' if at in CH5['cond'] else ''
        if ' b-tag ' in c or ' i-meth ' in c: return '5.12' if at in CH5['btag'] else ''
        return '5.18' if at in CH5['tag'] else ''
    if g == 'close':
        if ' x ' in c: return '5.24' if at in CH5['toast'] else ''
        return '5.9' if at in CH5['close'] else ''
    if g == 'stepper': return '5.11' if at in CH5['stepper'] else ''
    if g == 'tabs': return '5.20' if at in CH5['tab'] else ''
    if g == 'field': return '5.21' if at in CH5['find' if ' find ' in c else 'field'] else ''
    if g == 'lamp':
        if 'e-ready' in o.get('up', '') and a in ('F3-atlas', 'F-time-tools'): return '5.16'
        return '5.22' if at in CH5['lamp'] else ''
    if g == 'mark': return '5.15' if a == 'D-characters' else ''
    if g == 'face': return '5.4'
    if g == 'title': return '5.14' if at in CH5['title'] else ''
    if g == 'eyebrow': return '5.23' if at in CH5['eyebrow'] else ''
    if g == 'shade': return '5.2'
    return ''
W5 = {k: [] for k in ('kcard', 'bar', 'tag', 'close', 'stepper', 'tabs', 'field', 'lamp', 'mark', 'face', 'title', 'eyebrow', 'shade')}
PER5 = {'kcard': 2, 'bar': 2, 'tag': 3, 'close': 2, 'stepper': 2, 'tabs': 1, 'field': 2, 'lamp': 2, 'mark': 2, 'face': 2, 'title': 2, 'eyebrow': 3, 'shade': 2}
count = {}
rows5 = json.load(open('caps5.json')) if os.path.exists('caps5.json') else []
# Dawn's words: within each area, captures with a word of four letters or more come before initials and numbers.
sh5 = [o for o in rows5 if o['g'] == 'shade']
rows5 = [o for o in rows5 if o['g'] != 'shade'] + [o for a in dict.fromkeys(x['area'] for x in sh5) for o in sorted((x for x in sh5 if x['area'] == a), key=lambda o: 0 if re.search('[A-Za-z]{4}', o['text']) else 1)]
for o in rows5:
    lab = LABEL.get(o['area'])
    if o['g'] not in W5 or not lab or not os.path.exists('caps5/' + o['file']): continue
    k = (o['g'], o['area']); count[k] = count.get(k, 0) + 1
    if count[k] > PER5[o['g']]: continue
    im = Image.open('caps5/' + o['file']).convert('RGB')
    if im.width > 1000: im = im.resize((1000, round(im.height * 1000 / im.width)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82); src = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
    f = fixes5(o)
    page = o['page'] + (' (phone)' if o['fr'] == 'phone' else '') + (', Dawn' if o['scheme'] == 'light' else '')
    W5[o['g']].append('<figure%s><div class="shot"><img src="%s" width="%d" height="%d" alt="%s"></div><figcaption><span class="area">%s</span><span class="page">%s</span>%s</figcaption></figure>' % (' class="on"' if f else '', src, im.width, im.height, html.escape(lab + ', ' + page), html.escape(lab), html.escape(page), ''.join('<span class="flag">%s</span>' % x for x in f.split()) if f else ''))
print({k: len(v) for k, v in W5.items()})
head = open('head.html').read().replace('<title>OzyVTT Consistency Sweep</title>', '<title>OzyVTT Shared Parts</title>')
head = head.replace('</style>', '.wall.nat .shot { display: grid; place-items: center; padding: 6px; }\n.wall.nat .shot img { width: auto; max-width: 100%; }\n</style>')
head = head.replace('.finding .num { font: 400 34px/1 var(--f-num); color: var(--amber); }', '.finding .num { font: 400 34px/1 var(--f-num); color: var(--cyan); }\ncode { font: 400 1.15em/1 var(--f-num); }').replace('figure.off .shot { border-color: var(--amber); }', 'figure.on .shot { border-color: var(--cyan); }').replace('.flag { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px; border: 1px solid var(--amber); color: var(--amber);', '.flag { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px; border: 1px solid var(--cyan); color: var(--cyan);')
FIX = [
 ("One side list", "Settings and Time and tools", "Settings' list, its search results and the tools in Settings are drawn as the settled side list (T rule 13, ADR-0071)."),
 ("Faces on people's rows", "F3, the Downtime tab", "Each character in the Downtime tab's list carries their face at 20 px."),
 ("The crumb sits on the title's line", "F, time and tools; H; I, its leftovers", "Prep templates, the calendar, a screen's remote, an operation and a credential's page put the crumb inline before the title, with the back chevron (T rule 14)."),
 ("A menu about one thing names it", "F3; E2; C3, running", "The pin's menu, a map's menu, a creature's menu and the encounter's options open with the name in display capitals and its line (T rule 15)."),
 ("A phone sheet opens one way", "C3, C5, D, E2, E3, F, G, I", "Every sheet opens with the handle, then its title and the close button (T rule 16)."),
 ("No count in an eyebrow", "F3, the Atlas", "The Atlas's list says MAPS; its counts sit on the rows."),
 ("The Atlas tree's rows", "F3, the Atlas", "Each map's row has the map icon and its pin count; what the map is sits in its line on the map's glass."),
]
fx = ''.join('<div class="finding"><span class="num">%d</span><div style="display:grid;gap:6px;min-width:0"><h3>%s</h3><p>%s</p><p class="fix">%s</p></div></div>' % (i + 1, html.escape(a), html.escape(b), html.escape(c)) for i, (a, b, c) in enumerate(FIX))
FIX2 = [
 ("One primary in view", "F, F3, G, E3, H", "When a page shows its own Cup the bar's New steps down to a Base line button with its +; with two, the step's or panel's keeps the Cup (T rule 2)."),
 ("What a phone header names", "F, F3, G's pages, H, E3", "A section's page names the section; a record shows Back and where it goes, its title in the content (T rule 12)."),
 ("Strips a later round changed", "F, F3, H", "The story's four tabs everywhere, Prep's seven pages, the Codex bar's More after New."),
 ("A list has no title row", "E3, replays", "Replays' toolbar opens with \"5 replays\" (T rule 17)."),
 ("A list's count and sort", "F, G, G's pages, E2", "The count in plain words; sort as the sort icon and its word (T rule 17)."),
 ("Fields", "E2, F, F3, I's leftovers", "A choice field's caret at its right end; a find field's icon and muted placeholder (T rule 18)."),
 ("The Cup is words only", "I, I's leftovers, G, G's pages", "New credential and New homebrew lose their +."),
 ("Who sees a replay", "E3, replays", "The eye in the dim text colour when shared, violet when only you see it (T rule 9)."),
 ("A map's kind", "E2", "The map icon and \"Battle map\" in its line, as a kind (T rule 19)."),
 ("A player watching a replay", "E3, replays", "The menu button is the face alone; Table lit on the laptop as on the phone."),
 ("Which side list rows carry an icon", "T rule 13", "A row naming a kind of thing has its icon or face; a row that filters has none."),
]
fx2 = ''.join('<div class="finding"><span class="num">2.%d</span><div style="display:grid;gap:6px;min-width:0"><h3>%s</h3><p>%s</p><p class="fix">%s</p></div></div>' % (i + 1, html.escape(a), html.escape(b), html.escape(c)) for i, (a, b, c) in enumerate(FIX2))
FIX3 = [
 ("Settings' groups are Cradles", "I, I's leftovers, F's time and tools", "A 2 px base and sides that fade before the open top, no fill; the players' rows in their group (T 2.4)."),
 ("The Cup is words only", "B", "Arrival's Cups lose their arrow; a Cup that opens a menu keeps its caret (T rule 2)."),
 ("Phone controls at 44 px", "Every area with a phone", "Every button, chip, icon button, segment and Cup is at least 44 px tall on a phone (T 2.5)."),
 ("Danger reads one way", "I, I's leftovers, H, F3", "--danger-text on the Base line; a menu's delete in --danger-text with the bin (T 2.5)."),
 ("The ghost beside a Cup", "E2, E3, F, F3, G, G's pages, H, I", "A ghost only for Cancel or Back beside a Cup; other secondaries on their Base line."),
 ("Heads inside a page", "D, E, E2, G, F's time and tools", "The roster's names in Bai Jamjuree 600; a step's or a column's head an eyebrow (T rule 10)."),
 ("One Steps rail", "D", "The builder and Level up take Prep's marks and cyan edge (T rule 4)."),
 ("Every phone sheet's horizon", "C2 to C5", "A creature's tools, the encounter's options and the dice options carry the horizon."),
 ("The phone table's switch", "C2 to C5", "Words on base lines with no well, as C draws it."),
 ("One switch", "B and every piece with Prep's parts", "The 46 by 26 track with its glow."),
 ("Ticks for several", "I, I's leftovers", "The scopes, ability score methods and the assistant's checks are ticks."),
 ("Icon buttons on their Base line", "E3, G, G's pages, I", "36 px on the Base line; a row's More is its dots."),
 ("Rows", "C2 to C5, E2, E3, F, F3, G, I", "Menu rows 48 px (52 in a phone sheet), table rows 48 px, phone rows at least 44 px."),
 ("Base line at 36 px", "C, C2 to C5, D, E3, F's time and tools, I", "A laptop's Base line buttons are 36 px."),
 ("Colours", "D, F's time and tools, I's leftovers", "A harmful condition red; the timeline's edge grey; GET and POST in the dim text colour."),
 ("Dates and counts", "E2, E3, F, G's pages, I, I's leftovers", "\"Oct 30, 7:40 PM\", \"Today, 8:41 PM\"; \"All maps 6\" (T rule 20)."),
 ("Empty states", "F3, F's time and tools, G, G's pages", "One line and the button that fixes it (T rule 3)."),
 ("Copy", "C2 to C5, D, E3", "Characters by name; None in an empty field; Done to leave a making flow."),
 ("One GM ONLY tag", "C2, C4 and C6, C5; T rule 7", "VT323 16 px in a 22 px box, on what only the GM sees where players also look."),
 ("Widths", "I, I's leftovers, F's time and tools, the Codex", "Settings' column 880 px beside its list; the reading measure 680 px (T rule 11)."),
]
FIX4 = [
 ("Level up's marks", "D", "Each mark is its own 20 px box; the rule for a step reaches only the steps (T rule 4)."),
 ("The Compendium's chips", "G", "Filter chips, the open records button and the phone's Filters on Base lines (T 2.5)."),
 ("A date in a table", "I, I's leftovers", "A date cell stays on one line."),
 ("Phone headers on records", "F3, F's story and people", "The pin editor reads Editing with no strip; a faction's page ‹ PAGES with no strip (T rule 12)."),
 ("The last phone controls", "A, B, C2, C3, C5, D, F, G, I", "Steppers, segments, a toolbar, an add link and a chip's × at 44 px on a phone (T 2.5)."),
 ("Base line at 36 px", "C to C5, E3, F, G, I", "Mark used, Own tab, chips and the credentials' actions at 36 px, 6 px apart."),
 ("No horizon on a card", "Every Codex piece", "The next session's card keeps its tint; its Cup carries the horizon (T rule 9)."),
 ("The last ghosts", "I's leftovers", "Token image on its Base line, Release in --danger-text."),
 ("A column's head on a phone", "E", "To make it ready is an eyebrow (T rule 10)."),
 ("Dialog and sheet titles", "C3, C5, E3, F, F3, G's pages, I", "20 px display capitals (T 2.2)."),
 ("Title rows", "E, E3, F's time and tools, I's leftovers", "24 px on a laptop, 20 px on a phone (T 2.2)."),
 ("One eyebrow", "B, C to C5, D, E3, F, G", "11 px capitals, 0.12em, --text-muted (T 2.4)."),
 ("One notice", "A, C5, F, F3, G, G's pages", "A 1 px frame with a 3 px edge in its meaning's colour, no fill (T rule 21)."),
 ("Dates", "E3, F's time and tools", "\"Oct 2\"; a date field shows \"Nov 8\" (T rule 20)."),
 ("Rows", "E3, G's pages, I; every menu", "Phone rows at least 44 px; a menu's rule inside its 48 px (T rule 8)."),
 ("The SAMPLE tag", "D", "A state in the dim text colour (T rule 19)."),
]
FIX5 = [
 ("The table screen on a phone", "H", "The pages behind the menu and the preview stack the phone header and Prep's strip (T rule 12)."),
 ("Dawn's coloured words", "Every mockup", "Amber, magenta and violet words take --caution-text, --magenta-text and --violet-text, 5:1 or better in Dawn (T rule 9)."),
 ("Kind cards", "G", "One kind card: its icon and name, the count in VT323 30 px under them, its line (T rule 19)."),
 ("The frame's turn order", "A", "The table's faces, 38 px on a 2 px rim (34 px on a phone), with G2, GB and B."),
 ("The stat block's name", "G, G's pages", "Inside its record the stat block starts with its line."),
 ("Bars of actions", "F, F's story and people, G", "The date bar and the Sources line are Cradles (T 2.4)."),
 ("A read-only group", "F", "Recently changed is open, as its neighbours are (T 2.3)."),
 ("A condition", "C, C2 to C5", "The one tag, VT323 16 px in a 22 px box (T rule 7)."),
 ("Closes", "C3's running, C5, E2, E3's replays, F's time and tools, G, G's pages, I", "A plain 18 px icon in a 40 px button, 44 px on a phone (T 2.2)."),
 ("The Dusk and Dawn switch", "A, B, H", "36 px segments on their base lines (T 2.5)."),
 ("Steppers", "C5, G", "40 px, 44 px on a phone, the number VT323 22 px, the minus sign (T 2.5)."),
 ("Boxed words", "B, F's time and tools, I's leftovers", "CLAIMED, GET and POST are VT323 tags; a template's parts are their icon and word (T rule 19)."),
 ("A hashtag", "F's time and tools", "The pages index's chip."),
 ("Titles in a page", "E3, F, F3, G, G's pages, I's leftovers", "22 px on a laptop, 20 px on a phone (T 2.2)."),
 ("Steps marks", "D", "24 px, the number VT323 17 px (T rule 4)."),
 ("Saved", "F3, F's time and tools", "A lamp and its word (T rule 19)."),
 ("The ruling card", "C3", "The amber rim every card that needs the GM carries."),
 ("Tags", "C5, D, E, E2, E3, every Codex piece, G, G's pages", "VT323 16 px in a 22 px box (T rule 7); the TV's tags keep theirs."),
 ("Icons in content buttons", "B, E3, F's time and tools, G, G's pages", "15 px at a 1.8 stroke (T 2.5)."),
 ("Tabs", "A, C to C5, D, E, E3, every Codex piece", "44 px with 14 px words (T rule 1)."),
 ("Fields", "C2 to C5, the Codex, G, I, I's leftovers", "The bar's search 38 px; a form field 40 px, 44 px on a phone (T 2.5)."),
 ("Lamps", "A, B, C to C5, H", "8 px (T rule 19)."),
 ("Eyebrows", "C5, F's story and people, F3, F's time and tools", "11 px capitals, 0.12em, 600 (T 2.4)."),
 ("A toast's close", "A, H", "A 36 px square, 44 px on a phone (T 2.5)."),
 ("A template's drag handle", "F's time and tools", "44 px on a phone (T 2.5)."),
]
fx5 = ''.join('<div class="finding"><span class="num">5.%d</span><div style="display:grid;gap:6px;min-width:0"><h3>%s</h3><p>%s</p><p class="fix">%s</p></div></div>' % (i + 1, html.escape(a), html.escape(b), html.escape(c)) for i, (a, b, c) in enumerate(FIX5))
fx4 = ''.join('<div class="finding"><span class="num">4.%d</span><div style="display:grid;gap:6px;min-width:0"><h3>%s</h3><p>%s</p><p class="fix">%s</p></div></div>' % (i + 1, html.escape(a), html.escape(b), html.escape(c)) for i, (a, b, c) in enumerate(FIX4))
fx3 = ''.join('<div class="finding"><span class="num">3.%d</span><div style="display:grid;gap:6px;min-width:0"><h3>%s</h3><p>%s</p><p class="fix">%s</p></div></div>' % (i + 1, html.escape(a), html.escape(b), html.escape(c)) for i, (a, b, c) in enumerate(FIX3))
def sec(id_, h2, lede, inner): return '<section class="pattern" aria-labelledby="%s"><header><h2 id="%s">%s</h2><p class="lede">%s</p></header>%s</section>\n' % (id_, id_, h2, html.escape(lede), inner)
body = '''<main class="wrap">
<header style="display:grid;gap:8px">
  <p class="eyebrow">OzyVTT · polish · shared parts</p>
  <h1>Shared parts</h1>
  <p class="lede">Every side list, title row, menu, phone sheet and dialog in the approved mockups after the consistency sweeps' fixes, the section bars, phone headers, tabs, toolbars, fields and tags the second sweep added, the buttons, phone controls, switches, ticks, steps rails, groups and GM ONLY tags the third added, and the eyebrows, notices, dialog and sheet titles, title rows and the Compendium's chips the fourth added, and the kind cards, bars, tags, closes, steppers, tabs, fields, lamps, marks, titles and Dawn's coloured words the fifth added, captured as each mockup now draws it. A cyan frame and number mark a capture a fix changed (2.n for the second sweep, 3.n for the third, 4.n for the fourth, 5.n for the fifth). The rules are the theme's 13 to 21; <code>history/1-sweep.html</code> to <code>history/5-sweep.html</code> are the sweeps as they were shown, <code>history/3-before-after.html</code> sets each of the third sweep's fixes before and after, and the fourth and fifth sweeps' pages do the same for their own.</p>
</header>
''' + sec('f-h', 'The seven fixes', 'Made in the approved mockups and their specs on 2026-10-30, at the owner\'s word.', '<div class="findings">' + fx + '</div>') + sec('f2-h', 'The second sweep\'s eleven fixes', 'Made the same day, at the owner\'s word.', '<div class="findings">' + fx2 + '</div>') \
 + sec('s-h', 'Side lists', 'An eyebrow with no count; one row a thing, its name and its count, with its icon or face when it names a kind of thing; the chosen lit with the cyan edge.', '<div class="wall">' + ''.join(W['side']) + '</div>') \
 + sec('t-h', 'Title rows', 'A record opens with its title row, the crumb inline before the title. A section or a tool page names itself in its head.', '<p class="sub">Records and pages with a crumb</p><div class="wall wide">' + ''.join(W['rec']) + '</div><p class="sub">Section heads</p><div class="wall wide">' + ''.join(W['head']) + '</div>') \
 + sec('m-h', 'Menus', 'A menu about one thing opens with its name in display capitals and its line; a menu that offers a choice opens with its eyebrow.', '<div class="wall">' + ''.join(W['menu']) + '</div>') \
 + sec('p-h', 'Phone sheets', 'The handle, then the title and the close button over a hairline.', '<div class="wall sheets">' + ''.join(W['sheet']) + '</div>') \
 + sec('d-h', 'Dialogs', 'A\'s dialog: the title on the horizon edge, the close at the right.', '<div class="wall wide">' + ''.join(W['dialog']) + '</div>') \
 + sec('sb-h', 'Section bars', 'The section, its pages, its search, then its New: the Cup, or a Base line button when the page shows its own (T rule 2).', '<div class="wall wide">' + ''.join(W2['sbar']) + '</div>') \
 + sec('ph-h', 'Phone headers', 'A section names itself over its strip; a record shows Back and where it goes (T rule 12).', '<div class="wall sheets">' + ''.join(W2['pbar']) + '</div>') \
 + sec('tb-h', 'Tabs', 'One row of tabs, the chosen one inked (T rule 1).', '<div class="wall wide">' + ''.join(W2['tabs']) + '</div>') \
 + sec('to-h', 'Toolbars', 'The count in plain words, filters, sort as its icon and word, then the list\'s own action (T rule 17).', '<div class="wall wide">' + ''.join(W2['tool']) + '</div>') \
 + sec('fi-h', 'Fields', 'A choice field\'s caret at its right end; a find field\'s icon and muted placeholder (T rule 18).', '<div class="wall">' + ''.join(W2['field']) + '</div>') \
 + sec('tg-h', 'Tags', 'A state as a boxed tag, a kind as its icon and word, readiness as a lamp and words (T rule 19).', '<div class="wall">' + ''.join(W2['tag']) + '</div>') \
 + sec('f3-h', 'The third sweep\'s twenty fixes', 'Made on 2026-10-31, at the owner\'s word, after seeing each before and after.', '<div class="findings">' + fx3 + '</div>') \
 + sec('b3-h', 'Base line buttons', 'A label on its 1 px base, 36 px on a laptop (T 2.5).', '<div class="wall">' + ''.join(W3['base']) + '</div>') \
 + sec('g3-h', 'Ghosts and danger', 'A ghost only for Cancel or Back beside a Cup; danger in its red on the Base line, a menu\'s delete with the bin.', '<div class="wall">' + ''.join(W3['ghost'] + W3['danger']) + '</div>') \
 + sec('i3-h', 'Icon buttons', '36 px on the Base line in content; a row\'s More is its dots.', '<div class="wall">' + ''.join(W3['icon']) + '</div>') \
 + sec('p3-h', 'Phone controls', 'At least 44 px on a phone (T 2.5); fix 3.3 grew every one that was shorter.', '<div class="wall">' + ''.join(W3['pbase']) + '</div>') \
 + sec('s3-h', 'Switches and ticks', 'One switch for one setting; ticks for picking several.', '<div class="wall">' + ''.join(W3['sw'] + W3['tick']) + '</div>') \
 + sec('r3-h', 'Steps rails', 'Done a solid cyan box with a dark tick, the current step a cyan edge, a choice needed an amber box (T rule 4).', '<div class="wall">' + ''.join(W3['steps']) + '</div>') \
 + sec('c3-h', 'Groups', 'The Cradle in every area (T 2.4).', '<div class="wall wide">' + ''.join(W3['group']) + '</div>') \
 + sec('m3-h', 'The GM ONLY tag', 'One tag, VT323 16 px in a 22 px box (T rule 7).', '<div class="wall">' + ''.join(W3['gm']) + '</div>') \
 + sec('f4-h', 'The fourth sweep\'s sixteen fixes', 'Made on 2026-10-31, at the owner\'s word, after seeing each before and after.', '<div class="findings">' + fx4 + '</div>') \
 + sec('e4-h', 'Eyebrows', 'Bai Jamjuree 600, 11 px capitals, 0.12em, --text-muted, wherever an eyebrow appears (T 2.4).', '<div class="wall nat">' + ''.join(W4['eyebrow']) + '</div>') \
 + sec('n4-h', 'Notices', 'A 1 px frame with a 3 px edge at its left in its meaning\'s colour, no fill, its words in --text (T rule 21).', '<div class="wall nat">' + ''.join(W4['notice']) + '</div>') \
 + sec('d4-h', 'Dialog and sheet titles', '20 px display capitals (T 2.2).', '<div class="wall nat">' + ''.join(W4['dtitle']) + '</div>') \
 + sec('t4-h', 'Title rows', 'The title 24 px on a laptop, 20 px on a phone (T 2.2).', '<div class="wall wide">' + ''.join(W4['trow']) + '</div>') \
 + sec('c4-h', 'The Compendium\'s chips', 'Filter chips, the open records button and Filters on their Base lines (T 2.5).', '<div class="wall nat">' + ''.join(W4['gchip']) + '</div>') \
 + sec('f5-h', 'The fifth sweep\'s twenty-five fixes', 'Made on 2026-10-31, at the owner\'s word, after seeing each before and after.', '<div class="findings">' + fx5 + '</div>') \
 + sec('k5-h', 'Kind cards', 'Its icon and name, the count in VT323 30 px under them, its line (T rule 19).', '<div class="wall">' + ''.join(W5['kcard']) + '</div>') \
 + sec('b5-h', 'Bars you act in', 'A Cradle: no fill, a 2 px base, sides that fade before the top (T 2.4).', '<div class="wall wide">' + ''.join(W5['bar']) + '</div>') \
 + sec('g5-h', 'Tags', 'VT323 16 px in a 22 px box, for a state, a condition, a source, a folder and a method (T rule 7).', '<div class="wall nat">' + ''.join(W5['tag']) + '</div>') \
 + sec('x5-h', 'Closes', 'A plain 18 px icon, 40 px on a laptop and 44 px on a phone; a toast\'s close a 36 px square (T 2.2, 2.5).', '<div class="wall nat">' + ''.join(W5['close']) + '</div>') \
 + sec('s5-h', 'Steppers', '40 px, 44 px on a phone, the number VT323 22 px (T 2.5).', '<div class="wall nat">' + ''.join(W5['stepper']) + '</div>') \
 + sec('tb5-h', 'Tab rows', 'Tabs 44 px with 14 px words (T rule 1).', '<div class="wall wide">' + ''.join(W5['tabs']) + '</div>') \
 + sec('fi5-h', 'Fields', 'The bar\'s search 38 px; a form field 40 px on a laptop and 44 px on a phone (T 2.5).', '<div class="wall nat">' + ''.join(W5['field']) + '</div>') \
 + sec('l5-h', 'Lamps', 'An 8 px lamp beside its word (T rule 19).', '<div class="wall nat">' + ''.join(W5['lamp']) + '</div>') \
 + sec('mk5-h', 'Steps marks', '24 px, the number VT323 17 px (T rule 4).', '<div class="wall nat">' + ''.join(W5['mark']) + '</div>') \
 + sec('fa5-h', 'The frame\'s turn order', 'The table\'s faces: 38 px on a 2 px rim, 34 px on a phone.', '<div class="wall nat">' + ''.join(W5['face']) + '</div>') \
 + sec('ti5-h', 'Titles in a page', 'A title that opens a record or a pane: 22 px on a laptop, 20 px on a phone (T 2.2).', '<div class="wall nat">' + ''.join(W5['title']) + '</div>') \
 + sec('e5-h', 'Eyebrows the fourth sweep missed', '11 px capitals, 0.12em, 600 (T 2.4).', '<div class="wall nat">' + ''.join(W5['eyebrow']) + '</div>') \
 + sec('c5-h', 'Dawn\'s coloured words', 'Amber, magenta and violet words in their text shades, 5:1 or better on Dawn\'s grounds (T rule 9).', '<div class="wall nat">' + ''.join(W5['shade']) + '</div>') + '</main>\n'
open('../consistency.html', 'w').write(head + body)
print(len(head + body))

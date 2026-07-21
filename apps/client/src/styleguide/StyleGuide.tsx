import type { ReactNode } from "react";
import { useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Chip,
  Eyebrow,
  Field,
  IconButton,
  Input,
  Kbd,
  LinkButton,
  Menu,
  Meter,
  MenuItem,
  Modal,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Stepper,
  Steps,
  Switch,
  Tabs,
  Textarea,
  ThemeToggle,
  Tooltip,
  ToastProvider,
  useToast,
  Wordmark,
  type TabItem
} from "@vtt/ui";

/** Living style guide for the OzyVTT design system. Dev-only reference
    (its own Vite entry, styleguide.html); renders every token, type role, and
    primitive with its states, and switches themes live. Keep it current: a new
    primitive isn't done until it appears here. */

const SURFACES = ["--void", "--bg", "--surface-1", "--surface-2", "--surface-3", "--overlay"];
const LINES = ["--line", "--line-strong"];
const NEON = ["--magenta", "--magenta-hi", "--cyan", "--cyan-hi", "--violet", "--violet-hi", "--indigo"];
const SEMANTIC = ["--primary", "--success", "--caution", "--danger", "--danger-hi", "--info"];
const TEXTS = ["--text", "--text-dim", "--text-muted", "--text-on-neon"];

function Section({ id, title, blurb, children }: { id: string; title: string; blurb?: string; children: ReactNode }) {
  return (
    <section className="sg-section" id={id}>
      <div className="sg-section-head">
        <h2 className="sg-h2">{title}</h2>
        {blurb && <p className="sg-blurb">{blurb}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="sg-swatch">
      <div className="sg-swatch-chip" style={{ background: `var(${token})` }} />
      <code className="sg-swatch-name">{token}</code>
    </div>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="sg-row">
      <Button variant="secondary" onClick={() => toast("Encounter saved", { tone: "success" })}>Success toast</Button>
      <Button variant="secondary" onClick={() => toast("Couldn't reach the server", { tone: "error" })}>Error toast</Button>
      <Button variant="secondary" onClick={() => toast("Player joined the table", { tone: "info" })}>Info toast</Button>
    </div>
  );
}

const DEMO_TABS: TabItem[] = [
  { id: "encounter", label: "Encounter" },
  { id: "maps", label: "Map Setup" },
  { id: "viewer", label: "Viewer" },
  { id: "replay", label: "Replays" },
  { id: "setup", label: "VTT Setup" }
];

export function StyleGuide() {
  const [tab, setTab] = useState("encounter");
  const [vtab, setVtab] = useState("encounter");
  const [modalOpen, setModalOpen] = useState(false);
  const [entranceKey, setEntranceKey] = useState(0);
  const [filterOn, setFilterOn] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [count, setCount] = useState(3);
  const [seg, setSeg] = useState("all");

  return (
    <ToastProvider>
      <div className="sg">
        <header className="sg-header surface-frost">
          <div className="sg-header-brand">
            <Wordmark>OzyVTT</Wordmark>
            <Eyebrow>Design system reference</Eyebrow>
          </div>
          <ThemeToggle />
        </header>

        <main className="sg-main">
          <p className="sg-intro">
            The single source of truth for look and feel. Every control here is a{" "}
            <code>@vtt/ui</code> primitive driven entirely by the design tokens — switch the theme above
            to see all three themes. Build new features from these; do not hand-roll bespoke controls.
          </p>

          <Section id="color" title="Color" blurb="Magenta leads, cyan supports. Surfaces are dark and quiet; neon is reserved for edges and states.">
            <h3 className="sg-h3">Surfaces</h3>
            <div className="sg-swatches">{SURFACES.map((t) => <Swatch key={t} token={t} />)}</div>
            <h3 className="sg-h3">Lines</h3>
            <div className="sg-swatches">{LINES.map((t) => <Swatch key={t} token={t} />)}</div>
            <h3 className="sg-h3">Neon accents</h3>
            <div className="sg-swatches">{NEON.map((t) => <Swatch key={t} token={t} />)}</div>
            <h3 className="sg-h3">Semantic</h3>
            <div className="sg-swatches">{SEMANTIC.map((t) => <Swatch key={t} token={t} />)}</div>
            <h3 className="sg-h3">Text</h3>
            <div className="sg-swatches">{TEXTS.map((t) => <Swatch key={t} token={t} />)}</div>
            <h3 className="sg-h3">Signature ramp</h3>
            <div className="sg-ramp" />
          </Section>

          <Section id="type" title="Typography" blurb="Arcade voice is fenced to the wordmark and top titles; body and mono stay neutral and legible.">
            <div className="sg-type-rows">
              <div className="sg-type-row"><Wordmark>OzyVTT</Wordmark><code>--font-wordmark · wordmark only</code></div>
              <div className="sg-type-row"><span className="sg-display">Display / dice totals</span><code>--font-display · Russo One</code></div>
              <div className="sg-type-row"><span className="sg-body-sample">Body — stat blocks, chat, forms, controls stay in the neutral body face.</span><code>--font-body · Manrope</code></div>
              <div className="sg-type-row"><span className="tabular sg-mono-sample">2d6+3 · HP 42/58 · +5</span><code>--font-mono · Space Mono, tabular</code></div>
            </div>
            <div className="sg-scale">
              <p style={{ fontSize: "var(--fs-display)" }}>Display 34</p>
              <p style={{ fontSize: "var(--fs-h1)" }}>Heading 1 · 26</p>
              <p style={{ fontSize: "var(--fs-h2)" }}>Heading 2 · 20</p>
              <p style={{ fontSize: "var(--fs-h3)" }}>Heading 3 · 16</p>
              <p style={{ fontSize: "var(--fs-body)" }}>Body · 15</p>
              <p style={{ fontSize: "var(--fs-sm)" }}>Small · 13</p>
              <p style={{ fontSize: "var(--fs-xs)" }}>Caption · 11</p>
            </div>
          </Section>

          <Section id="buttons" title="Buttons" blurb="One primary action per view. Variants map to semantic roles; labels are sentence case.">
            <div className="sg-row">
              <Button variant="primary">Roll initiative</Button>
              <Button variant="secondary">Add combatant</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="destructive">End encounter</Button>
              <Button variant="primary" disabled>Disabled</Button>
            </div>
            <div className="sg-row">
              <Button variant="primary" size="sm">Small primary</Button>
              <Button variant="secondary" size="sm">Small secondary</Button>
              <IconButton label="Ping">📍</IconButton>
              <IconButton label="Measure">📏</IconButton>
              <IconButton label="Fog" aria-pressed>🌫</IconButton>
            </div>
            <div className="sg-row">
              <Button variant="primary" arrow>Start encounter</Button>
              <Button variant="secondary" arrow>Open sheet</Button>
              <Button variant="secondary" lift>Lift on hover</Button>
            </div>
          </Section>

          <Section id="forms" title="Inputs & forms" blurb="Surface-3 well, cyan-glow focus. Validation always pairs an icon with text.">
            <div className="sg-grid2">
              <Field label="GM password" htmlFor="sg-pass" help="Set once on the host machine.">
                <Input id="sg-pass" type="password" placeholder="GM password" />
              </Field>
              <Field label="Roll visibility" htmlFor="sg-vis">
                <Select id="sg-vis" defaultValue="public">
                  <option value="public">Everyone</option>
                  <option value="gm">GM only</option>
                </Select>
              </Field>
              <Field label="Encounter name" htmlFor="sg-name" required error="Name is required.">
                <Input id="sg-name" invalid placeholder="Goblin ambush" />
              </Field>
              <Field label="Notes" htmlFor="sg-notes" help="Markdown supported.">
                <Textarea id="sg-notes" placeholder="Set the scene…" />
              </Field>
            </div>
          </Section>

          <Section id="panels" title="Panels" blurb="Resting surfaces stay dark. An optional 2px hairline labels a panel kind.">
            <div className="sg-grid3">
              <Panel><PanelHeader eyebrow="Notes" title="Plain panel" /><p className="sg-muted">surface-1, 1px line, no glow.</p></Panel>
              <Panel accent="magenta"><PanelHeader eyebrow="Combat" title="Magenta accent" /><p className="sg-muted">Encounter / combat kind.</p></Panel>
              <Panel accent="cyan"><PanelHeader eyebrow="Info" title="Cyan accent" /><p className="sg-muted">Notes / info kind.</p></Panel>
            </div>
          </Section>

          <Section id="tabs" title="Tabs" blurb="One tab bar everywhere. Active = text + magenta underline (or left bar) with a faint glow.">
            <Tabs tabs={DEMO_TABS} activeId={tab} onChange={setTab} ariaLabel="Demo tabs" />
            <div className="sg-vtabs">
              <Tabs tabs={DEMO_TABS.slice(0, 4)} activeId={vtab} onChange={setVtab} orientation="vertical" ariaLabel="Demo vertical tabs" />
            </div>
          </Section>

          <Section id="menus" title="Menus & tooltips" blurb="Native details/summary disclosure; caret rotates on open.">
            <div className="sg-row">
              <Menu trigger="Options">
                <MenuItem icon="⚔">Roll mode</MenuItem>
                <MenuItem icon="🎲">Rules mode</MenuItem>
                <MenuItem icon="🗑" tone="danger">End encounter</MenuItem>
              </Menu>
              <Tooltip content="Reveal the map to the shared screen">
                <Button variant="secondary">Hover / focus me</Button>
              </Tooltip>
            </div>
          </Section>

          <Section id="chips" title="Condition chips" blurb="Category reads from icon + label + border, never color alone.">
            <div className="sg-row">
              <Chip tone="harmful" icon="☠">Poisoned</Chip>
              <Chip tone="harmful" icon="⬇">Prone</Chip>
              <Chip tone="beneficial" icon="✦">Blessed</Chip>
              <Chip tone="magical" icon="✷">Concentrating</Chip>
              <Chip tone="magical" icon="✷" atRisk>Concentration at risk</Chip>
              <Chip tone="info" icon="•">Hidden</Chip>
              <Chip tone="harmful" icon="☠" onRemove={() => {}} removeLabel="Remove poisoned">Removable</Chip>
              <Chip tone="magical" icon="✷" pressed={filterOn} onClick={() => setFilterOn((v) => !v)}>Toggle (pressable)</Chip>
            </div>
          </Section>

          <Section id="badges" title="Badges & avatars" blurb="Badges label counts and short statuses (quieter than a chip). Avatars carry identity — monogram or portrait, with an optional presence dot.">
            <h3 className="sg-h3">Badges</h3>
            <div className="sg-row">
              <Badge>Draft</Badge>
              <Badge tone="primary">Homebrew</Badge>
              <Badge tone="success">Ready</Badge>
              <Badge tone="caution">Beta</Badge>
              <Badge tone="danger">Revoked</Badge>
              <Badge tone="info">SRD</Badge>
              <Badge tone="primary" solid>LIVE</Badge>
              <Badge tone="danger" solid>3</Badge>
            </div>
            <h3 className="sg-h3">Avatars</h3>
            <div className="sg-row sg-row-baseline">
              <Avatar name="Borin Stoneguard" size="sm" />
              <Avatar name="Mirena Dawnbright" />
              <Avatar name="Lyra Emberwise" size="lg" />
              <Avatar name="Aria Voss" presence="online" />
              <Avatar name="Kel Tanner" presence="away" />
              <Avatar name="Draven Ash" presence="offline" />
            </div>
          </Section>

          <Section id="meters" title="Meters & progress" blurb="Labeled bars for hit points and resources. Health tone auto-bands cyan → magenta → danger, the same fraction the map/token health uses.">
            <div className="sg-grid2">
              <Meter value={58} max={58} tone="health" label="HP — healthy" />
              <Meter value={24} max={58} tone="health" label="HP — bloodied" />
              <Meter value={5} max={58} tone="health" label="HP — down" />
              <Meter value={3} max={4} tone="violet" label="Spell slots (lvl 2)" />
              <Meter value={2} max={3} tone="cyan" label="Hit Dice" />
              <Meter value={780} max={2700} tone="magenta" label="XP to level 4" />
            </div>
          </Section>

          <Section id="alerts" title="Alerts" blurb="In-flow message banners that explain state and stay put — unlike a toast, which is transient. Danger and warning announce assertively.">
            <div className="sg-stack">
              <Alert tone="info" title="Server owns the dice">Every roll is resolved and audited on the server; the client only renders the result.</Alert>
              <Alert tone="success" title="Grid calibrated">The 3 × 3 sample matched at 71px per cell — this battlemap is ready to run.</Alert>
              <Alert tone="warning" title="Freeform rules mode">Action economy and reach are not enforced. Rejections degrade to warnings.</Alert>
              <Alert tone="danger" title="Secret shown once">Copy this credential now — it is stored only as a salted hash and cannot be shown again.</Alert>
            </div>
          </Section>

          <Section id="table" title="Data table" blurb="One table style for content lists, credentials, and import previews. Numeric columns are mono + right-aligned; rows lift on hover.">
            <div className="sg-table-wrap">
              <table className="nh-table">
                <thead><tr><th>Name</th><th>Type</th><th className="nh-num">CR</th><th className="nh-num">AC</th><th className="nh-num">HP</th></tr></thead>
                <tbody>
                  <tr><td>Goblin</td><td>Humanoid</td><td className="nh-num">1/4</td><td className="nh-num">15</td><td className="nh-num">7</td></tr>
                  <tr><td>Owlbear</td><td>Monstrosity</td><td className="nh-num">3</td><td className="nh-num">13</td><td className="nh-num">59</td></tr>
                  <tr><td>Adult Red Dragon</td><td>Dragon</td><td className="nh-num">17</td><td className="nh-num">19</td><td className="nh-num">256</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="statlist" title="Stat block & definition list" blurb="Key–value grid for character-sheet vitals, monster meta, and any labeled data. Values use the tabular mono face.">
            <dl className="nh-statlist">
              <div><dt>HP</dt><dd>58 / 58</dd></div>
              <div><dt>AC</dt><dd>18</dd></div>
              <div><dt>Speed</dt><dd>30 ft</dd></div>
              <div><dt>Init</dt><dd>+2</dd></div>
              <div><dt>Prof</dt><dd>+3</dd></div>
              <div><dt>STR</dt><dd>16</dd></div>
              <div><dt>DEX</dt><dd>14</dd></div>
              <div><dt>CON</dt><dd>15</dd></div>
            </dl>
          </Section>

          <Section id="empty" title="Empty states" blurb="A consistent 'nothing here yet' block: icon, display-face title, one line of guidance, and (optionally) the action that fills it.">
            <div className="nh-empty">
              <span className="nh-empty-icon" aria-hidden="true">🗺️</span>
              <span className="nh-empty-title">No maps yet</span>
              <span className="nh-empty-text">Upload a battlemap to stage encounters, or import a folder of scenes to get started.</span>
              <Button variant="primary" arrow>Upload a map</Button>
            </div>
          </Section>

          <Section id="switch" title="Switch" blurb="On/off toggle for settings that take effect immediately (role=switch). Reach for a checkbox only inside a form that's submitted.">
            <div className="sg-row">
              <Switch checked={switchOn} onChange={setSwitchOn} label="Reveal to players" />
              <Switch checked={!switchOn} onChange={(v) => setSwitchOn(!v)} label="GM-only" />
              <Switch checked={false} onChange={() => {}} disabled aria-label="Disabled off" />
            </div>
          </Section>

          <Section id="stepper" title="Stepper" blurb="Numeric −/+ spinner for small bounded quantities — ability scores, dice counts, HP nudges, limited uses. Clamps and disables the spent edge.">
            <div className="sg-row">
              <Stepper value={count} onChange={setCount} min={1} max={6} label="Dice" />
              <Stepper value={16} onChange={() => {}} min={1} max={20} label="STR" />
              <Stepper value={0} onChange={() => {}} min={0} max={9} label="Spell level" />
            </div>
          </Section>

          <Section id="segmented" title="Segmented control" blurb="Inline 'pick exactly one' for filters and mode switches. Distinct from Tabs, which swap whole views — use this for in-place option toggles.">
            <div className="sg-row">
              <SegmentedControl
                ariaLabel="Map filter"
                value={seg}
                onChange={setSeg}
                options={[{ value: "all", label: "All" }, { value: "battlemap", label: "Battlemaps" }, { value: "regional", label: "Regional" }, { value: "world", label: "World" }]}
              />
            </div>
          </Section>

          <Section id="steps" title="Steps" blurb="Progress indicator for multi-step flows — character builder, map calibration, content-import wizards. Done steps check off; the current step glows.">
            <Steps
              current={1}
              steps={[{ label: "Upload map" }, { label: "Calibrate grid" }, { label: "Verify scale" }, { label: "Save" }]}
            />
          </Section>

          <Section id="skeleton" title="Skeleton loaders" blurb="Quiet shimmer placeholders shaped like the content they stand in for (neutralized under reduced-motion). Use while a fetch resolves.">
            <div className="sg-skeleton-card">
              <div className="sg-skeleton-head">
                <Skeleton variant="circle" />
                <div className="sg-skeleton-lines">
                  <Skeleton variant="text" width="40%" />
                  <Skeleton variant="text" width="65%" />
                </div>
              </div>
              <Skeleton variant="block" height="6rem" />
            </div>
          </Section>

          <Section id="kbd" title="Keyboard hints" blurb="Key caps for shortcut hints and cheat sheets. Compose several for a chord — ready for the coming command palette.">
            <div className="sg-row">
              <span className="sg-kbd-hint"><Kbd>⌘</Kbd><Kbd>K</Kbd> Command palette</span>
              <span className="sg-kbd-hint"><Kbd>⌘</Kbd><Kbd>Enter</Kbd> Confirm roll</span>
              <span className="sg-kbd-hint"><Kbd>Esc</Kbd> Close</span>
            </div>
          </Section>

          <Section id="overlays" title="Modals & toasts" blurb="Native dialog with scrim blur, focus return, and scroll lock. Toasts name the result.">
            <div className="sg-row">
              <Button variant="primary" onClick={() => setModalOpen(true)}>Open modal</Button>
              <ToastDemo />
            </div>
            <Modal
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              title="Save encounter"
              accent="magenta"
              footer={<>
                <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>Save encounter</Button>
              </>}
            >
              <p className="sg-muted">The scrim blurs the background, focus is trapped and returns to the opener on close, and Escape or a backdrop click dismisses it.</p>
            </Modal>
          </Section>

          <Section id="states" title="States, glow & texture" blurb="Neon is a state, not a wallpaper. One glowing element per region; nothing pulses.">
            <div className="sg-row">
              <div className="sg-state-box is-selected">Selected · cyan</div>
              <div className="sg-state-box is-active-turn">Active turn · magenta</div>
              <div className="sg-state-box combat-active">Combat active · hue shift</div>
            </div>
            <div className="sg-textures">
              <div className="sg-texture scanlines"><span>scanlines</span></div>
              <div className="sg-texture static-noise"><span>static-noise</span></div>
              <div className="sg-texture sg-grid-demo"><div className="grid-floor" /><span>grid-floor</span></div>
            </div>
          </Section>

          <Section id="motion" title="Motion & interaction" blurb="One easing (--ease-settle), tiered durations. Smooth the moments that change context; leave dense lists alone. Nothing pulses; reduced-motion neutralizes all of it.">
            <h3 className="sg-h3">Hover-lift cards — hover them</h3>
            <div className="sg-grid3">
              <Panel interactive><PanelHeader eyebrow="Card" title="Lifts + presses" /><p className="sg-muted">translateY(-2px) + shadow on hover, settles flush on press.</p></Panel>
              <Panel lift><PanelHeader eyebrow="Card" title="Lift only" /><p className="sg-muted">Rises on hover without the press inversion.</p></Panel>
              <Panel><PanelHeader eyebrow="Card" title="Static" /><p className="sg-muted">Resting surface — no motion.</p></Panel>
            </div>
            <h3 className="sg-h3">Forward-nav arrows — hover them</h3>
            <div className="sg-row">
              <Button variant="primary" arrow>Start encounter</Button>
              <Button variant="secondary" arrow>Open sheet</Button>
              <LinkButton variant="ghost" arrow href="#motion">Jump to section</LinkButton>
            </div>
            <h3 className="sg-h3">Entrance vocabulary</h3>
            <div className="sg-row">
              <Button variant="secondary" onClick={() => setEntranceKey((k) => k + 1)}>Replay entrance</Button>
            </div>
            <div key={entranceKey} className="anim-view sg-state-box" style={{ marginTop: "var(--space-3)", minWidth: "16rem" }}>anim-view · fade + 7px drift</div>
            <p className="sg-muted" style={{ marginTop: "var(--space-4)" }}>
              Press feedback rides every control; disclosure carets rotate; dialogs pop (fade + 8px drift + scale), menus slide from the trigger side, mobile sheets rise. Dense, frequently-re-rendered lists (initiative rows, combat log, token list) never animate — press-only.
            </p>
          </Section>
        </main>
      </div>
    </ToastProvider>
  );
}

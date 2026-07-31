import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  AbilityScoreAllocator,
  Alert,
  Avatar,
  Badge,
  Button,
  Checklist,
  type ChecklistItem,
  ChoiceCard,
  ChoiceGrid,
  Chip,
  Combobox,
  DiceInputRow,
  Drawer,
  Eyebrow,
  FeatureList,
  Field,
  FieldGrid,
  IconButton,
  IconCheck,
  IconChevron,
  IconCopy,
  IconDie,
  IconDrag,
  IconEye,
  IconEyeOff,
  IconInfo,
  IconPencil,
  IconPlay,
  IconPlus,
  IconSearch,
  IconShuffle,
  IconTrash,
  IconWarning,
  IconX,
  Input,
  Kbd,
  LinkButton,
  MarkdownEditor,
  Menu,
  Meter,
  MenuItem,
  Modal,
  NameField,
  NumberField,
  Panel,
  PanelHeader,
  ReviewSummary,
  RowEditor,
  SaveState,
  SegmentedControl,
  Select,
  Skeleton,
  Stepper,
  Steps,
  Switch,
  TagInput,
  Tabs,
  Textarea,
  ThemeToggle,
  Tooltip,
  ToastProvider,
  useToast,
  WizardShell,
  Wordmark,
  type AbilityPoolValue,
  type ChoiceOption,
  type SaveStatus,
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
/** D21 — the atlas pin palette. Eight hues a GM assigns by MEANING, so they are a set, not a ramp. */
const PINS = ["--pin-1", "--pin-2", "--pin-3", "--pin-4", "--pin-5", "--pin-6", "--pin-7", "--pin-8"];

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

// ----- Codex recut demos (D25): the primitives the overhaul promoted out of feature code -----

const PICKER_OPTIONS = [
  { id: "p1", label: "Strahd von Zarovich", meta: "Character" },
  { id: "p2", label: "Barovia", meta: "Location" },
  { id: "p3", label: "The Vistani", meta: "Faction" },
  { id: "p4", label: "Castle Ravenloft", meta: "Location" },
  { id: "p5", label: "Ireena Kolyana", meta: "Character" },
  { id: "p6", label: "The Tome of Strahd", meta: "Item" }
];

function ComboboxDemo() {
  const [bound, setBound] = useState<string | null>(null);
  const [free, setFree] = useState<string | null>(null);
  return (
    <div className="sg-stack">
      <FieldGrid>
        <Field label="Closed set — pick an existing page" htmlFor="sg-combo-bound">
          <Combobox id="sg-combo-bound" ariaLabel="Pick a page" options={PICKER_OPTIONS} value={bound} onChange={setBound} placeholder="Search pages…" />
        </Field>
        <Field label="Open set — allowFreeText" htmlFor="sg-combo-free" help="Type a name nobody has written a page for yet and press Enter.">
          <Combobox id="sg-combo-free" ariaLabel="Who took this downtime" options={PICKER_OPTIONS} value={free} onChange={setFree} placeholder="Who?" allowFreeText />
        </Field>
      </FieldGrid>
      <p className="sg-muted">
        Chosen value: <code>{bound ?? "null"}</code> · free-text value: <code>{free ?? "null"}</code>
      </p>
    </div>
  );
}

/**
 * The preview renderer is the CALLER's, deliberately — the primitive renders no markdown itself. This
 * one is four lines of nothing so the styleguide does not quietly ship a second markdown implementation.
 */
function tinyPreview(markdown: string): ReactNode {
  return (
    <div className="sg-stack">
      {markdown.split("\n\n").map((block, index) => (
        <p key={index} className={block.startsWith("> ") ? "sg-muted" : undefined}>
          {block.replace(/^[#>\-\s]+/, "")}
        </p>
      ))}
    </div>
  );
}

function MarkdownEditorDemo() {
  const [body, setBody] = useState("The burgomaster's writ is a forgery.\n\nAsk [[Ireena Kolyana]] who sealed it.");
  return (
    <div className="sg-stack">
      <MarkdownEditor
        ariaLabel="Page body"
        value={body}
        onChange={setBody}
        placeholder="What do the players know?"
        renderPreview={tinyPreview}
        suggest={(query) => PICKER_OPTIONS.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))}
        rows={6}
      />
      <p className="sg-muted">Type <code>[[</code> in the body to raise the page autocomplete. The Edit/View switch only appears because a <code>renderPreview</code> was supplied — an editor with no reader shows no switch.</p>
      <h3 className="sg-h3">With an overlay — how the Codex marks its GM layer</h3>
      <MarkdownEditor
        ariaLabel="GM-only notes"
        value={"Strahd already knows. He is letting them carry it."}
        onChange={() => {}}
        rows={3}
        overlay={<Badge tone="violet">GM only</Badge>}
      />
      <p className="sg-muted">The overlay slot exists so the design system never learns what a “GM layer” is. Violet is the one hue reserved for it, and it is worn by the badge, not by the editor.</p>
    </div>
  );
}

/** D20: the palette is a COMPOSITION — Modal align='top' + an input + a list. Not a new primitive. */
function CommandPaletteDemo() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = PICKER_OPTIONS.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <div className="sg-row">
        <Button variant="primary" onClick={() => setOpen(true)}>Open the palette</Button>
        <span className="sg-kbd-hint"><Kbd>⌘</Kbd><Kbd>K</Kbd> in the app</span>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} size="sm" align="top" ariaLabel="Demo command palette">
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages, entries, maps, pins…" aria-label="Search" />
        <ul className="sg-palette-list">
          {matches.map((option) => (
            <li key={option.id}><button type="button" className="sg-palette-item tap-target interactive" onClick={() => setOpen(false)}>{option.label} <span className="sg-muted">{option.meta}</span></button></li>
          ))}
          {matches.length === 0 && <li className="sg-muted">No matches.</li>}
        </ul>
      </Modal>
    </>
  );
}

const DEMO_TABS: TabItem[] = [
  { id: "encounter", label: "Encounter" },
  { id: "maps", label: "Map Setup" },
  { id: "viewer", label: "Viewer" },
  { id: "replay", label: "Replays" },
  { id: "setup", label: "VTT Setup" }
];

/* The real GM bar, which is what made the scroll fix necessary: eight labels are about
   810px of content, so at 375px the last two sit outside a scrollport with a hidden
   scrollbar. Shrink the window to watch the fade appear and the active tab scroll in. */
const OVERFLOW_TABS: TabItem[] = [
  { id: "encounter", label: "Encounter" },
  { id: "maps", label: "Map Setup" },
  { id: "scenes", label: "Scenes" },
  { id: "codex", label: "Codex" },
  { id: "homebrew", label: "Homebrew" },
  { id: "viewer", label: "Viewer" },
  { id: "replay", label: "Replays" },
  { id: "setup", label: "VTT Setup" }
];

const ICONS = [
  { name: "IconCheck", glyph: <IconCheck />, use: "the one chosen mark" },
  { name: "IconChevron", glyph: <IconChevron />, use: "disclosure; rotate for back" },
  { name: "IconSearch", glyph: <IconSearch />, use: "filter a catalog" },
  { name: "IconShuffle", glyph: <IconShuffle />, use: "generate; in flight" },
  { name: "IconDie", glyph: <IconDie />, use: "roll it for me" },
  { name: "IconPencil", glyph: <IconPencil />, use: "edit; unsaved" },
  { name: "IconWarning", glyph: <IconWarning />, use: "blocked / caution" },
  { name: "IconInfo", glyph: <IconInfo />, use: "low-urgency note" },
  { name: "IconPlus", glyph: <IconPlus />, use: "add a row / a tag" },
  { name: "IconTrash", glyph: <IconTrash />, use: "remove (always worded)" },
  { name: "IconDrag", glyph: <IconDrag />, use: "reorder grip" },
  { name: "IconCopy", glyph: <IconCopy />, use: "duplicate an existing one" },
  { name: "IconEye", glyph: <IconEye />, use: "shown to players" },
  { name: "IconEyeOff", glyph: <IconEyeOff />, use: "GM only" },
  // Both added by the Codex recut, and both for the same reason the set exists at all: they were being
  // typed as characters. The close control was a literal "×" in five components (Manrope has no U+00D7
  // at the right weight, so it substituted), and the run/activate control was a "▶".
  { name: "IconX", glyph: <IconX />, use: "close / clear a chosen value" },
  { name: "IconPlay", glyph: <IconPlay />, use: "make live / run" }
];

const SAVE_STATUSES: SaveStatus[] = ["idle", "dirty", "saving", "saved", "conflict", "error"];

/** All six autosave states side by side — the point of the component is that you can
    tell them apart with the colour thrown away, so they are shown together. */
function SaveStateDemo() {
  const [status, setStatus] = useState<SaveStatus>("dirty");
  return (
    <div className="sg-stack">
      <SegmentedControl
        ariaLabel="Save status"
        size="sm"
        value={status}
        onChange={(next) => setStatus(next as SaveStatus)}
        options={SAVE_STATUSES.map((value) => ({ value, label: value }))}
      />
      <div className="sg-state-box" style={{ minWidth: 0, justifyItems: "start" }}>
        <SaveState status={status} onReload={() => setStatus("saved")} onRetry={() => setStatus("saved")} />
      </div>
      <div className="sg-savestates">
        {SAVE_STATUSES.map((value) => (
          <div key={value} className="sg-savestate-row">
            <code className="sg-swatch-name">{value}</code>
            <SaveState status={value} onReload={() => {}} onRetry={() => {}} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The editable and the read-only checklist SIDE BY SIDE, because the split is the
    component: the same items render as the GM's editor and as the player's status, and
    the player's copy has to be visibly (and, in a screen reader, audibly) not-a-control. */
function ChecklistDemo() {
  const [objectives, setObjectives] = useState<readonly ChecklistItem[]>([
    { text: "Find the missing ledger in the counting house", done: true },
    { text: "Learn who paid the harbourmaster", done: true },
    { text: "Confront Vessily before the tide turns", done: false }
  ]);

  return (
    <div className="sg-stack">
      <h3 className="sg-h3">Editable — the GM console (onChange present)</h3>
      {/* Distinct names on purpose: two lists on one page called "Quest objectives" are
          two identical stops in a screen reader's landmark/list rota. */}
      <Checklist
        ariaLabel="Quest objectives (editable)"
        items={objectives}
        onChange={setObjectives}
        onAdd={() => setObjectives((prev) => [...prev, { text: "", done: false }])}
        addLabel="Add an objective"
        max={5}
      />

      <h3 className="sg-h3">Read-only — the player's view (onChange omitted)</h3>
      <Checklist ariaLabel="Quest objectives (read-only)" items={objectives} />
    </div>
  );
}

/* Stands in for the app's `newId()`. The whole point of RowEditor's `rowKey` is that
   this id is minted once, with the row, and never derived from the array position. */
let demoSeq = 0;
const newDemoId = () => `demo-${++demoSeq}`;

type DemoAction = { id: string; name: string; description: string };
type DemoBonus = { id: string; ability: string; amount: number | null };

function RowEditorDemo() {
  const [actions, setActions] = useState<readonly DemoAction[]>([
    { id: newDemoId(), name: "Fire Breath", description: "Exhales fire in a 30-foot cone. DEX save 18, 56 (16d6) fire damage." },
    { id: newDemoId(), name: "Bite", description: "Melee weapon attack, +14 to hit, reach 10 ft. 19 (2d10 + 8) piercing." }
  ]);
  const [bonuses, setBonuses] = useState<readonly DemoBonus[]>([]);

  return (
    <div className="sg-stack">
      <h3 className="sg-h3">Collapsible rows, capped</h3>
      <RowEditor
        ariaLabel="Actions"
        rows={actions}
        onChange={setActions}
        rowKey={(row) => row.id}
        rowLabel={(row, index) => row.name || `Action ${index + 1}`}
        collapsible
        max={3}
        maxReachedReason="Three actions is the demo's cap — the real schema sets its own."
        emptyText="No actions yet."
        addLabel="Add an action"
        onAdd={() => ({ id: newDemoId(), name: "", description: "" })}
        renderRow={(row, index) => (
          <FieldGrid min="14rem">
            <Field label="Name" htmlFor={`sg-act-name-${row.id}`}>
              <Input
                id={`sg-act-name-${row.id}`}
                value={row.name}
                placeholder="Fire Breath"
                onChange={(event) => setActions((prev) => prev.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))}
              />
            </Field>
            <Field label="Description" htmlFor={`sg-act-desc-${row.id}`} className="nh-fieldgrid-wide">
              <Textarea
                id={`sg-act-desc-${row.id}`}
                value={row.description}
                placeholder="What happens when it hits."
                onChange={(event) => setActions((prev) => prev.map((r, i) => (i === index ? { ...r, description: event.target.value } : r)))}
              />
            </Field>
          </FieldGrid>
        )}
      />

      <h3 className="sg-h3">Flat rows, and the empty state</h3>
      <RowEditor
        ariaLabel="Ability bonuses"
        rows={bonuses}
        onChange={setBonuses}
        rowKey={(row) => row.id}
        rowLabel={(row, index) => (row.ability ? `${row.ability.toUpperCase()} ${(row.amount ?? 0) >= 0 ? "+" : ""}${row.amount ?? 0}` : `Bonus ${index + 1}`)}
        emptyText="No ability bonuses yet."
        addLabel="Add a bonus"
        onAdd={() => ({ id: newDemoId(), ability: "str", amount: 1 })}
        renderRow={(row, index) => (
          <FieldGrid min="10rem">
            <Field label="Ability" htmlFor={`sg-bonus-ab-${row.id}`}>
              <Select
                id={`sg-bonus-ab-${row.id}`}
                value={row.ability}
                onChange={(event) => setBonuses((prev) => prev.map((r, i) => (i === index ? { ...r, ability: event.target.value } : r)))}
              >
                {ABILITIES.map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}
              </Select>
            </Field>
            <Field label="Amount" htmlFor={`sg-bonus-amt-${row.id}`}>
              <NumberField
                id={`sg-bonus-amt-${row.id}`}
                value={row.amount}
                min={-2}
                max={3}
                allowNegative
                onChange={(next) => setBonuses((prev) => prev.map((r, i) => (i === index ? { ...r, amount: next } : r)))}
              />
            </Field>
          </FieldGrid>
        )}
      />
    </div>
  );
}

function NumberFieldDemo() {
  const [gold, setGold] = useState<number | null>(1250);
  const [weight, setWeight] = useState<number | null>(1.5);
  const [attack, setAttack] = useState<number | null>(-1);
  const [hp, setHp] = useState<number | null>(null);
  return (
    <FieldGrid>
      <Field label="Cost" htmlFor="sg-num-gp" help="Clamps to 0–1,000,000 when you leave the field, not while you type.">
        <NumberField id="sg-num-gp" value={gold} onChange={setGold} min={0} max={1000000} unit="gp" placeholder="0" />
      </Field>
      <Field label="Weight" htmlFor="sg-num-lb" help="allowDecimal switches the phone keypad to one with a decimal point.">
        <NumberField id="sg-num-lb" value={weight} onChange={setWeight} min={0} allowDecimal unit="lb" placeholder="0" />
      </Field>
      <Field label="Attack bonus" htmlFor="sg-num-atk" help="allowNegative — a −1 cursed blade is a real item.">
        <NumberField id="sg-num-atk" value={attack} onChange={setAttack} min={-5} max={5} allowNegative />
      </Field>
      <Field label="Hit points" htmlFor="sg-num-hp" error="Give this creature hit points.">
        <NumberField id="sg-num-hp" value={hp} onChange={setHp} min={1} max={1000} invalid placeholder="256" />
      </Field>
    </FieldGrid>
  );
}

const TOOL_SUGGESTIONS = ["thieves-tools", "smiths-tools", "herbalism-kit", "navigators-tools", "brewers-supplies"];

function TagInputDemo() {
  const [tools, setTools] = useState<readonly string[]>(["thieves-tools"]);
  const [resistances, setResistances] = useState<readonly string[]>(["fire", "cold", "poison"]);
  return (
    <FieldGrid>
      <Field label="Tool proficiencies" htmlFor="sg-tags-tools" help="Suggestions hint; they never close the set.">
        <TagInput
          id="sg-tags-tools"
          ariaLabel="Tool proficiencies"
          values={tools}
          onChange={setTools}
          suggestions={TOOL_SUGGESTIONS}
          placeholder="thieves-tools"
        />
      </Field>
      <Field label="Damage resistances" htmlFor="sg-tags-res" help="Typed entries slugify: “Cold Iron” becomes cold-iron.">
        <TagInput
          id="sg-tags-res"
          ariaLabel="Damage resistances"
          values={resistances}
          onChange={setResistances}
          max={3}
          maxReachedReason="Three is this demo's cap. Remove one to add another."
          placeholder="fire"
        />
      </Field>
    </FieldGrid>
  );
}

/* ---- Character-builder demo data (presentation only — the real content comes from
   the SRD bundles and the real math from @vtt/rules-5e). ---- */

const WIZARD_STEPS = [
  { label: "Species" }, { label: "Class" }, { label: "Background" },
  { label: "Ability scores" }, { label: "Skills" }, { label: "Equipment" }, { label: "Review" }
];

const SPECIES: ChoiceOption[] = [
  { value: "human", title: "Human", facet: "srd", keywords: "versatile", meta: "+1 to all · 30 ft", description: "Ambitious and adaptable, humans turn up in every corner of the world.", badge: <Badge tone="info">SRD</Badge> },
  { value: "elf", title: "Elf", facet: "srd", keywords: "fey darkvision", meta: "+2 DEX · 30 ft", description: "Graceful, long-lived, and at home in twilight — darkvision and keen senses.", badge: <Badge tone="info">SRD</Badge> },
  { value: "dwarf", title: "Dwarf", facet: "srd", keywords: "stout hardy", meta: "+2 CON · 25 ft", description: "Stone-hardy and stubborn, with darkvision and a resistance to poison.", badge: <Badge tone="info">SRD</Badge> },
  { value: "halfling", title: "Halfling", facet: "srd", keywords: "lucky small", meta: "+2 DEX · 25 ft", description: "Small, lucky, and very hard to frighten.", badge: <Badge tone="info">SRD</Badge> },
  { value: "dragonborn", title: "Dragonborn", facet: "srd", keywords: "breath weapon", meta: "+2 STR · 30 ft", description: "Draconic ancestry grants a breath weapon and matching damage resistance.", badge: <Badge tone="info">SRD</Badge> },
  { value: "gnome", title: "Gnome", facet: "srd", keywords: "cunning tinker", meta: "+2 INT · 25 ft", description: "Inventive and irrepressible, with advantage on mental saves against magic.", badge: <Badge tone="info">SRD</Badge> },
  { value: "half-elf", title: "Half-Elf", facet: "srd", keywords: "charisma versatile", meta: "+2 CHA · 30 ft", description: "At home everywhere and nowhere; two extra skills of your choosing.", badge: <Badge tone="info">SRD</Badge> },
  { value: "half-orc", title: "Half-Orc", facet: "srd", keywords: "relentless endurance", meta: "+2 STR · 30 ft", description: "Relentless endurance keeps you standing at 1 hit point once per rest.", badge: <Badge tone="info">SRD</Badge> },
  { value: "tiefling", title: "Tiefling", facet: "srd", keywords: "infernal fire", meta: "+2 CHA · 30 ft", description: "Infernal heritage: fire resistance and a little innate magic.", badge: <Badge tone="info">SRD</Badge> },
  { value: "ashborn", title: "Ashborn", facet: "homebrew", keywords: "volcanic", meta: "+2 CON · 30 ft", description: "Born of the cinder wastes; the campaign's own lineage.", badge: <Badge tone="primary">Homebrew</Badge> },
  { value: "tidewalker", title: "Tidewalker", facet: "homebrew", keywords: "aquatic swim", meta: "+2 WIS · 30 ft", description: "Amphibious wanderers of the drowned coast, with a swim speed.", badge: <Badge tone="primary">Homebrew</Badge> },
  { value: "voidkin", title: "Voidkin", facet: "homebrew", keywords: "starlight", meta: "+2 INT · 30 ft", description: "Touched by the space between stars. Needs the GM's blessing.", badge: <Badge tone="primary">Homebrew</Badge>, disabled: true, disabledReason: "The GM has not unlocked this lineage." }
];

const ABILITIES = [
  { id: "str", label: "Strength", abbr: "STR" },
  { id: "dex", label: "Dexterity", abbr: "DEX" },
  { id: "con", label: "Constitution", abbr: "CON" },
  { id: "int", label: "Intelligence", abbr: "INT" },
  { id: "wis", label: "Wisdom", abbr: "WIS" },
  { id: "cha", label: "Charisma", abbr: "CHA" }
];
const SPECIES_BONUS: Record<string, number> = { dex: 2, con: 1 };
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
/* Demo-only: the shipping wizard takes these from @vtt/rules-5e. */
const modifierOf = (score: number) => Math.floor((score - 10) / 2);

const CLASS_FEATURES = [
  { id: "second-wind", title: "Second Wind", meta: "Level 1", badge: <Badge tone="info">SRD</Badge>, body: <p>Once per short or long rest, use a bonus action to regain 1d10 + your fighter level in hit points.</p>, defaultOpen: true },
  { id: "action-surge", title: "Action Surge", meta: "Level 2", badge: <Badge tone="info">SRD</Badge>, body: <p>On your turn, take one additional action. Once per short or long rest.</p> },
  { id: "martial-archetype", title: "Martial Archetype", meta: "Level 3", badge: <Badge tone="info">SRD</Badge>, body: <p>Choose the archetype that shapes the rest of your fighter career. Its features arrive at levels 3, 7, 10, 15, and 18.</p> },
  { id: "asi-4", title: "Ability Score Improvement", meta: "Level 4", badge: <Badge tone="info">SRD</Badge>, body: <p>Raise one ability by 2, or two abilities by 1 each — or take a feat instead. No ability goes above 20 this way.</p> },
  { id: "extra-attack", title: "Extra Attack", meta: "Level 5", badge: <Badge tone="info">SRD</Badge>, body: <p>Attack twice whenever you take the Attack action on your turn.</p> },
  { id: "cinder-mark", title: "Cinder Mark", meta: "Level 3", badge: <Badge tone="primary">Homebrew</Badge>, body: <p>Brand a creature you hit. Your next attack against it before the end of your next turn deals an extra 1d6 fire damage.</p> }
];

/** The wizard frame driving a real step: species picking, live validation gating,
    a preview pane, and the persistent attribution footnote. */
function WizardDemo() {
  const [step, setStep] = useState(0);
  const [species, setSpecies] = useState<string | null>(null);
  const [facet, setFacet] = useState("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const chosen = SPECIES.find((option) => option.value === species) ?? null;

  return (
    <div className="sg-wizard-frame">
      <WizardShell
        title="Create a character"
        eyebrow="Character builder"
        steps={WIZARD_STEPS}
        current={step}
        onStepSelect={setStep}
        onSaveAndClose={() => undefined}
        onBack={step > 0 ? () => setStep((s) => s - 1) : undefined}
        onNext={step < WIZARD_STEPS.length - 1 ? () => setStep((s) => s + 1) : undefined}
        blockedReason={step === 0 && !species ? "Choose a species to continue." : undefined}
        resume={<Alert tone="info" title="Draft found">You started this character on another device. <Button variant="ghost" size="sm">Resume draft</Button></Alert>}
        detail={chosen
          ? <>
              <p>{chosen.description}</p>
              <p className="tabular sg-muted">{chosen.meta}</p>
            </>
          : <p>Pick a species to preview its traits here.</p>}
        detailTitle={chosen ? chosen.title : "Preview"}
        detailOpen={detailOpen}
        onOpenDetail={() => setDetailOpen(true)}
        detailOpenLabel="Show preview"
        onCloseDetail={() => setDetailOpen(false)}
        detailBackLabel="Back to the list"
        footnote="Species, class, and background text from the SRD 5.2.1, CC BY 4.0."
      >
        <div className="sg-wizard-step">
          <ChoiceGrid
            ariaLabel="Species"
            options={SPECIES}
            value={species}
            onChange={(value) => { setSpecies(value); }}
            searchPlaceholder="Search species…"
            facetValue={facet}
            onFacetChange={setFacet}
            facetLabel="Source"
            facets={[{ value: "all", label: "All" }, { value: "srd", label: "SRD" }, { value: "homebrew", label: "Homebrew" }]}
          />
        </div>
      </WizardShell>
    </div>
  );
}

/** All four ability-generation methods behind one component. */
function AllocatorDemo() {
  const [method, setMethod] = useState("standard");
  const [assigned, setAssigned] = useState<Record<string, string | null>>({});
  const [scores, setScores] = useState<Record<string, number>>(() => Object.fromEntries(ABILITIES.map((a) => [a.id, 8])));
  const [rolls, setRolls] = useState<number[]>([]);
  const [diceMode, setDiceMode] = useState<"auto" | "manual">("auto");

  const spend = method === "point-buy";
  const values = method === "roll" ? rolls : method === "custom" ? [17, 15, 13, 12, 10, 8] : STANDARD_ARRAY;

  const pool: AbilityPoolValue[] = useMemo(
    () => values.map((value, index) => {
      const id = `${method}-${index}`;
      return { id, value, assignedTo: Object.entries(assigned).find(([, poolId]) => poolId === id)?.[0] ?? null };
    }),
    [values, assigned, method]
  );

  const rows = ABILITIES.map((ability) => {
    const bonus = SPECIES_BONUS[ability.id];
    const base = spend ? scores[ability.id] : pool.find((entry) => entry.assignedTo === ability.id)?.value ?? null;
    const total = base == null ? null : base + (bonus ?? 0);
    return { ...ability, score: base, bonus, total, modifier: total == null ? null : modifierOf(total), min: 8, max: 15 };
  });

  const spent = ABILITIES.reduce((sum, ability) => sum + (POINT_COST[scores[ability.id]] ?? 0), 0);

  const switchMethod = (next: string) => { setMethod(next); setAssigned({}); setRolls([]); };
  const assign = (abilityId: string, poolId: string | null) => setAssigned((prev) => {
    const next = { ...prev };
    if (poolId) for (const key of Object.keys(next)) if (next[key] === poolId) next[key] = null;
    next[abilityId] = poolId;
    return next;
  });

  return (
    <AbilityScoreAllocator
      mode={spend ? "spend" : "assign"}
      method={method}
      onMethodChange={switchMethod}
      methods={[
        { value: "standard", label: "Standard array" },
        { value: "point-buy", label: "Point buy" },
        { value: "roll", label: "Roll 4d6" },
        { value: "custom", label: "GM formula" }
      ]}
      methodHint={
        method === "standard" ? "Assign 15, 14, 13, 12, 10, 8 to the six abilities."
        : method === "point-buy" ? "Spend 27 points. 8 is free; 15 costs 9."
        : method === "roll" ? "Roll 4d6 and drop the lowest, six times, then assign the results."
        : "This table's formula: 2d6 + 6, rolled six times."
      }
      rows={rows}
      pool={spend ? undefined : pool}
      onAssign={assign}
      onScoreChange={(abilityId, next) => setScores((prev) => ({ ...prev, [abilityId]: next }))}
      budget={spend ? { spent, total: 27 } : undefined}
      toolbar={method === "roll"
        ? <DiceInputRow
            label="Roll six scores"
            notation="4d6 drop lowest"
            mode={diceMode}
            onModeChange={setDiceMode}
            min={3}
            max={18}
            onRoll={() => setRolls(Array.from({ length: 6 }, () => 8 + Math.floor(Math.random() * 8)))}
            onManual={(total) => setRolls((prev) => (prev.length >= 6 ? prev : [...prev, total]))}
            onReroll={rolls.length > 0 ? () => { setRolls([]); setAssigned({}); } : undefined}
            result={rolls.length > 0 ? rolls.join(" · ") : undefined}
            hint={diceMode === "manual" ? "Type each of your six totals, one at a time." : "The server owns the dice; this button only asks for them."}
          />
        : undefined}
    />
  );
}

function NameFieldDemo() {
  const POOLS = [
    ["Borin Stoneguard", "Mirena Dawnbright", "Lyra Emberwise", "Kel Tanner"],
    ["Draven Ash", "Sabine Vale", "Orrin Quickfoot", "Thessaly Grey"],
    ["Rurik Ironvow", "Nessa Coldbrook", "Halvard Finn", "Ilsa Wren"]
  ];
  const [batch, setBatch] = useState(0);
  const [name, setName] = useState("");
  return (
    <div className="sg-grid2">
      <NameField
        value={name}
        onChange={setName}
        suggestions={POOLS[batch % POOLS.length]}
        onShuffle={() => setBatch((b) => b + 1)}
        help="Per-species name bundles feed these; you can always type your own."
      />
    </div>
  );
}

function DiceInputDemo() {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [hp, setHp] = useState<number | null>(null);
  return (
    <DiceInputRow
      label="Hit points for level 4"
      notation="1d10 + 2"
      mode={mode}
      onModeChange={setMode}
      min={3}
      max={12}
      onRoll={() => setHp(3 + Math.floor(Math.random() * 10))}
      onManual={setHp}
      onReroll={hp != null ? () => setHp(null) : undefined}
      result={hp != null ? `${hp} HP` : undefined}
      complete={hp != null}
      hint="Outside combat the wizard offers both paths; inside an encounter, RollControls does."
    />
  );
}

function ChoiceGridDemo() {
  const [value, setValue] = useState<string | null>("elf");
  const [facet, setFacet] = useState("all");
  return (
    <ChoiceGrid
      ariaLabel="Species"
      options={SPECIES}
      value={value}
      onChange={setValue}
      searchPlaceholder="Search species…"
      facetLabel="Source"
      facetValue={facet}
      onFacetChange={setFacet}
      facets={[{ value: "all", label: "All" }, { value: "srd", label: "SRD" }, { value: "homebrew", label: "Homebrew" }]}
      emptyAction={<Button variant="secondary" onClick={() => setFacet("all")}>Clear filters</Button>}
    />
  );
}

/** The same grid in choose-N mode — the shape every content offer with `choose > 1`
    takes (three Weapon Masteries, six prepared spells, two Magic Initiate cantrips). */
function ChoiceGridMultiDemo() {
  const [picked, setPicked] = useState<readonly string[]>(["elf"]);
  const max = 2;
  return (
    <>
      <p className="sg-muted tabular">{picked.length} of {max} chosen</p>
      <ChoiceGrid
        ariaLabel="Weapon masteries"
        selection="multiple"
        options={SPECIES}
        value={null}
        onChange={() => undefined}
        values={picked}
        max={max}
        onToggle={(value, next) => setPicked((prev) => next ? [...prev, value] : prev.filter((entry) => entry !== value))}
        searchPlaceholder="Search options…"
      />
    </>
  );
}

export function StyleGuide() {
  const [tab, setTab] = useState("encounter");
  const [overflowTab, setOverflowTab] = useState("encounter");
  const [vtab, setVtab] = useState("encounter");
  const [modalOpen, setModalOpen] = useState(false);
  const [entranceKey, setEntranceKey] = useState(0);
  const [filterOn, setFilterOn] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [count, setCount] = useState(3);
  const [mod, setMod] = useState(0);
  const [seg, setSeg] = useState("all");
  const [dockSide, setDockSide] = useState("right");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSide, setDrawerSide] = useState<"right" | "left">("right");
  const [cardPick, setCardPick] = useState("fighter");

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
            <h3 className="sg-h3">Atlas pins</h3>
            <p className="sg-muted">Eight hues a GM assigns by meaning (capital, ruin, danger, quest). A set rather than a ramp: no order is implied, and every one is darkened in the light theme so a pin on parchment stays a pin.</p>
            <div className="sg-swatches">{PINS.map((t) => <Swatch key={t} token={t} />)}</div>
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

          <Section id="icons" title="Icons" blurb="The system's own SVG glyphs — 24×24, filled with currentColor, sized in em, always aria-hidden so the control around them carries the name. A primitive never renders a glyph as TEXT: Manrope has no ⚠, so it silently falls back to a system face at the wrong size and iOS/Android give it emoji presentation — a yellow triangle, a hue this palette does not own. The set is deliberately small; the app's richer fantasy-cartography glyphs live in the client. There is no IconArrow: the forward → is all-or-none across seven existing call sites, and half-adopting it would mix a drawn arrow with a fallback glyph on the same screen.">
            <div className="sg-icons">
              {ICONS.map((icon) => (
                <div className="sg-icon" key={icon.name}>
                  <span className="sg-icon-glyph">{icon.glyph}</span>
                  <code className="sg-swatch-name">{icon.name}</code>
                  <span className="sg-icon-use">{icon.use}</span>
                </div>
              ))}
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
              {/* Never an emoji or a symbol character, including here: the styleguide is the one place a
                  bad example is most likely to be copied. These were 📍 / 📏 / 🌫 and are now real glyphs. */}
              <IconButton label="Ping"><IconEye /></IconButton>
              <IconButton label="Measure"><IconDrag /></IconButton>
              <IconButton label="Fog" aria-pressed><IconEyeOff /></IconButton>
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
            <h3 className="sg-h3">variant=&quot;title&quot; — the record's own name</h3>
            <p className="sg-muted">
              An editor whose subject is one record wants the title to READ as the heading it becomes, not as
              the first of six identical wells. The variant is display-sized and loses the well; it keeps the
              focus ring, because it is still a text field and hiding that is how a title becomes a control
              nobody notices they can edit. Use it once per surface, on the field that names the thing.
            </p>
            <Input variant="title" defaultValue="Castle Ravenloft" aria-label="Page title" />
          </Section>

          <Section id="fieldgrid" title="Field grid" blurb="The form layout for every authoring surface: as many equal columns as fit, no media query. The load-bearing detail is minmax(min(220px, 100%), 1fr) rather than minmax(220px, 1fr) — the bare version holds a 220px floor even inside a 200px rail, which pushes the document sideways at 375px. Because it is intrinsic rather than breakpoint-driven, the same grid resolves to ONE column in a narrow desktop rail and TWO in a full-width phone column, which is the right answer in both places and takes no thought from the caller. A field that must span the row takes className='nh-fieldgrid-wide' — the escape hatch belongs to the child, so the grid never learns about its children.">
            <FieldGrid>
              <Field label="Name" htmlFor="sg-fg-name"><Input id="sg-fg-name" placeholder="Frost Warden" /></Field>
              <Field label="Hit die" htmlFor="sg-fg-die">
                <Select id="sg-fg-die" defaultValue="d10"><option>d6</option><option>d8</option><option>d10</option><option>d12</option></Select>
              </Field>
              <Field label="Subclass label" htmlFor="sg-fg-sub"><Input id="sg-fg-sub" placeholder="Martial Archetype" /></Field>
              <Field label="Description" htmlFor="sg-fg-desc" className="nh-fieldgrid-wide" help="nh-fieldgrid-wide spans 1 / -1.">
                <Textarea id="sg-fg-desc" placeholder="What this class is for." />
              </Field>
            </FieldGrid>
            <h3 className="sg-h3">min=&quot;12rem&quot; — the same grid, tighter columns</h3>
            <FieldGrid min="12rem">
              {ABILITIES.map((ability) => (
                <Field key={ability.id} label={ability.label} htmlFor={`sg-fg-${ability.id}`}>
                  <NumberField id={`sg-fg-${ability.id}`} value={10} onChange={() => {}} min={1} max={30} />
                </Field>
              ))}
            </FieldGrid>
          </Section>

          <Section id="numberfield" title="Number field" blurb="A free-typed number — 1250 gp, 133 hit points, a −2 ability bonus. Two decisions, each a bug the other way round. It is type='text' + inputMode, never type='number': that is the repo's established idiom, and the native control gives a spinner nobody uses at 375px, reports an empty value on a stray letter, and changes the number when the wheel rolls over a focused field. And it clamps on BLUR, never mid-typing — clamping per keystroke against min=10 eats the first digit of '12' the moment it is typed, so the field fights the GM. Stepper stays the control for small bounded nudges (an ability score, 'choose 3'); this is for the values where nudging by one twelve hundred times is absurd. The unit is a suffix, never part of the value, and it rides aria-describedby because '1250' and '1250 gp' are different facts.">
            <NumberFieldDemo />
          </Section>

          <Section id="taginput" title="Tag input" blurb="An open list of slugs: armour proficiencies, languages, damage resistances, feature tags. Composed from Chip + Input rather than invented, and open rather than a multiselect on purpose — the content schemas keep these fields as free slugs so a homebrew author can name a proficiency the SRD never had. Suggestions are a datalist, which hints without closing the set; a Select here would be a closed-world control over an open-world field. Enter or comma commits, Backspace on an empty input removes the last, and adds and removes are announced politely because a chip appearing above the field you are typing in is otherwise silent. At capacity the field disables and states its reason at full strength — annotate, never hide.">
            <TagInputDemo />
          </Section>

          <Section id="combobox" title="Combobox (type-to-filter chooser)" blurb="An input, a listbox, arrow-key selection, and the chosen value as a removable chip — the ARIA combobox pattern written once. Promoted out of the Codex, which had grown TWO of these: a page picker and the [[ suggestion list, with different keyboard behaviour and different row heights, so learning one taught you nothing about the other. Rows take the 44px floor as REAL PAINT (route 1); a route-2 ::after on a stacked list overhangs into the row below and steals its tap. allowFreeText is the one real fork: with it the control accepts a value that matches no option and hands the raw text back, which is what lets the same component be a closed-world page picker and an open-world 'who took this downtime' field. Without it, unmatched text is simply not selectable — a picker over a closed set must not invent members.">
            <ComboboxDemo />
          </Section>

          <Section id="mdeditor" title="Markdown editor" blurb="One writing surface for every body of text in the app: a formatting toolbar, [[ ]] autocomplete, image drop/paste, and an Edit↔View switch. Before this, the Codex's good editor lived inside the page editor and NOWHERE else, so session prep, quest bodies and journal entries were bare textareas — typing [[ in one of them silently did nothing, which is the kind of inconsistency that teaches a GM not to trust a feature. It is deliberately markdown-AGNOSTIC: renderPreview is the caller's, which is what keeps a viewer-safe redlink renderer (and any GM-layer chrome) out of the design system. Toolbar letterforms (B / I / S / H) stay text because they are genuinely letters in the body face; every other mark is an SVG path, because Manrope has no glyph for most symbol characters and the platform substitutes a face at the wrong size — on phones, emoji.">
            <MarkdownEditorDemo />
          </Section>

          <Section id="palette" title="Command palette (a pattern, not a primitive)" blurb="Modal align='top' + an input + a result list. It is documented here as a COMPOSITION on purpose: nothing about it is reusable except the top alignment, which is the one thing the Modal primitive gained for it. A palette anchored in the vertical centre of the viewport puts the result list under the fold on a laptop and under the keyboard on a phone, so align='top' is the whole primitive change and the rest is three ordinary controls. In the app it is scoped to the Codex and deliberately not global — ⌘K means nothing on the Encounter tab, and a test locks that, because 'make it global' is the obvious next step and is out of scope.">
            <CommandPaletteDemo />
          </Section>

          <Section id="panels" title="Panels" blurb="Resting surfaces stay dark. An optional 2px hairline labels a panel kind.">
            <div className="sg-grid3">
              <Panel><PanelHeader eyebrow="Notes" title="Plain panel" /><p className="sg-muted">surface-1, 1px line, no glow.</p></Panel>
              <Panel accent="magenta"><PanelHeader eyebrow="Combat" title="Magenta accent" /><p className="sg-muted">Encounter / combat kind.</p></Panel>
              <Panel accent="cyan"><PanelHeader eyebrow="Info" title="Cyan accent" /><p className="sg-muted">Notes / info kind.</p></Panel>
            </div>
          </Section>

          <Section id="tabs" title="Tabs" blurb="One tab bar everywhere. Active = text + magenta underline (or left bar) with a faint glow. A horizontal bar that overflows hides its scrollbar, so it has to say so some other way: the edge fades whichever side has content behind it, and only when the bar actually overflows — a permanent fade would claim there is more when there is not. Selecting a tab scrolls it into the scrollport (honouring reduced motion), which is what makes an eighth tab reachable at 375px instead of simply gone. It scrolls the BAR rather than calling scrollIntoView, which walks every scrollable ancestor and would drag the whole page to wherever the tab bar happens to sit. SHRINK THE WINDOW past ~700px to watch the second bar below fade and scroll.">
            <Tabs tabs={DEMO_TABS} activeId={tab} onChange={setTab} ariaLabel="Demo tabs" />
            <h3 className="sg-h3">Eight tabs — the real GM bar, which overflows at 375px</h3>
            <Tabs tabs={OVERFLOW_TABS} activeId={overflowTab} onChange={setOverflowTab} ariaLabel="Overflowing demo tabs" />
            <p className="sg-blurb">Pick “VTT Setup”, then narrow the window: the bar scrolls the active tab back into view and fades the left edge to show what is behind it.</p>
            <div className="sg-vtabs">
              <Tabs tabs={DEMO_TABS.slice(0, 4)} activeId={vtab} onChange={setVtab} orientation="vertical" ariaLabel="Demo vertical tabs" />
            </div>
          </Section>

          <Section id="menus" title="Menus & tooltips" blurb="Native details/summary disclosure; caret rotates on open. The default trigger is a padded pill that carries the 44px floor as paint; icon puts it in a 1.75rem square instead — for dense tool clusters, where the floor is hit area, not paint — so a ⋯ can sit beside a same-size grip as an even pair.">
            <div className="sg-row">
              <Menu trigger="Options">
                <MenuItem icon="⚔">Roll mode</MenuItem>
                <MenuItem icon="🎲">Rules mode</MenuItem>
                <MenuItem icon="🗑" tone="danger">End encounter</MenuItem>
              </Menu>
              <Menu trigger="⋯" icon label="Scene actions" align="end">
                <MenuItem icon="✎">Rename</MenuItem>
                <MenuItem icon="⧉">Duplicate</MenuItem>
                <MenuItem icon="🗑" tone="danger">Remove</MenuItem>
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
            <h3 className="sg-h3">tone=&quot;violet&quot; — GM-only CONTENT, and nothing else, ever</h3>
            <div className="sg-row">
              <Badge tone="violet">GM only</Badge>
              <Badge tone="violet" title="Only you can read this layer">GM notes</Badge>
            </div>
            <p className="sg-muted">
              Violet marks the <strong>content axis</strong>: a layer of a record that exists for the GM and is
              never projected to a player at all — a page's GM body, a quest's real ending, a session's prep.
              It is not a seventh decorative tone and must not be reached for because a status needs a colour
              nothing else is using — pick neutral. The second badge also shows the <code>title</code> prop,
              which is for the abbreviated badge whose full sentence will not fit; it is a supplement to a
              label that already reads correctly, never a replacement for one.
            </p>
            <h3 className="sg-h3">Record visibility — never violet</h3>
            <div className="sg-row">
              <Badge tone="success">Shown to players</Badge>
              <Badge tone="neutral">Hidden from players</Badge>
            </div>
            <p className="sg-muted">
              The <strong>record axis</strong> is a different question: whether a whole record has been shared
              yet. These two axes collided once and were deliberately separated (see <code>SecretMarkers.tsx</code>),
              so “Hidden from players” is <em>neutral with an eye-off icon</em> and never violet — a hidden page
              is one switch away from being shared, while a GM body never will be. Use <code>VisibilityBadge</code>
              rather than hand-rolling the pair.
            </p>
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

          <Section id="savestate" title="Save state" blurb="The autosave readout for a park-as-you-type editor. Three things it fixes about the hand-rolled version it replaces. (1) A REAL RESTING STATE: idle and saved both read 'Saved', because rendering an empty string at rest means the GM cannot tell 'your work is safe' from 'nothing has happened yet' — the one question this readout exists to answer. (2) ICON AND TEXT, never colour alone: this palette is heavy in the red-pink-magenta band and reserves violet for GM-only, so no state may be carried by hue — every status differs by WORD first, glyph second, colour third, and none of them uses --text-muted, which is 3.61:1 and fails AA. (3) THE TWO STATES THAT NEED AN ACTION GET ONE: a readout you cannot act on is exactly the state that most needs reading, so conflict offers Reload and error offers Retry. The label reserves the width of the longest string so the buttons beside it never shuffle, and the polite live region carries only the settled states — announcing 'dirty' would fire on every keystroke.">
            <SaveStateDemo />
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

          <Section id="gallery" title="Cards & gallery" blurb="A responsive grid of thumbnail cards for browse-and-pick surfaces (scenes, maps). Each card carries explicit actions — Prepare and Go live in opposite corners — with the ⋯ menu and status badge over the thumb. Live is a state: the live card, and only it, glows magenta; a privately-staged card takes a quiet cyan edge. A dashed tile the same size adds a new one.">
            <ul className="nh-gallery">
              <li className="nh-card is-live">
                <div className="nh-card-thumb"><span className="nh-card-thumb-empty" aria-hidden="true">🗺️</span></div>
                <div className="nh-card-body"><h3 className="nh-card-title">Bridge Ambush</h3><span className="nh-card-meta">4 combatants</span></div>
                <span className="nh-card-status"><Badge tone="primary" solid>LIVE</Badge></span>
                <div className="nh-card-tools">
                  <Menu trigger="⋯" icon label="Scene actions" align="end">
                    <MenuItem icon="✎">Rename</MenuItem>
                    <MenuItem icon="⧉">Duplicate</MenuItem>
                  </Menu>
                </div>
                <div className="nh-card-actions"><span style={{ color: "var(--magenta)", fontSize: "var(--fs-xs)", fontWeight: 700 }}>● Live now</span></div>
              </li>
              <li className="nh-card is-staging">
                <div className="nh-card-thumb"><span className="nh-card-thumb-empty" aria-hidden="true">🗺️</span></div>
                <div className="nh-card-body"><h3 className="nh-card-title">Boss Chamber</h3><span className="nh-card-meta">6 combatants</span></div>
                <span className="nh-card-status"><Badge>Staging</Badge></span>
                <div className="nh-card-tools">
                  <Menu trigger="⋯" icon label="Scene actions" align="end">
                    <MenuItem icon="✎">Rename</MenuItem>
                    <MenuItem icon="⧉">Duplicate</MenuItem>
                    <MenuItem icon="🗑" tone="danger">Remove</MenuItem>
                  </Menu>
                </div>
                <div className="nh-card-actions"><Button variant="secondary">Prepare</Button><Button variant="primary">Go live</Button></div>
              </li>
              <li className="nh-card">
                <div className="nh-card-thumb"><span className="nh-card-thumb-empty" aria-hidden="true">🗺️</span></div>
                <div className="nh-card-body"><h3 className="nh-card-title">Escape Tunnels</h3><span className="nh-card-meta">2 combatants</span></div>
                <div className="nh-card-tools">
                  <Menu trigger="⋯" icon label="Scene actions" align="end">
                    <MenuItem icon="✎">Rename</MenuItem>
                    <MenuItem icon="⧉">Duplicate</MenuItem>
                    <MenuItem icon="🗑" tone="danger">Remove</MenuItem>
                  </Menu>
                </div>
                <div className="nh-card-actions"><Button variant="secondary">Prepare</Button><Button variant="primary">Go live</Button></div>
              </li>
              <li><button type="button" className="nh-card nh-card--new"><span className="nh-card-new-icon" aria-hidden="true">＋</span>New scene</button></li>
            </ul>
          </Section>

          <Section id="switch" title="Switch" blurb="On/off toggle for settings that take effect immediately (role=switch). Reach for a checkbox only inside a form that's submitted.">
            <div className="sg-row">
              <Switch checked={switchOn} onChange={setSwitchOn} label="Shown to players" />
              <Switch checked={!switchOn} onChange={(v) => setSwitchOn(!v)} label="GM-only" />
              <Switch checked={false} onChange={() => {}} disabled aria-label="Disabled off" />
            </div>
          </Section>

          <Section id="stepper" title="Stepper" blurb="Numeric −/+ spinner for small bounded quantities — ability scores, dice counts, HP nudges, limited uses. Clamps and disables the spent edge. Pass format to render signed modifiers or units.">
            <div className="sg-row">
              <Stepper value={count} onChange={setCount} min={1} max={6} label="Dice" />
              <Stepper value={16} onChange={() => {}} min={1} max={20} label="STR" />
              <Stepper value={0} onChange={() => {}} min={0} max={9} label="Spell level" />
              <Stepper value={mod} onChange={setMod} label="Modifier" format={(v) => (v === 0 ? "±0" : v > 0 ? `+${v}` : `−${Math.abs(v)}`)} />
            </div>
          </Section>

          <Section id="segmented" title="Segmented control" blurb="Inline 'pick exactly one' for filters and mode switches. Distinct from Tabs, which swap whole views — use this for in-place option toggles. Options may be icon-only: give each a per-option ariaLabel (and drop label) so the button announces more than a bare glyph.">
            <div className="sg-row">
              <SegmentedControl
                ariaLabel="Map filter"
                value={seg}
                onChange={setSeg}
                options={[{ value: "all", label: "All" }, { value: "battlemap", label: "Battlemaps" }, { value: "regional", label: "Regional" }, { value: "world", label: "World" }]}
              />
              <SegmentedControl
                size="sm"
                ariaLabel="Dock side"
                value={dockSide}
                onChange={setDockSide}
                options={[
                  { value: "left", icon: "◧", ariaLabel: "Dock left", title: "Dock left" },
                  { value: "right", icon: "◨", ariaLabel: "Dock right", title: "Dock right" },
                ]}
              />
            </div>
          </Section>

          <Section id="steps" title="Steps" blurb="Progress indicator for multi-step flows — character builder, map calibration, content-import wizards. Two forms, one component, swapped by media query: the full horizontal rail above 760px (done steps check off, the current step glows, it scrolls rather than wraps) and a 'Step 3 of 7' + progress bar below it, so a seven-step flow never blobs into rows at 375px. Pass onStepSelect to let a completed step be revisited. Position alone can only say 'before' and 'after', so a flow that knows whether a visited step is actually FINISHED declares state='done' | 'incomplete' per step — the third rail below. Each of the four states differs in three ways at once, never by hue alone: done is a solid cyan ring with a check, incomplete a dashed caution-violet ring with the system's one caution mark (rose is reserved for damage and destruction — an unanswered step is not an error), current a filled magenta disc, and upcoming a quiet grey ring with its number. Steps that declare a state also say 'done' / 'not finished' to a screen reader, because the marks themselves are decorative.">
            <Steps
              current={1}
              steps={[{ label: "Upload map" }, { label: "Calibrate grid" }, { label: "Verify scale" }, { label: "Save" }]}
            />
            <div style={{ marginTop: "var(--space-5)" }}>
              <Steps current={3} ariaLabel="Character builder progress" onStepSelect={() => {}} steps={WIZARD_STEPS} />
            </div>
            {/* All four states at once — the only place they can be compared side by side. */}
            <div style={{ marginTop: "var(--space-5)" }}>
              <Steps
                current={3}
                ariaLabel="Declared step states"
                onStepSelect={() => {}}
                maxSelectable={5}
                steps={[
                  { label: "Species", state: "done" },
                  { label: "Background", state: "incomplete" },
                  { label: "Class & level", state: "done" },
                  { label: "Class features" },
                  { label: "Ability scores", state: "incomplete" },
                  { label: "Equipment" },
                  { label: "Name & review" }
                ]}
              />
            </div>
          </Section>

          <Section id="wizard" title="Wizard shell" blurb="The multi-step frame behind the character builder: a full page on a laptop, a full-screen sheet on a phone — deliberately not a modal. Header and footer stick, so Back/Next stay put while the step body scrolls. Next is gated per step: when the step is incomplete the button disables AND the reason is shown and announced (a silent disabled button is a dead end). It also carries the resume-draft slot, Save & close, an optional preview pane, and the persistent CC BY footnote. The preview is the flow's ONE detail pane: a column on a laptop, and below 760px a master-detail swap with both halves — the way in (onOpenDetail) and the way back (onCloseDetail) — owned by the shell, so no consumer re-invents a 'Show preview' button. Shrink the window past 760px to watch it swap.">
            <WizardDemo />
            <p className="sg-muted" style={{ marginTop: "var(--space-3)", fontSize: "var(--fs-sm)" }}>
              Demoed inside a bounded scroll frame so the whole page stays readable; in the app it owns the viewport.
            </p>
          </Section>

          <Section id="choicecard" title="Choice card" blurb="The selectable content card behind every pick-one step (species, class, background, feat). Radio semantics — role=radio + aria-checked — because these grids are single-select. There is exactly ONE chosen treatment in the system: a cyan edge with the selection glow plus a check. Slots: icon, description, mono meta line, and the provenance Badge. BADGE THE EXCEPTION, NOT THE RULE: the tones are fixed (info = SRD, primary = Homebrew — reuse those, don't invent a third), but a badge every card carries distinguishes nothing and takes ~46px out of the title row at 375px, so the badge goes on what is unusual. Here that is the homebrew class; in the builder, where every shipped option is SRD, only homebrew is badged at all. Badge both sides only when both are genuinely present and the grid can be filtered by them — see the faceted grid below.">
            <div className="sg-grid3" role="radiogroup" aria-label="Class">
              <ChoiceCard
                selected={cardPick === "fighter"} onSelect={() => setCardPick("fighter")}
                title="Fighter" meta="d10 hit die · STR or DEX"
                icon={<IconDie />}
                description="A master of martial combat, skilled with every weapon and all armor."
              />
              <ChoiceCard
                selected={cardPick === "wizard"} onSelect={() => setCardPick("wizard")}
                title="Wizard" meta="d6 hit die · INT"
                description="A scholarly magic-user capable of manipulating the structures of reality."
              />
              <ChoiceCard
                selected={cardPick === "warden"} onSelect={() => setCardPick("warden")}
                title="Ember Warden" meta="d10 hit die · CON" badge={<Badge tone="primary">Homebrew</Badge>}
                description="This table's own class: a sworn guardian who burns their own vitality for power."
              />
              <ChoiceCard
                selected={false} onSelect={() => {}} disabled
                title="Artificer" meta="d8 hit die · INT"
                description="Not in the SRD bundle yet."
                disabledReason="Not available at level 1 in this campaign."
              />
            </div>
          </Section>

          <Section id="choicegrid" title="Choice grid (faceted picker)" blurb="Search + facets + a ChoiceCard grid. The search is debounced (160ms) so a long catalog doesn't refilter per keystroke; no results is a real .nh-empty state; and the grid is a keyboard radiogroup — arrows move and select, Home/End jump, and a roving tabindex means Tab enters and leaves the grid once instead of stepping through twelve cards. It carries no detail pane of its own: a phone can only show the cards or the detail, never both, and WizardShell already owns that master-detail swap — pass the selected option's text to the shell instead.">
            <ChoiceGridDemo />
          </Section>

          <Section id="choicegrid-multi" title="Choice grid (choose N)" blurb="selection='multiple' turns the same grid into the choose-N list every content offer needs — three Weapon Masteries, six prepared spells, two Magic Initiate cantrips. Same cards, same single chosen treatment; only the semantics change (role=checkbox, and arrows move focus without ticking every card they pass). Pass max and the grid locks the UNCHOSEN cards at capacity with a reason, while the chosen ones stay tappable so a pick can always be swapped — capacity handled once here rather than re-derived by each step. The chosen cards keep their cyan edge and check but spend no glow: a choose-6 region has six answers, and §8.1 budgets one glowing element per region — six blooming cards is the wallpaper that rule exists to prevent.">
            <ChoiceGridMultiDemo />
          </Section>

          <Section id="allocator" title="Ability score allocator" blurb="All four generation methods behind one component: standard array, point buy, 4d6-drop-lowest, and a GM custom formula. Two interactions cover them — assign values from a pool, or spend against a budget. Assignment is a per-ability select rather than drag-and-drop: dragging is the obvious mouse gesture and a dead end on a phone, and shipping both would be two ways to say one thing. Base, bonus, total, and modifier all render in the mono tabular face. Pure presentation: every number and callback comes from @vtt/rules-5e.">
            <AllocatorDemo />
          </Section>

          <Section id="diceinput" title="Dice input row" blurb="The manual-vs-auto roll control for everything OUTSIDE combat — ability generation, starting HP, starting gold. It speaks the same two-mode vocabulary as the encounter's RollControls ('roll it for me' or type what your physical dice showed) so rolling feels the same everywhere, but it shares no combat state. Pass complete once the row has collected every result it needs: the roll and Apply actions lock while Roll again stays live, so a finished set never leaves a button that silently does nothing.">
            <DiceInputDemo />
          </Section>

          <Section id="namefield" title="Name field" blurb="Text input + a shuffle button + a row of clickable suggestions from the per-species name bundles. The suggestions are plain buttons, not a dropdown: a name list you have to open is a name list nobody uses.">
            <NameFieldDemo />
          </Section>

          <Section id="features" title="Feature list" blurb="In-flow disclosure for long class/species feature lists (Menu is a popover — wrong shape for twenty features you read alongside the step). Built on native details/summary, so keyboard and screen-reader behaviour come from the platform. Collapsed rows are one tappable line, which is what makes a twenty-feature class readable at 375px.">
            <FeatureList items={CLASS_FEATURES} allowExpandAll ariaLabel="Fighter features" />
          </Section>

          <Section id="roweditor" title="Row editor" blurb="Repeating rows behind every 'rows' field — monster actions, starting-equipment options, ability bonuses, damage parts. rowKey IS A STABLE ID, NEVER THE INDEX: keying by index means removing row 2 of 5 hands row 3's DOM to row 2, so the focused input, the open disclosure and any uncommitted keystrokes silently belong to a different record. The caller mints that id with newId() when it mints the row, which is also why onAdd returns the row rather than the primitive inventing data. ONE ⋯ MENU PER ROW, NOT FOUR ICON BUTTONS: move up, move down and remove would each need a 44px hit area in a dense list; collapsed into one menu they cost one target, they match .nh-card-tools, and there is no gap budget to get wrong. The drag grip on the left is a pointer-only enhancement on top — every reorder it offers is also in the menu, so nothing is mouse-only, and it sets touch-action: none so dragging on a phone does not scroll the page out from under the row. Reorders and removals announce politely, with row-scoped names throughout: five bare 'Remove's in a list tell a screen reader nothing. Collapse is UI-local and derived, never stored — a newly added row opens because you just asked for it. At the cap the Add button disables with its reason at full strength beside it.">
            <RowEditorDemo />
          </Section>

          <Section id="checklist" title="Checklist" blurb="An ordered list of short tickable lines — a quest's objectives, and any other 'what is still open' list. Items are exactly {text, done}; anything richer is a different component. READ-ONLY WHEN onChange IS ABSENT, and that split is the whole point: the same array serves the GM console and the player's view of a revealed record, and the player must see PROGRESS without ever seeing a tickable box — no checkbox, no field, no remove, no Add, nothing focusable. It is deliberately not a DISABLED editor: a disabled checkbox still announces itself as a control you are being refused, which is a different and worse statement than 'this is a status'. Done reads three ways at once and never by hue alone — the glyph, the strike, and an sr-only word — and the tick is cyan rather than the encounter panel's magenta because a completed objective is a STATE (a Step's done ring, the selection edge), not an action. IT IS NOT BUILT ON RowEditor, for one fatal reason and three supporting ones: rowKey must be a stable id and an item has no identity it is allowed to grow, so there is nothing to hand it; RowEditor has no read-only mode (onChange and onAdd are required and the ⋯ menu always renders); its shape is a whole collapsible form per row, which would spend three touch targets on a two-key record; and its onAdd returns the row for the primitive to append, where here the caller owns what a blank item means. Reach for RowEditor the moment a row grows a second field. Order is content: nothing sorts, dedupes or reorders, and there is no reorder affordance. Every control takes the 44px floor as REAL PAINT (route 1) — a route-2 ::after on a 20px checkbox overhangs 12px per side into an 8px row gap and would steal the neighbouring row's tap.">
            <ChecklistDemo />
          </Section>

          <Section id="review" title="Review summary" blurb="The final 'here's your character' step: every choice grouped by the step that made it, each group with its own way back. It extends .nh-statlist rather than inventing a second key/value grid, and anything still missing is called out in words beside its Edit link.">
            <ReviewSummary
              sections={[
                { id: "identity", title: "Identity", onEdit: () => {}, items: [
                  { label: "Name", value: "Borin Stoneguard" },
                  { label: "Species", value: "Dwarf" },
                  { label: "Class", value: "Fighter 4" },
                  { label: "Background", value: "Soldier" }
                ] },
                { id: "abilities", title: "Ability scores", onEdit: () => {}, items: [
                  { label: "STR", value: "16 (+3)", numeric: true },
                  { label: "DEX", value: "12 (+1)", numeric: true },
                  { label: "CON", value: "17 (+3)", numeric: true },
                  { label: "INT", value: "10 (±0)", numeric: true },
                  { label: "WIS", value: "13 (+1)", numeric: true },
                  { label: "CHA", value: "8 (−1)", numeric: true }
                ] },
                { id: "vitals", title: "Vitals", onEdit: () => {}, items: [
                  { label: "HP", value: "38", numeric: true },
                  { label: "AC", value: "18", numeric: true },
                  { label: "Speed", value: "25 ft", numeric: true },
                  { label: "Prof", value: "+2", numeric: true }
                ], note: "Armor class comes from your equipped armor, so it can change when you swap gear." },
                { id: "equipment", title: "Equipment", onEdit: () => {}, editLabel: "Edit",
                  incomplete: "Pick one of the two starting packs.",
                  items: [
                    { label: "Weapon", value: "Warhammer" },
                    { label: "Armor", value: "Chain mail" },
                    { label: "Pack", value: "Not chosen" }
                  ] }
              ]}
            >
              <p className="sg-muted" style={{ fontSize: "var(--fs-sm)" }}>SRD 5.2.1 content, CC BY 4.0.</p>
            </ReviewSummary>
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

          <Section id="overlays" title="Modals, sheets & toasts" blurb="Native dialog with scrim blur, focus return, and scroll lock. Toasts name the result. size='full' is the full-screen sheet: a roomy centred surface on a laptop, edge-to-edge over the whole viewport at ≤760px (with the footer clearing the home indicator) — reach for it instead of overriding max-height on a modal, which is what features kept doing.">
            <div className="sg-row">
              <Button variant="primary" onClick={() => setModalOpen(true)}>Open modal</Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>Open full-screen sheet</Button>
              <ToastDemo />
            </div>
            <Modal
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              size="full"
              title="Browse the bestiary"
              accent="cyan"
              footer={<>
                <Button variant="ghost" onClick={() => setSheetOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setSheetOpen(false)}>Add selected</Button>
              </>}
            >
              <p className="sg-muted">Long, browse-heavy surfaces (content browsers, sheets, the builder's sub-pickers) want the whole phone screen. Shrink the window below 760px to watch this go edge-to-edge.</p>
              <div style={{ marginTop: "var(--space-4)" }}>
                <FeatureList items={CLASS_FEATURES} />
              </div>
            </Modal>
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

          <Section id="drawer" title="Drawer (non-modal side panel)" blurb="The console you keep open WHILE you work — the Codex session panel beside a live Codex mode, the way devtools sit beside a page. That one word, non-modal, is the whole component: no dialog.showModal(), no scrim, no focus trap, no scroll lock, so the view behind it stays scrollable, clickable and fully usable — open one and try the buttons underneath. It is an <aside> landmark rather than role='dialog' for the same reason: a dialog role promises focus containment this deliberately does not provide, and tabbing straight out of an announced 'dialog' serves a screen-reader user worse than tabbing out of a named complementary region. Escape closes it, but only while focus is inside it — a global key listener would eat Escape from the mode still running behind. It stays mounted when closed (translated off, visibility:hidden + inert) so the slide plays both ways on --ease-drawer while nothing inside is focusable or announced in between. SHRINK THE WINDOW below 760px to watch the side panel become a full-width sheet.">
            <div className="sg-row">
              <Button variant="primary" onClick={() => { setDrawerSide("right"); setDrawerOpen(true); }}>Open drawer (right)</Button>
              <Button variant="secondary" onClick={() => { setDrawerSide("left"); setDrawerOpen(true); }}>Open drawer (left)</Button>
            </div>
            <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side={drawerSide} title="Session 14">
              <div className="sg-stack">
                <p className="sg-muted">A drawer is a view onto something that already exists elsewhere, not a second place to edit it. This one reads the session; the full view owns the writing.</p>
                <Panel><PanelHeader eyebrow="Prep" title="Tonight" /><p className="sg-muted">The council summons the party at dusk. Three factions want the same writ.</p></Panel>
                <Panel><PanelHeader eyebrow="Recap" title="Last time" /><p className="sg-muted">The bridge fell. Nobody has told the quartermaster yet.</p></Panel>
                <div className="sg-row">
                  <Badge tone="info">4 entries</Badge>
                  <Badge tone="neutral">Planned</Badge>
                </div>
              </div>
            </Drawer>
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

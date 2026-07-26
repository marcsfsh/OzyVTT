import type { Widget } from "./read-pdf.js";

/** Pure transform: D&D Beyond widget list -> a draft `actor-character` definition + review warnings.
 * No pdfjs, no I/O — unit-testable and reusable in the browser. Output is validated by the caller. */
export interface DraftResult {
  draft: Record<string, unknown>;
  warnings: string[];
}

const ABIL = ["str", "dex", "con", "int", "wis", "cha"] as const;
type Ability = (typeof ABIL)[number];
const isAbility = (s: string): s is Ability => (ABIL as readonly string[]).includes(s);

/** 18 SRD skills in sheet order; `aliases` cover DDB's irregular field naming (e.g. "Animal", "SleightofHand"). */
const SKILLS: { id: string; ability: Ability; aliases: string[] }[] = [
  { id: "acrobatics", ability: "dex", aliases: ["acrobatics"] },
  { id: "animal-handling", ability: "wis", aliases: ["animalhandling", "animal"] },
  { id: "arcana", ability: "int", aliases: ["arcana"] },
  { id: "athletics", ability: "str", aliases: ["athletics"] },
  { id: "deception", ability: "cha", aliases: ["deception"] },
  { id: "history", ability: "int", aliases: ["history"] },
  { id: "insight", ability: "wis", aliases: ["insight"] },
  { id: "intimidation", ability: "cha", aliases: ["intimidation"] },
  { id: "investigation", ability: "int", aliases: ["investigation"] },
  { id: "medicine", ability: "wis", aliases: ["medicine"] },
  { id: "nature", ability: "int", aliases: ["nature"] },
  { id: "perception", ability: "wis", aliases: ["perception"] },
  { id: "performance", ability: "cha", aliases: ["performance"] },
  { id: "persuasion", ability: "cha", aliases: ["persuasion"] },
  { id: "religion", ability: "int", aliases: ["religion"] },
  { id: "sleight-of-hand", ability: "dex", aliases: ["sleightofhand"] },
  { id: "stealth", ability: "dex", aliases: ["stealth"] },
  { id: "survival", ability: "wis", aliases: ["survival"] },
];

const nkey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
const toInt = (v: string | undefined): number | undefined => {
  if (v == null) return undefined;
  const m = v.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : undefined;
};
const parseSpellLevel = (h: string): number => {
  if (/cantrip/i.test(h)) return 0;
  const m = /(\d+)(?:st|nd|rd|th)/i.exec(h);
  return m ? Math.min(9, parseInt(m[1], 10)) : 0;
};

interface Keyed extends Widget { key: string; }

export function buildDefinition(widgets: Widget[]): DraftResult {
  const warnings: string[] = [];
  const items: Keyed[] = widgets.map((w) => ({ ...w, key: nkey(w.name) }));
  const first = new Map<string, Keyed>();
  for (const it of items) if (!first.has(it.key)) first.set(it.key, it);
  const val = (k: string): string | undefined => first.get(k)?.value;
  const num = (k: string): number | undefined => toInt(val(k));

  const draft: Record<string, unknown> = {};

  // ---- identity ----
  draft.name = val("charactername") ?? "Imported Character";
  const classes: { id: string; name: string; level: number }[] = [];
  for (const seg of (val("classlevel") ?? "").split("/")) {
    const m = seg.trim().match(/^(.+?)\s+(\d{1,2})$/);
    if (m) classes.push({ id: slug(m[1]), name: m[1].trim().slice(0, 60), level: parseInt(m[2], 10) });
  }
  const totalLevel = classes.reduce((s, c) => s + c.level, 0) || 1;
  if (classes.length > 4) warnings.push(`This character has ${classes.length} classes; the schema supports at most 4. The extras were dropped — confirm before saving.`);
  if (classes.length) {
    const character: Record<string, unknown> = { classes: classes.slice(0, 4) };
    const race = val("race");
    const background = val("background");
    if (race) character.race = { id: slug(race), name: race.slice(0, 60) };
    if (background) character.background = { id: slug(background), name: background.slice(0, 60) };
    draft.character = character;
  } else {
    warnings.push("Could not read class & level.");
  }

  // ---- ability scores ----
  const abilityScores: Record<string, number> = {};
  for (const ab of ABIL) {
    const s = num(ab);
    if (s != null && s >= 1 && s <= 30) abilityScores[ab] = s;
  }
  if (Object.keys(abilityScores).length === 6) draft.abilityScores = abilityScores;
  else warnings.push("Could not read all six ability scores.");

  // ---- core numbers ----
  const ac = num("ac");
  if (ac != null) draft.armorClass = ac; else warnings.push("Armor Class not found.");
  const maxhp = num("maxhp");
  if (maxhp != null && maxhp > 0) draft.hitPoints = { maximum: maxhp }; else warnings.push("Max HP not found.");
  draft.initiativeBonus = num("init") ?? 0;
  const speed = num("speed");
  if (speed != null) draft.speedFeet = speed; else warnings.push("Speed not found.");
  draft.proficiencyBonus = num("profbonus") ?? 2 + Math.floor((totalLevel - 1) / 4);
  const hitDice = val("total");
  if (hitDice && draft.hitPoints && /^\d+d(4|6|8|10|12|20)$/.test(hitDice.replace(/\s/g, ""))) {
    (draft.hitPoints as Record<string, unknown>).formula = hitDice.replace(/\s/g, "");
  }

  // ---- damage resistances (from the "Resistances - X, Y" defenses field) ----
  const defenses = val("defenses");
  if (defenses) {
    const m = /resist\w*\s*[-:]\s*([^|]+)/i.exec(defenses);
    if (m) {
      const types = m[1].split(/,|\band\b/).map((t) => slug(t)).filter(Boolean);
      if (types.length) draft.damageResistances = types.slice(0, 20);
    }
  }

  // ---- proficiencies: saves + skills from the *Prof fields ----
  const saves = ABIL.filter((ab) => (val(ab + "prof") ?? "") !== "");
  const skills: { id: string; proficiency: "proficient" | "expertise" }[] = [];
  for (const sk of SKILLS) {
    let prof: string | undefined;
    for (const a of sk.aliases) {
      const v = val(a + "prof");
      if (v != null) { prof = v; break; }
    }
    if (prof == null || prof === "") continue;
    skills.push({ id: sk.id, proficiency: /e/i.test(prof) ? "expertise" : "proficient" });
  }
  if (saves.length || skills.length) draft.proficiencies = { saves, skills };

  // ---- spellcasting ----
  const spellcasting = buildSpellcasting(items, warnings);
  if (spellcasting) draft.spellcasting = spellcasting;

  // ---- weapons -> actions ----
  draft.actions = buildWeapons(first);

  // ---- starting inventory ----
  const inventory = buildInventory(items);
  if (inventory.length) draft.startingInventory = inventory;

  // ---- fixed envelope ----
  draft.schemaId = "vtt.actor-character";
  draft.schemaVersion = 1;
  draft.size = "medium";
  draft.token = { disposition: "friendly", footprint: { width: 1, height: 1 } };
  draft.source = { name: "D&D Beyond PDF (2024)", version: "1" };
  const summary = [val("race"), classes.map((c) => `${c.name} ${c.level}`).join(" / ")].filter(Boolean).join(" ").slice(0, 280);
  if (summary) draft.summary = summary;

  return { draft, warnings };
}

function buildSpellcasting(items: Keyed[], warnings: string[]): Record<string, unknown> | null {
  const spell = items.filter((i) => i.key.startsWith("spell"));
  if (!spell.length) return null;
  const first = new Map<string, string>();
  for (const it of spell) if (!first.has(it.key)) first.set(it.key, it.value);

  const abilRaw = (first.get("spellcastingability0") ?? "").split("/")[0].trim().toLowerCase().slice(0, 3);
  const sc: Record<string, unknown> = { ability: isAbility(abilRaw) ? abilRaw : "int" };
  const dc = toInt((first.get("spellsavedc0") ?? "").split("/")[0]);
  const atk = toInt((first.get("spellatkbonus0") ?? "").split("/")[0]);
  if (dc != null) sc.saveDc = dc;
  if (atk != null) sc.attackBonus = atk;
  const castingClasses = new Set(spell.filter((i) => /^spellcastingclass\d+$/.test(i.key)).map((i) => i.value));
  if (castingClasses.size > 1) warnings.push(`Multiclass spellcasting (${[...castingClasses].join(", ")}); one spellcasting ability is stored (${String(sc.ability).toUpperCase()}) — review the per-class DC/attack.`);

  // Position-walk: headers set the current level, slot headers set slot maxima, names emit spells.
  type Ev = { kind: "header" | "slot" | "name"; value: string; idx: number; page: number; y: number };
  const evs: Ev[] = [];
  const prepared = new Map<number, string>();
  const source = new Map<number, string>();
  for (const it of spell) {
    let m: RegExpExecArray | null;
    if ((m = /^spellheader(\d+)$/.exec(it.key))) evs.push({ kind: "header", value: it.value, idx: +m[1], page: it.page, y: it.y });
    else if ((m = /^spellslotheader(\d+)$/.exec(it.key))) evs.push({ kind: "slot", value: it.value, idx: +m[1], page: it.page, y: it.y });
    else if ((m = /^spellname(\d+)$/.exec(it.key))) evs.push({ kind: "name", value: it.value, idx: +m[1], page: it.page, y: it.y });
    else if ((m = /^spellprepared(\d+)$/.exec(it.key))) prepared.set(+m[1], it.value);
    else if ((m = /^spellsource(\d+)$/.exec(it.key))) source.set(+m[1], it.value);
  }
  evs.sort((a, b) => a.page - b.page || a.y - b.y || a.idx - b.idx);

  const slots: Record<number, number> = {};
  let pact: { level: number; max: number } | null = null;
  const spells: { id: string; name: string; level: number; prepared: boolean; alwaysPrepared: boolean }[] = [];
  let cur = 0;
  for (const ev of evs) {
    if (ev.kind === "header") cur = parseSpellLevel(ev.value);
    else if (ev.kind === "slot") {
      const m = /(\d+)\s*(Slots|Pact)/i.exec(ev.value);
      if (m && cur >= 1) {
        if (/pact/i.test(m[2])) pact = { level: cur, max: Math.min(4, +m[1]) };
        else slots[cur] = +m[1];
      }
    } else {
      const src = source.get(ev.idx) ?? "";
      const always = /always prepared/i.test(src);
      spells.push({ id: slug(ev.value), name: ev.value.slice(0, 120), level: cur, prepared: prepared.get(ev.idx) === "P" || always, alwaysPrepared: always });
    }
  }
  sc.slots = Object.entries(slots).map(([level, max]) => ({ level: +level, max })).sort((a, b) => a.level - b.level);
  if (pact) sc.pact = pact;
  const seen = new Set<string>();
  sc.spells = spells.filter((s) => { const k = `${s.id}@${s.level}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 400);
  return sc;
}

function buildWeapons(first: Map<string, Keyed>): Record<string, unknown>[] {
  const idxs = new Set<number>();
  for (const key of first.keys()) {
    const m = /^wpn(\d+)atkbonus$/.exec(key);
    if (m) idxs.add(+m[1]);
  }
  if (first.has("wpnname")) idxs.add(1);
  const actions: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const idx of [...idxs].sort((a, b) => a - b)) {
    const name = (idx === 1 ? first.get("wpnname") : first.get("wpnname" + idx))?.value ?? first.get("wpnname" + idx)?.value;
    if (!name) continue;
    let id = slug(name);
    while (seen.has(id)) id = `${id}-${idx}`;
    seen.add(id);
    const action: Record<string, unknown> = { id, name: name.slice(0, 120), activation: "action", description: name.slice(0, 120) };
    const atk = toInt(first.get("wpn" + idx + "atkbonus")?.value);
    if (atk != null) action.attack = { bonus: atk };
    const dmg = first.get("wpn" + idx + "damage")?.value;
    const m = dmg ? /^(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([A-Za-z]+)/.exec(dmg) : null;
    if (m) action.damage = [{ formula: m[1].replace(/\s/g, ""), type: m[2].toLowerCase() }];
    actions.push(action);
  }
  return actions;
}

function buildInventory(items: Keyed[]): Record<string, unknown>[] {
  const rows = new Map<number, { name?: string; qty?: string; weight?: string }>();
  const ensure = (i: number) => rows.get(i) ?? (rows.set(i, {}), rows.get(i)!);
  for (const it of items) {
    let m: RegExpExecArray | null;
    if ((m = /^eqname(\d+)$/.exec(it.key))) ensure(+m[1]).name = it.value;
    else if ((m = /^eqqty(\d+)$/.exec(it.key))) ensure(+m[1]).qty = it.value;
    else if ((m = /^eqweight(\d+)$/.exec(it.key))) ensure(+m[1]).weight = it.value;
  }
  const inv: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const idx of [...rows.keys()].sort((a, b) => a - b)) {
    const e = rows.get(idx)!;
    if (!e.name) continue;
    let id = slug(e.name);
    while (seen.has(id)) id = `${id}-${idx}`;
    seen.add(id);
    const qty = toInt(e.qty);
    inv.push({ id, name: e.name.slice(0, 120), quantity: qty != null && qty >= 0 ? Math.min(9999, qty) : 1 });
  }
  return inv.slice(0, 200);
}

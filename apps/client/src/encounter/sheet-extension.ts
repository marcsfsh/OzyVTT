import type { Ability } from "@vtt/rules-5e";

/** The SRD stat-block fields a bundled definition carries under `extensions["open5e.srd-2024"]`. */
export type SrdExtension = Partial<{
  challengeRating: number;
  type: string;
  alignment: string;
  armorDetail: string | null;
  speeds: Partial<Record<"walk" | "swim" | "fly" | "climb" | "burrow", number | null>> & { hover?: boolean };
  senses: readonly string[];
  passivePerception: number | null;
  languages: string | null;
  savingThrows: Partial<Record<Ability, number | null>>;
  damageVulnerabilities: string | null;
  damageResistances: string | null;
  damageImmunities: string | null;
  conditionImmunities: string | null;
  traits: ReadonlyArray<{ name: string; description: string }>;
}>;

import type { GameState } from "@vtt/domain";
import { footprintInTemplate } from "./area-targeting.js";
import { CONCENTRATING_TAG } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import type { TokenMapGeometry } from "./token-placement.js";

/**
 * SRD Silence: "Casting a spell that includes a Verbal component is impossible there." A spell whose area makes no
 * sound (`SpellEffect.silencesArea`) stands while its caster concentrates on it, on the template its cast placed (the
 * annotation takes the cast's id). Whether a creature's token stands in one is measured on the calibrated map; with no
 * grid, or the area not placed, nothing is measured and the GM rules.
 */
export function standsInSilence(
  state: GameState,
  actorId: string,
  geometry: TokenMapGeometry | null,
  catalog: Pick<EquipmentCatalog, "spellRecord"> | undefined
): boolean {
  const calibration = geometry?.calibration ?? null;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  if (!calibration || !token?.position) return false;
  const position = token.position;
  return state.actors.some((caster) =>
    caster.effects.some((effect) => {
      if (!effect.tags.includes(CONCENTRATING_TAG) || !effect.spell || !effect.castId) return false;
      if (catalog?.spellRecord?.(effect.spell.id)?.effect?.silencesArea !== true) return false;
      const area = state.combat.annotations.find((annotation) => annotation.id === effect.castId);
      if (!area || area.shape === null) return false;
      return footprintInTemplate(calibration, area.geometry, area.shape, null, position, token.sizeCells);
    })
  );
}

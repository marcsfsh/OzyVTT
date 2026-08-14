/**
 * Markdown/HTML helpers shared by the SRD ETLs.
 *
 * These lived inside `build-class-bundle.ts` until the magic-item ETL needed the same table
 * rendering. They moved here VERBATIM rather than being copied, because two renderings of the same
 * HTML table is exactly the divergence that ends with one bundle's tables reading differently from
 * another's - and `build-class-bundle.ts` writes its bundles at module scope, so importing it to
 * reuse them would regenerate `classes.v1.json` as a side effect of a different build.
 */

export const strip = (value: string) =>
  value.replace(/<[^>]+>/g, " ")
    .replace(/&mdash;|&#8212;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ").trim();

/**
 * ONE HTML table, as a sentence.
 *
 * Every cell is prefixed with its own column heading, so the rendering is self-describing rather
 * than positional: a player reading "Druid Level 2: Known Forms 4, Max CR 1/4, Fly Speed No" needs
 * no column order in their head. Rows join with "; " because descriptions are collapsed to a single
 * line downstream and a table cannot be laid out there.
 *
 * A TWO-COLUMN table labels only its first cell. "Sorcerer Level 3: Alter Self, Chromatic Orb" is
 * unambiguous, and the alternative ("Sorcerer Level 3: Spells Alter Self, ...") reads like a typo -
 * every spell-by-level table in the SRD's subclasses is this shape, so it is worth the special case.
 */
export function tableAsText(html: string): string {
  const cells = (row: string, tag: "th" | "td") =>
    [...row.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((cell) => strip(cell[1]));
  const head = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
  const columns = cells(head, "th");
  const bodyRows = [...(html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const lines: string[] = [];
  for (const [, row] of bodyRows) {
    const values = cells(row, "td");
    if (values.length === 0) continue;
    const labelled = values.map((value, index) =>
      (columns[index] && (index === 0 || values.length > 2) ? `${columns[index]} ${value}` : value));
    lines.push(labelled.length === 1 ? labelled[0] : `${labelled[0]}: ${labelled.slice(1).join(", ")}`);
  }
  const text = lines.join("; ");
  return text === "" ? "" : `${text}.`;
}

/**
 * THE TABLES ARE CONTENT, NOT DECORATION - and dropping them truncated five features mid-sentence.
 *
 * Every parser used to `.replace(/<table>[\s\S]*?<\/table>/g, " ")`, which is why Draconic Spells,
 * Fiend Spells, Oath of Devotion Spells and Circle of the Land Spells each ended at the word
 * "table" with the spells they promise nowhere in the record, and why Nature's Ward, Wild Shape and
 * Font of Magic lost theirs too. The table IS the promise in all seven; a description that stops
 * before it is not shorter prose, it is a feature that does not say what it does. It is the promise
 * in `Armor of Resistance` and `Horn of Valhalla` for the same reason.
 */
export const withTables = (value: string) =>
  value.replace(/<table>[\s\S]*?<\/table>/g, (html) => ` ${tableAsText(html)} `);

/** The one id grammar for content minted from prose: `ContentIdSchema`'s `^[a-z0-9-]+$`. */
export const slug = (value: string) =>
  strip(value).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

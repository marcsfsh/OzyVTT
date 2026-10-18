/**
 * Markdown/HTML helpers shared by the SRD ETLs. Kept out of `build-class-bundle.ts` because that
 * script writes its bundles at module scope, so importing it would regenerate them.
 */

export const strip = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;|&#8212;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Renders an HTML table as one sentence. Each cell is prefixed with its column heading; a
 * two-column table labels only its first cell ("Sorcerer Level 3: Alter Self, Chromatic Orb").
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
      columns[index] && (index === 0 || values.length > 2) ? `${columns[index]} ${value}` : value
    );
    lines.push(labelled.length === 1 ? labelled[0] : `${labelled[0]}: ${labelled.slice(1).join(", ")}`);
  }
  const text = lines.join("; ");
  return text === "" ? "" : `${text}.`;
}

/** Inlines tables as text, so none is dropped: several features' content lives in a table. */
export const withTables = (value: string) =>
  value.replace(/<table>[\s\S]*?<\/table>/g, (html) => ` ${tableAsText(html)} `);

/** The one id grammar for content minted from prose: `ContentIdSchema`'s `^[a-z0-9-]+$`. */
export const slug = (value: string) =>
  strip(value)
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

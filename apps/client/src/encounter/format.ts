/** Small display formatters shared by the table's sheets, runners and browsers. */

/** A bonus with its sign: "+3", "-1", "+0". */
export const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

export const titleCase = (value: string) => (value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value);

/** "1st", "2nd", "3rd", "4th": spell and slot levels only reach 9, so the teens never come up. */
export const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** CR as the books print it: fractional ratings render as 1/8, 1/4, 1/2. */
export const formatChallenge = (rating: number) =>
  rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);

/** An id built from a typed name, capped at 60 characters; "item" when nothing usable is left. */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";

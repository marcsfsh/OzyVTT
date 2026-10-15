/** Two action or item names are the same when they match ignoring case and punctuation. */
const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const sameName = (left: string, right: string) => normalized(left) === normalized(right);

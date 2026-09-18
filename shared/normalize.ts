const words: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  boulevard: "blvd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  place: "pl",
  terrace: "ter",
  highway: "hwy",
  parkway: "pkwy",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northwest: "nw",
  northeast: "ne",
  southwest: "sw",
  southeast: "se",
};
export function normalizeAddress(value: string) {
  return value
    .toLowerCase()
    .replace(/[.,#'’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => words[w] ?? w)
    .join(" ");
}
export function normalizeUnit(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^(?:unit|apt|apartment)\s*/, "")
    .replace(/[^a-z0-9]/g, "");
}

// FANTAMONITOR: assisted browser adapter, no credential handling.
// Requires a browser-skill Tab with playwright.domSnapshot(), goto(), url().
export const LEAGUE = {
  slug: "chefantavitae10", name: "CheFantaVitaE10", competitionId: "337500",
  season: "2026-2027", round: 1, initialTeamId: "12420064",
  teams: ["AC Idovalproico", "Atletico Fontanelle", "FC LBVLA", "FC SEMINI",
    "FC Villaggio Mau Mau", "FDS Sballo", "I PIPPISTRELLI", "Pro Spritz",
    "Real Hasbulla", "Salamandre"]
};
export class ReadError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function validatePage(snapshot, url, config = LEAGUE) {
  const u = new URL(url);
  if (u.pathname.includes("/login") || snapshot.includes("Sessione scaduta"))
    throw new ReadError("AUTH_REQUIRED");
  const expected = "/" + config.slug + "/view/competition/" +
    config.competitionId + "/manage-lineups/" + config.round;
  if (u.origin !== "https://leghe.fantacalcio.it" || u.pathname !== expected)
    throw new ReadError("WRONG_CONTEXT");
  if (!snapshot.includes('heading "' + config.name + '"') ||
      !snapshot.includes("generic: Gestione formazioni Admin") ||
      !snapshot.includes('generic "Giornata ' + config.round + '"'))
    throw new ReadError("PAGE_NOT_READY");
  const matches = [...snapshot.matchAll(/generic: (\d+)\/(\d+) inserite/g)];
  if (matches.length !== 1) throw new ReadError("COUNT_UNAVAILABLE");
  return { inserted: Number(matches[0][1]), total: Number(matches[0][2]) };
}
export function parseSnapshot(snapshot, url, observedAt, config = LEAGUE) {
  const count = validatePage(snapshot, url, config);
  const dialogs = snapshot.split("- dialog:").slice(1)
    .filter(x => x.includes("generic: Seleziona Squadra"));
  if (dialogs.length !== 1) throw new ReadError("TEAM_LIST_NOT_READY");
  const lines = dialogs[0].split("\n").map(x => x.trim());
  const teams = config.teams.map(name => {
    const starts = lines.map((line, i) => line === "- generic: " + name ? i : -1)
      .filter(i => i >= 0);
    if (starts.length !== 1) throw new ReadError("INCOMPLETE_TEAMS");
    const i = starts[0];
    // The user label is intentionally neither returned nor persisted.
    if (!lines[i + 1]?.startsWith("- generic: ")) throw new ReadError("ROW_CHANGED");
    const icon = lines[i + 2];
    let present;
    if (icon === '- img "close-circle":' && lines[i + 3] === "- generic: Non inserita")
      present = false;
    else if (icon === '- img "check-circle":' &&
      /^- generic: [1-9]-[1-9]-[1-9](?:-[1-9])?$/.test(lines[i + 3] || ""))
      present = true;
    else throw new ReadError("UNKNOWN_STATUS");
    return { team_key: name, name, present, source_status: present ? "check-circle" : "Non inserita" };
  });
  if (count.total !== config.teams.length || teams.filter(x => x.present).length !== count.inserted)
    throw new ReadError("INCONSISTENT_COUNT");
  return {
    schema_version: 1, league: config.slug, season: config.season,
    competition_id: config.competitionId, round: config.round,
    observed_at: observedAt, source: "authenticated_ui", source_url: url,
    expected_total: count.total, inserted: count.inserted, teams
  };
}
export async function openPage(tab, config = LEAGUE) {
  await tab.goto("https://leghe.fantacalcio.it/" + config.slug +
    "/view/competition/" + config.competitionId + "/manage-lineups/" +
    config.round + "?team=" + config.initialTeamId);
}
export async function openTeamList(tab, config = LEAGUE) {
  const snapshot = await tab.playwright.domSnapshot();
  validatePage(snapshot, await tab.url(), config);
  if (snapshot.includes("generic: Seleziona Squadra")) return;
  const lines = snapshot.split("\n");
  const candidates = lines.map(x => x.match(/^  - button "(.+ down)":$/))
    .filter(Boolean).map(m => m[1])
    .filter(x => config.teams.some(n => x.startsWith(n + " ")));
  if (candidates.length !== 1) throw new ReadError("TEAM_SELECTOR_NOT_READY");
  await tab.playwright.getByRole("button", { name: candidates[0], exact: true }).click();
}
export async function capture(tab, config = LEAGUE) {
  const url = await tab.url();
  const snapshot = await tab.playwright.domSnapshot();
  if (url !== await tab.url()) throw new ReadError("PAGE_CHANGED");
  return parseSnapshot(snapshot, url, new Date().toISOString(), config);
}


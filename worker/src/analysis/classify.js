// Deterministic, explainable incident classifier. It labels headlines; it does not verify them.
//
// "Suspected terrorism" is assigned only when a report explicitly uses terrorism language,
// names a proscribed jihadist group, or describes a non-state armed attack outside a
// state-on-state conflict context. It is a reporting signal, never a legal determination.

export const CATEGORIES = {
  terrorism: 'Suspected terrorism',
  attack: 'Violent attack',
  conflict: 'Armed conflict',
  unrest: 'Civil unrest',
  disaster: 'Natural disaster',
  infrastructure: 'Cyber & infrastructure',
  health: 'Health emergency',
  transport: 'Major accident',
};

const STRONG_TERROR =
  /\b(?:terror(?:ism|ist|ists)?|counter-?terror(?:ism)?|suicide (?:bomb(?:er|ers|ing|ings)?|attack(?:er|ers|s)?|blast)|car bomb(?:ing)?|truck bomb|vehicle-borne|ieds?|improvised explosive|jihadis[mt]s?|claimed responsibility|islamic state|isis(?:-k)?|isil|daesh|al-?qaeda|al-?qaida|al-?shabaa?b|boko haram|iswap|jnim|tehrik-?e-?taliban|baloch liberation army)\b/i;
const ATTACK =
  /\b(?:gunm[ae]n|armed men|mass shooting|shooting|shot dead|opened fire|gunfire|stabb(?:ing|ings|ed)|knife attack|machete|bomb(?:ing|ings|ed)?|bomb blast|grenade|ramm(?:ing|ed) (?:into )?(?:a )?crowd|hostages?|kidnapp(?:ed|ing|ers)|abduct(?:ed|ion|s)|massacre|assassinat(?:ed|ion)|arson attack|attack toll|attackers?|(?:deadly|armed|militant|rebel|jihadist|terror|knife|gun|bomb) attacks?|attack(?:ed|s)? (?:on|at) (?:a )?(?:mosque|church|synagogue|temple|school|market|hotel|bus|police|checkpoint|village|concert|festival))\b/i;
const EXPLOSION = /\b(?:explosions?|blasts?|exploded)\b/i;
// A lone "gunman" is not evidence of terrorism, so it is deliberately absent here.
const NON_STATE = /\b(?:militants?|insurgents?|extremists?|jihadis(?:t|ts|m)|armed groups?)\b/i;
const CONFLICT_KINETIC =
  /\b(?:air ?strikes?|air raids?|missiles?|drones?|shelling|artillery|rocket (?:attack|fire|barrage|strike)s?|rockets? (?:fired|launched at|hit|struck)|(?:israeli|russian|ukrainian|us|american|saudi|turkish|iranian|military|deadly|retaliatory|drone|missile|naval) strikes?|fighting|battles?|clashes|offensive|counteroffensive|invasion|incursion|bombard\w*|siege|front ?line|warplanes?|fighter jets?|ambush(?:ed)?|ground operation)\b/i;
const CONFLICT_CONTEXT = /\b(?:war|troops|military|army|soldiers|militants|rebels|insurgents|militias?|paramilitary|rsf|armed forces|security forces)\b/i;
const STATE_CONFLICT = /\b(?:air ?strikes?|air raids?|missiles?|shelling|artillery|troops|army|warplanes?|fighter jets?|drone strikes?|front ?line|invasion|navy|naval)\b/i;
const UNREST =
  /\b(?:protests?|protesters?|demonstrat(?:ion|ions|ors)|riots?|rioting|unrest|coup|curfew|martial law|state of emergency|crackdown|tear gas|uprising|insurrection|looting|general strike|mutiny)\b/i;
const DISASTER =
  /\b(?:earthquakes?|quake|tsunami|hurricane|typhoon|cyclone|tornado(?:es)?|floods?(?! of)|flooding|landslides?|mudslides?|wildfires?|bushfires?|forest fires?|volcan(?:o|ic)|eruption|heatwave|drought|avalanche|blizzard|storm (?:hits|batters|lashes|kills|makes landfall)|landfall)\b/i;
const INFRA =
  /\b(?:cyber ?-?attacks?|ransomware|hack(?:ed|ers|ing)|data breach|ddos|blackouts?|power cuts?|power outages?|outages?|grid failure|sabotage|undersea cables?|gas leak|dam (?:collapse|burst)|internet shutdown)\b/i;
const HEALTH =
  /\b(?:outbreak|epidemic|pandemic|cholera|ebola|mpox|marburg|measles|dengue|bird flu|avian (?:flu|influenza)|h5n1|plague|anthrax|mass poisoning)\b/i;
const TRANSPORT =
  /\b(?:plane crash|air crash|crash landing|aircraft crash|helicopter crash|derail(?:ed|ment)|train (?:crash|collision)|ferry (?:sank|sinks|capsiz\w*)|boat capsiz\w*|capsized|shipwreck|bus crash|bridge collapse|building collapse|stampede|crowd crush|mine collapse|fire kills|blaze kills)\b/i;

const NOT_INCIDENT =
  /\b(?:trade war|price war|culture war|war of words|tariffs?|box office|football|cricket|tennis|rugby|olympics?|world cup|premier league|grand prix|championship|election results?|stock market|recipe|fashion|celebrity|oscars?|grammys?|bets?|betting|prediction markets?|polymarket|kalshi)\b/i;
const RETROSPECTIVE =
  /\b(?:anniversary|years? (?:after|since|ago|on)|decades? (?:after|since|ago)|memorial|commemorat\w+|sentenced|convicted|verdict|jailed|inquest|on trial|trial of|lawsuit|obituary|dies aged|documentary|exhibition|quiz|remembering|looking back)\b/i;
const SOFT = /\b(?:opinion|analysis|explainer|interview|podcast|in pictures|photos|newsletter|live updates|what to know)\b/i;
const RHETORIC =
  /\b(?:warns?|threatens?|vows?|condemns?|calls for|urges|could|may|plans?|considering|talks|negotiat\w+|ceasefire|truce|peace|aid|summit|sanctions?|pact|deal|agreement|signs?|elections?|postpones?|powers|law|bill|budget)\b/i;
const ESCALATION =
  /\b(?:deadliest|massive|mass casualty|dozens|hundreds|scores of|state of emergency|nationwide|catastrophic|devastating|large-scale|full-scale|tsunami warning|evacuat\w+ (?:thousands|millions|hundreds of thousands))\b/i;
const FOILED = /\b(?:arrest(?:ed|s)?|charged|detained|foiled|thwarted|plot|suspects? held|raids?)\b/i;

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, dozen: 12, dozens: 24, scores: 40, hundreds: 200, thousands: 2000,
};
const NUM = '(\\d[\\d,]*|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozens?|scores|hundreds|thousands)';
const QUAL = '(?:at least |more than |over |nearly |almost |about |around |some |up to )?';
const WHO = '(?:people |persons |civilians |children |soldiers |police(?:men| officers)? |troops |migrants |protesters |workers |others |palestinians |israelis |ukrainians |russians )?';
const KILLED_AFTER = new RegExp(`${QUAL}${NUM} ${WHO}(?:were |have been |are |was )?(?:killed|dead|died|deaths|slain|massacred|confirmed dead)`, 'gi');
const KILLED_BEFORE = new RegExp(`kill(?:s|ed|ing)? ${QUAL}${NUM}\\b`, 'gi');
const DEATH_TOLL = new RegExp(`(?:death |attack )?toll (?:rises |climbs |reaches |jumps |hits )?(?:to )?${QUAL}${NUM}`, 'gi');
const INJURED_AFTER = new RegExp(`${QUAL}${NUM} ${WHO}(?:were |have been |are |was )?(?:injured|wounded|hurt)`, 'gi');
const INJURED_BEFORE = new RegExp(`(?:injur(?:es|ed|ing)|wound(?:s|ed|ing)) ${QUAL}${NUM}\\b`, 'gi');

function toNumber(s) {
  const k = String(s).toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(k)) return Number(k);
  return NUMBER_WORDS[k] ?? 0;
}

function maxMatch(text, regexes) {
  let max = 0;
  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const n = toNumber(m[1]);
      if (n > 0 && n < 1000000) max = Math.max(max, n);
    }
  }
  return max;
}

export function extractCasualties(text) {
  const killed = maxMatch(text, [KILLED_AFTER, KILLED_BEFORE, DEATH_TOLL]);
  const injured = maxMatch(text, [INJURED_AFTER, INJURED_BEFORE]);
  return { killed, injured };
}

function pickCategory(text, casualties) {
  const strongTerror = STRONG_TERROR.test(text);
  const attack = ATTACK.test(text) || (EXPLOSION.test(text) && (casualties.killed > 0 || casualties.injured > 0 || /\battack/i.test(text)));
  const kinetic = CONFLICT_KINETIC.test(text);
  const stateConflict = STATE_CONFLICT.test(text);
  const conflictContext = CONFLICT_CONTEXT.test(text) && (casualties.killed > 0 || /\b(?:attack|kill|strike)/i.test(text));

  if (strongTerror) return 'terrorism';
  if (attack && NON_STATE.test(text) && !stateConflict) return 'terrorism';
  if (kinetic || conflictContext) return 'conflict';
  if (attack) return 'attack';
  if (UNREST.test(text)) return 'unrest';
  if (DISASTER.test(text)) return 'disaster';
  if (INFRA.test(text)) return 'infrastructure';
  if (HEALTH.test(text)) return 'health';
  if (TRANSPORT.test(text)) return 'transport';
  return null;
}

const BASE_SEVERITY = { terrorism: 3, attack: 2, conflict: 2, unrest: 2, disaster: 2, infrastructure: 2, health: 2, transport: 2 };

/**
 * @param {string} title
 * @param {string} summary
 * @returns {null | {category:string, severity:number, casualties:{killed:number, injured:number}, retrospective:boolean}}
 */
export function classify(title, summary = '') {
  const text = `${title}. ${summary}`;
  if (NOT_INCIDENT.test(title)) return null;
  // Headline figures win: standfirsts often cite tolls from earlier, related events.
  const titleCasualties = extractCasualties(title);
  const casualties = titleCasualties.killed || titleCasualties.injured ? titleCasualties : extractCasualties(text);
  // The headline decides the category. The standfirst is only consulted when it reports
  // casualties, because summaries often mention unrelated background events.
  let category = pickCategory(title, titleCasualties);
  let fromSummary = false;
  if (!category && (casualties.killed > 0 || casualties.injured > 0)) {
    category = pickCategory(text, casualties);
    fromSummary = Boolean(category);
  }
  if (!category) return null;

  let severity = BASE_SEVERITY[category] - (fromSummary ? 1 : 0);
  if (/\?\s*$/.test(title)) severity -= 1;
  const k = casualties.killed;
  if (k >= 100) severity += 3;
  else if (k >= 20) severity += 2;
  else if (k >= 5) severity += 1.5;
  else if (k >= 1) severity += 1;
  else if (casualties.injured >= 20) severity += 1;
  if (ESCALATION.test(text)) severity += 1;
  if (RHETORIC.test(title) && k === 0) severity -= 1;
  if (SOFT.test(title)) severity -= 1;
  if (category === 'terrorism' && FOILED.test(title) && k === 0) severity = Math.min(severity, 2);

  const retrospective = RETROSPECTIVE.test(title);
  if (retrospective) severity = 1;

  return {
    category,
    severity: Math.max(1, Math.min(5, Math.round(severity))),
    casualties,
    retrospective,
  };
}

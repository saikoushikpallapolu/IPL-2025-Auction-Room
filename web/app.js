const $ = id => document.getElementById(id);
const money = value => value == null ? "—" : `₹${(value / 100).toFixed(2).replace(/\.?0+$/, "")} Cr`;
const roles = { BAT: "Batter", BOWL: "Bowler", AR: "All-rounder", WK: "Wicketkeeper" };
const xiRoles = { keeper: "Wicketkeeper", top_order: "Top-order batter", finisher: "Finisher", pace: "Pace bowler", spin: "Spinner", death: "Death bowler" };
const colors = {
  CSK: ["#fff3ba", "#705000"], DC: ["#dcecff", "#174b8d"], GT: ["#dde4ef", "#233c5b"],
  KKR: ["#eee2ff", "#572695"], LSG: ["#d9f1ff", "#125477"], MI: ["#dce6ff", "#20489c"],
  PBKS: ["#ffe3e6", "#a51e39"], RR: ["#ffe1f4", "#94216a"], RCB: ["#fce2e2", "#a01328"],
  SRH: ["#ffe8d5", "#8e380c"],
};

let config;
let selection;
let state;
let busy = false;
let syncing = false;
let countdownEnd;
let raiseTimer;
let lastPaddle;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function badge(code) {
  const node = element("span", code, "team-badge");
  node.style.setProperty("--team-bg", colors[code][0]);
  node.style.setProperty("--team-fg", colors[code][1]);
  return node;
}

function showError(message) {
  $("error").textContent = message || "";
  $("error").hidden = !message;
}

async function api(path, body) {
  const response = await fetch(`/api/${path}`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) {
    const payload = await response.json();
    const error = new Error(typeof payload.detail === "string" ? payload.detail : "Could not complete the request.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function updatePurse() {
  const keep = new Set([...$("retentions").querySelectorAll("input:checked")].map(box => box.value));
  const players = config.retained[selection].filter(player => keep.has(player.name));
  const capped = players.filter(player => !player.uncapped);
  const slab = config.retention_slabs.slice(0, capped.length).reduce((sum, price) => sum + price, 0);
  const cappedCost = Math.max(slab, capped.reduce((sum, player) => sum + player.price, 0));
  const uncappedCost = players.filter(player => player.uncapped).reduce((sum, player) => sum + Math.max(400, player.price), 0);
  $("starting-purse").textContent = money(12000 - cappedCost - uncappedCost);
}

function choose(team) {
  const changed = selection !== team;
  selection = team;
  for (const button of $("team-picker").children) {
    button.setAttribute("aria-pressed", String(button.value === team));
  }
  $("retentions").replaceChildren(...config.retained[team].map(player => {
    const label = element("label", null, "retention");
    const box = element("input");
    box.type = "checkbox";
    box.checked = true;
    box.value = player.name;
    box.dataset.price = player.price;
    box.addEventListener("change", updatePurse);
    label.append(box, element("span", player.name), element("strong", money(player.price)));
    return label;
  }));
  updatePurse();
  if (changed) {
    const panel = $("retentions").closest(".retention-panel");
    panel.style.setProperty("--selection-color", colors[team][1]);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      panel.getAnimations().forEach(animation => animation.cancel());
      panel.animate([{ opacity: .65, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], { duration: 230 });
    }
  }
}

function showSetup() {
  state = null;
  presentation.reset();
  lastPaddle = null;
  $("setup").hidden = false;
  $("room").hidden = true;
  $("restart").hidden = true;
  $("pool-count").textContent = config.players;
  $("team-picker").replaceChildren(...Object.entries(config.teams).map(([code, name]) => {
    const button = element("button", null, "team-option");
    button.value = code;
    button.append(badge(code), element("span", name));
    button.addEventListener("click", () => choose(code));
    return button;
  }));
  choose(selection || Object.keys(config.teams)[0]);
}

function renderStandings() {
  const opened = new Set([...$("standings").querySelectorAll("details[open]")].map(node => node.dataset.team));
  const entries = Object.entries(state.teams).sort(([code], [other]) => Number(other === state.user) - Number(code === state.user));
  $("standings").replaceChildren(...entries.map(([code, team]) => {
    const details = element("details", null, "standing");
    details.dataset.team = code;
    details.open = opened.has(code);
    const summary = element("summary");
    const content = element("span", null, "standing-content");
    const name = element("span", config.teams[code]);
    const overseas = team.roster.filter(player => player.overseas).length;
    name.append(element("em", `${team.roster.length}/25 squad · ${overseas}/8 overseas`));
    content.append(badge(code), name, element("strong", money(team.purse)));
    summary.append(content);
    const roster = element("ul", null, "roster");
    for (const player of team.roster) {
      roster.append(element("li", `${player.name} · ${money(player.price)}${player.retained ? " · Retained" : ""}`));
    }
    if (!team.roster.length) roster.append(element("li", "No players yet"));
    const xi = element("p", `Projected XI · ${team.playing_xi.players.length}/11 roles filled`, "muted");
    const vacancies = Object.entries(team.playing_xi.vacancies).map(([skill, count]) => `${xiRoles[skill]} ×${count}`);
    const needs = element("p", vacancies.length ? vacancies.join(" · ") : "All specialist roles covered", "muted");
    const lineup = element("ul", null, "roster");
    for (const player of team.playing_xi.players) {
      lineup.append(element("li", `${player.name} · ${xiRoles[player.skill]}${player.overseas ? " · Overseas" : ""}`));
    }
    details.append(summary, xi, needs, lineup, element("p", "Full squad", "muted"), roster);
    return details;
  }));
}

function updateClock() {
  if (state?.phase === "bidding") {
    const speaking = presentation.speaking();
    $("bid").disabled = !state.can_bid || speaking;
    $("bid").title = speaking ? "Wait for the auctioneer to finish the call." : "";
  }
  if (state?.phase !== "rtm") return;
  const seconds = Math.max(0, Math.ceil((countdownEnd - performance.now()) / 1000));
  $("phase").textContent = `Match window · ${seconds}s`;
}

function renderSet(group) {
  const { code, number, category, players } = group;
  $("pouch-code").textContent = number === code ? (code.startsWith("Accelerated") ? `A${code.at(-1)}` : "RET") : code;
  $("set-kicker").textContent = number === code ? "ADDITIONAL LOTS" : `SET ${number} · ${code}`;
  $("set-name").textContent = category;
  $("set-count").textContent = `${players.length} ${players.length === 1 ? "player" : "players"} in this pouch`;
  $("current-set-label").textContent = `${number === code ? "Additional lots" : code} · ${players.length} players`;
  for (const id of ["set-list", "current-set-list"]) {
    const list = $(id);
    list.replaceChildren(...players.map((player, index) => {
      const row = element("li", player.name);
      row.append(element("span", roles[player.role]));
      if (Number.isFinite(player.reserve)) row.append(element("strong", money(player.reserve), "set-reserve"));
      row.style.setProperty("--order", index);
      return row;
    }));
    list.scrollTop = 0;
  }
}

function buildFloor(user) {
  const bidButton = $("bid");
  const codes = Object.keys(config.teams).filter(code => code !== user);
  codes.splice(7, 0, user);
  $("floor-tables").replaceChildren(...codes.map((code, index) => {
    const table = element("div", null, "floor-table");
    table.id = `floor-${code}`;
    table.classList.toggle("is-user", code === user);
    table.style.setProperty("--seat", index);
    table.style.setProperty("--team-bg", colors[code][0]);
    table.style.setProperty("--team-fg", colors[code][1]);
    const delegates = element("div", null, "delegates");
    delegates.setAttribute("aria-hidden", "true");
    for (const position of ["back-left", "back-right", "bidder"]) {
      const person = element("div", null, `delegate ${position}`);
      person.append(element("i", null, "person-head"), element("i", null, "person-body"));
      if (position === "bidder") {
        const arm = element("i", null, "bid-arm");
        arm.append(element("span", code, "paddle"));
        person.append(arm);
      }
      delegates.append(person);
    }
    const price = element("span", null, "floor-price");
    price.setAttribute("aria-hidden", "true");
    const desk = element(code === user ? "div" : "button", code, "team-desk");
    if (code !== user) {
      desk.type = "button";
      desk.setAttribute("aria-label", `Inspect ${config.teams[code]}`);
      desk.addEventListener("click", () => showStats("teams", code));
    } else {
      desk.classList.add("user-desk-name");
      desk.textContent = `${code} · Your table`;
    }
    table.append(delegates, desk, price);
    return table;
  }));
  $(`floor-${user}`).append(bidButton);
}

const statTitles = { player: "Player stats", teams: "Franchise purses and squads", set: "Current set", results: "Auction results", activity: "Bid history" };
const performanceGroups = {
  "Batting": [["career_runs", "Career runs"], ["career_strike_rate", "Career strike rate"], ["recent_runs", "Recent runs"], ["recent_strike_rate", "Recent strike rate"], ["peak_season_runs", "Peak season runs"]],
  "Bowling": [["career_wickets", "Career wickets"], ["career_economy", "Career economy"], ["recent_wickets", "Recent wickets"], ["recent_economy", "Recent economy"], ["peak_season_wickets", "Peak season wickets"]],
  "Experience": [["career_matches", "Career batting matches"], ["recent_matches", "Recent batting matches"], ["international_prestige_score", "International matches"], ["injury_gap_years", "Years since last recorded match"]],
};
const statNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function showStats(section, code) {
  for (const key of Object.keys(statTitles)) $("stats-" + key).hidden = key !== section;
  $("stats-title").textContent = section === "player" && state.player ? state.player.name : statTitles[section];
  $("stats-dialog").showModal();
  if (code) {
    const franchise = $("standings").querySelector(`[data-team="${code}"]`);
    franchise.open = true;
    franchise.scrollIntoView({ block: "nearest" });
  }
}

function renderPerformance(stats) {
  const target = $("performance-stats");
  if (!stats) {
    target.replaceChildren(element("p", "Performance metrics are unavailable for this player.", "muted"));
    return;
  }
  target.replaceChildren(...Object.entries(performanceGroups).map(([group, metrics]) => {
    const panel = element("section", null, "performance-group");
    panel.append(element("h3", group));
    const list = element("dl", null, "detail-stats");
    for (const [key, label] of metrics) {
      if (!(key in stats)) continue;
      const item = element("div");
      item.append(element("dt", label), element("dd", statNumber.format(stats[key])));
      list.append(item);
    }
    panel.append(list);
    return panel;
  }));
}

function updateNominationSheet() {
  const query = $("nomination-search").value.trim().toLowerCase();
  const role = $("nomination-role").value;
  const boxes = [...$("nomination-list").querySelectorAll("input")];
  const count = boxes.filter(box => box.checked).length;
  for (const box of boxes) {
    const row = box.closest("label");
    row.hidden = Boolean((role && role !== row.dataset.role) || !row.textContent.toLowerCase().includes(query));
    box.disabled = !box.checked && count >= state.nomination_limit;
  }
  $("nomination-count").textContent = `${count} / ${state.nomination_limit} selected`;
  $("nomination-empty").hidden = boxes.some(box => !box.closest("label").hidden);
  $("nomination-empty").textContent = boxes.length ? "No players match these filters." : "No eligible players are available for this round.";
}

function renderNominations(players) {
  $("nomination-search").value = "";
  $("nomination-role").value = "";
  const final = state.nomination_round === 2;
  $("nomination-title").textContent = final ? "Final recall nominations" : "Accelerated round nominations";
  $("nomination-rules").textContent = final
    ? "Choose from players who went unsold or have yet to be called. Every franchise submits its own sheet before the final accelerated round."
    : "Choose from later sets that have yet to be called. Every franchise submits a sheet, and each nominated player is offered once in this round.";
  $("nomination-list").replaceChildren(...players.map(player => {
    const label = element("label", null, "nomination-player");
    label.dataset.role = player.role;
    const box = element("input");
    box.type = "checkbox";
    box.value = player.id;
    box.addEventListener("change", updateNominationSheet);
    const details = element("div");
    details.append(element("strong", player.name), element("small",
      [xiRoles[player.skill] || roles[player.role], player.country, player.recalled ? "Previously unsold" : "Uncalled"].filter(Boolean).join(" · ")));
    label.append(box, details, element("strong", money(player.reserve), "nomination-reserve"));
    return label;
  }));
  updateNominationSheet();
}

function renderFloor(call) {
  $("floor-call").textContent = call;
  for (const table of $("floor-tables").children) {
    table.classList.toggle("is-leading", table.id === `floor-${state.leader}`);
  }
  const identity = state.bid_id && `${state.lot}:${state.bid_id}`;
  if (!identity || identity === lastPaddle) return;
  lastPaddle = identity;
  const table = $(`floor-${state.leader}`);
  const previous = $("floor-tables").querySelector(".is-raising");
  if (previous) previous.classList.remove("is-raising");
  clearTimeout(raiseTimer);
  table.querySelector(".floor-price").textContent = money(state.price);
  table.classList.add("is-raising");
  raiseTimer = setTimeout(() => table.classList.remove("is-raising"), 1120);
}

function render(nextState) {
  const previous = state;
  countdownEnd = performance.now() + (nextState.seconds || 0) * 1000;
  const unchanged = state?.version === nextState.version && state?.user === nextState.user && !$("room").hidden;
  state = nextState;
  if (unchanged) {
    updateClock();
    return;
  }

  const { player, phase, user, leader, price, results } = state;
  const bidding = phase === "bidding";
  const matching = phase === "rtm";
  const finalBid = matching && state.rtm_stage === "final";
  const complete = phase === "complete";
  const reveal = phase === "reveal";
  const nominate = phase === "nomination";
  $("setup").hidden = true;
  $("room").hidden = false;
  $("restart").hidden = false;
  $("your-team").replaceChildren(badge(user), element("span", config.teams[user]));
  $("set-reveal").hidden = !reveal;
  $("room-grid").hidden = reveal || nominate;
  $("nominations").hidden = !nominate;
  if (nominate) {
    presentation.sync(state, previous, config.teams);
    if ($("stats-dialog").open) $("stats-dialog").close();
    renderNominations(state.nominees);
    window.scrollTo(0, 0);
    return;
  }
  if (state.set && (!previous || previous.set?.code !== state.set.code)) renderSet(state.set);
  if (reveal) {
    presentation.sync(state, previous, config.teams);
    if ($("stats-dialog").open) $("stats-dialog").close();
    lastPaddle = null;
    window.scrollTo(0, 0);
    $("set-reveal").querySelector(".pouch-scene").getAnimations({ subtree: true }).forEach(animation => {
      animation.currentTime = 0;
      animation.play();
    });
    $("open-set").focus({ preventScroll: true });
    return;
  }
  if (!previous || previous.user !== user || !$("floor-tables").children.length) buildFloor(user);
  $("auction-floor").classList.toggle("is-complete", complete);
  const setIndex = state.set?.players.findIndex(entry => entry.id === player?.id || entry.name === player?.name);
  const setProgress = setIndex >= 0 ? ` · ${state.set.code} ${setIndex + 1}/${state.set.players.length}` : "";
  $("progress").textContent = complete ? `${state.total} lots processed` : `Lot ${state.lot} · ${state.total} queued${setProgress}`;
  const call = state.cue === "once" ? "Going once…" : state.cue === "twice" ? "Going twice…" :
    leader ? `${config.teams[leader]} leads` : "Taking opening bids";
  $("phase").textContent = complete ? "Complete" : bidding ? (state.accelerated_round ? "Accelerated bidding" : "Live bidding") : matching ? "RTM" : leader ? "Sold" : "Unsold";
  if (!complete) {
    renderFloor(bidding ? call : matching ? (finalBid ? "Make your final offer" : `Right to Match · ${state.rtm_team}`) : leader ? `Sold to ${leader} · ${money(price)}` : "Unsold · no bids");
  } else {
    renderFloor("Final standings are available below");
  }
  updateClock();
  $("player-name").textContent = complete ? "Auction complete" : player.name;
  $("player-meta").textContent = complete ? "FINAL STANDINGS" : `${roles[player.role]} · ${player.country}`;
  $("price-source").textContent = complete ? "Expand a franchise to review its final squad." :
    player.valuation == null ? "No model valuation available for this player." :
      "Valuation uses historical auction prices and modeled performance features. Runs and wickets can be league-weighted.";
  $("reserve").textContent = money(player?.reserve);
  $("valuation").textContent = money(player?.valuation);
  $("current-price").textContent = money(price);
  $("stage-price").textContent = complete ? "" : money(price ?? player.reserve);
  $("current-label").textContent = phase === "result" && leader ? "Winning bid" : "Current bid";
  $("previous-franchise").textContent = config.teams[player?.previous] || "—";
  $("sale-probability").textContent = player?.sale_probability == null ? "—" : `${Math.round(player.sale_probability * 100)}%`;
  $("median-price").textContent = money(player?.price_range?.[1]);
  $("price-range").textContent = player?.price_range ? `${money(player.price_range[0])} – ${money(player.price_range[2])}` : "—";
  $("prior-sale").textContent = Number.isFinite(player?.prior_sale)
    ? [money(player.prior_sale), player.prior_sale_year].filter(Boolean).join(" · ")
    : "No prior sale recorded";
  $("xi-role").textContent = xiRoles[player?.skill] || "—";
  $("phase-stats").textContent = player?.form && Object.keys(player.form).length ?
    `Pre-auction T20 form · ${player.form.recent_runs} runs · ${player.form.recent_wickets} wickets · ${player.form.death_bowl_balls} death-over balls bowled` : "";
  if (previous?.lot !== state.lot || previous?.phase === "reveal" || !previous) {
    renderPerformance(player?.stats);
    if ($("stats-dialog").open && !$("stats-player").hidden) {
      $("stats-title").textContent = player?.name || statTitles.player;
    }
  }
  $("action-note").textContent = matching ? (finalBid ? "Raise your winning bid once, or stand on the current price." :
    state.rtm_stage === "offer" ? "Request Right to Match. The current leader can raise once before you decide." : "Match the final price to sign the player and use a card.") :
    bidding ? (leader === user ? "Your paddle has the high bid." : state.can_bid ?
      "Raise your paddle from your table any time before the hammer." : "Your purse or squad limits prevent another bid.") :
      complete ? "Start a new auction to try another franchise." : "Ready to continue? Bidding stays paused until you choose.";
  $("bid").textContent = matching ? (finalBid ? "Raise final bid" : state.rtm_stage === "offer" ? "Request RTM" : `Match ${money(price)}`) : leader === user ? "You lead" : `Bid ${money(state.next_price)}`;
  $("bid").hidden = !(bidding || matching);
  $("bid").disabled = bidding && (!state.can_bid || presentation.speaking());
  if (bidding && presentation.speaking()) $("bid").title = "Wait for the auctioneer to finish the call.";
  if (!bidding) $("bid").removeAttribute("title");
  $("pass").hidden = !matching;
  $("pass").textContent = finalBid ? "Keep current bid" : "Decline RTM";
  $("final-raise").hidden = !finalBid;
  if (finalBid && previous?.rtm_stage !== "final") {
    $("final-amount").min = state.final_bid_min / 100;
    $("final-amount").max = state.final_bid_max / 100;
    $("final-amount").value = state.final_bid_min / 100;
  }
  if (finalBid) $("bid").disabled = state.final_bid_min > state.final_bid_max;
  $("skip").hidden = !bidding;
  $("next").hidden = phase !== "result";
  $("next").textContent = state.lot === state.total ? "Ready to continue" : "Ready for next player";
  $("rtm-count").textContent = `${state.rtm} RTM left`;
  $("current-set").hidden = complete;
  $("player-stats-button").hidden = complete;
  $("activity-button").hidden = complete;
  $("player-preview").textContent = player ? `Reserve ${money(player.reserve)}` : "";
  $("teams-preview").textContent = `${user} · ${money(state.teams[user].purse)} left`;
  $("activity-preview").textContent = `${state.events.filter(event => event.kind === "bid").length} recent bids`;
  const sold = results.filter(result => result.team).length;
  $("result-count").textContent = `${sold} sold · ${results.length - sold} unsold`;
  if (!previous || previous.results.length !== results.length || previous.user !== user || previous.phase === "reveal") {
    $("results").replaceChildren(...(results.length ? [...results].reverse().map(result => {
    const row = element("div", null, "result-row");
    row.append(element("strong", result.name), element("span", result.team ? `${result.team} · ${money(result.price)}` : "Unsold"));
    return row;
    }) : [element("p", "Results appear after the first lot.", "muted")]));
    renderStandings();
  }
  $("activity").replaceChildren(...[...state.events].reverse().map(event => {
    const row = element("li");
    row.append(element("span", event.team ? `${event.team} · ${event.message}` : event.message));
    if (event.price != null) row.append(element("strong", money(event.price)));
    return row;
  }));
  presentation.sync(state, previous, config.teams);
  lineupMaker.sync(state, previous);
}

async function move(action, options = {}) {
  if (busy || !state) return;
  busy = true;
  showError();
  try {
    render(await api("action", { action, version: state.version, lot: state.lot, price: state.next_price, ...options }));
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
  }
}

$("bid").addEventListener("click", () => {
  if (state.phase === "bidding" && presentation.speaking()) return;
  if (state.rtm_stage === "final") {
    const price = $("final-amount");
    if (price.reportValidity() && Number.isFinite(price.valueAsNumber)) {
      move("raise", { amount: Math.round(price.valueAsNumber * 100) });
    }
  } else {
    move(state.phase === "rtm" ? "match" : "bid");
  }
});
$("nomination-search").addEventListener("input", updateNominationSheet);
$("nomination-role").addEventListener("change", updateNominationSheet);
$("submit-nominations").addEventListener("click", () => {
  const nominations = [...$("nomination-list").querySelectorAll("input:checked")].map(box => box.value);
  move("nominate", { nominations });
});
for (const button of document.querySelectorAll("[data-stats]")) {
  button.addEventListener("click", () => showStats(button.dataset.stats));
}
$("pass").addEventListener("click", () => move("pass"));
$("skip").addEventListener("click", () => move("skip"));
$("open-set").addEventListener("click", () => move("open"));
$("next").addEventListener("click", () => move("next"));
$("restart").addEventListener("click", () => {
  if (!busy && (state.phase === "complete" || window.confirm("Start over and replace this auction?"))) {
    showError();
    showSetup();
  }
});
$("start").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  $("start").disabled = true;
  showError();
  try {
    const keep = [...$("retentions").querySelectorAll("input:checked")].map(box => box.value);
    render(await api("start", { team: selection, keep }));
    window.scrollTo(0, 0);
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
    $("start").disabled = false;
  }
});

async function sync() {
  if (busy || syncing || !state || state.seconds == null || (state.phase === "bidding" && presentation.waitingForBid())) return;
  const previous = state;
  syncing = true;
  try {
    const latest = await api(`state?after=${previous.version}`);
    if (latest && !busy && state === previous && !presentation.speaking()) render(latest);
  } catch (error) {
    if (!busy && state === previous) showError(error.message);
  } finally {
    syncing = false;
  }
}

async function initialize() {
  try {
    config = await api("config");
    try {
      render(await api("state"));
    } catch (error) {
      if (error.status !== 404) throw error;
      showSetup();
    }
    setInterval(updateClock, 200);
    setInterval(sync, 400);
  } catch (error) {
    showError(error.message);
  }
}

const presentation = createAuctionPresentation(colors, money, {
  inspect: code => showStats("teams", code),
  playerRole: player => xiRoles[player.skill] || roles[player.role],
});
const lineupMaker = createLineupMaker(async lineup => render(await api("lineup", lineup)));

initialize();

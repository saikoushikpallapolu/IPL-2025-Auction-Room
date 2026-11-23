function createAuctionPresentation(colors, formatPrice, actions) {
  const node = id => document.getElementById(id);
  const tones = {
    CSK: "#ffd429", DC: "#236cfc", GT: "#3d6684", KKR: "#964cdd", LSG: "#37b9f5",
    MI: "#3364ed", PBKS: "#ec3754", RR: "#ee4da9", RCB: "#ec342e", SRH: "#fb7c22",
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const restartHome = node("restart").parentElement;
  const venue = node("room-viewport");
  const venueHome = venue.parentElement;
  const roster = node("table-roster");
  const rosterHome = roster.parentElement;
  let selected = "3d";
  let scene;
  let loading;
  let failed;
  let latest;
  let teamNames;
  let saleTimeout;
  let impactTimeout;
  let wide = true;
  let cameraTeam;
  let displayedRoster;
  let lastBid;
  const audio = createAuctionAudio(node);

  function isLive() {
    return latest && !["reveal", "nomination", "complete"].includes(latest.phase);
  }

  function placeBid() {
    const bid = node("bid");
    const destination = selected === "3d" ? node("room-bid") : node(`floor-${latest?.user}`);
    if (destination && bid.parentElement !== destination) destination.append(bid);
  }

  function showTableRoster() {
    const roster = latest?.teams[cameraTeam]?.roster;
    const visible = isLive() && roster && (selected !== "3d" || !wide);
    const stand = node("table-roster");
    stand.hidden = !visible;
    if (!visible) return;
    if (displayedRoster?.team === cameraTeam && displayedRoster.count === roster.length) return;
    displayedRoster = { team: cameraTeam, count: roster.length };
    stand.style.setProperty("--roster-ink", colors[cameraTeam][1]);
    stand.style.setProperty("--roster-light", colors[cameraTeam][0]);
    node("table-roster-title").replaceChildren(actions.badge(cameraTeam), document.createTextNode(teamNames[cameraTeam]));
    node("table-roster-players").replaceChildren(...roster.map(player => {
      const row = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = player.name;
      const kind = document.createElement("span");
      kind.textContent = player.retained ? "Retained" : "Bought";
      row.append(label, kind);
      return row;
    }));
  }

  function showView() {
    const reveal = latest?.phase === "reveal";
    const show3d = selected === "3d" && isLive();
    const reveal3d = reveal && !failed;
    const venueParent = reveal3d ? node("set-venue") : venueHome;
    if (venue.parentElement !== venueParent) {
      if (reveal3d) venueParent.append(venue);
      else venueParent.insertBefore(venue, node("floor-tables"));
    }
    node("room").classList.toggle("arena-reveal", reveal);
    node("auction-floor").classList.toggle("using-3d", Boolean(show3d));
    node("room").classList.toggle("arena-active", Boolean(show3d));
    venue.hidden = !(show3d || reveal3d);
    node("floor-tables").hidden = Boolean(show3d);
    node("room-bid").hidden = !show3d;
    node("view-3d").setAttribute("aria-pressed", String(Boolean(show3d)));
    node("view-floor").setAttribute("aria-pressed", String(!show3d));
    node("view-wide").hidden = !show3d;
    node("view-wide").setAttribute("aria-pressed", String(wide));
    node("view-wide").textContent = wide ? "My table" : "Wide camera";
    node("camera-team-control").hidden = !isLive();
    showTableRoster();
    node("arena-tables").hidden = !show3d;
    node("view-3d").disabled = Boolean(failed);
    node("view-3d").title = failed ? "3D is unavailable on this device. The table view is ready." : "";
    node("view-controls").hidden = !isLive();
    const restartParent = show3d ? node("view-controls") : restartHome;
    if (node("restart").parentElement !== restartParent) restartParent.append(node("restart"));
    const rosterParent = show3d ? node("view-controls") : rosterHome;
    if (roster.parentElement !== rosterParent) {
      if (show3d) rosterParent.append(roster);
      else rosterHome.insertBefore(roster, rosterHome.querySelector(".stage-controls"));
    }
    if (failed) node("view-3d").textContent = "3D unavailable";
    if (isLive()) placeBid();
    scene?.show(Boolean(show3d || reveal3d));
    if ((show3d || reveal3d) && !scene && !loading) {
      node("room-loading").hidden = false;
      loading = import("./auction-room.js").then(({ createRoom }) => {
        scene = createRoom(node("room-canvas"), node("table-labels"), {
          table(code) {
            if (!isLive()) return;
            if (code === latest?.user) node("bid").click();
            else actions.inspect(code);
          },
          unavailable() {
            failed = true;
            selected = "table";
            showView();
          },
        });
        updateScene();
        node("room-loading").hidden = true;
        showView();
      }).catch(() => {
        failed = true;
        selected = "table";
        showView();
      });
    }
  }

  function updateScene() {
    if (!latest?.player) return;
    if (latest.phase === "reveal") {
      if (!scene) return;
      scene.configure(latest.user, tones, teamNames);
      scene.rosters(latest.teams);
      scene.wide(true, true);
      scene.call(null);
      scene.lead(null);
      scene.scoreboard([latest.set.category, `${latest.set.players.length} players`, "Next set", null]);
      return;
    }
    if (!isLive()) return;
    const player = latest.player;
    const lastSale = Number.isFinite(player.prior_sale)
      ? [formatPrice(player.prior_sale), player.prior_sale_year].filter(Boolean).join(" · ")
      : "No prior sale recorded";
    const metrics = [
      ["Reserve", formatPrice(player.reserve)],
      ["Last recorded sale", lastSale],
      ["Role", actions.playerRole(player)],
    ];
    const rtmTeam = latest.rtm_team || latest.rtm_eligible_team;
    if (rtmTeam && latest.phase !== "result") metrics.push(["RTM", rtmTeam]);
    node("arena-metrics").replaceChildren(...metrics.map(([label, value]) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      const number = document.createElement("strong");
      text.textContent = label;
      number.textContent = value;
      item.append(text, number);
      return item;
    }));
    if (!scene) return;
    scene.configure(latest.user, tones, teamNames);
    scene.wide(wide);
    scene.viewTable(cameraTeam);
    scene.rosters(latest.teams);
    scene.scoreboard([
      latest.player.name,
      formatPrice(latest.price ?? latest.player.reserve),
      latest.phase === "result" ? (latest.leader ? `Sold to ${latest.leader}` : "Unsold") :
        latest.phase === "rtm" ? "Right to Match" :
          latest.cue === "once" ? "Going once" : latest.cue === "twice" ? "Going twice" :
            latest.leader ? "Highest bidder" : "Opening bid",
      latest.leader ? tones[latest.leader] : null,
      metrics,
      latest.leader ? { code: latest.leader, name: teamNames[latest.leader] } : null,
    ]);
    scene.call(latest.phase === "bidding" ? latest.cue : null);
    scene.lead(["bidding", "rtm"].includes(latest.phase) ? latest.leader : null);
  }

  function announce(result, featured, name) {
    audio.stopVoice();
    clearTimeout(saleTimeout);
    const banner = node("sold-banner");
    banner.style.setProperty("--winner-color", tones[result.team]);
    banner.style.setProperty("--winner-light", colors[result.team][0]);
    banner.classList.toggle("featured-sale", featured);
    banner.hidden = false;
    node("sold-team").textContent = name;
    node("sold-player").textContent = result.name;
    node("sold-price").textContent = formatPrice(result.price);
    banner.setAttribute("aria-label", `${result.name} sold to ${name} for ${formatPrice(result.price)}`);
    banner.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = 0; animation.play(); });
    scene?.sold(result.team, featured);
    clearTimeout(impactTimeout);
    impactTimeout = setTimeout(audio.sold, motion.matches ? 0 : 440);
    saleTimeout = setTimeout(() => { banner.hidden = true; }, featured && !motion.matches ? 2800 : 2000);
  }

  node("view-3d").addEventListener("click", () => { if (!failed) { selected = "3d"; showView(); } });
  node("view-floor").addEventListener("click", () => { selected = "table"; showView(); });
  node("view-wide").addEventListener("click", () => {
    wide = !wide;
    if (!wide) {
      cameraTeam = latest.user;
      node("camera-team").value = cameraTeam;
    }
    scene?.wide(wide);
    scene?.viewTable(cameraTeam);
    showView();
  });
  node("camera-team").addEventListener("change", event => {
    cameraTeam = event.target.value;
    wide = false;
    scene?.wide(false);
    scene?.viewTable(cameraTeam);
    showView();
  });
  motion.addEventListener("change", () => scene?.reduced(motion.matches));
  window.addEventListener("pagehide", () => clearTimeout(impactTimeout));
  return {
    speaking: audio.speaking,
    waitingForBid: audio.waitingForBid,
    sync(state, previous, teams) {
      latest = state;
      teamNames = teams;
      if (previous && (state.lot !== previous.lot || state.phase !== previous.phase || state.paused)) {
        audio.stopVoice();
        clearTimeout(impactTimeout);
      }
      audio.live(state.phase !== "complete" && !state.paused);
      if (!previous || previous.user !== state.user) {
        cameraTeam = state.user;
        node("camera-team").replaceChildren(...Object.entries(teams).map(([code, name]) => new Option(name, code)));
        node("camera-team").value = cameraTeam;
        node("arena-tables").replaceChildren(...Object.entries(teams).map(([code, name]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.append(actions.badge(code), document.createTextNode(code));
          button.dataset.team = code;
          button.style.setProperty("--team-light", tones[code]);
          button.setAttribute("aria-label", `Inspect ${name}${code === state.user ? ", your team" : ""}`);
          button.addEventListener("click", () => actions.inspect(code));
          return button;
        }));
      }
      for (const button of node("arena-tables").children) {
        button.classList.toggle("is-leading", button.dataset.team === state.leader);
      }
      node("seat-team").textContent = state.user;
      node("seat-team").style.setProperty("--seat-color", colors[state.user][0]);
      showView();
      updateScene();
      if (previous && !state.paused && state.phase === "bidding" &&
          (state.lot !== previous.lot || state.cue !== previous.cue)) {
        if (state.cue === "once") audio.call("Going once.");
        if (state.cue === "twice") audio.call("Going twice.");
      }
      const bid = state.bid_id && `${state.lot}:${state.bid_id}`;
      if (bid && bid !== lastBid && state.leader) {
        lastBid = bid;
        if (previous && !state.paused) {
          scene?.raise(state.leader);
          const ownTable = state.leader === state.user;
          const names = Object.keys(teams).filter(team => team !== state.user);
          names.splice(7, 0, state.user);
          const side = (names.indexOf(state.leader) % 5 - 2) * .24;
          const bidder = state.leader === "RCB" ? "Bengaluru"
            : state.leader === "SRH" ? "Hyderabad" : teams[state.leader].split(" ")[0];
          audio.bid(bidder, state.price, ownTable, side);
        }
      }
      const result = state.results.at(-1);
      if (previous && previous.results.length < state.results.length && result?.team) {
        const overlapping = state.phase === "bidding" || state.phase === "reveal";
        const featured = !overlapping && (["M1", "M2"].includes(result.set) || result.price >= 2000);
        announce(result, featured, teams[result.team]);
      }
    },
    reset() {
      latest = null;
      displayedRoster = null;
      lastBid = null;
      clearTimeout(saleTimeout);
      clearTimeout(impactTimeout);
      audio.stopVoice();
      audio.live(false);
      node("sold-banner").hidden = true;
      node("room").classList.remove("arena-active");
      node("room").classList.remove("arena-reveal");
      restartHome.append(node("restart"));
      scene?.resetSale();
      scene?.show(false);
    },
  };
}

function createLineupMaker(save) {
  const node = id => document.getElementById(id);
  const editor = node("lineup-maker");
  const home = editor.parentElement;
  let roster = [];
  let order = [];
  let suggested = [];
  let keeper;
  let confirmState;
  let draggedPlayer;
  let editingDraft = false;
  const roles = { BAT: "Batter", BOWL: "Bowler", AR: "All-rounder", WK: "Wicketkeeper" };

  function button(text, handler, label = text) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "secondary compact";
    control.textContent = text;
    control.setAttribute("aria-label", label);
    control.addEventListener("click", handler);
    return control;
  }

  function sensibleKeeper() {
    if (!order.includes(keeper) || roster[keeper]?.role !== "WK") {
      keeper = order.find(index => roster[index].role === "WK");
    }
  }

  function changed() {
    confirmState = null;
    sensibleKeeper();
    draw();
  }

  function reorder(from, to) {
    if (from == null || from === to || to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    changed();
    node("lineup-slots").children[to]?.querySelector("button")?.focus();
  }

  function canAdd(index) {
    return order.length < 11 && (!roster[index].overseas || order.filter(i => roster[i].overseas).length < 4);
  }

  function addPlayer(index, position = order.length) {
    if (!canAdd(index)) return;
    order.splice(position, 0, index);
    changed();
  }

  function removePlayer(index) {
    order = order.filter(player => player !== index);
    changed();
  }

  function endDrag() {
    draggedPlayer = null;
    editor.classList.remove("dragging-lineup");
  }

  function makeDraggable(row, index) {
    row.dataset.lineupPlayer = index;
    row.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      draggedPlayer = { index, from: order.indexOf(index), x: event.clientX, y: event.clientY, pointer: event.pointerId };
      editor.setPointerCapture(event.pointerId);
    });
  }

  function showEmptyHint(list, text) {
    if (list.children.length) return;
    const row = document.createElement("li");
    row.className = "lineup-empty";
    row.textContent = text;
    list.append(row);
  }

  editor.addEventListener("pointermove", event => {
    if (draggedPlayer?.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - draggedPlayer.x, event.clientY - draggedPlayer.y) >= 5) {
      editor.classList.add("dragging-lineup");
    }
  });
  editor.addEventListener("pointerup", event => {
    if (draggedPlayer?.pointer !== event.pointerId) return;
    const { index, from } = draggedPlayer;
    const moved = editor.classList.contains("dragging-lineup");
    endDrag();
    if (!moved) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target?.closest("#lineup-bench") && from >= 0) {
      removePlayer(index);
    } else if (target?.closest("#lineup-slots")) {
      const row = target.closest("[data-lineup-player]");
      const bounds = row?.getBoundingClientRect();
      const position = row
        ? order.indexOf(Number(row.dataset.lineupPlayer)) + Number(event.clientY > bounds.top + bounds.height / 2)
        : order.length;
      if (from < 0) addPlayer(index, position);
      else reorder(from, from < position ? position - 1 : position);
    }
  });
  editor.addEventListener("pointercancel", endDrag);

  function draw() {
    const players = order.map(index => roster[index]);
    const overseas = players.filter(player => player.overseas).length;
    const bowlers = players.filter(player => ["BOWL", "AR"].includes(player.role)).length;
    const batters = players.filter(player => ["BAT", "WK", "AR"].includes(player.role)).length;
    const valid = players.length === 11 && overseas <= 4 && keeper != null;
    node("lineup-summary").textContent = `${players.length}/11 selected · ${overseas}/4 overseas · ${keeper == null ? "Wicketkeeper needed" : `Keeper: ${roster[keeper].name}`}`;
    node("lineup-balance").textContent = `${batters} batting options · ${bowlers} bowling options${bowlers < 5 ? " · Add bowling cover" : ""}`;
    node("save-lineup").textContent = editingDraft ? "Save XI draft" : "Save Playing XI";
    node("save-lineup").disabled = (!editingDraft && !valid) || Boolean(confirmState);
    node("lineup-feedback").textContent = confirmState ? (editingDraft ? "Draft saved for this auction." : "Playing XI saved for this auction.") :
      overseas > 4 ? "Remove an overseas player to save." : "";
    node("lineup-slots").replaceChildren(...order.map((index, position) => {
      const player = roster[index];
      const row = document.createElement("li");
      makeDraggable(row, index);
      const label = document.createElement("span");
      label.textContent = `${player.name}${player.overseas ? " · Overseas" : ""}`;
      const info = document.createElement("small");
      info.textContent = `${roles[player.role]}${index === keeper ? " · Keeping" : ""}`;
      label.append(info);
      const controls = document.createElement("div");
      const up = button("↑", () => reorder(position, position - 1), `Move ${player.name} up`);
      const down = button("↓", () => reorder(position, position + 1), `Move ${player.name} down`);
      up.disabled = position === 0;
      down.disabled = position === order.length - 1;
      controls.append(up, down);
      if (player.role === "WK" && index !== keeper) controls.append(button("Keep", () => { keeper = index; changed(); }, `Make ${player.name} wicketkeeper`));
      controls.append(button(editingDraft ? "−" : "Remove", () => removePlayer(index), `Remove ${player.name} from XI`));
      row.append(label, controls);
      return row;
    }));
    const selected = new Set(order);
    node("lineup-bench").replaceChildren(...roster.flatMap((player, index) => {
      if (selected.has(index)) return [];
      const row = document.createElement("li");
      makeDraggable(row, index);
      const label = document.createElement("span");
      label.textContent = `${player.name} · ${roles[player.role]}${player.overseas ? " · Overseas" : ""}`;
      const add = button(editingDraft ? "+" : "Add", () => addPlayer(index), `Add ${player.name} to XI`);
      add.disabled = !canAdd(index);
      row.append(label, add);
      return [row];
    }));
    showEmptyHint(node("lineup-bench"), "Drop a player here to return them to the squad.");
    showEmptyHint(node("lineup-slots"), "Drop a player here to start your XI.");
  }

  async function submit() {
    const saveButton = node("save-lineup");
    saveButton.disabled = true;
    try {
      await save({ order, keeper, draft: editingDraft });
      confirmState = true;
      draw();
    } catch (error) {
      saveButton.disabled = false;
      node("lineup-feedback").textContent = error.message;
    }
  }

  node("save-lineup").addEventListener("click", submit);
  node("reset-lineup").addEventListener("click", () => {
    order = [...suggested];
    keeper = undefined;
    changed();
  });

  function loadLineup(state) {
      const team = state.teams[state.user];
      roster = team.roster;
      suggested = team.playing_xi.players.map(player => player.roster_index);
      if (!suggested.some(index => roster[index].role === "WK")) {
        const preferred = roster.findIndex(player => player.role === "WK" && !player.overseas);
        const candidate = preferred >= 0 ? preferred : roster.findIndex(player => player.role === "WK");
        if (candidate >= 0) {
          if (roster[candidate].overseas && suggested.filter(i => roster[i].overseas).length >= 4) {
            const last = suggested.findLastIndex(i => roster[i].overseas);
            suggested.splice(last, 1, candidate);
          } else if (suggested.length >= 11) {
            suggested[suggested.length - 1] = candidate;
          } else {
            suggested.unshift(candidate);
          }
        }
      }
      const available = roster.map((_, index) => index).sort((a, b) => (roster[b].quality || 1) - (roster[a].quality || 1));
      for (const index of available) {
        if (suggested.length >= 11) break;
        if (suggested.includes(index) || (roster[index].overseas && suggested.filter(i => roster[i].overseas).length >= 4)) continue;
        suggested.push(index);
      }
      const ranks = { top_order: 0, keeper: 1, finisher: 2, pace: 3, spin: 4, death: 5 };
      suggested.sort((a, b) => (ranks[roster[a].skill] ?? 6) - (ranks[roster[b].skill] ?? 6));
      order = [...(state.lineup?.order || suggested)];
      keeper = state.lineup?.keeper;
      confirmState = Boolean(state.lineup && editingDraft === Boolean(state.lineup.draft));
      sensibleKeeper();
      draw();
  }

  return {
    showDraft(state) {
      editingDraft = true;
      node("live-lineup-host").append(editor);
      node("live-lineup-host").hidden = false;
      editor.hidden = false;
      loadLineup(state);
    },
    closeDraft() {
      if (!editingDraft) return;
      endDrag();
      editingDraft = false;
      node("live-lineup-host").hidden = true;
      editor.hidden = true;
      home.append(editor);
    },
    sync(state, previous) {
      if (editingDraft) return;
      const enabled = state.phase === "complete";
      editor.hidden = !enabled;
      if (enabled && (previous?.phase !== "complete" || previous.user !== state.user)) loadLineup(state);
    },
  };
}

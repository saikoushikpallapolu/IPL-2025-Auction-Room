function createAuctionPresentation(colors, formatPrice, actions) {
  const node = id => document.getElementById(id);
  const tones = {
    CSK: "#ffd429", DC: "#236cfc", GT: "#3d6684", KKR: "#964cdd", LSG: "#37b9f5",
    MI: "#3364ed", PBKS: "#ec3754", RR: "#ee4da9", RCB: "#ec342e", SRH: "#fb7c22",
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const restartHome = node("restart").parentElement;
  let selected = "3d";
  let scene;
  let loading;
  let failed;
  let latest;
  let teamNames;
  let saleTimeout;
  let impactTimeout;
  let wide = true;
  let lastBid;
  let audioEnabled = false;
  let audioContext;

  function isLive() {
    return latest && !["reveal", "nomination", "complete"].includes(latest.phase);
  }

  function placeBid() {
    const bid = node("bid");
    const destination = selected === "3d" ? node("room-bid") : node(`floor-${latest?.user}`);
    if (destination && bid.parentElement !== destination) destination.append(bid);
  }

  function showView() {
    const show3d = selected === "3d" && isLive();
    node("auction-floor").classList.toggle("using-3d", Boolean(show3d));
    node("room").classList.toggle("arena-active", Boolean(show3d));
    node("room-viewport").hidden = !show3d;
    node("floor-tables").hidden = Boolean(show3d);
    node("room-bid").hidden = !show3d;
    node("view-3d").setAttribute("aria-pressed", String(Boolean(show3d)));
    node("view-floor").setAttribute("aria-pressed", String(!show3d));
    node("view-wide").hidden = !show3d;
    node("view-wide").setAttribute("aria-pressed", String(wide));
    node("view-wide").textContent = wide ? "Back to my seat" : "Wide camera";
    node("arena-tables").hidden = !show3d;
    node("view-3d").disabled = Boolean(failed);
    node("view-3d").title = failed ? "3D is unavailable on this device. The table view is ready." : "";
    node("view-controls").hidden = !isLive();
    const restartParent = show3d ? node("view-controls") : restartHome;
    if (node("restart").parentElement !== restartParent) restartParent.append(node("restart"));
    if (failed) node("view-3d").textContent = "3D unavailable";
    if (isLive()) placeBid();
    scene?.show(Boolean(show3d));
    if (show3d && !scene && !loading) {
      node("room-loading").hidden = false;
      loading = import("./auction-room.js").then(({ createRoom }) => {
        scene = createRoom(node("room-canvas"), node("table-labels"), {
          table(code) {
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
    if (!latest?.player || !isLive()) return;
    const player = latest.player;
    const metrics = [
      ["Reserve", formatPrice(player.reserve)],
      player.price_range && ["Est. sale price", formatPrice(player.price_range[1])],
      Number.isFinite(player.form?.recent_runs) && ["Recent runs", player.form.recent_runs],
      Number.isFinite(player.form?.recent_wickets) && ["Recent wickets", player.form.recent_wickets],
      Number.isFinite(player.stats?.career_strike_rate) && player.stats.career_strike_rate > 0 && ["Career strike rate", player.stats.career_strike_rate.toFixed(1)],
    ].filter(Boolean).slice(0, 4);
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
    scene.scoreboard([
      latest.player.name,
      formatPrice(latest.price ?? latest.player.reserve),
      latest.phase === "result" ? (latest.leader ? `Sold to ${latest.leader}` : "Unsold") :
        latest.phase === "rtm" ? "Right to Match" :
          latest.cue === "once" ? "Going once" : latest.cue === "twice" ? "Going twice" :
            latest.leader ? `${latest.leader} leads` : "Opening bid",
      latest.leader ? tones[latest.leader] : null,
      metrics,
    ]);
    scene.call(latest.phase === "bidding" ? latest.cue : null);
    scene.lead(["bidding", "rtm"].includes(latest.phase) ? latest.leader : null);
  }

  function speak(text) {
    if (!audioEnabled || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    window.speechSynthesis.cancel();
    const call = new SpeechSynthesisUtterance(text);
    const voice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase() === "en-in");
    if (voice) call.voice = voice;
    call.lang = voice?.lang || "en";
    call.rate = .92;
    window.speechSynthesis.speak(call);
  }

  function strike() {
    if (!audioEnabled) return;
    if (audioContext?.state === "running") {
      const beat = audioContext.currentTime;
      for (const [wave, high, low, length, volume] of [
        ["triangle", 180, 58, .19, .27], ["square", 780, 260, .045, .045],
      ]) {
        const tone = audioContext.createOscillator();
        const envelope = audioContext.createGain();
        tone.type = wave;
        tone.frequency.setValueAtTime(high, beat);
        tone.frequency.exponentialRampToValueAtTime(low, beat + length * .8);
        envelope.gain.setValueAtTime(volume, beat);
        envelope.gain.exponentialRampToValueAtTime(.001, beat + length);
        tone.connect(envelope).connect(audioContext.destination);
        tone.start(beat);
        tone.stop(beat + length);
      }
    }
    speak("Sold!");
  }

  function announce(result, featured, name) {
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
    if (audioEnabled) {
      clearTimeout(impactTimeout);
      impactTimeout = setTimeout(strike, motion.matches ? 0 : 440);
    }
    saleTimeout = setTimeout(() => { banner.hidden = true; }, featured && !motion.matches ? 2800 : 2000);
  }

  node("view-3d").addEventListener("click", () => { if (!failed) { selected = "3d"; showView(); } });
  node("view-floor").addEventListener("click", () => { selected = "table"; showView(); });
  node("view-wide").addEventListener("click", () => { wide = !wide; scene?.wide(wide); showView(); });
  motion.addEventListener("change", () => scene?.reduced(motion.matches));
  const audioButton = node("auction-audio");
  audioButton.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled && window.AudioContext) {
      audioContext ||= new AudioContext();
      audioContext.resume().catch(() => {});
    } else if (!audioEnabled) {
      clearTimeout(impactTimeout);
      window.speechSynthesis?.cancel();
    }
    audioButton.setAttribute("aria-pressed", String(audioEnabled));
    audioButton.textContent = audioEnabled ? "Auction audio on" : "Auction audio off";
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(impactTimeout);
    if (audioEnabled) window.speechSynthesis?.cancel();
  });
  return {
    sync(state, previous, teams) {
      latest = state;
      teamNames = teams;
      if (!previous || previous.user !== state.user) {
        node("arena-tables").replaceChildren(...Object.entries(teams).map(([code, name]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = code;
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
      if (previous && state.phase === "bidding" &&
          (state.lot !== previous.lot || state.cue !== previous.cue)) {
        if (state.cue === "once") speak("Going once.");
        if (state.cue === "twice") speak("Going twice.");
      }
      const bid = state.bid_id && `${state.lot}:${state.bid_id}`;
      if (bid && bid !== lastBid && state.leader) {
        lastBid = bid;
        if (previous) {
          scene?.raise(state.leader);
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
      lastBid = null;
      clearTimeout(saleTimeout);
      clearTimeout(impactTimeout);
      if (audioEnabled) window.speechSynthesis?.cancel();
      node("sold-banner").hidden = true;
      node("room").classList.remove("arena-active");
      restartHome.append(node("restart"));
      scene?.resetSale();
      scene?.show(false);
    },
  };
}

function createLineupMaker(save) {
  const node = id => document.getElementById(id);
  let roster = [];
  let order = [];
  let suggested = [];
  let keeper;
  let confirmState;
  let dragSlot;
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

  function draw() {
    const players = order.map(index => roster[index]);
    const overseas = players.filter(player => player.overseas).length;
    const bowlers = players.filter(player => ["BOWL", "AR"].includes(player.role)).length;
    const batters = players.filter(player => ["BAT", "WK", "AR"].includes(player.role)).length;
    const valid = players.length === 11 && overseas <= 4 && keeper != null;
    node("lineup-summary").textContent = `${players.length}/11 selected · ${overseas}/4 overseas · ${keeper == null ? "Wicketkeeper needed" : `Keeper: ${roster[keeper].name}`}`;
    node("lineup-balance").textContent = `${batters} batting options · ${bowlers} bowling options${bowlers < 5 ? " · Add bowling cover" : ""}`;
    node("save-lineup").disabled = !valid || Boolean(confirmState);
    node("lineup-feedback").textContent = confirmState ? "Playing XI saved for this auction." :
      overseas > 4 ? "Remove an overseas player to save." : "";
    node("lineup-slots").replaceChildren(...order.map((index, position) => {
      const player = roster[index];
      const row = document.createElement("li");
      row.draggable = true;
      row.addEventListener("dragstart", event => {
        dragSlot = position;
        event.dataTransfer.setData("text/plain", String(position));
      });
      row.addEventListener("dragend", () => { dragSlot = null; });
      row.addEventListener("dragover", event => { if (dragSlot != null) event.preventDefault(); });
      row.addEventListener("drop", event => {
        event.preventDefault();
        reorder(dragSlot, position);
        dragSlot = null;
      });
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
      controls.append(button("Remove", () => { order.splice(position, 1); changed(); }, `Remove ${player.name} from XI`));
      row.append(label, controls);
      return row;
    }));
    const selected = new Set(order);
    node("lineup-bench").replaceChildren(...roster.flatMap((player, index) => {
      if (selected.has(index)) return [];
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${player.name} · ${roles[player.role]}${player.overseas ? " · Overseas" : ""}`;
      const add = button("Add", () => { order.push(index); changed(); }, `Add ${player.name} to XI`);
      add.disabled = players.length >= 11 || (player.overseas && overseas >= 4);
      row.append(label, add);
      return [row];
    }));
  }

  async function submit() {
    const saveButton = node("save-lineup");
    saveButton.disabled = true;
    try {
      await save({ order, keeper });
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

  return {
    sync(state, previous) {
      const enabled = state.phase === "complete";
      node("lineup-maker").hidden = !enabled;
      if (!enabled || (previous?.phase === "complete" && previous.user === state.user)) return;
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
      confirmState = Boolean(state.lineup);
      sensibleKeeper();
      draw();
    },
  };
}

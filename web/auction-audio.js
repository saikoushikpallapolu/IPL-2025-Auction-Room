function createAuctionAudio(node) {
  const panel = node("auction-audio-panel");
  const menu = node("auction-audio");
  const voice = node("auction-voice");
  const effects = node("auction-effects");
  const musicToggle = node("auction-music");
  let context;
  let music;
  let instrumental;
  let voicePack;
  let voiceLoading;
  let clipSource;
  let musicGain;
  let live = false;
  let knocks;
  let gavel;

  function soundBuffer(duration, sample) {
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = sample(i / context.sampleRate, i, length);
    return buffer;
  }

  function wood(frequency, decay) {
    let previousNoise = 0;
    return soundBuffer(.19, t => {
      const noise = Math.random() * 2 - 1;
      const tap = (noise - previousNoise * .45) * .60 * Math.exp(-165 * t);
      previousNoise = noise;
      const body = Math.exp(-decay * t) * (.42 * Math.sin(2 * Math.PI * frequency * t)
        + .15 * Math.sin(2 * Math.PI * frequency * 2.73 * t) * Math.exp(-55 * t));
      return (tap + body) * Math.min(1, t * 1400);
    });
  }

  function makeInstrumental() {
    const beat = .75;
    const chords = [[45, 52, 57, 60], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]];
    return soundBuffer(16 * beat, (t, sample, length) => {
      const step = Math.floor(t / beat);
      const chord = chords[Math.min(3, Math.floor(step / 4))];
      const elapsed = t - step * beat;
      const note = chord[[1, 2, 3, 2][step % 4]];
      const freq = 440 * 2 ** ((note - 69) / 12);
      const bass = 440 * 2 ** ((chord[0] - 69) / 12);
      const bassTime = t % (4 * beat);
      const pluck = Math.sin(2 * Math.PI * freq * elapsed) + .18 * Math.sin(4 * Math.PI * freq * elapsed);
      const melody = .43 * pluck * Math.min(1, elapsed * 48) * Math.exp(-5 * elapsed);
      const low = .24 * Math.sin(2 * Math.PI * bass * bassTime) * Math.min(1, bassTime * 12) * Math.exp(-1.85 * bassTime);
      return (melody + low) * Math.min(1, sample / 1500, (length - 1 - sample) / 3000);
    });
  }

  function setMusic() {
    if (!context) return;
    const shouldPlay = live && musicToggle.checked && !document.hidden;
    if (shouldPlay && !music) {
      instrumental ||= makeInstrumental();
      music = context.createBufferSource();
      musicGain = context.createGain();
      musicGain.gain.value = .10;
      music.buffer = instrumental;
      music.loop = true;
      music.connect(musicGain).connect(context.destination);
      music.start();
    } else if (!shouldPlay && music) {
      music.stop();
      music = null;
      musicGain = null;
    }
  }

  function loadVoice() {
    voiceLoading ||= Promise.all([
      fetch("/assets/auction-voice.wav").then(response => {
        if (!response.ok) throw new Error("Voice audio unavailable");
        return response.arrayBuffer();
      }).then(bytes => context.decodeAudioData(bytes)),
      fetch("/assets/auction-voice.json").then(response => response.json()),
    ]).then(([buffer, clips]) => { voicePack = { buffer, clips }; }).catch(() => {
      voiceLoading = null;
      node("auction-voice-status").textContent = "Voice audio could not load. Toggle Auctioneer to retry.";
    });
    return voiceLoading;
  }

  function playClips(keys, index = 0) {
    if (index >= keys.length) {
      if (musicGain) musicGain.gain.setTargetAtTime(.10, context.currentTime, .15);
      return;
    }
    const clip = voicePack.clips[keys[index]];
    if (!clip) return playClips(keys, index + 1);
    const [offset, duration] = clip;
    const source = context.createBufferSource();
    source.buffer = voicePack.buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (clipSource !== source) return;
      clipSource = null;
      playClips(keys, index + 1);
    };
    clipSource = source;
    source.start(0, offset, duration);
  }

  function stopVoice() {
    if (clipSource) {
      const source = clipSource;
      clipSource = null;
      source.stop();
    }
    if (musicGain) musicGain.gain.setTargetAtTime(.10, context.currentTime, .1);
  }

  function call(text, keys = [text]) {
    if (!voice.checked || !voicePack || context?.state !== "running" || document.hidden) return;
    stopVoice();
    if (musicGain) musicGain.gain.setTargetAtTime(.035, context.currentTime, .08);
    playClips(keys);
  }

  function play(buffer, volume, pan = 0) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const stereo = context.createStereoPanner();
    source.buffer = buffer;
    gain.gain.value = volume;
    stereo.pan.value = pan;
    source.connect(gain).connect(stereo).connect(context.destination);
    source.start();
  }

  function canPlayEffects() {
    return effects.checked && context?.state === "running" && !document.hidden;
  }

  menu.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    menu.setAttribute("aria-expanded", String(!panel.hidden));
  });
  panel.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    panel.hidden = true;
    menu.setAttribute("aria-expanded", "false");
    menu.focus();
  });
  panel.addEventListener("change", async event => {
    if (!voice.checked) stopVoice();
    if ((effects.checked || musicToggle.checked || voice.checked) && window.AudioContext) {
      context ||= new AudioContext();
      await context.resume().catch(() => {});
    }
    setMusic();
    if (event.target !== voice || !voice.checked || !context) return;
    if (!voicePack) node("auction-voice-status").textContent = "Loading auctioneer voice…";
    await loadVoice();
    if (voice.checked && voicePack) {
      node("auction-voice-status").textContent = "Built-in auctioneer voice ready";
      call("Auctioneer ready.");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopVoice();
    setMusic();
  });
  window.addEventListener("pagehide", () => {
    stopVoice();
    live = false;
    setMusic();
  });

  return {
    live(value) { live = value; setMusic(); },
    stopVoice,
    call,
    bid(team, amount, ownTable, side) {
      if (canPlayEffects()) {
        knocks ||= [wood(430, 65), wood(500, 77), wood(560, 81)];
        play(knocks[Math.floor(Math.random() * knocks.length)], ownTable ? .28 : .14, side);
      }
      const crore = Math.floor(amount / 100);
      const lakh = amount % 100;
      const keys = [team];
      if (crore) keys.push(String(crore), "crore");
      if (lakh) keys.push(String(lakh), "lakh");
      call(team, keys);
    },
    sold() {
      if (canPlayEffects()) {
        gavel ||= wood(170, 23);
        play(gavel, .65);
      }
      call("Sold!");
    },
  };
}

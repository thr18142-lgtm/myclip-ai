/*
 * MyClip AI: studio.
 *
 * Loads a file into a preview, takes typed commands, shows each plan before
 * it is applied, and keeps applied changes in a list that can be undone.
 * The original file is never modified: every change lives in the edit state.
 */
(function () {
  "use strict";

  var E = window.MyClipEdits;
  var PLACEHOLDER_LENGTH = 30;
  var IMAGE_LENGTH = 10;
  var SUGGESTIONS = [
    "Cut the first 5 seconds",
    "Add captions",
    "Make it 9:16",
    "Speed up 1.5x",
    "Remove the audio",
    "Fade out 2 seconds"
  ];

  var state = {
    media: null,      // { file, url, kind: "video" | "audio" | "image" }
    el: null,         // the playing element (video or audio), if any
    length: 0,        // real duration once known
    time: 0,
    playing: false,
    messages: [],     // { id, role, text, plan, state }
    applied: [],      // operations applied to the preview, in order
    view: "edit"
  };
  var nextMessageId = 1;
  var links = [];

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var els = {
    tabEdit: $("tab-edit"),
    tabSources: $("tab-sources"),
    viewEdit: $("view-edit"),
    viewSources: $("view-sources"),
    status: $("file-status"),
    input: $("file-input"),
    messages: $("messages"),
    suggestions: $("suggestions"),
    composer: $("composer"),
    command: $("command"),
    stage: $("stage-area"),
    play: $("play"),
    timecode: $("timecode"),
    kept: $("kept"),
    timeline: $("timeline"),
    appliedText: $("applied-text"),
    undo: $("undo"),
    replace: $("replace"),
    linkForm: $("link-form"),
    linkInput: $("link-input"),
    linkError: $("link-error"),
    linkList: $("link-list")
  };

  function length() {
    return state.length > 0 ? state.length : PLACEHOLDER_LENGTH;
  }

  function currentEdit() {
    return E.derive(state.applied, length());
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // ---------- Views ----------

  function setView(view) {
    state.view = view;
    var editing = view === "edit";
    els.viewEdit.hidden = !editing;
    els.viewSources.hidden = editing;
    els.tabEdit.setAttribute("aria-pressed", String(editing));
    els.tabSources.setAttribute("aria-pressed", String(!editing));
  }

  // ---------- Files and stage ----------

  function kindOf(file) {
    if (file.type.indexOf("video/") === 0) return "video";
    if (file.type.indexOf("audio/") === 0) return "audio";
    if (file.type.indexOf("image/") === 0) return "image";
    return null;
  }

  function loadFile(file) {
    var kind = kindOf(file);
    if (!kind) {
      addMessage("assistant", "That file type isn't supported. Use a video, an audio file or an image.");
      return;
    }
    if (state.media) URL.revokeObjectURL(state.media.url);
    state.media = { file: file, url: URL.createObjectURL(file), kind: kind };
    state.el = null;
    state.length = kind === "image" ? IMAGE_LENGTH : 0;
    state.time = 0;
    state.playing = false;
    state.applied = [];
    addMessage("assistant", "Loaded " + file.name + ". Tell me what to change.");
    renderStage();
    refresh();
  }

  function buildDropzone() {
    var zone = el("div", "dropzone");
    zone.appendChild(el("p", null, "Drop a video, audio file or image here."));
    var choose = el("button", "button button-primary", "Choose a file");
    choose.type = "button";
    choose.addEventListener("click", function () { els.input.click(); });
    zone.appendChild(choose);

    zone.addEventListener("dragover", function (e) {
      e.preventDefault();
      zone.classList.add("over");
    });
    zone.addEventListener("dragleave", function () {
      zone.classList.remove("over");
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      zone.classList.remove("over");
      var file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
    return zone;
  }

  function renderStage() {
    els.stage.innerHTML = "";
    state.el = null;

    if (!state.media) {
      els.stage.appendChild(buildDropzone());
      els.status.textContent = "No file loaded";
      els.replace.hidden = true;
      return;
    }

    els.status.textContent = state.media.file.name;
    els.replace.hidden = false;

    var kind = state.media.kind;
    var box = el("div", "stage");
    box.id = "stage";
    var media;

    if (kind === "image") {
      media = el("img");
      media.alt = state.media.file.name;
      media.src = state.media.url;
    } else {
      media = el(kind === "video" ? "video" : "audio");
      media.src = state.media.url;
      media.preload = "metadata";
      media.playsInline = true;
      if (kind === "audio") media.className = "hidden-media";
      state.el = media;

      media.addEventListener("loadedmetadata", function () {
        if (isFinite(media.duration) && media.duration > 0) {
          state.length = media.duration;
        }
        refresh();
      });
      media.addEventListener("timeupdate", onTimeUpdate);
      media.addEventListener("play", function () { state.playing = true; renderTransport(); });
      media.addEventListener("pause", function () { state.playing = false; renderTransport(); });
      media.addEventListener("ended", function () { state.playing = false; renderTransport(); });
    }

    box.appendChild(media);

    if (kind === "audio") {
      var art = el("div", "audio-art");
      for (var i = 0; i < 60; i++) {
        var bar = el("i");
        bar.style.height = barHeight(i) + "%";
        art.appendChild(bar);
      }
      box.appendChild(art);
    }

    box.appendChild(el("div", "fade"));
    var caption = el("div", "caption", "Captions show here");
    caption.id = "caption";
    box.appendChild(caption);

    els.stage.appendChild(box);
  }

  function barHeight(i) {
    return Math.round(25 + Math.abs(Math.sin(i * 0.37)) * 45 + Math.abs(Math.cos(i * 1.3)) * 25);
  }

  // Keeps playback inside the kept range, so the preview shows the cut.
  function onTimeUpdate() {
    var media = state.el;
    if (!media) return;
    var edit = currentEdit();
    if (edit.to > edit.from && media.currentTime >= edit.to) {
      media.currentTime = edit.from;
    } else if (media.currentTime < edit.from - 0.05) {
      media.currentTime = edit.from;
    }
    state.time = media.currentTime;
    renderTransport();
    renderTimeline();
    renderEffects(edit);
  }

  function togglePlay() {
    var media = state.el;
    if (!media) return;
    var edit = currentEdit();
    if (media.paused) {
      if (media.currentTime < edit.from || media.currentTime >= edit.to) {
        media.currentTime = edit.from;
      }
      var played = media.play();
      if (played && played.catch) played.catch(function () {});
    } else {
      media.pause();
    }
  }

  function seek(t) {
    var edit = currentEdit();
    var target = clamp(t, edit.from, edit.to);
    state.time = target;
    if (state.el) state.el.currentTime = target;
    renderTransport();
    renderTimeline();
  }

  // ---------- Rendering ----------

  function renderEffects(edit) {
    var box = $("stage");
    if (!box) return;

    box.classList.toggle("cropped", Boolean(edit.ratio));
    if (edit.ratio) {
      box.style.aspectRatio = edit.ratio.replace(":", " / ");
      box.style.width = edit.ratio === "9:16"
        ? "min(100%, calc(60vh * 9 / 16))"
        : edit.ratio === "1:1" ? "min(100%, 60vh)" : "100%";
    } else {
      box.style.aspectRatio = "";
      box.style.width = "100%";
    }

    var fadeOpacity = 0;
    if (edit.fade > 0 && state.time > edit.to - edit.fade) {
      fadeOpacity = clamp((state.time - (edit.to - edit.fade)) / edit.fade, 0, 1);
    }
    var fade = box.querySelector(".fade");
    if (fade) fade.style.opacity = String(fadeOpacity);

    var caption = $("caption");
    if (caption) caption.hidden = !edit.captions;

    if (state.el) {
      state.el.playbackRate = edit.rate;
      state.el.muted = edit.muted;
    }
  }

  function renderTransport() {
    var edit = currentEdit();
    els.timecode.textContent = E.formatTime(state.time) + " / " + E.formatTime(length());
    els.kept.textContent = state.media
      ? "Kept " + E.formatTime(edit.from) + " to " + E.formatTime(edit.to)
      : "";
    els.play.textContent = state.playing ? "Pause" : "Play";
    els.play.disabled = !state.el;
  }

  function renderTimeline() {
    els.timeline.innerHTML = "";
    if (!state.media) return;

    var len = length();
    var edit = currentEdit();
    var pct = function (t) { return (clamp(t, 0, len) / len * 100) + "%"; };
    var span = function (from, to) { return ((to - from) / len * 100) + "%"; };

    var ruler = el("div", "ruler");
    for (var i = 0; i <= 5; i++) {
      ruler.appendChild(el("span", null, E.formatTime(len * i / 5)));
    }

    var tracks = el("div", "tracks");
    tracks.addEventListener("click", function (e) {
      var rect = tracks.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      seek(clamp(x, 0, 1) * len);
    });

    // Media row: the clip, with the cut areas dimmed.
    var clipRow = el("div", "track");
    var clip = el("div", "track-clip");
    clip.appendChild(el("span", null, state.media.file.name));
    if (edit.rate !== 1) clip.appendChild(el("span", "badge", edit.rate + "x"));
    if (edit.ratio) clip.appendChild(el("span", "badge", edit.ratio));
    clipRow.appendChild(clip);
    if (edit.from > 0) {
      var dimLeft = el("div", "dim");
      dimLeft.style.left = "0";
      dimLeft.style.width = pct(edit.from);
      clipRow.appendChild(dimLeft);
    }
    if (edit.to < len) {
      var dimRight = el("div", "dim");
      dimRight.style.left = pct(edit.to);
      dimRight.style.right = "0";
      clipRow.appendChild(dimRight);
    }
    tracks.appendChild(clipRow);

    // Captions row.
    if (edit.captions) {
      var capsRow = el("div", "track");
      var caps = el("div", "track-caps", "Captions");
      caps.style.left = pct(edit.from);
      caps.style.width = span(edit.from, edit.to);
      capsRow.appendChild(caps);
      tracks.appendChild(capsRow);
    }

    // Sound row, when the media has sound.
    if (state.media.kind !== "image") {
      var soundRow = el("div", "track");
      if (edit.muted) {
        soundRow.appendChild(el("span", "track-note", "Muted"));
      } else {
        var sound = el("div", "track-sound");
        sound.style.left = pct(edit.from);
        sound.style.width = span(edit.from, edit.to);
        for (var b = 0; b < 60; b++) {
          var bar = el("i");
          bar.style.height = barHeight(b) + "%";
          sound.appendChild(bar);
        }
        soundRow.appendChild(sound);
      }
      tracks.appendChild(soundRow);
    }

    var playhead = el("div", "playhead");
    playhead.style.left = pct(state.time);
    tracks.appendChild(playhead);

    els.timeline.appendChild(ruler);
    els.timeline.appendChild(tracks);
  }

  function renderApplied() {
    els.undo.disabled = state.applied.length === 0;
    if (!state.media) {
      els.appliedText.textContent = "Nothing applied yet.";
    } else if (state.applied.length === 0) {
      els.appliedText.textContent = "No changes applied. Your original file is untouched.";
    } else {
      els.appliedText.textContent = "Applied: " + state.applied.map(function (op) { return op.label; }).join(", ");
    }
  }

  function renderMessages() {
    var host = els.messages;
    host.innerHTML = "";

    if (state.messages.length === 0) {
      host.appendChild(el("p", "muted", "Load a file, then type what you want changed."));
    }

    state.messages.forEach(function (m) {
      var wrap = el("div", "message " + m.role);
      wrap.appendChild(el("p", null, m.text));

      if (m.plan) {
        var plan = el("div", "plan");
        var list = el("ul");
        m.plan.forEach(function (op) { list.appendChild(el("li", null, op.label)); });
        plan.appendChild(list);

        if (m.state === "pending") {
          var actions = el("div", "plan-actions");
          var apply = el("button", "button button-primary", "Apply plan");
          apply.type = "button";
          apply.addEventListener("click", function () { decide(m.id, "applied"); });
          var discard = el("button", "button button-quiet", "Discard");
          discard.type = "button";
          discard.addEventListener("click", function () { decide(m.id, "discarded"); });
          actions.appendChild(apply);
          actions.appendChild(discard);
          plan.appendChild(actions);
        } else {
          plan.appendChild(el("p", "muted", m.state === "applied" ? "Applied to the preview." : "Discarded."));
        }
        wrap.appendChild(plan);
      }
      host.appendChild(wrap);
    });

    host.scrollTop = host.scrollHeight;
  }

  function renderSuggestions() {
    els.suggestions.innerHTML = "";
    SUGGESTIONS.forEach(function (text) {
      var chip = el("button", "chip", text);
      chip.type = "button";
      chip.addEventListener("click", function () {
        els.command.value = text;
        els.command.focus();
      });
      els.suggestions.appendChild(chip);
    });
  }

  function renderLinks() {
    els.linkList.innerHTML = "";
    links.forEach(function (href) {
      var item = el("li");
      var label = el("span", null, href);
      label.style.overflowWrap = "anywhere";
      item.appendChild(label);
      item.appendChild(el("span", "pill", "Saved here. Reading it needs server setup."));
      els.linkList.appendChild(item);
    });
  }

  function refresh() {
    var edit = currentEdit();
    renderTransport();
    renderTimeline();
    renderEffects(edit);
    renderApplied();
  }

  // ---------- Messages and plans ----------

  function addMessage(role, text, plan, msgState) {
    state.messages.push({
      id: nextMessageId++,
      role: role,
      text: text,
      plan: plan || null,
      state: msgState || null
    });
    renderMessages();
  }

  function send(raw) {
    var text = raw.trim();
    if (!text) return;
    addMessage("user", text);
    els.command.value = "";

    if (!state.media) {
      addMessage("assistant", "Drop a file first, then tell me what to change.");
      return;
    }

    var result = E.parseCommand(text);
    if (result.ops.length) {
      addMessage("assistant", result.reply, result.ops, "pending");
    } else {
      addMessage("assistant", result.reply);
    }
  }

  function decide(id, outcome) {
    var target = state.messages.filter(function (m) { return m.id === id; })[0];
    if (!target || target.state !== "pending") return;
    target.state = outcome;
    if (outcome === "applied") {
      state.applied = state.applied.concat(target.plan);
    }
    renderMessages();
    refresh();
  }

  function undoLast() {
    if (state.applied.length === 0) return;
    var last = state.applied[state.applied.length - 1];
    state.applied = state.applied.slice(0, -1);
    addMessage("assistant", "Undid: " + last.label + ".");
    refresh();
  }

  // ---------- Wiring ----------

  els.tabEdit.addEventListener("click", function () { setView("edit"); });
  els.tabSources.addEventListener("click", function () { setView("sources"); });

  els.input.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) loadFile(file);
    e.target.value = "";
  });
  els.replace.addEventListener("click", function () { els.input.click(); });

  els.play.addEventListener("click", togglePlay);
  els.undo.addEventListener("click", undoLast);

  els.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    send(els.command.value);
  });
  els.command.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(els.command.value);
    }
  });

  els.linkForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = els.linkInput.value.trim();
    if (!raw) {
      els.linkError.textContent = "Paste a link first.";
      return;
    }
    try {
      var url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
      if (url.hostname.indexOf(".") === -1) throw new Error("no host");
      links.push(url.href);
      els.linkInput.value = "";
      els.linkError.textContent = "";
      renderLinks();
    } catch (err) {
      els.linkError.textContent = "That doesn't look like a web address.";
    }
  });

  // ---------- Start ----------

  renderSuggestions();
  renderMessages();
  renderStage();
  refresh();
  setView(window.location.hash === "#sources" ? "sources" : "edit");
})();

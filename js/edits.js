/*
 * MyClip AI: edit model.
 *
 * Turns a typed sentence into a list of edit operations, and derives the
 * current edit from the operations that have been applied so far.
 *
 * parseCommand() is a local stand-in for the AI step. The live version will
 * send the sentence to Claude and get the same kind of operations back.
 */
(function (root) {
  "use strict";

  var counter = 0;

  function newId() {
    counter += 1;
    return "op-" + counter;
  }

  function parseCommand(input) {
    var text = String(input || "").toLowerCase();
    var ops = [];
    var m;

    m = text.match(/(?:cut|trim|remove)\s+(?:the\s+)?first\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?/);
    if (m) {
      ops.push({ id: newId(), kind: "trimFirst", seconds: Number(m[1]), label: "Cut first " + m[1] + " s" });
    }

    m = text.match(/(?:cut|trim|remove)\s+(?:the\s+)?last\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?/);
    if (m) {
      ops.push({ id: newId(), kind: "trimLast", seconds: Number(m[1]), label: "Cut last " + m[1] + " s" });
    }

    if (/caption|subtitle/.test(text)) {
      ops.push({ id: newId(), kind: "captions", label: "Add captions" });
    }

    var ratio = null;
    if (/9:16|vertical|tiktok|reels|shorts/.test(text)) ratio = "9:16";
    else if (/1:1|square/.test(text)) ratio = "1:1";
    else if (/16:9|landscape/.test(text)) ratio = "16:9";
    if (ratio) {
      ops.push({ id: newId(), kind: "reframe", ratio: ratio, label: "Reframe to " + ratio });
    }

    m = text.match(/(\d+(?:\.\d+)?)\s*x\b/);
    if (m) {
      ops.push({ id: newId(), kind: "speed", rate: Number(m[1]), label: "Speed " + m[1] + "x" });
    } else if (/speed up|faster/.test(text)) {
      ops.push({ id: newId(), kind: "speed", rate: 1.5, label: "Speed 1.5x" });
    } else if (/slow/.test(text)) {
      ops.push({ id: newId(), kind: "speed", rate: 0.75, label: "Slow to 0.75x" });
    }

    if (/mute|no audio|remove (?:the )?audio|silent/.test(text)) {
      ops.push({ id: newId(), kind: "mute", label: "Mute audio" });
    }

    m = text.match(/fade(?: out)?(?:\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*s)?/);
    if (m) {
      var secs = m[1] ? Number(m[1]) : 1;
      ops.push({ id: newId(), kind: "fade", seconds: secs, label: "Fade out " + secs + " s" });
    }

    if (ops.length === 0) {
      return {
        ops: [],
        reply: "I can't turn that into an edit yet. Try 'cut the first 5 seconds', 'add captions', 'make it 9:16', or 'speed up 1.5x'."
      };
    }
    return { ops: ops, reply: "Here's the plan. Check the preview, then apply it or discard it." };
  }

  // Applies operations in order to a clip of the given length.
  function derive(ops, length) {
    var e = { from: 0, to: length, captions: false, ratio: null, rate: 1, muted: false, fade: 0 };
    ops.forEach(function (op) {
      switch (op.kind) {
        case "trimFirst": e.from = Math.min(e.to, e.from + op.seconds); break;
        case "trimLast": e.to = Math.max(e.from, e.to - op.seconds); break;
        case "captions": e.captions = true; break;
        case "reframe": e.ratio = op.ratio; break;
        case "speed": e.rate = op.rate; break;
        case "mute": e.muted = true; break;
        case "fade": e.fade = op.seconds; break;
        default: break;
      }
    });
    return e;
  }

  function formatTime(t) {
    var s = Math.max(0, Number(t) || 0);
    var m = Math.floor(s / 60);
    var rest = s - m * 60;
    return String(m).padStart(2, "0") + ":" + rest.toFixed(2).padStart(5, "0");
  }

  var api = { parseCommand: parseCommand, derive: derive, formatTime: formatTime };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.MyClipEdits = api;
})(typeof window !== "undefined" ? window : globalThis);

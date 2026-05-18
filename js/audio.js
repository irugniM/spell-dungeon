/**
 * Spell Dungeon — Web Audio SFX (oscillator beeps, no asset files).
 */
(function (global) {
    "use strict";

    var MUTE_KEY = "spelldungeon-muted";
    var LEGACY_MUTE_KEY = "spellDungeonMuted";
    var ctx = null;
    var muted = false;

    function loadMute() {
        try {
            if (global.localStorage.getItem(MUTE_KEY) === "1") {
                muted = true;
                return;
            }
            if (global.localStorage.getItem(LEGACY_MUTE_KEY) === "1") {
                muted = true;
                global.localStorage.setItem(MUTE_KEY, "1");
                return;
            }
            muted = false;
        } catch (_e) { /* ignore */ }
    }

    function ensureCtx() {
        if (!ctx) {
            var AC = global.AudioContext || global.webkitAudioContext;
            if (AC) ctx = new AC();
        }
        if (ctx && ctx.state === "suspended" && ctx.resume) ctx.resume();
        return ctx;
    }

    function tone(freq, dur, type, vol, freqEnd) {
        if (muted) return;
        var ac = ensureCtx();
        if (!ac) return;
        try {
            var t0 = ac.currentTime;
            var osc = ac.createOscillator();
            var gain = ac.createGain();
            osc.type = type || "square";
            osc.frequency.setValueAtTime(freq, t0);
            if (freqEnd) {
                osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
            }
            gain.gain.setValueAtTime(vol || 0.07, t0);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(t0);
            osc.stop(t0 + dur + 0.02);
        } catch (_e) { /* ignore */ }
    }

    var catalog = {
        shoot: function () { tone(880, 0.06, "square", 0.06, 440); },
        hit: function () { tone(220, 0.05, "sawtooth", 0.07); },
        crit: function () { tone(990, 0.05, "square", 0.08, 1320); },
        kill: function () {
            tone(440, 0.07, "square", 0.07, 660);
            tone(660, 0.1, "square", 0.06, 880);
        },
        door: function () { tone(330, 0.12, "triangle", 0.08, 520); },
        pickup: function () { tone(660, 0.07, "sine", 0.07, 990); },
        heal: function () { tone(440, 0.12, "sine", 0.06, 660); },
        hurt: function () { tone(120, 0.14, "sawtooth", 0.09, 70); },
        dash: function () { tone(200, 0.08, "sine", 0.05, 420); },
        parry: function () { tone(520, 0.07, "triangle", 0.08, 880); },
        heartbeat: function () { tone(72, 0.1, "sine", 0.045, 58); },
        roomClear: function () {
            tone(440, 0.08, "triangle", 0.07);
            tone(554, 0.12, "triangle", 0.08, 660);
        },
        level: function () {
            tone(523, 0.09, "square", 0.07);
            tone(659, 0.09, "square", 0.07);
            tone(784, 0.14, "square", 0.08);
        },
        levelup: function () {
            tone(523, 0.09, "square", 0.07);
            tone(659, 0.09, "square", 0.07);
            tone(784, 0.14, "square", 0.08);
        },
        levelClear: function () {
            tone(523, 0.09, "square", 0.07);
            tone(659, 0.09, "square", 0.07);
            tone(784, 0.14, "square", 0.08);
        },
        bossIntro: function () {
            tone(165, 0.2, "sawtooth", 0.08, 110);
            tone(110, 0.25, "sawtooth", 0.06, 82);
        },
    };

    function syncMuteButton() {
        ["hud-sound-btn", "btn-mute"].forEach(function (id) {
            var btn = global.document.getElementById(id);
            if (!btn) return;
            btn.textContent = muted ? "MUTE" : "SND";
            btn.classList.toggle("is-muted", muted);
            btn.classList.toggle("muted", muted);
            btn.setAttribute("aria-pressed", muted ? "true" : "false");
            btn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
        });
    }

    function initAudio() {
        loadMute();
        syncMuteButton();
    }

    function playSfx(name) {
        if (catalog[name]) catalog[name]();
    }

    function toggleMute() {
        muted = !muted;
        try {
            global.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
        } catch (_e) { /* ignore */ }
        syncMuteButton();
        return muted;
    }

    function isMuted() {
        return muted;
    }

    function wireMuteButton() {
        ["hud-sound-btn", "btn-mute"].forEach(function (id) {
            var btn = global.document.getElementById(id);
            if (!btn || btn._spellDungeonWired) return;
            btn._spellDungeonWired = true;
            btn.style.pointerEvents = "auto";
            btn.addEventListener("click", function () {
                var nowMuted = toggleMute();
                if (!nowMuted) playSfx("pickup");
            });
        });
    }

    global.SpellDungeonAudio = {
        initAudio: initAudio,
        playSfx: playSfx,
        toggleMute: toggleMute,
        isMuted: isMuted,
        wireMuteButton: wireMuteButton,
        syncMuteButton: syncMuteButton,
    };
})(window);

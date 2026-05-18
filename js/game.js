/**
 * Spell Dungeon — gameplay module.
 *
 * The original Java game ran every screen through libGDX. In the web port
 * the gameplay layer is exposed as `Game.start(slotUsername, role)` which
 * is invoked from the screen router after the player picks a save slot.
 *
 * Feature parity with the original GameplayScreen:
 *   - Full top-down arena (3 rooms, corridors, doors, treasures).
 *   - Spell-casting minigame (Enter): type the sentence within the tier
 *     timer without errors to load a fireball into the hotbar.
 *   - 12-slot inventory window (Tab) with click + confirm-to-use; potions
 *     grant 90 s buffs.
 *   - Save state persists per slot; advancing a level autosaves.
 *   - Statistics (WPM, accuracy, errors, time) are accumulated per cast.
 *   - Personal-best leaderboard is keyed off the base username (so all
 *     four save slots share a single best for the account).
 */
(function (global) {
    "use strict";

    /* ============================================================ *
     *  Constants
     * ============================================================ */
    var VIEW_W = 1280;
    var VIEW_H = 800;
    var TILE = 32;

    // Corridor narrow dimension used for both H and V corridors
    var CORR_NARROW = 4 * TILE;

    var PLAYER_SPEED = 230;
    var PLAYER_RADIUS = 14;
    var PLAYER_MAX_HP = 100;
    var PLAYER_MAX_MP = 60;
    var FIREBALL_SPEED = 520;
    var FIREBALL_COST = 10;
    var FIREBALL_DMG = 70;
    var FIREBALL_DMG_BOOSTED = 110;
    var FIREBALL_RADIUS = 7;
    var SHOOT_COOLDOWN = 0.18;
    var DAMAGE_COOLDOWN = 1.0;
    var ENEMY_DAMAGE = 15;
    var MP_REGEN = 9;
    var BOSS_HP_MULT = 1.5;
    var SCORE_KILL = 100;
    var SCORE_BOSS = 300;
    var ELITE_SPAWN_CHANCE = 0.2;
    var ELITE_HP_MULT = 2;
    var ELITE_SCORE_MULT = 1.5;
    var CHAMPION_SPAWN_CHANCE = 0.18;
    var CHAMPION_HP_MULT = 3;
    var RAMPAGE_COMBO = 10;
    var RAMPAGE_DURATION = 2;
    var RAMPAGE_DMG_MULT = 1.5;
    var SHRINE_STRENGTH_TIME = 15;
    var SHRINE_HEAL = 30;
    var SCORE_ELITE_MULT = ELITE_SCORE_MULT;
    var SHRINE_ROOM_CHANCE = 0.3;
    var ARCHETYPE_NAMES = {
        grunt: "Slime",
        fast: "Swift",
        tank: "Brute",
        ranged: "Mage",
        archer: "Archer",
    };
    var POTION_HEAL = 30;
    var BUFF_DURATION = 90;
    var LEVEL3_BASE_TIME = 60;

    var DASH_DURATION = 0.2;
    var DASH_COOLDOWN = 1.2;
    var DASH_IFRAMES = 0.35;
    var DASH_SPEED_MULT = 2.5;
    var ENEMY_SHOOT_INTERVAL = 2;
    var CRIT_CHANCE = 0.15;
    var CRIT_MULT = 1.65;
    var PARRY_DASH_WINDOW = 0.2;
    var TRAP_DAMAGE = 8;
    var TRAP_COOLDOWN = 0.85;
    var BURN_TICK_COUNT = 3;
    var BURN_TICK_DMG = 9;
    var BURN_TICK_INTERVAL = 0.55;
    var SECRET_SCORE_BONUS = 500;
    var SECRET_ROOM_CHANCE = 0.05;
    var ENEMY_TELEGRAPH = 0.42;
    var SPELL_WPM_GOAL = 80;
    var SPELL_SUCCESS_SCORE = 50;
    var HINT_FADE_SEC = 60;
    var START_TUTORIAL_KEY = "spelldungeon-start-tutorial-dismissed";
    var GROUND_PICKUP_REACH = 68;
    function playSfx(name) {
        var audio = global.SpellDungeonAudio;
        if (!audio || !audio.playSfx) return;
        var alias = { damage: "hurt", levelClear: "levelup" };
        audio.playSfx(alias[name] || name);
    }

    function syncSoundButton() {
        if (global.SpellDungeonAudio && global.SpellDungeonAudio.syncMuteButton) {
            global.SpellDungeonAudio.syncMuteButton();
        }
    }

    function initGameAudio() {
        if (global.SpellDungeonAudio) {
            global.SpellDungeonAudio.initAudio();
            global.SpellDungeonAudio.wireMuteButton();
        }
    }

    var Sfx = {
        init: initGameAudio,
        play: playSfx,
        isMuted: function () {
            return global.SpellDungeonAudio ? global.SpellDungeonAudio.isMuted() : false;
        },
        toggleMute: function () {
            if (global.SpellDungeonAudio) global.SpellDungeonAudio.toggleMute();
        },
    };

    var POTION_TOOLTIPS = {
        Health: "Restores 30 HP instantly (only if below max).",
        Strength: "90s buff — charged fireballs deal extra damage.",
        Invincibility: "90s buff — ignore contact and projectile damage.",
    };

    function drawDamageIndicator(ctx, state) {
        var p = state.player;
        if (!p) return;
        if (p.hurtFlash > 0) {
            var ha = clamp(p.hurtFlash / 0.1, 0, 1) * 0.35;
            ctx.fillStyle = "rgba(255, 93, 108, " + ha + ")";
            ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        }
        var ind = state.damageIndicator;
        if (!ind || ind.life <= 0) return;
        var angle = ind.angle;
        var alpha = clamp(ind.life / 1.15, 0, 1) * 0.88;
        var cx = VIEW_W * 0.5;
        var cy = VIEW_H * 0.5;
        var ex = cx + Math.cos(angle) * (VIEW_W * 0.47);
        var ey = cy + Math.sin(angle) * (VIEW_H * 0.47);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#ff3d55";
        ctx.shadowColor = "#ff2244";
        ctx.shadowBlur = 18;
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(ex, ey, 32, angle + Math.PI * 0.52, angle + Math.PI * 1.48);
        ctx.stroke();
        ctx.restore();
    }

    function enemyDisplayName(e) {
        var name = ARCHETYPE_NAMES[e.archetype] || "Foe";
        if (e.isChampion) return "Champion " + name;
        return e.isElite ? name + "★" : name;
    }

    function getDailySeed(username) {
        var d = new Date();
        var day = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
        var h = 0;
        var s = day + "|" + (username || "");
        for (var i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h |= 0;
        }
        return ("00000000" + Math.abs(h).toString(36).toUpperCase()).slice(-8);
    }

    var ACH_STORAGE_KEY = "spelldungeon-achievements";
    var SPELL_STREAK_BUFF_TIME = 8;
    var SPELL_STREAK_DMG_MULT = 1.35;
    var RANGED_HOLD_RANGE = 150;
    var RANGED_SHOOT_RANGE = 260;
    var ENEMY_SHOT_SPEED = 210;
    var ENEMY_SHOT_DMG = 12;
    var ENEMY_AGGRO_RANGE = 420;

    var INVENTORY_SIZE = 12;
    var QUICK_POTION_TYPES = ["Health", "Strength", "Invincibility"];
    var QUICK_POTION_GLYPHS = { Health: "♥", Strength: "⚔", Invincibility: "★" };
    var HOTBAR_SIZE = 6;

    // startIndex / bossIndex are now stored on the map object (dynamic per level)

    var STATE_PLAYING = "playing";
    var STATE_PAUSED = "paused";
    var STATE_GAMEOVER = "gameover";
    var STATE_SPELLCAST = "spellcast";
    var STATE_INVENTORY = "inventory";
    var STATE_START_TUTORIAL = "start-tutorial";

    /* ============================================================ *
     *  Helpers
     * ============================================================ */
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
    function pointInRect(px, py, rx, ry, rw, rh) { return px >= rx && py >= ry && px <= rx + rw && py <= ry + rh; }

    /** True if a circle overlaps the interior of an axis-aligned rectangle (shared edges OK). */
    function circleIntersectsAxisRect(cx, cy, cr, rx, ry, rw, rh) {
        var nx = clamp(cx, rx, rx + rw);
        var ny = clamp(cy, ry, ry + rh);
        return dist(cx, cy, nx, ny) < cr;
    }
    function el(id) { return document.getElementById(id); }
    function show(node) { if (node) node.hidden = false; }
    function hide(node) { if (node) node.hidden = true; }
    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function escapeHtml(text) {
        return String(text || "").replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function initExploration(state) {
        state.visitedRooms = {};
        state.revealedRooms = {};
        state.currentRoomIndex = -1;
        state.floatTexts = [];
        state.particles = [];
    }

    function markRoomRevealed(state, roomIndex) {
        if (roomIndex >= 0) state.revealedRooms[roomIndex] = true;
    }

    function trackPlayerRoom(state) {
        if (!state.map) return;
        var rm = roomContaining(state.map, state.player.x, state.player.y);
        if (!rm) return;
        if (state.currentRoomIndex !== rm.index) {
            state.currentRoomIndex = rm.index;
            state.visitedRooms[rm.index] = true;
            state.revealedRooms[rm.index] = true;
            checkExplorerAchievement(state);
            checkBossRoomIntro(state);
        }
    }

    function addFloatText(state, x, y, text, color, opts) {
        opts = opts || {};
        state.floatTexts.push({
            x: x, y: y, text: String(text), color: color || "#fff",
            vy: opts.vy != null ? opts.vy : -72,
            life: opts.life != null ? opts.life : 0.85,
            maxLife: opts.life != null ? opts.life : 0.85,
            scale: opts.scale || 1,
        });
    }

    function spawnDeathParticles(state, x, y, isBoss) {
        var count = 6 + Math.floor(Math.random() * 3);
        var baseColor = isBoss ? "#ff5d6c" : "#ff8a3d";
        for (var i = 0; i < count; i++) {
            var ang = Math.random() * Math.PI * 2;
            var spd = rand(60, isBoss ? 200 : 150);
            state.particles.push({
                x: x, y: y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd,
                life: rand(0.35, 0.65),
                maxLife: 0.65,
                size: rand(2, isBoss ? 5 : 4),
                color: baseColor
            });
        }
    }

    function updateParticles(state, dt) {
        for (var i = state.particles.length - 1; i >= 0; i--) {
            var pt = state.particles[i];
            pt.life -= dt;
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vy += 120 * dt;
            if (pt.life <= 0) state.particles.splice(i, 1);
        }
    }

    function drawParticles(ctx, state) {
        for (var i = 0; i < state.particles.length; i++) {
            var pt = state.particles[i];
            var alpha = clamp(pt.life / pt.maxLife, 0, 1);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function triggerSpellSuccessFlash(state) {
        var wrap = el("canvas-wrap");
        if (!wrap) return;
        wrap.classList.add("spell-success-flash");
        clearTimeout(state._spellFlashTimer);
        state._spellFlashTimer = setTimeout(function () {
            wrap.classList.remove("spell-success-flash");
        }, 400);
    }

    var ACH_LABELS = {
        first_kill: "First blood!",
        combo5: "On fire!",
        combo10: "Unstoppable!",
        explorer: "Fully explored!",
        boss_slayer: "Boss slain!",
        spell_streak: "Arcane rhythm",
    };

    function loadAchievementIds() {
        try {
            var raw = localStorage.getItem(ACH_STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (_e) { return []; }
    }

    function saveAchievementIds(ids) {
        try { localStorage.setItem(ACH_STORAGE_KEY, JSON.stringify(ids)); } catch (_e) { /* ignore */ }
    }

    function unlockAchievement(id) {
        if (!ACH_LABELS[id]) return false;
        var ids = loadAchievementIds();
        if (ids.indexOf(id) >= 0) return false;
        ids.push(id);
        saveAchievementIds(ids);
        return true;
    }

    function getUnlockedAchievements() {
        var ids = loadAchievementIds();
        return ids.map(function (id) {
            return { id: id, label: ACH_LABELS[id] || id };
        });
    }

    function checkKillAchievements(state, isBoss) {
        if (isBoss) {
            showToast(state, "Boss slain!", 1500);
            unlockAchievement("boss_slayer");
            return;
        }
        if (!state.achFirstKill) {
            state.achFirstKill = true;
            showToast(state, "First blood!", 1600);
            unlockAchievement("first_kill");
        }
        if (state.comboCount >= 5 && !state.achCombo5) {
            state.achCombo5 = true;
            showToast(state, "On fire!", 1600);
            unlockAchievement("combo5");
        }
    }

    function getRoomProgress(state) {
        if (!state.map) return { cleared: 0, total: 0 };
        var cleared = 0, total = 0;
        for (var i = 0; i < state.map.rooms.length; i++) {
            if (i === state.map.startIndex) continue;
            total++;
            if (state.map.rooms[i].cleared) cleared++;
        }
        return { cleared: cleared, total: total };
    }

    function checkExplorerAchievement(state) {
        if (!state.map || state.achExplorer) return;
        for (var i = 0; i < state.map.rooms.length; i++) {
            if (i === state.map.startIndex) continue;
            if (!state.visitedRooms[i]) return;
        }
        state.achExplorer = true;
        showToast(state, "Fully explored!", 1800);
        unlockAchievement("explorer");
    }

    function tryParry(state, fromX, fromY) {
        var p = state.player;
        if (p.dashIFrameTimer <= 0 || p.parryUsed) return false;
        p.parryUsed = true;
        showToast(state, "Parried!", 1200);
        addFloatText(state, p.x, p.y - 26, "Parried!", "#6ec1ff", { scale: 1.15, vy: -55 });
        p.damageCooldown = 0.35;
        playSfx("parry");
        return true;
    }

    function applyPlayerDamage(state, amount, fromX, fromY) {
        var p = state.player;
        if (tryParry(state, fromX, fromY)) return false;
        if (playerIsInvulnerable(p) || p.damageCooldown > 0) return false;
        p.hp = Math.max(0, p.hp - amount);
        p.damageCooldown = DAMAGE_COOLDOWN;
        p.hurtFlash = 0.1;
        state.shake = 0.6;
        state.minimapHitFlash = 0.4;
        if (fromX != null && fromY != null) {
            state.damageIndicator = {
                angle: Math.atan2(fromY - p.y, fromX - p.x),
                life: 1.15,
            };
        }
        addFloatText(state, p.x, p.y - 20, "-" + amount, "#ff5d6c");
        playSfx("hurt");
        if (p.hp <= 0) gameOver(state);
        return true;
    }

    function pickEnemyArchetype() {
        var r = Math.random();
        if (r < 0.32) return "grunt";
        if (r < 0.54) return "fast";
        if (r < 0.74) return "tank";
        if (r < 0.88) return "archer";
        return "ranged";
    }

    function archetypeStats(arch, baseHp, baseSpeed) {
        if (arch === "fast") return { hp: Math.round(baseHp * 0.55), speed: baseSpeed * 1.55, radius: 14 };
        if (arch === "tank") return { hp: Math.round(baseHp * 1.85), speed: baseSpeed * 0.62, radius: 20 };
        if (arch === "archer") return { hp: Math.round(baseHp * 0.78), speed: baseSpeed * 0.72, radius: 15 };
        if (arch === "ranged") return { hp: Math.round(baseHp * 0.82), speed: baseSpeed * 0.78, radius: 15 };
        return { hp: baseHp, speed: baseSpeed, radius: 16 };
    }

    function enemyShoots(arch) {
        return arch === "ranged" || arch === "archer";
    }

    function computeSpellGrade(wpm, acc, state) {
        return global.SentenceBank.computeSpellGrade(wpm, acc, getTypingTierId(state));
    }

    function getTypingTierId(state) {
        if (state && state.typingTier && global.SentenceBank.TIERS[state.typingTier]) {
            return state.typingTier;
        }
        return global.SentenceBank.getStoredTierId();
    }

    function getTypingScoreMult(state) {
        return global.SentenceBank.getScoreMultiplier(getTypingTierId(state));
    }

    function applyTypingScore(state, base) {
        return Math.max(0, Math.round(base * getTypingScoreMult(state)));
    }

    function formatTypingMult(mult) {
        return mult % 1 === 0 ? String(mult) : mult.toFixed(2).replace(/\.?0+$/, "");
    }

    function levelHpMultiplier(level) {
        var mult = Math.pow(1.18, Math.max(0, level - 1));
        if (level > 3) mult *= Math.pow(1.10, level - 3);
        return mult;
    }

    function generateRoomTraps(room) {
        var traps = [];
        if (Math.random() > 0.32) return traps;
        var count = 2 + Math.floor(Math.random() * 3);
        for (var i = 0; i < count; i++) {
            traps.push({
                x: rand(room.x + 48, room.x + room.w - 80),
                y: rand(room.y + 48, room.y + room.h - 80),
                w: rand(36, 56),
                h: rand(28, 44),
                roomIndex: room.index,
            });
        }
        return traps;
    }

    function spawnChestParticles(state, x, y, color) {
        for (var i = 0; i < 10; i++) {
            var ang = Math.random() * Math.PI * 2;
            var spd = rand(40, 130);
            state.particles.push({
                x: x, y: y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - 40,
                life: rand(0.25, 0.5),
                maxLife: 0.5,
                size: rand(2, 5),
                color: color || "#ffd166",
            });
        }
    }

    function floorThemeTint(level) {
        var tints = [
            "rgba(70, 110, 200, 0.05)",
            "rgba(120, 70, 180, 0.06)",
            "rgba(200, 80, 90, 0.07)",
            "rgba(60, 180, 140, 0.06)",
        ];
        return tints[(Math.max(1, level) - 1) % tints.length];
    }

    function updateFloatTexts(state, dt) {
        for (var i = state.floatTexts.length - 1; i >= 0; i--) {
            var ft = state.floatTexts[i];
            ft.life -= dt;
            ft.y += ft.vy * dt;
            if (ft.life <= 0) state.floatTexts.splice(i, 1);
        }
    }

    function roomRevealMessage(type) {
        if (type === "boss") return "Boss chamber!";
        if (type === "potions") return "Treasure cache!";
        if (type === "shrine") return "Mystic shrine!";
        if (type === "enemies") return "Enemy ambush!";
        return null;
    }

    function populateRunStats(state, containerId) {
        var node = el(containerId);
        if (!node) return;
        var prog = getRoomProgress(state);
        var seedRow = state.map && state.map.seed
            ? '<div class="result-row"><span>Maze seed</span><strong>' + state.map.seed + "</strong></div>"
            : "";
        node.innerHTML =
            seedRow +
            '<div class="result-row"><span>Kills</span><strong>' + (state.runKills | 0) + "</strong></div>" +
            '<div class="result-row"><span>Max combo</span><strong>x' + (state.runMaxCombo | 0) + "</strong></div>" +
            '<div class="result-row"><span>Rooms cleared</span><strong>' + prog.cleared + "/" + prog.total + "</strong></div>";
    }

    function pushKillFeed(state, label) {
        if (!state.killFeed) state.killFeed = [];
        var kind = label.indexOf("Champion") >= 0 ? "champion" : label.indexOf("★") >= 0 ? "elite" : label.indexOf("Boss") >= 0 ? "boss" : "normal";
        state.killFeed.unshift({ text: label, life: 4, maxLife: 4, kind: kind });
        while (state.killFeed.length > 3) state.killFeed.pop();
    }

    function updateKillFeed(state, dt) {
        if (!state.killFeed) return;
        for (var i = state.killFeed.length - 1; i >= 0; i--) {
            state.killFeed[i].life -= dt;
            if (state.killFeed[i].life <= 0) state.killFeed.splice(i, 1);
        }
    }

    function renderKillFeed(state) {
        var list = el("hud-kill-feed");
        if (!list) return;
        if (!state.killFeed || !state.killFeed.length) {
            list.innerHTML = "";
            list.hidden = true;
            return;
        }
        list.hidden = false;
        var html = "";
        var shown = Math.min(3, state.killFeed.length);
        for (var i = 0; i < shown; i++) {
            var row = state.killFeed[i];
            var maxLife = row.maxLife || 4;
            var fade = clamp(row.life / maxLife, 0, 1);
            var cls = row.kind ? " kill-" + row.kind : "";
            html += '<li class="kill-feed-item' + cls + '" style="opacity:' + fade.toFixed(2) + '">' + escapeHtml(row.text) + "</li>";
        }
        list.innerHTML = html;
    }

    function renderQuestObjectives(state) {
        var list = el("hud-quest-list");
        var panel = el("hud-quest");
        if (!list || !panel || !state.map) {
            if (panel) panel.hidden = true;
            return;
        }
        panel.hidden = false;
        var prog = getRoomProgress(state);
        var bossRoom = state.map.rooms[state.map.bossIndex];
        var bossDone = !!(bossRoom && bossRoom.cleared);
        var roomsDone = prog.total > 0 && prog.cleared >= prog.total;
        list.innerHTML =
            '<li class="quest-item' + (bossDone ? " done" : "") + '">Slay the boss' + (bossDone ? " ✓" : "") + "</li>" +
            '<li class="quest-item' + (roomsDone ? " done" : "") + '">Clear rooms (' + prog.cleared + "/" + prog.total + ")" + (roomsDone ? " ✓" : "") + "</li>";
    }

    function grantSpellCharge(state) {
        for (var i = 0; i < state.spellHotbar.length; i++) {
            if (!state.spellHotbar[i]) {
                state.spellHotbar[i] = "Fireball";
                return true;
            }
        }
        return false;
    }

    function triggerRampage(state) {
        state.rampageTimer = RAMPAGE_DURATION;
        showToast(state, "RAMPAGE!", 2000);
        var wrap = el("canvas-wrap");
        if (wrap) {
            wrap.classList.add("rampage-flash");
            clearTimeout(state._rampageFlashTimer);
            state._rampageFlashTimer = setTimeout(function () {
                wrap.classList.remove("rampage-flash");
            }, 380);
        }
        playSfx("levelClear");
    }

    function celebrateRoomClear(state) {
        showToast(state, "Room cleared!", 1400);
        playSfx("roomClear");
        var wrap = el("canvas-wrap");
        if (wrap) {
            wrap.classList.add("room-clear-flash");
            clearTimeout(state._roomClearFlashTimer);
            state._roomClearFlashTimer = setTimeout(function () {
                wrap.classList.remove("room-clear-flash");
            }, 500);
        }
    }

    function checkRoomClearCelebration(state) {
        if (!state.map || !state._roomWasCleared) return;
        for (var i = 0; i < state.map.rooms.length; i++) {
            if (i === state.map.startIndex) continue;
            var room = state.map.rooms[i];
            var was = !!state._roomWasCleared[i];
            var now = !!room.cleared;
            state._roomWasCleared[i] = now;
            if (!was && now) celebrateRoomClear(state);
        }
    }

    function checkBossRoomIntro(state) {
        if (!state.map || state.bossIntroShown) return;
        if (state.currentRoomIndex !== state.map.bossIndex) return;
        state.bossIntroShown = true;
        showToast(state, "BOSS CHAMBER — defeat the guardian!", 2400);
        playSfx("bossIntro");
    }

    function isShiftHeld(state) {
        var k = state.input.keys;
        return !!(k["shift"] || k["shiftleft"] || k["shiftright"]);
    }

    function getMoveVector(state) {
        var mvx = 0, mvy = 0;
        var k = state.input.keys;
        if (Math.abs(state.input.touchMoveX) > 0.12 || Math.abs(state.input.touchMoveY) > 0.12) {
            mvx = state.input.touchMoveX;
            mvy = state.input.touchMoveY;
        } else {
            if (k["w"] || k["arrowup"]) mvy -= 1;
            if (k["s"] || k["arrowdown"]) mvy += 1;
            if (k["a"] || k["arrowleft"]) mvx -= 1;
            if (k["d"] || k["arrowright"]) mvx += 1;
        }
        var len = Math.sqrt(mvx * mvx + mvy * mvy);
        if (len < 0.01) return { x: 0, y: 0, len: 0 };
        return { x: mvx / len, y: mvy / len, len: len };
    }

    function tryStartDash(state) {
        var p = state.player;
        if (p.dashTimer > 0 || p.dashCooldown > 0) return;
        var mv = getMoveVector(state);
        if (mv.len < 0.01) {
            mv.x = p.faceX;
            mv.y = p.faceY;
            mv.len = Math.sqrt(mv.x * mv.x + mv.y * mv.y) || 1;
        }
        p.dashVx = mv.x;
        p.dashVy = mv.y;
        p.dashTimer = DASH_DURATION;
        p.dashCooldown = DASH_COOLDOWN;
        p.dashIFrameTimer = DASH_IFRAMES;
        p.parryUsed = false;
        playSfx("dash");
        if (!state.dashHintShown) {
            state.dashHintShown = true;
            showToast(state, "Shift to dash!", 1800);
        }
    }

    function tryPerformDash(state) {
        tryStartDash(state);
    }

    function updateDoorFlashes(state, dt) {
        if (!state.map) return;
        for (var i = 0; i < state.map.doors.length; i++) {
            var d = state.map.doors[i];
            if (d.flashTimer > 0) d.flashTimer = Math.max(0, d.flashTimer - dt);
        }
    }

    /* ============================================================ *
     *  Map & rooms — procedural maze
     * ============================================================ */

    /**
     * Builds a randomised dungeon layout on a 3×3 grid.
     *
     * Rooms grow outwards from a random starting cell (Prim-style expansion)
     * so the selected cells are always connected. A random spanning tree is
     * then computed over adjacent room pairs; optionally one extra edge is
     * added to create a loop. Both horizontal (E-W) and vertical (N-S)
     * corridors are supported.
     *
     * @param {number} level   current game level (affects room count)
     * @returns {{ rooms, corridors, doors, startIndex, bossIndex }}
     */
    function buildLevel(level) {
        var COLS = 3, ROWS = 3;
        var ROOM_W  = 20 * TILE;   // all rooms fixed size for clean alignment
        var ROOM_H  = 14 * TILE;
        var CORR_LEN = 5 * TILE;   // length of each corridor segment
        var CELL_W  = ROOM_W + CORR_LEN;
        var CELL_H  = ROOM_H + CORR_LEN;
        var DOOR_TH = 10;          // door thickness in pixels

        // Number of rooms scales with level: 4 on level 1, up to 9 on level 5+
        var roomCount = Math.max(4, Math.min(4 + Math.floor((level + 1) / 2), COLS * ROWS));

        // ---- grow cells from a random starting cell ----
        var occupied = {};
        var cellList = [];
        var sc = Math.floor(Math.random() * COLS);
        var sr = Math.floor(Math.random() * ROWS);
        occupied[sr + ',' + sc] = 0;
        cellList.push({ col: sc, row: sr });

        var DIRS4 = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];

        while (cellList.length < roomCount) {
            var frontier = [];
            for (var fi = 0; fi < cellList.length; fi++) {
                var fc = cellList[fi];
                for (var di = 0; di < 4; di++) {
                    var nc = fc.col + DIRS4[di].dc;
                    var nr = fc.row + DIRS4[di].dr;
                    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
                    if (occupied[nr + ',' + nc] !== undefined) continue;
                    frontier.push({ col: nc, row: nr });
                }
            }
            if (frontier.length === 0) break;
            var pick = frontier[Math.floor(Math.random() * frontier.length)];
            occupied[pick.row + ',' + pick.col] = cellList.length;
            cellList.push({ col: pick.col, row: pick.row });
        }

        // ---- create room objects ----
        var rooms = [];
        for (var ri = 0; ri < cellList.length; ri++) {
            var cell = cellList[ri];
            rooms.push({
                index: ri,
                col: cell.col, row: cell.row,
                x: cell.col * CELL_W,
                y: cell.row * CELL_H,
                w: ROOM_W, h: ROOM_H,
                cleared: false
            });
        }

        // ---- find all adjacent room pairs ----
        function roomAt(col, row) {
            for (var i = 0; i < rooms.length; i++) {
                if (rooms[i].col === col && rooms[i].row === row) return rooms[i];
            }
            return null;
        }

        var allEdges = [];
        var edgeSeen = {};
        for (var rei = 0; rei < rooms.length; rei++) {
            var rm = rooms[rei];
            [[1, 0], [0, 1]].forEach(function (d) {
                var nb = roomAt(rm.col + d[0], rm.row + d[1]);
                if (!nb) return;
                var key = Math.min(rm.index, nb.index) + '_' + Math.max(rm.index, nb.index);
                if (!edgeSeen[key]) {
                    edgeSeen[key] = true;
                    allEdges.push({ from: rm.index, to: nb.index, w: Math.random() });
                }
            });
        }

        // ---- Kruskal spanning tree ----
        allEdges.sort(function (a, b) { return a.w - b.w; });
        var par = rooms.map(function (_, i) { return i; });
        function find(x) { return par[x] === x ? x : (par[x] = find(par[x])); }
        var mst = [], extras = [];
        for (var ei = 0; ei < allEdges.length; ei++) {
            var e = allEdges[ei];
            if (find(e.from) !== find(e.to)) {
                par[find(e.from)] = find(e.to);
                mst.push(e);
            } else {
                extras.push(e);
            }
        }

        // Optionally add one loop edge (~40% chance)
        if (extras.length > 0 && Math.random() < 0.4) {
            mst.push(extras[Math.floor(Math.random() * extras.length)]);
        }

        // ---- build corridors + doors from selected edges ----
        var corridors = [], doors = [];
        for (var mi = 0; mi < mst.length; mi++) {
            var edge  = mst[mi];
            var fromR = rooms[edge.from];
            var toR   = rooms[edge.to];
            var isH   = fromR.row === toR.row;
            var leftR  = isH ? (fromR.col < toR.col ? fromR : toR) : null;
            var rightR = isH ? (fromR.col < toR.col ? toR : fromR) : null;
            var topR   = !isH ? (fromR.row < toR.row ? fromR : toR) : null;
            var botR   = !isH ? (fromR.row < toR.row ? toR : fromR) : null;
            var co, d1, d2;

            if (isH) {
                var cy = leftR.y + leftR.h / 2 - CORR_NARROW / 2;
                co = { fromIndex: leftR.index, toIndex: rightR.index, dir: 'h',
                       x: leftR.x + leftR.w, y: cy, w: CORR_LEN, h: CORR_NARROW };
                d1 = { fromIndex: leftR.index,  toIndex: rightR.index, dir: 'h',
                       x: co.x, y: cy, w: DOOR_TH, h: CORR_NARROW, open: false, flashTimer: 0 };
                d2 = { fromIndex: rightR.index, toIndex: leftR.index, dir: 'h',
                       x: co.x + co.w - DOOR_TH, y: cy, w: DOOR_TH, h: CORR_NARROW, open: false, flashTimer: 0 };
            } else {
                var cx = topR.x + topR.w / 2 - CORR_NARROW / 2;
                co = { fromIndex: topR.index, toIndex: botR.index, dir: 'v',
                       x: cx, y: topR.y + topR.h, w: CORR_NARROW, h: CORR_LEN };
                d1 = { fromIndex: topR.index, toIndex: botR.index, dir: 'v',
                       x: cx, y: co.y, w: CORR_NARROW, h: DOOR_TH, open: false, flashTimer: 0 };
                d2 = { fromIndex: botR.index, toIndex: topR.index, dir: 'v',
                       x: cx, y: co.y + co.h - DOOR_TH, w: CORR_NARROW, h: DOOR_TH, open: false, flashTimer: 0 };
            }
            corridors.push(co);
            doors.push(d1);
            doors.push(d2);
        }

        // ---- pick start (closest to grid origin) and boss (BFS-farthest from start) ----
        var startIndex = 0;
        var minManh = Infinity;
        for (var si = 0; si < rooms.length; si++) {
            var m = rooms[si].col + rooms[si].row;
            if (m < minManh) { minManh = m; startIndex = si; }
        }

        var visited = {};
        var bfsQ = [startIndex];
        visited[startIndex] = true;
        var bfsOrder = [startIndex];
        while (bfsQ.length > 0) {
            var cur = bfsQ.shift();
            for (var bi = 0; bi < mst.length; bi++) {
                var be = mst[bi];
                var nb = -1;
                if (be.from === cur && !visited[be.to])   nb = be.to;
                if (be.to   === cur && !visited[be.from]) nb = be.from;
                if (nb >= 0) { visited[nb] = true; bfsQ.push(nb); bfsOrder.push(nb); }
            }
        }
        var bossIndex = bfsOrder[bfsOrder.length - 1];

        rooms[startIndex].cleared = true;

        var edges = mst.map(function (edge) {
            return { from: edge.from, to: edge.to };
        });

        var seed = 10000 + Math.floor(Math.random() * 90000);

        return { rooms: rooms, corridors: corridors, doors: doors, edges: edges,
                 startIndex: startIndex, bossIndex: bossIndex,
                 bounds: computeMapBounds(rooms, corridors), seed: seed };
    }

    /** Axis-aligned bounds of all walkable geometry (rooms + corridors) plus padding. */
    function computeMapBounds(rooms, corridors) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        function expand(x, y, w, h) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
        }
        for (var i = 0; i < rooms.length; i++) {
            var rm = rooms[i];
            expand(rm.x, rm.y, rm.w, rm.h);
        }
        for (var j = 0; j < corridors.length; j++) {
            var co = corridors[j];
            expand(co.x, co.y, co.w, co.h);
        }
        var pad = TILE * 2;
        return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }

    function roomHasPendingContent(map, roomIndex) {
        var room = map.rooms[roomIndex];
        return !!(room && room.pendingContent);
    }

    /**
     * Returns true if the circle (x, y, radius) sits entirely inside the
     * walkable floor.
     *
     * Rooms: strict containment on all four walls (centre must be ≥r from
     * every outer wall so the player can't clip through solid stone).
     *
     * Corridors: strict only on the two *narrow* walls (perpendicular to
     * travel direction). The two *connecting* ends are left margin-free so
     * the player can smoothly cross the room→corridor junction without
     * hitting a phantom dead zone at x = roomEdge ± r.
     */
    function isWalkable(map, x, y, radius) {
        var r = radius || 0;
        var onFloor = false;

        for (var i = 0; i < map.rooms.length; i++) {
            var rm = map.rooms[i];
            if (x >= rm.x + r && x <= rm.x + rm.w - r &&
                y >= rm.y + r && y <= rm.y + rm.h - r) {
                onFloor = true; break;
            }
        }
        if (!onFloor) {
            for (var j = 0; j < map.corridors.length; j++) {
                var co = map.corridors[j];
                if (co.dir === 'h') {
                    // Strict on top/bottom walls; open at left/right room junctions
                    if (x >= co.x - r && x <= co.x + co.w + r &&
                        y >= co.y + r && y <= co.y + co.h - r) {
                        onFloor = true; break;
                    }
                } else {
                    // Strict on left/right walls; open at top/bottom room junctions
                    if (x >= co.x + r && x <= co.x + co.w - r &&
                        y >= co.y - r && y <= co.y + co.h + r) {
                        onFloor = true; break;
                    }
                }
            }
        }
        if (!onFloor) return false;

        for (var d = 0; d < map.doors.length; d++) {
            var door = map.doors[d];
            if (!door.open && circleIntersectsAxisRect(x, y, r + 2, door.x, door.y, door.w, door.h)) {
                return false;
            }
        }
        return true;
    }

    function roomContaining(map, x, y) {
        for (var i = 0; i < map.rooms.length; i++) {
            var rm = map.rooms[i];
            if (pointInRect(x, y, rm.x, rm.y, rm.w, rm.h)) return rm;
        }
        return null;
    }

    function corridorContaining(map, x, y) {
        for (var i = 0; i < map.corridors.length; i++) {
            var co = map.corridors[i];
            if (pointInRect(x, y, co.x, co.y, co.w, co.h)) return co;
        }
        return null;
    }

    function isDoorOpenBetween(map, roomA, roomB) {
        for (var i = 0; i < map.doors.length; i++) {
            var d = map.doors[i];
            if (!d.open) continue;
            if ((d.fromIndex === roomA && d.toIndex === roomB) ||
                (d.fromIndex === roomB && d.toIndex === roomA)) {
                return true;
            }
        }
        return false;
    }

    /** Room indices reachable from startIdx through open doors (BFS on map.edges). */
    function roomsReachableFrom(state, startIdx) {
        var reachable = {};
        reachable[startIdx] = true;
        var queue = [startIdx];
        var edges = state.map.edges || [];
        while (queue.length > 0) {
            var cur = queue.shift();
            for (var ei = 0; ei < edges.length; ei++) {
                var edge = edges[ei];
                var nb = -1;
                if (edge.from === cur) nb = edge.to;
                else if (edge.to === cur) nb = edge.from;
                if (nb < 0 || reachable[nb]) continue;
                if (!isDoorOpenBetween(state.map, cur, nb)) continue;
                reachable[nb] = true;
                queue.push(nb);
            }
        }
        return reachable;
    }

    /**
     * Whether the enemy may chase or shoot at the player — same room, connected
     * rooms/corridors through open doors, or within aggro range on that network.
     */
    function enemyCanReachPlayer(state, enemy) {
        var p = state.player;
        var pRoom = roomContaining(state.map, p.x, p.y);
        if (pRoom && pRoom.index === enemy.roomIndex) return true;

        var reachable = roomsReachableFrom(state, enemy.roomIndex);

        if (pRoom && reachable[pRoom.index]) return true;

        var pCorridor = corridorContaining(state.map, p.x, p.y);
        if (pCorridor) {
            var cFrom = pCorridor.fromIndex;
            var cTo = pCorridor.toIndex;
            if (cFrom === enemy.roomIndex || cTo === enemy.roomIndex) {
                return isDoorOpenBetween(state.map, cFrom, cTo);
            }
            if ((reachable[cFrom] || reachable[cTo]) &&
                isDoorOpenBetween(state.map, cFrom, cTo)) {
                return true;
            }
        }

        if (dist(p.x, p.y, enemy.x, enemy.y) <= ENEMY_AGGRO_RANGE) {
            if (pRoom && reachable[pRoom.index]) return true;
            if (pCorridor && (reachable[pCorridor.fromIndex] || reachable[pCorridor.toIndex]) &&
                isDoorOpenBetween(state.map, pCorridor.fromIndex, pCorridor.toIndex)) {
                return true;
            }
        }
        return false;
    }

    /* ============================================================ *
     *  Entities
     * ============================================================ */
    function makePlayer(hp) {
        return {
            x: 0, y: 0, vx: 0, vy: 0,
            faceX: 0, faceY: 1,
            hp: hp || PLAYER_MAX_HP,
            maxHp: PLAYER_MAX_HP,
            mp: PLAYER_MAX_MP,
            mpFloat: PLAYER_MAX_MP,
            damageCooldown: 0,
            shootCooldown: 0,
            invincibleTimer: 0,
            dashCooldown: 0,
            dashIFrameTimer: 0,
            dashTimer: 0,
            dashVx: 0,
            dashVy: 0,
            hurtFlash: 0,
            strengthTimer: 0,
            slowTimer: 0,
            slowMult: 1,
            parryUsed: false,
            tintColor: "#6cf2a6",
        };
    }

    function makeEnemy(opts) {
        return {
            x: opts.x, y: opts.y, roomIndex: opts.roomIndex,
            hp: opts.hp, maxHp: opts.hp, speed: opts.speed,
            radius: opts.radius != null ? opts.radius : (opts.isBoss ? 22 : 16),
            archetype: opts.archetype || "grunt",
            isBoss: !!opts.isBoss,
            active: true,
            attackCooldown: 0,
            attackWindup: 0,
            shootCooldown: 0,
            hitFlash: 0,
            burnTicks: 0,
            burnTickDmg: 0,
            burnTickTimer: 0,
            isElite: !!opts.isElite,
            isChampion: !!opts.isChampion,
            burnStacks: 0,
        };
    }

    function spawnBurnParticles(state, x, y) {
        for (var bi = 0; bi < 5; bi++) {
            var ang = Math.random() * Math.PI * 2;
            var spd = rand(30, 90);
            state.particles.push({
                x: x, y: y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - 50,
                life: rand(0.2, 0.45),
                maxLife: 0.45,
                size: rand(2, 4),
                color: "#ff8a3d",
            });
        }
    }

    function makeEnemyShot(x, y, vx, vy, arch) {
        return {
            x: x, y: y, vx: vx, vy: vy, life: 2.2, active: true, radius: 6,
            arch: arch || "ranged",
        };
    }

    function pushEnemyWithArchetype(state, room, roomIndex, baseHp, baseSpeed, forceArch) {
        var arch = forceArch || pickEnemyArchetype();
        var st = archetypeStats(arch, baseHp, baseSpeed);
        var isChampion = !forceArch && Math.random() < CHAMPION_SPAWN_CHANCE;
        var isElite = !forceArch && !isChampion && Math.random() < ELITE_SPAWN_CHANCE;
        if (isChampion) {
            st.hp = Math.round(st.hp * CHAMPION_HP_MULT);
            st.radius += 3;
        } else if (isElite) {
            st.hp = Math.round(st.hp * ELITE_HP_MULT);
        }
        var ex = rand(room.x + 60, room.x + room.w - 60);
        var ey = rand(room.y + 60, room.y + room.h - 60);
        state.enemies.push(makeEnemy({
            roomIndex: roomIndex,
            x: ex, y: ey,
            hp: st.hp, speed: st.speed, radius: st.radius,
            archetype: arch, isBoss: false, isElite: isElite, isChampion: isChampion,
        }));
        if (isChampion) {
            addFloatText(state, ex, ey - st.radius - 24, "CHAMPION!", "#ff5d6c", { scale: 1.3, life: 1.2, vy: -62 });
        } else if (isElite) {
            addFloatText(state, ex, ey - st.radius - 22, "ELITE!", "#ffd166", { scale: 1.25, life: 1.1, vy: -58 });
        }
    }

    function playerIsInvulnerable(p) {
        return p.invincibleTimer > 0 || p.dashIFrameTimer > 0;
    }

    function makeFireball(x, y, vx, vy, dmg, charged, isCrit) {
        return {
            x: x, y: y, vx: vx, vy: vy, dmg: dmg, charged: !!charged, crit: !!isCrit,
            life: 1.6, active: true, trail: [{ x: x, y: y }],
        };
    }

    function pushFireballTrail(f) {
        if (!f.trail) f.trail = [];
        f.trail.push({ x: f.x, y: f.y });
        while (f.trail.length > 3) f.trail.shift();
    }

    function makeTreasure(x, y, type, roomIndex) {
        return { x: x, y: y, type: type, roomIndex: roomIndex, opened: false, openAnim: 0 };
    }

    function makeShrine(x, y, roomIndex) {
        return { x: x, y: y, roomIndex: roomIndex, used: false };
    }

    function findNearbyShrine(state) {
        if (!state.shrines) return null;
        var p = state.player;
        var best = null;
        var bestD = Infinity;
        var REACH = 72;
        for (var i = 0; i < state.shrines.length; i++) {
            var s = state.shrines[i];
            if (s.used) continue;
            var dd = dist(p.x, p.y, s.x, s.y);
            if (dd < bestD && dd < REACH) { bestD = dd; best = s; }
        }
        return best;
    }

    function findNearbyGroundPotion(state) {
        if (!state.treasures) return null;
        var p = state.player;
        var best = null;
        var bestD = Infinity;
        for (var i = 0; i < state.treasures.length; i++) {
            var t = state.treasures[i];
            if (t.opened || t.type === "ScoreCache") continue;
            var dd = dist(p.x, p.y, t.x, t.y);
            if (dd < bestD && dd < GROUND_PICKUP_REACH) { bestD = dd; best = t; }
        }
        return best;
    }

    function pickupGroundTreasure(state, treasure) {
        if (!treasure || treasure.opened) return false;
        treasure.opened = true;
        treasure.openAnim = 0.001;
        var chestColor = treasure.type === "Health" ? "#6cf2a6" : treasure.type === "Strength" ? "#ffb46b" : treasure.type === "ScoreCache" ? "#ffd166" : "#b29bff";
        spawnChestParticles(state, treasure.x, treasure.y, chestColor);
        if (treasure.type === "Health") {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + POTION_HEAL);
            addFloatText(state, state.player.x, state.player.y - 18, "+" + POTION_HEAL, "#6cf2a6");
            playSfx("pickup");
            showToast(state, "+" + POTION_HEAL + " HP", 900);
        } else if (treasure.type === "Strength") {
            addToInventory(state, "Strength");
            playSfx("pickup");
            showToast(state, "Picked up Strength potion", 900);
        } else if (treasure.type === "Invincibility") {
            addToInventory(state, "Invincibility");
            playSfx("pickup");
            showToast(state, "Picked up Invincibility potion", 900);
        }
        return true;
    }

    function interactShrine(state, shrine) {
        if (!shrine || shrine.used) return;
        shrine.used = true;
        var roll = Math.random();
        if (roll < 0.34) {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + SHRINE_HEAL);
            addFloatText(state, shrine.x, shrine.y - 24, "+" + SHRINE_HEAL, "#6cf2a6");
            showToast(state, "Shrine: +" + SHRINE_HEAL + " HP", 1200);
            playSfx("heal");
        } else if (roll < 0.67) {
            state.player.strengthTimer = SHRINE_STRENGTH_TIME;
            addFloatText(state, shrine.x, shrine.y - 24, "STR!", "#ffb46b");
            showToast(state, "Shrine: Strength " + SHRINE_STRENGTH_TIME + "s", 1200);
            playSfx("pickup");
        } else if (grantSpellCharge(state)) {
            addFloatText(state, shrine.x, shrine.y - 24, "+1 SPELL", "#6ec1ff");
            showToast(state, "Shrine: +1 spell charge", 1200);
            playSfx("pickup");
        } else {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + SHRINE_HEAL);
            showToast(state, "Shrine: hotbar full — healed instead", 1200);
            playSfx("heal");
        }
        spawnChestParticles(state, shrine.x, shrine.y, "#ffd166");
        updateRoomsCleared(state);
    }

    /* ============================================================ *
     *  Level spawn
     * ============================================================ */
    /**
     * Decides what each room will contain and stores it as `pendingContent`.
     * Nothing is actually spawned until the player opens the door.
     * The start room gets no pending content and is marked cleared immediately.
     */
    function spawnLevel(state) {
        state.map = buildLevel(state.level);
        state.enemies = [];
        state.treasures = [];
        state.fireballs = [];
        state.enemyShots = state.enemyShots || [];
        state.enemyShots.length = 0;
        state.shrines = [];

        var startIdx  = state.map.startIndex;
        var bossIdx   = state.map.bossIndex;
        var hpMult    = levelHpMultiplier(state.level);
        var speedMult = Math.min(1 + (state.level - 1) * 0.08, 1.6);
        var pickups   = ["Health", "Strength", "Invincibility"];
        var pickupIdx = 0;
        var secretRoom = -1;
        var secretCandidates = [];

        // Place player in start room centre
        var startRoom = state.map.rooms[startIdx];
        state.player.x = startRoom.x + startRoom.w / 2;
        state.player.y = startRoom.y + startRoom.h / 2;

        // Assign pending content to every room
        for (var ri = 0; ri < state.map.rooms.length; ri++) {
            var room = state.map.rooms[ri];
            room.cleared = false;
            if (ri === startIdx) {
                room.pendingContent = null;  // start room always empty
                room.cleared = true;
            } else if (ri === bossIdx) {
                room.pendingContent = {
                    type: 'boss',
                    minionCount: state.level >= 3 ? 2 : 1,
                    minionHp:    Math.round(70  * hpMult),
                    minionSpeed: 95 * speedMult,
                    bossHp:      Math.round(160 * hpMult * BOSS_HP_MULT),
                    bossSpeed:   80 * speedMult,
                };
            } else if (Math.random() < 0.65) {
                room.pendingContent = {
                    type:  'enemies',
                    count: 2 + Math.floor(Math.random() * (2 + Math.min(state.level - 1, 2))),
                    hp:    Math.round(60 * hpMult),
                    speed: 90 * speedMult,
                };
                secretCandidates.push(ri);
            } else if (Math.random() < SHRINE_ROOM_CHANCE) {
                room.pendingContent = { type: "shrine" };
            } else {
                var numPotions = Math.random() < 0.4 ? 2 : 1;
                var items = [];
                for (var p = 0; p < numPotions; p++) {
                    items.push(pickups[pickupIdx % pickups.length]);
                    pickupIdx++;
                }
                room.pendingContent = { type: 'potions', items: items };
            }
        }

        if (secretCandidates.length > 0 && Math.random() < SECRET_ROOM_CHANCE) {
            secretRoom = secretCandidates[Math.floor(Math.random() * secretCandidates.length)];
            state.map.rooms[secretRoom].isSecret = true;
        }

        state.map.traps = [];
        for (var tri = 0; tri < state.map.rooms.length; tri++) {
            if (tri === startIdx) continue;
            var trapRoom = state.map.rooms[tri];
            if (trapRoom.pendingContent && trapRoom.pendingContent.type === "enemies") {
                var roomTraps = generateRoomTraps(trapRoom);
                for (var tt = 0; tt < roomTraps.length; tt++) state.map.traps.push(roomTraps[tt]);
            }
        }

        for (var d = 0; d < state.map.doors.length; d++) state.map.doors[d].open = false;

        initExploration(state);
        state.visitedRooms[startIdx] = true;
        state.revealedRooms[startIdx] = true;
        state.currentRoomIndex = startIdx;
        state.bossIntroShown = false;
        state._roomWasCleared = {};
        for (var ri2 = 0; ri2 < state.map.rooms.length; ri2++) {
            state._roomWasCleared[ri2] = !!state.map.rooms[ri2].cleared;
        }

        state.timerActive = state.level >= 3;
        state.timeLimit = state.level >= 3 ? Math.max(20, state.level3TimeLimit - (state.level - 3) * 5) : 0;
        state.timer = state.timerActive ? state.timeLimit : 0;
    }

    /**
     * Materialises a room's pending content (enemies / potions) the first time
     * the player enters it.  Idempotent — does nothing if already spawned.
     */
    function spawnRoomContent(state, roomIndex) {
        var room = state.map.rooms[roomIndex];
        if (!room || !room.pendingContent) return null;
        var c = room.pendingContent;
        var contentType = c.type;
        room.pendingContent = null;  // mark spawned immediately
        markRoomRevealed(state, roomIndex);

        if (c.type === 'enemies') {
            for (var i = 0; i < c.count; i++) {
                pushEnemyWithArchetype(state, room, roomIndex, c.hp, c.speed, null);
            }
            if (room.isSecret) {
                state.treasures.push(makeTreasure(
                    room.x + room.w / 2,
                    room.y + room.h / 2,
                    "ScoreCache",
                    roomIndex
                ));
                state.treasures.push(makeTreasure(
                    rand(room.x + 56, room.x + room.w - 56),
                    rand(room.y + 56, room.y + room.h - 56),
                    "Health",
                    roomIndex
                ));
                showToast(state, "Secret chamber — bonus score chest!", 2200);
            }
        } else if (c.type === 'boss') {
            for (var m = 0; m < c.minionCount; m++) {
                pushEnemyWithArchetype(state, room, roomIndex, c.minionHp, c.minionSpeed, m === 0 ? "tank" : null);
            }
            state.enemies.push(makeEnemy({
                roomIndex: roomIndex,
                x: room.x + room.w / 2,
                y: room.y + room.h / 2,
                hp: c.bossHp, speed: c.bossSpeed, isBoss: true,
            }));
        } else if (c.type === "shrine") {
            state.shrines.push(makeShrine(
                room.x + room.w / 2,
                room.y + room.h / 2,
                roomIndex
            ));
        } else if (c.type === 'potions') {
            for (var pi = 0; pi < c.items.length; pi++) {
                state.treasures.push(makeTreasure(
                    rand(room.x + 48, room.x + room.w - 48),
                    rand(room.y + 48, room.y + room.h - 48),
                    c.items[pi], roomIndex
                ));
            }
        }
        updateRoomsCleared(state);
        var msg = roomRevealMessage(contentType);
        if (room.isSecret && contentType === "enemies") msg = "Secret ambush!";
        if (msg) showToast(state, msg, 1400);
        return contentType;
    }

    function updateTraps(state, dt) {
        if (!state.map || !state.map.traps || !state.map.traps.length) return;
        var p = state.player;
        state.trapCooldown = Math.max(0, (state.trapCooldown || 0) - dt);
        if (state.trapCooldown > 0) return;
        var pr = roomContaining(state.map, p.x, p.y);
        if (!pr) return;
        for (var i = 0; i < state.map.traps.length; i++) {
            var tr = state.map.traps[i];
            if (tr.roomIndex !== pr.index) continue;
            if (pointInRect(p.x, p.y, tr.x, tr.y, tr.w, tr.h)) {
                if (applyPlayerDamage(state, TRAP_DAMAGE, tr.x + tr.w / 2, tr.y + tr.h / 2)) return;
                state.trapCooldown = TRAP_COOLDOWN;
                state.shake = Math.max(state.shake || 0, 0.5);
                addFloatText(state, p.x, p.y - 16, "TRAP!", "#ff5d6c");
                break;
            }
        }
    }

    function drawTraps(ctx, state) {
        if (!state.map || !state.map.traps) return;
        var pr = roomContaining(state.map, state.player.x, state.player.y);
        var pulse = 0.55 + 0.45 * Math.sin((state.animTime || 0) * 6);
        for (var i = 0; i < state.map.traps.length; i++) {
            var tr = state.map.traps[i];
            if (pr && tr.roomIndex !== pr.index) continue;
            ctx.save();
            ctx.fillStyle = "rgba(200, 40, 50, " + (0.22 + pulse * 0.18) + ")";
            ctx.fillRect(tr.x, tr.y, tr.w, tr.h);
            ctx.strokeStyle = "rgba(255, 90, 70, " + (0.45 + pulse * 0.25) + ")";
            ctx.lineWidth = 2;
            ctx.strokeRect(tr.x + 1, tr.y + 1, tr.w - 2, tr.h - 2);
            ctx.restore();
        }
    }

    function updateRoomsCleared(state) {
        for (var i = 0; i < state.map.rooms.length; i++) {
            var room = state.map.rooms[i];
            // A room with unspawned content is NOT cleared
            if (room.pendingContent) { room.cleared = false; continue; }
            var anyAlive = false;
            for (var k = 0; k < state.enemies.length; k++) {
                var e = state.enemies[k];
                if (e.active && e.hp > 0 && e.roomIndex === i) { anyAlive = true; break; }
            }
            room.cleared = !anyAlive;
        }
    }

    /** Returns the closest interactable door within reach of the player, or null. */
    function findNearbyDoor(state) {
        if (!state.map) return null;
        var p = state.player;
        var best = null;
        var bestD = Infinity;
        var REACH = 80;
        for (var i = 0; i < state.map.doors.length; i++) {
            var d = state.map.doors[i];
            if (d.open) continue;
            var cx = d.x + d.w / 2;
            var cy = d.y + d.h / 2;
            var dd = dist(p.x, p.y, cx, cy);
            if (dd < bestD && dd < REACH) { bestD = dd; best = d; }
        }
        return best;
    }

    /** Opens the door (and its mirror) and spawns content in the room being entered. */
    function openDoorPair(state, door) {
        door.open = true;
        door.flashTimer = 0.45;
        playSfx("door");
        markRoomRevealed(state, door.toIndex);
        var revealed = spawnRoomContent(state, door.toIndex);
        for (var i = 0; i < state.map.doors.length; i++) {
            var other = state.map.doors[i];
            if (other === door) continue;
            if (other.fromIndex === door.toIndex && other.toIndex === door.fromIndex) {
                other.open = true;
                other.flashTimer = 0.45;
                markRoomRevealed(state, other.toIndex);
                var r2 = spawnRoomContent(state, other.toIndex);
                if (!revealed) revealed = r2;
            }
        }
        updateRoomsCleared(state);
        var wrap = el("canvas-wrap");
        if (wrap) {
            wrap.classList.add("door-flash");
            clearTimeout(state._doorFlashTimer);
            state._doorFlashTimer = setTimeout(function () {
                wrap.classList.remove("door-flash");
            }, 450);
        }
        return revealed;
    }

    function tryInteract(state) {
        var potion = findNearbyGroundPotion(state);
        if (potion) {
            pickupGroundTreasure(state, potion);
            return;
        }
        var shrine = findNearbyShrine(state);
        if (shrine && !shrine.used) {
            interactShrine(state, shrine);
            return;
        }
        var door = findNearbyDoor(state);
        if (!door) return;
        var fromCleared = state.map.rooms[door.fromIndex].cleared;
        var toCleared   = state.map.rooms[door.toIndex].cleared;
        if (!fromCleared && !toCleared) {
            showToast(state, "Defeat the enemies first", 1100);
            return;
        }
        var hadPending = !!state.map.rooms[door.toIndex].pendingContent;
        openDoorPair(state, door);
        if (!hadPending) showToast(state, "Door opened", 900);
    }

    /* ============================================================ *
     *  Drawing
     * ============================================================ */
    function drawRect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

    function drawRoomFloor(ctx, room, isStart, isBoss) {
        var base = isStart ? "#0e1a2c" : isBoss ? "#1c0d18" : "#0e162a";
        drawRect(ctx, room.x, room.y, room.w, room.h, base);
        ctx.save();
        ctx.globalAlpha = 0.18;
        var checker1 = isBoss ? "#280d1f" : "#152540";
        var checker2 = isBoss ? "#1a0916" : "#0d1731";
        for (var ty = 0; ty < room.h / TILE; ty++) {
            for (var tx = 0; tx < room.w / TILE; tx++) {
                ctx.fillStyle = (ty + tx) % 2 === 0 ? checker1 : checker2;
                ctx.fillRect(room.x + tx * TILE, room.y + ty * TILE, TILE, TILE);
            }
        }
        ctx.restore();
        ctx.strokeStyle = isBoss ? "#3b1430" : isStart ? "#1d3457" : "#1a2a4a";
        ctx.lineWidth = 4;
        ctx.strokeRect(room.x + 2, room.y + 2, room.w - 4, room.h - 4);
        if (isBoss) {
            ctx.save();
            ctx.fillStyle = "#3a0e22";
            ctx.beginPath();
            ctx.arc(room.x + room.w / 2, room.y + room.h / 2, 110, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function drawCorridor(ctx, corridor) {
        drawRect(ctx, corridor.x, corridor.y, corridor.w, corridor.h, "#0c142a");
        ctx.strokeStyle = "#1a2a4a";
        ctx.lineWidth = 4;
        ctx.strokeRect(corridor.x + 2, corridor.y + 2, corridor.w - 4, corridor.h - 4);
    }

    /**
     * Draws over wall-edge artifacts at each corridor junction so the
     * corridor opening looks continuous with the room floor.
     * Supports both horizontal (dir:'h') and vertical (dir:'v') corridors.
     */
    function carveDoorways(ctx, map) {
        ctx.save();
        ctx.fillStyle = "#0c142a";
        for (var i = 0; i < map.corridors.length; i++) {
            var co = map.corridors[i];
            var fromR = map.rooms[co.fromIndex];
            var toR   = map.rooms[co.toIndex];
            if (co.dir === 'h') {
                var leftR  = fromR.col < toR.col ? fromR : toR;
                var rightR = fromR.col < toR.col ? toR : fromR;
                // Carve horizontal band between the two inner-wall artefacts
                var x1 = leftR.x  + leftR.w  - 4;
                var x2 = rightR.x + 4;
                ctx.fillRect(x1, co.y + 4, x2 - x1, co.h - 8);
            } else {
                var topR = fromR.row < toR.row ? fromR : toR;
                var botR = fromR.row < toR.row ? toR : fromR;
                // Carve vertical band between the two inner-wall artefacts
                var y1 = topR.y + topR.h - 4;
                var y2 = botR.y + 4;
                ctx.fillRect(co.x + 4, y1, co.w - 8, y2 - y1);
            }
        }
        ctx.restore();
    }

    function drawDoor(ctx, door) {
        ctx.save();
        if (door.open) {
            ctx.fillStyle = "#0c142a";
            ctx.fillRect(door.x, door.y, door.w, door.h);
            if (door.flashTimer > 0) {
                var fa = clamp(door.flashTimer / 0.45, 0, 1) * 0.85;
                ctx.fillStyle = "rgba(255, 209, 102, " + fa + ")";
                ctx.fillRect(door.x, door.y, door.w, door.h);
            }
            ctx.restore();
            return;
        }
        ctx.fillStyle = "#3b2412";
        ctx.fillRect(door.x, door.y, door.w, door.h);
        ctx.strokeStyle = "#0c0a08";
        ctx.lineWidth = 2;
        ctx.strokeRect(door.x + 1, door.y + 1, door.w - 2, door.h - 2);
        // Keyhole: vertical bar for H doors, horizontal bar for V doors
        ctx.fillStyle = "#ffd166";
        var cx = door.x + door.w / 2, cy = door.y + door.h / 2;
        if (!door.dir || door.dir === 'h') {
            ctx.fillRect(cx - 1, cy - 4, 2, 8);
        } else {
            ctx.fillRect(cx - 4, cy - 1, 8, 2);
        }
        ctx.restore();
    }

    function drawPlayer(ctx, p) {
        var x = p.x, y = p.y;
        var bodyColor = p.tintColor || "#6cf2a6";
        ctx.save();
        if (p.dashIFrameTimer > 0) { ctx.shadowColor = "#6ec1ff"; ctx.shadowBlur = 20; }
        else if (p.invincibleTimer > 0) { ctx.shadowColor = "#b29bff"; ctx.shadowBlur = 18; }
        else if (p.strengthTimer > 0) { ctx.shadowColor = "#ffb46b"; ctx.shadowBlur = 14; }
        ctx.fillStyle = "#0c1326";
        ctx.beginPath(); ctx.arc(x, y + 6, PLAYER_RADIUS + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#0b0f1a";
        ctx.beginPath(); ctx.arc(x, y, PLAYER_RADIUS - 3, 0, Math.PI * 2); ctx.fill();
        var fx = p.faceX, fy = p.faceY;
        var len = Math.sqrt(fx * fx + fy * fy) || 1;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x + (fx / len) * 4, y + (fy / len) * 4, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    function drawEnemy(ctx, e, animTime) {
        if (e.isBoss && e.maxHp > 0 && e.hp / e.maxHp < 0.5) {
            var bp = 0.5 + 0.5 * Math.sin((animTime || 0) * 9);
            ctx.save();
            ctx.strokeStyle = "rgba(255, 50, 70, " + (0.4 + bp * 0.35) + ")";
            ctx.lineWidth = 3;
            ctx.shadowColor = "#ff2244";
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius + 12 + bp * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        if (e.attackWindup > 0) {
            var tp = clamp(e.attackWindup / ENEMY_TELEGRAPH, 0, 1);
            ctx.save();
            ctx.strokeStyle = "rgba(255, 93, 108, " + (0.35 + tp * 0.45) + ")";
            ctx.lineWidth = 2 + tp * 2;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius + 6 + tp * 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        var c1 = e.isBoss ? "#ff5d6c" : e.archetype === "fast" ? "#6cf2a6" : e.archetype === "tank" ? "#b29bff" : e.archetype === "archer" ? "#ff8a3d" : e.archetype === "ranged" ? "#ff66aa" : "#ff8a3d";
        var c2 = e.isBoss ? "#7a1c2a" : e.archetype === "fast" ? "#1a4a30" : e.archetype === "tank" ? "#3a2860" : e.archetype === "archer" ? "#4a2110" : e.archetype === "ranged" ? "#5c1a40" : "#4a2110";
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath(); ctx.arc(e.x, e.y + 6, e.radius + 2, 0, Math.PI * 2); ctx.fill();
        if (e.archetype === "ranged" || e.archetype === "archer") {
            ctx.fillStyle = c1;
            ctx.beginPath();
            ctx.moveTo(e.x, e.y - e.radius);
            ctx.lineTo(e.x + e.radius, e.y + e.radius * 0.6);
            ctx.lineTo(e.x - e.radius, e.y + e.radius * 0.6);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = c2;
            ctx.beginPath();
            ctx.moveTo(e.x, e.y - e.radius + 5);
            ctx.lineTo(e.x + e.radius - 5, e.y + e.radius * 0.45);
            ctx.lineTo(e.x - e.radius + 5, e.y + e.radius * 0.45);
            ctx.closePath();
            ctx.fill();
        } else if (e.archetype === "tank") {
            ctx.fillStyle = c1;
            ctx.fillRect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
            ctx.fillStyle = c2;
            ctx.fillRect(e.x - e.radius + 4, e.y - e.radius + 4, e.radius * 2 - 8, e.radius * 2 - 8);
        } else if (e.archetype === "fast") {
            ctx.fillStyle = c1;
            ctx.beginPath();
            ctx.ellipse(e.x, e.y, e.radius * 0.75, e.radius, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = c2;
            ctx.beginPath();
            ctx.ellipse(e.x, e.y, e.radius * 0.55, e.radius - 4, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = c1;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = c2;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.radius - 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(e.x - 5, e.y - 3, 3, 3); ctx.fillRect(e.x + 2, e.y - 3, 3, 3);
        ctx.fillStyle = "#000";
        ctx.fillRect(e.x - 4, e.y - 2, 1, 1); ctx.fillRect(e.x + 3, e.y - 2, 1, 1);
        if (e.isElite) {
            ctx.strokeStyle = "#ffd166";
            ctx.lineWidth = 3;
            ctx.shadowColor = "#ffd166";
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        if (e.hitFlash > 0) {
            ctx.globalAlpha = clamp(e.hitFlash / 0.12, 0, 1) * 0.85;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        var w = e.isBoss ? 80 : 50;
        var pct = clamp(e.hp / e.maxHp, 0, 1);
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(e.x - w / 2 - 1, e.y - e.radius - 11, w + 2, 6);
        ctx.fillStyle = "#1a0a0a";
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 10, w, 4);
        ctx.fillStyle = e.isBoss ? "#ff5d6c" : "#ffd166";
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 10, w * pct, 4);
        ctx.restore();
    }

    function drawFireball(ctx, f) {
        var trail = f.trail || [];
        for (var ti = 0; ti < trail.length - 1; ti++) {
            var tp = trail[ti];
            var fade = (ti + 1) / trail.length * 0.45;
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.fillStyle = f.charged ? "#fff3b0" : "#ff8a3d";
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, FIREBALL_RADIUS - 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.save();
        ctx.shadowColor = f.charged ? "#ffe066" : "#ff8a3d";
        ctx.shadowBlur = f.charged ? 22 : 16;
        ctx.fillStyle = f.charged ? "#fff3b0" : "#ffd166";
        ctx.beginPath(); ctx.arc(f.x, f.y, f.charged ? FIREBALL_RADIUS + 2 : FIREBALL_RADIUS, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = f.charged ? "#fff" : "#fff3b0";
        ctx.beginPath(); ctx.arc(f.x - f.vx * 0.005, f.y - f.vy * 0.005, FIREBALL_RADIUS - 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    function drawShrine(ctx, s, animTime) {
        if (s.used) return;
        var bob = Math.sin((animTime || 0) * 3.2 + s.x * 0.01) * 4;
        var y = s.y + bob;
        ctx.save();
        ctx.shadowColor = "#ffd166";
        ctx.shadowBlur = 14 + Math.sin((animTime || 0) * 4) * 4;
        ctx.fillStyle = "#3a3018";
        ctx.fillRect(s.x - 12, y - 4, 24, 18);
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.moveTo(s.x, y - 22);
        ctx.lineTo(s.x + 14, y - 2);
        ctx.lineTo(s.x - 14, y - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255, 243, 176, 0.85)";
        ctx.beginPath();
        ctx.arc(s.x, y - 10, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawTreasure(ctx, t, animTime) {
        if (t.opened && (!t.openAnim || t.openAnim >= 1)) return;
        var color = t.type === "Health" ? "#6cf2a6" : t.type === "Strength" ? "#ffb46b" : t.type === "ScoreCache" ? "#ffd166" : "#b29bff";
        var bob = Math.sin((animTime || 0) * 4.5 + t.x * 0.02) * 3;
        var y = t.y + bob;
        var lidLift = t.openAnim ? t.openAnim * 14 : 0;
        ctx.save();
        ctx.globalAlpha = t.openAnim ? 1 - t.openAnim * 0.9 : 1;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 + Math.sin((animTime || 0) * 5) * 3;
        ctx.fillStyle = "#3b2412";
        ctx.fillRect(t.x - 14, y - 6 + lidLift * 0.2, 28, 16);
        ctx.fillStyle = color;
        ctx.fillRect(t.x - 12, y - 4 + lidLift * 0.2, 24, 12);
        ctx.fillStyle = "#2a1810";
        ctx.fillRect(t.x - 14, y - 10 - lidLift, 28, 8);
        ctx.fillStyle = color;
        ctx.globalAlpha *= 0.85;
        ctx.fillRect(t.x - 12, y - 9 - lidLift, 24, 5);
        ctx.restore();
    }

    function drawAimReticle(ctx, state) {
        if (state.phase !== STATE_PLAYING) return;
        var mx = state.input.mouseX;
        var my = state.input.mouseY;
        var s = 8;
        ctx.save();
        ctx.strokeStyle = "rgba(255, 209, 102, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx - s, my); ctx.lineTo(mx - 3, my);
        ctx.moveTo(mx + 3, my); ctx.lineTo(mx + s, my);
        ctx.moveTo(mx, my - s); ctx.lineTo(mx, my - 3);
        ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + s);
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 209, 102, 0.35)";
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /* ============================================================ *
     *  HUD
     * ============================================================ */
    function refreshHud(state) {
        var hpFill = el("hp-bar-fill"), mpFill = el("mp-bar-fill");
        var hpLabel = el("hp-bar-label"), mpLabel = el("mp-bar-label");
        var levelPill = el("level-pill");
        var scoreLabel = el("score"), bestLabel = el("best");
        var hudTimer = el("hud-timer");

        if (hpFill) hpFill.style.width = clamp((state.player.hp / state.player.maxHp) * 100, 0, 100) + "%";
        if (mpFill) mpFill.style.width = clamp((state.player.mp / PLAYER_MAX_MP) * 100, 0, 100) + "%";
        if (hpLabel) hpLabel.textContent = Math.max(0, Math.round(state.player.hp)) + " / " + state.player.maxHp;
        if (mpLabel) mpLabel.textContent = Math.max(0, Math.round(state.player.mp)) + " / " + PLAYER_MAX_MP;
        if (levelPill) levelPill.textContent = state.level >= 3 ? "Endless · Lv " + state.level : "Level " + state.level;
        var typingPill = el("hud-typing-tier");
        if (typingPill) {
            var hudTier = global.SentenceBank.getTier(getTypingTierId(state));
            typingPill.hidden = false;
            typingPill.textContent = hudTier.label + " ×" + formatTypingMult(hudTier.scoreMultiplier);
            typingPill.title = "Typing tier — harder tiers earn more score per kill";
        }
        if (scoreLabel) {
            scoreLabel.textContent = String(state.score).padStart(4, "0");
            if (state._lastHudScore >= 0 && state.score > state._lastHudScore) {
                scoreLabel.classList.remove("score-bump");
                void scoreLabel.offsetWidth;
                scoreLabel.classList.add("score-bump");
            }
            state._lastHudScore = state.score;
        }
        if (bestLabel) bestLabel.textContent = String(state.personalBest);

        if (hudTimer) {
            if (state.timerActive) {
                hudTimer.hidden = false;
                hudTimer.textContent = "TIME " + pad2(Math.max(0, Math.ceil(state.timer)));
            } else {
                hudTimer.hidden = true;
            }
        }

        renderBuffs(state);
        renderPotionToolbar(state);
        renderHotbar(state);
        renderDoorHint(state);
        renderMinimap(state);
        renderBossBar(state);

        var comboEl = el("hud-combo");
        if (comboEl) {
            if (state.comboCount >= 2 && state.comboTimer > 0) {
                comboEl.hidden = false;
                comboEl.textContent = "x" + state.comboCount + " COMBO";
            } else {
                comboEl.hidden = true;
            }
        }

        var hpPct = state.player.hp / state.player.maxHp;
        var lowHp = hpPct < 0.25;
        var criticalHp = hpPct < 0.15;
        var hpBar = el("hp-bar");
        if (hpBar) {
            if (lowHp) hpBar.classList.add("hp-low");
            else hpBar.classList.remove("hp-low");
            if (criticalHp) hpBar.classList.add("hp-critical");
            else hpBar.classList.remove("hp-critical");
        }
        var mpBar = el("mp-bar");
        var lowMp = state.player.mp < FIREBALL_COST;
        if (mpBar) {
            if (lowMp) mpBar.classList.add("mp-low");
            else mpBar.classList.remove("mp-low");
        }
        var wrap = el("canvas-wrap");
        if (wrap) {
            if (criticalHp) {
                wrap.classList.add("low-hp-danger");
                wrap.classList.remove("hp-danger");
            } else if (lowHp) {
                wrap.classList.add("hp-danger");
                wrap.classList.remove("low-hp-danger");
            } else {
                wrap.classList.remove("hp-danger", "low-hp-danger");
            }
        }

        if (criticalHp) {
            state.heartbeatAcc = (state.heartbeatAcc || 0) + 0.016;
            var beatInterval = 0.55 + hpPct * 1.2;
            if (state.heartbeatAcc >= beatInterval) {
                state.heartbeatAcc = 0;
                playSfx("heartbeat");
            }
        } else {
            state.heartbeatAcc = 0;
        }

        var roomsEl = el("hud-rooms");
        if (roomsEl && state.map) {
            var prog = getRoomProgress(state);
            roomsEl.textContent = "Rooms " + prog.cleared + "/" + prog.total;
            if (prog.total > 0 && prog.cleared >= prog.total) roomsEl.classList.add("all-clear");
            else roomsEl.classList.remove("all-clear");
        }

        var dashWrap = el("dash-cooldown");
        var dashFill = el("dash-cooldown-fill");
        if (dashFill) {
            var cd = state.player.dashCooldown || 0;
            var pct = cd > 0 ? clamp(1 - cd / DASH_COOLDOWN, 0, 1) * 100 : 100;
            dashFill.style.width = pct + "%";
            if (dashWrap) dashWrap.classList.toggle("ready", cd <= 0);
        }

        if (state.sessionPlayTime >= HINT_FADE_SEC) {
            var hint = el("hud-hint");
            if (hint) hint.classList.add("faded");
        }

        if (state.minimapHitFlash > 0) state.minimapHitFlash = Math.max(0, state.minimapHitFlash - 0.016);

        var ghost = el("score-ghost");
        if (ghost && state.personalBest > 0) {
            ghost.hidden = state.score >= state.personalBest;
            ghost.textContent = "→ " + String(state.personalBest).padStart(4, "0");
        }

        var seedEl = el("hud-seed");
        if (seedEl) {
            if (state.map && state.map.seed) {
                seedEl.hidden = false;
                seedEl.textContent = "Seed: " + state.map.seed;
            } else {
                seedEl.hidden = true;
            }
        }

        renderKillFeed(state);
        renderQuestObjectives(state);
        syncSoundButton();

        var minimapEl = el("hud-minimap");
        if (minimapEl) minimapEl.classList.toggle("spell-ready-pulse", hasHotbarCharge(state));
    }

    function findActiveBoss(state) {
        for (var i = 0; i < state.enemies.length; i++) {
            var e = state.enemies[i];
            if (e.active && e.isBoss && e.hp > 0) return e;
        }
        return null;
    }

    function renderBossBar(state) {
        var bar = el("boss-hp-bar");
        var fill = el("boss-hp-fill");
        var pctLabel = el("boss-hp-pct");
        if (!bar) return;
        var boss = findActiveBoss(state);
        if (!boss) {
            bar.hidden = true;
            return;
        }
        var pct = clamp((boss.hp / boss.maxHp) * 100, 0, 100);
        bar.hidden = false;
        if (fill) fill.style.width = pct + "%";
        if (pctLabel) pctLabel.textContent = Math.round(pct) + "%";
    }

    function renderMinimap(state) {
        var canvas = el("hud-minimap");
        if (!canvas || !state.map) return;
        var ctx = canvas.getContext("2d");
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "rgba(5, 8, 17, 0.92)";
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = "rgba(255, 209, 102, 0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

        var rooms = state.map.rooms;
        var minC = 99, minR = 99, maxC = 0, maxR = 0;
        for (var i = 0; i < rooms.length; i++) {
            if (rooms[i].col < minC) minC = rooms[i].col;
            if (rooms[i].row < minR) minR = rooms[i].row;
            if (rooms[i].col > maxC) maxC = rooms[i].col;
            if (rooms[i].row > maxR) maxR = rooms[i].row;
        }
        var gridW = maxC - minC + 1;
        var gridH = maxR - minR + 1;
        var pad = 10;
        var cell = Math.floor(Math.min((W - pad * 2) / gridW, (H - pad * 2) / gridH));

        function minimapRoomCenter(idx) {
            var rm = rooms[idx];
            var rx = pad + (rm.col - minC) * cell;
            var ry = pad + (rm.row - minR) * cell;
            var rw = cell - 3;
            var rh = cell - 3;
            return { x: rx + rw / 2, y: ry + rh / 2 };
        }

        var edges = state.map.edges || [];
        if (edges.length) {
            ctx.strokeStyle = "rgba(255, 209, 102, 0.28)";
            ctx.lineWidth = 1;
            for (var ei = 0; ei < edges.length; ei++) {
                var edge = edges[ei];
                if (!state.revealedRooms[edge.from] || !state.revealedRooms[edge.to]) continue;
                var a = minimapRoomCenter(edge.from);
                var b = minimapRoomCenter(edge.to);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }

        for (var ri = 0; ri < rooms.length; ri++) {
            var rm = rooms[ri];
            var rx = pad + (rm.col - minC) * cell;
            var ry = pad + (rm.row - minR) * cell;
            var rw = cell - 3;
            var rh = cell - 3;
            var visited = !!state.visitedRooms[ri];
            var revealed = !!state.revealedRooms[ri];
            var isCurrent = state.currentRoomIndex === ri;
            var isBoss = ri === state.map.bossIndex;
            var isStart = ri === state.map.startIndex;

            if (!revealed) {
                ctx.fillStyle = "#0a0e18";
            } else if (!visited) {
                ctx.fillStyle = "#141c30";
            } else if (isBoss) {
                ctx.fillStyle = "#4a1830";
            } else if (isStart) {
                ctx.fillStyle = "#1a3050";
            } else {
                ctx.fillStyle = "#1e2d4a";
            }
            ctx.fillRect(rx, ry, rw, rh);

            if (isCurrent) {
                ctx.strokeStyle = "#6cf2a6";
                ctx.lineWidth = 2;
                ctx.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2);
            }

            if (revealed) {
                ctx.fillStyle = visited ? "#e8eef8" : "#6a7a9a";
                ctx.font = "bold 9px monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                var label = isStart ? "S" : isBoss ? "B" : visited ? "" : "?";
                if (label) ctx.fillText(label, rx + rw / 2, ry + rh / 2);
            }
        }

        if (state.minimapHitFlash > 0) {
            var hf = clamp(state.minimapHitFlash / 0.4, 0, 1);
            ctx.strokeStyle = "rgba(255, 93, 108, " + (0.35 + hf * 0.55) + ")";
            ctx.lineWidth = 2 + hf * 2;
            ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
        }

        if (hasHotbarCharge(state) && state.currentRoomIndex >= 0) {
            var pulse = 0.5 + 0.5 * Math.sin((state.animTime || 0) * 7);
            var pc = minimapRoomCenter(state.currentRoomIndex);
            ctx.fillStyle = "rgba(108, 242, 166, " + (0.35 + pulse * 0.55) + ")";
            ctx.beginPath();
            ctx.arc(pc.x, pc.y, 3 + pulse * 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function renderDoorHint(state) {
        var hint = el("door-hint");
        if (!hint) return;
        var hintOk = state.phase === STATE_PLAYING || state.phase === STATE_START_TUTORIAL;
        if (!hintOk) {
            hint.hidden = true;
            hint.classList.remove("pickup-hint");
            return;
        }

        var potion = findNearbyGroundPotion(state);
        if (potion) {
            hint.classList.remove("locked");
            hint.classList.add("pickup-hint");
            var label = potion.type === "Health" ? "health potion" : potion.type.toLowerCase() + " potion";
            hint.innerHTML = 'Press <kbd>E</kbd> to pick up <b>' + label + "</b>";
            hint.hidden = false;
            return;
        }
        hint.classList.remove("pickup-hint");

        var shrine = findNearbyShrine(state);
        if (shrine && !shrine.used) {
            hint.classList.remove("locked");
            hint.innerHTML = 'Press <kbd>E</kbd> at <b>mystic shrine</b>';
            hint.hidden = false;
            return;
        }

        var door = findNearbyDoor(state);
        if (!door) { hint.hidden = true; return; }
        var fromCleared = state.map.rooms[door.fromIndex].cleared;
        var toCleared   = state.map.rooms[door.toIndex].cleared;
        if (fromCleared || toCleared) {
            hint.classList.remove("locked");
            hint.innerHTML = 'Press <kbd>E</kbd> to open — <b>unknown room</b> ahead';
        } else {
            hint.classList.add("locked");
            hint.innerHTML = 'Locked — defeat all enemies in this room first';
        }
        hint.hidden = false;
    }

    function renderBuffs(state) {
        var holder = el("hud-buffs");
        if (!holder) return;
        var html = "";
        if (state.player.invincibleTimer > 0) html += buffMarkup("INV", state.player.invincibleTimer, BUFF_DURATION, "#b29bff");
        if (state.player.strengthTimer > 0) html += buffMarkup("STR", state.player.strengthTimer, BUFF_DURATION, "#ffb46b");
        holder.innerHTML = html;
    }

    function buffMarkup(name, timeLeft, total, color) {
        var pct = clamp((timeLeft / total) * 100, 0, 100);
        return (
            '<div class="buff-icon" style="border-color:' + color + '">' +
            '<div class="buff-fill" style="height:' + pct + "%;background:" + color + '33"></div>' +
            '<span class="buff-name" style="color:' + color + '">' + name + "</span>" +
            '<span class="buff-time">' + Math.ceil(timeLeft) + "s</span>" +
            "</div>"
        );
    }

    function countHotbarCharges(state) {
        var n = 0;
        for (var i = 0; i < state.spellHotbar.length; i++) {
            if (state.spellHotbar[i]) n++;
        }
        return n;
    }

    function countPotionInInventory(inv, name) {
        var n = 0;
        for (var i = 0; i < inv.length; i++) {
            if (inv[i] === name) n++;
        }
        return n;
    }

    function findFirstInventorySlot(inv, name) {
        for (var i = 0; i < inv.length; i++) {
            if (inv[i] === name) return i;
        }
        return -1;
    }

    function useQuickPotion(state, potionName) {
        if (state.phase !== STATE_PLAYING) return false;
        var slot = findFirstInventorySlot(state.inventory, potionName);
        if (slot < 0) {
            showToast(state, "No " + potionName + " potion in inventory", 1000);
            return false;
        }
        return consumePotion(state, slot);
    }

    function renderPotionToolbar(state) {
        var holder = el("hud-potion-bar");
        if (!holder) return;
        var sig = QUICK_POTION_TYPES.map(function (t) {
            return t + ":" + countPotionInInventory(state.inventory, t);
        }).join("|");
        if (holder.dataset.sig === sig) return;
        holder.dataset.sig = sig;
        holder.innerHTML = "";
        for (var qi = 0; qi < QUICK_POTION_TYPES.length; qi++) {
            var type = QUICK_POTION_TYPES[qi];
            var count = countPotionInInventory(state.inventory, type);
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "potion-slot " + type.toLowerCase();
            btn.dataset.potion = type;
            btn.disabled = count <= 0;
            btn.title = (POTION_TOOLTIPS[type] || type) + " — press " + (qi + 1);
            btn.setAttribute("aria-label", type + " potion, " + count + " in inventory");
            btn.innerHTML =
                '<span class="potion-key">' + (qi + 1) + "</span>" +
                '<span class="potion-glyph">' + (QUICK_POTION_GLYPHS[type] || type[0]) + "</span>" +
                '<span class="potion-label">' + type.slice(0, 4) + "</span>" +
                '<span class="potion-count">' + count + "</span>";
            holder.appendChild(btn);
        }
    }

    function renderHotbar(state) {
        var holder = el("hud-hotbar");
        var countEl = el("hud-fireball-count");
        var charges = countHotbarCharges(state);
        if (countEl) {
            countEl.textContent = "Fireballs: " + charges;
            countEl.classList.toggle("has-charges", charges > 0);
        }
        if (!holder) return;
        var html = "";
        for (var i = 0; i < HOTBAR_SIZE; i++) {
            var slot = state.spellHotbar[i];
            var hasSpell = !!slot;
            html += '<div class="hotbar-slot' + (hasSpell ? " has-spell has-charge" : "") + '">';
            html += '<span class="hotbar-num">' + (i + 1) + "</span>";
            html += '<span class="hotbar-name">' + escapeHtml(hasSpell ? slot : "—") + "</span>";
            if (hasSpell) html += '<span class="hotbar-badge">●</span>';
            html += "</div>";
        }
        holder.innerHTML = html;
    }

    function showToast(state, message, ms) {
        var node = el("hud-toast");
        if (!node) return;
        node.textContent = message;
        node.hidden = false;
        clearTimeout(state._toastTimer);
        state._toastTimer = setTimeout(function () { node.hidden = true; }, ms || 1400);
    }

    /* ============================================================ *
     *  Inventory
     * ============================================================ */
    function ensureInventoryShape(arr) {
        var inv = Array.isArray(arr) ? arr.slice() : [];
        while (inv.length < INVENTORY_SIZE) inv.push("EMPTY");
        if (inv.length > INVENTORY_SIZE) inv.length = INVENTORY_SIZE;
        for (var i = 0; i < inv.length; i++) {
            if (inv[i] == null || inv[i] === "" || inv[i] === "EMPTY") inv[i] = "EMPTY";
        }
        return inv;
    }

    function defaultInventory() {
        var inv = new Array(INVENTORY_SIZE);
        for (var i = 0; i < INVENTORY_SIZE; i++) inv[i] = "EMPTY";
        inv[0] = "Health";
        inv[1] = "Invincibility";
        inv[2] = "Strength";
        return inv;
    }

    function inventoryCount(inv) {
        var n = 0;
        for (var i = 0; i < inv.length; i++) if (inv[i] !== "EMPTY") n++;
        return n;
    }

    function addToInventory(state, item) {
        for (var i = 0; i < state.inventory.length; i++) {
            if (state.inventory[i] === "EMPTY") {
                state.inventory[i] = item;
                renderInventoryGrid(state);
                var potionBarAdd = el("hud-potion-bar");
                if (potionBarAdd) potionBarAdd.dataset.sig = "";
                return true;
            }
        }
        showToast(state, "Inventory full", 1100);
        return false;
    }

    function consumePotion(state, slotIndex) {
        var item = state.inventory[slotIndex];
        if (!item || item === "EMPTY") return false;
        var p = state.player;
        if (item === "Health") {
            if (p.hp >= p.maxHp) {
                showToast(state, "Already at full health", 1100);
                return false;
            }
            p.hp = Math.min(p.maxHp, p.hp + POTION_HEAL);
            addFloatText(state, p.x, p.y - 22, "+" + POTION_HEAL, "#6cf2a6", { scale: 1.15 });
            playSfx("heal");
            showToast(state, "Used Health potion · +" + POTION_HEAL + " HP", 1100);
        } else if (item === "Strength") {
            p.strengthTimer = BUFF_DURATION;
            showToast(state, "Used Strength potion · 90s", 1100);
        } else if (item === "Invincibility") {
            p.invincibleTimer = BUFF_DURATION;
            showToast(state, "Used Invincibility potion · 90s", 1100);
        } else {
            return false;
        }
        state.inventory[slotIndex] = "EMPTY";
        state.selectedInventorySlot = -1;
        renderInventoryGrid(state);
        var potionBar = el("hud-potion-bar");
        if (potionBar) potionBar.dataset.sig = "";
        return true;
    }

    function renderInventoryGrid(state) {
        var grid = el("inventory-grid");
        if (!grid) return;
        grid.innerHTML = "";
        for (var i = 0; i < INVENTORY_SIZE; i++) {
            var item = state.inventory[i];
            var hasItem = item !== "EMPTY";
            var classes = ["inv-cell"];
            if (hasItem) {
                classes.push("has-item");
                classes.push(item.toLowerCase());
            }
            if (state.selectedInventorySlot === i) classes.push("selected");

            var cell = document.createElement("div");
            cell.className = classes.join(" ");
            cell.dataset.slot = String(i);

            if (hasItem) {
                cell.title = POTION_TOOLTIPS[item] || item;
                var glyph = document.createElement("span");
                glyph.className = "inv-glyph";
                glyph.textContent = item[0];
                cell.appendChild(glyph);
                var label = document.createElement("span");
                label.textContent = item;
                cell.appendChild(label);
            } else {
                cell.textContent = "Empty";
            }

            cell.addEventListener("click", (function (idx) {
                return function () {
                    if (state.inventory[idx] === "EMPTY") return;
                    state.selectedInventorySlot = idx;
                    renderInventoryGrid(state);
                };
            })(i));

            grid.appendChild(cell);
        }
    }

    function openInventory(state) {
        if (state.phase !== STATE_PLAYING) return;
        state.phase = STATE_INVENTORY;
        state.selectedInventorySlot = -1;
        renderInventoryGrid(state);
        show(el("inventory-overlay"));
    }

    function closeInventory(state) {
        state.phase = STATE_PLAYING;
        state.selectedInventorySlot = -1;
        hide(el("inventory-overlay"));
    }

    /* ============================================================ *
     *  Spell casting
     * ============================================================ */
    function startSpellCast(state) {
        if (state.phase !== STATE_PLAYING) return;
        var hotbarFree = -1;
        for (var i = 0; i < state.spellHotbar.length; i++) {
            if (!state.spellHotbar[i]) { hotbarFree = i; break; }
        }
        if (hotbarFree === -1) {
            showToast(state, "Spell hotbar full", 1100);
            return;
        }
        state.phase = STATE_SPELLCAST;
        state.spellTargetSlot = hotbarFree;
        var spellCast = global.SentenceBank.pickSpellForCast(state.level, getTypingTierId(state));
        state.spellSentence = spellCast.sentence;
        state.spellTimeLimit = spellCast.timeLimitSec;
        state.spellTyped = "";
        state.spellTimer = spellCast.timeLimitSec;
        state.spellStart = performance.now();
        state.spellAlertTimer = 0;
        state.spellAlertText = "";
        state.spellPendingResult = null;

        var input = el("spell-input");
        if (input) {
            input.value = "";
            input.disabled = false;
            setTimeout(function () { input.focus(); }, 0);
        }
        var alert = el("spell-alert");
        if (alert) { alert.hidden = true; alert.textContent = ""; }
        var gradeNode = el("spell-grade");
        if (gradeNode) { gradeNode.hidden = true; gradeNode.textContent = ""; }

        show(el("spell-overlay"));
        updateSpellLabel(state);
    }

    function updateSpellLabel(state) {
        var prompt = el("spell-prompt");
        var stats = el("spell-stats");
        if (!prompt || !stats) return;

        var typed = state.spellTyped;
        var target = state.spellSentence;

        var errors = 0;
        var html = "";

        for (var i = 0; i < target.length; i++) {
            if (i < typed.length) {
                var ch = typed.charAt(i);
                var display = escapeHtml(ch);
                if (ch === " ") display = "&nbsp;";
                if (ch === target.charAt(i)) {
                    html += '<span class="ok">' + display + "</span>";
                } else {
                    errors++;
                    html += '<span class="err">' + display + "</span>";
                }
            } else {
                var pendingCh = target.charAt(i);
                var pendingDisplay = escapeHtml(pendingCh);
                if (pendingCh === " ") pendingDisplay = "&nbsp;";
                html += '<span class="pending">' + pendingDisplay + "</span>";
            }
        }
        if (typed.length < target.length) {
            html += '<span class="spell-caret" aria-hidden="true"></span>';
        }
        state.spellErrors = errors;
        prompt.innerHTML = html;

        var elapsed = (performance.now() - state.spellStart) / 1000;
        var mins = Math.max(elapsed / 60, 1 / 60);
        var correctChars = typed.length - errors;
        var wpm = typed.length > 0 ? Math.round((correctChars / 5) / mins) : 0;
        var acc = typed.length > 0 ? Math.floor((correctChars / typed.length) * 100) : 100;

        var tierId = getTypingTierId(state);
        var tier = global.SentenceBank.getTier(tierId);
        var timing = global.SentenceBank.getTierTiming(tierId);
        var multLabel = formatTypingMult(tier.scoreMultiplier);
        if (stats) stats.textContent = "";

        var tierLine = el("spell-tier-line");
        if (tierLine) {
            var spellLimit = state.spellTimeLimit != null ? state.spellTimeLimit : tier.timeLimitSec;
            tierLine.textContent = tier.label + " · goal " + timing.accuracyGoalLabel + " · score ×" + multLabel + " · limit " + spellLimit.toFixed(0) + "s";
        }

        var timerDisp = el("spell-timer-display");
        if (timerDisp) {
            timerDisp.textContent = state.spellTimer.toFixed(1) + "s";
            if (state.spellTimer <= 3) timerDisp.classList.add("spell-timer-urgent");
            else timerDisp.classList.remove("spell-timer-urgent");
        }

        var wpmGoal = Math.max(1, timing.targetWpm || SPELL_WPM_GOAL);
        var charPct = target.length > 0 ? clamp((typed.length / target.length) * 100, 0, 100) : 0;
        var wpmPct = clamp((wpm / wpmGoal) * 100, 0, 100);
        var wpmFill = el("spell-wpm-fill");
        var accFill = el("spell-acc-fill");
        if (wpmFill) wpmFill.style.width = Math.max(charPct, wpmPct) + "%";
        if (accFill) accFill.style.width = clamp(acc, 0, 100) + "%";

        var wpmVal = el("spell-wpm-value");
        var accVal = el("spell-acc-value");
        if (wpmVal) wpmVal.textContent = wpm + " · " + typed.length + "/" + target.length;
        if (accVal) accVal.textContent = acc + "%";
    }

    function updateSpellCast(state, dt) {
        if (state.spellAlertTimer > 0) {
            state.spellAlertTimer -= dt;
            if (state.spellAlertTimer <= 0) {
                finalizeSpellCast(state, !!state.spellPendingResult);
            }
            return;
        }
        state.spellTimer -= dt;
        if (state.spellTimer <= 0) {
            state.spellTimer = 0;
            updateSpellLabel(state);
            failSpellCast(state, "Time's up!");
            return;
        }
        updateSpellLabel(state);
    }

    function failSpellCast(state, message) {
        if (state.spellPendingResult !== null) return;
        state.spellLoadStreak = 0;
        state.spellPendingResult = false;
        state.spellAlertTimer = 1.2;
        var alert = el("spell-alert");
        if (alert) { alert.textContent = message; alert.hidden = false; }
        var input = el("spell-input");
        if (input) input.disabled = true;
    }

    function finalizeSpellCast(state, success) {
        var elapsed = (performance.now() - state.spellStart) / 1000;
        var mins = elapsed / 60;
        var correctChars = state.spellTyped.length - state.spellErrors;
        var wpm = mins > 0 ? (correctChars / 5) / mins : 0;
        var acc = state.spellTyped.length > 0 ? (correctChars / state.spellTyped.length) * 100 : 100;

        try {
            var base = global.Storage.utils.stripSlot(state.username);
            global.Storage.Players.updateStatistics(base, wpm, acc, state.spellErrors, Math.floor(elapsed));
            if (state.username !== base) {
                global.Storage.Players.updateStatistics(state.username, wpm, acc, state.spellErrors, Math.floor(elapsed));
            }
        } catch (_e) { /* ignore */ }

        if (success && state.spellTargetSlot >= 0) {
            state.spellHotbar[state.spellTargetSlot] = "Fireball";
            triggerSpellSuccessFlash(state);
            state.spellLoadStreak = (state.spellLoadStreak | 0) + 1;
            if (state.spellLoadStreak >= 2) {
                state.spellStreakBuffTimer = SPELL_STREAK_BUFF_TIME;
                unlockAchievement("spell_streak");
                var bonusSlot = -1;
                for (var si = 0; si < state.spellHotbar.length; si++) {
                    if (!state.spellHotbar[si]) { bonusSlot = si; break; }
                }
                if (bonusSlot >= 0) {
                    state.spellHotbar[bonusSlot] = "Fireball";
                    showToast(state, "Spell streak! +1 hotbar charge", 1600);
                } else {
                    showToast(state, "Spell streak! Hotbar full", 1400);
                }
                state.spellLoadStreak = 0;
            }
            var grade = computeSpellGrade(wpm, acc, state);
            var gradeNodeOk = el("spell-grade");
            if (gradeNodeOk) {
                gradeNodeOk.hidden = false;
                gradeNodeOk.textContent = "Grade " + grade;
                gradeNodeOk.className = "spell-grade grade-" + grade.toLowerCase();
            }
            var spellPts = applyTypingScore(state, SPELL_SUCCESS_SCORE);
            state.score += spellPts;
            var wpmMsg = "Grade " + grade + " · " + Math.round(wpm) + " WPM · " + Math.round(acc) + "% · +" + spellPts;
            addFloatText(state, state.player.x, state.player.y - 36, grade, grade === "S" ? "#fff3b0" : grade === "A" ? "#6cf2a6" : grade === "B" ? "#6ec1ff" : "#a8b4cc", { scale: 1.35, vy: -48, life: 1.1 });
            addFloatText(state, state.player.x, state.player.y - 52, "+" + spellPts, "#ffd166", { scale: 1.1, vy: -42, life: 0.9 });
            showToast(state, "Spell loaded! · " + wpmMsg, 1600);
        } else {
            state.spellLoadStreak = 0;
            showToast(state, "Spell failed", 1100);
        }

        hide(el("spell-overlay"));
        var input = el("spell-input");
        if (input) input.blur();

        state.spellPendingResult = null;
        state.spellTargetSlot = -1;
        state.phase = STATE_PLAYING;
    }

    function handleSpellKey(state, key, ev) {
        if (key === "escape") {
            failSpellCast(state, "Cancelled");
            ev.preventDefault();
            return;
        }
        // Input element drives typing — we only listen to escape here.
    }

    function onSpellInput(state, value) {
        if (state.phase !== STATE_SPELLCAST) return;
        if (state.spellAlertTimer > 0) return;
        var target = state.spellSentence;
        if (value.length > target.length) value = value.substring(0, target.length);
        state.spellTyped = value;
        updateSpellLabel(state);

        if (state.spellTyped.length === target.length) {
            if (state.spellErrors === 0) {
                state.spellPendingResult = true;
                state.spellAlertTimer = 0.4;
                var elapsedOk = (performance.now() - state.spellStart) / 1000;
                var minsOk = elapsedOk / 60;
                var correctOk = state.spellTyped.length - (state.spellErrors | 0);
                var wpmOk = minsOk > 0 ? (correctOk / 5) / minsOk : 0;
                var accOk = state.spellTyped.length > 0 ? (correctOk / state.spellTyped.length) * 100 : 100;
                var gradePreview = computeSpellGrade(wpmOk, accOk, state);
                var alert = el("spell-alert");
                if (alert) {
                    alert.textContent = "Spell ready! Grade " + gradePreview;
                    alert.classList.remove("err");
                    alert.style.color = "var(--good)";
                    alert.hidden = false;
                }
                var gradePreviewNode = el("spell-grade");
                if (gradePreviewNode) {
                    gradePreviewNode.hidden = false;
                    gradePreviewNode.textContent = "Grade " + gradePreview;
                    gradePreviewNode.className = "spell-grade grade-" + gradePreview.toLowerCase();
                }
            } else {
                failSpellCast(state, "Spell failed!");
            }
        }
    }

    /* ============================================================ *
     *  Game state machine
     * ============================================================ */
    function createState(username, role) {
        return {
            phase: STATE_PLAYING,
            username: username,
            baseUsername: global.Storage.utils.stripSlot(username),
            role: role,
            level: 1,
            score: 0,
            personalBest: 0,
            player: makePlayer(),
            map: null,
            enemies: [],
            treasures: [],
            fireballs: [],
            timerActive: false,
            timer: 0,
            timeLimit: 0,
            level3TimeLimit: LEVEL3_BASE_TIME,
            input: createInput(),
            shake: 0,
            inventory: defaultInventory(),
            spellHotbar: new Array(HOTBAR_SIZE),
            selectedInventorySlot: -1,
            spellSentence: "",
            spellTyped: "",
            spellTimer: 0,
            spellTimeLimit: 0,
            spellStart: 0,
            spellErrors: 0,
            spellAlertTimer: 0,
            spellPendingResult: null,
            spellTargetSlot: -1,
            typingTier: global.SentenceBank.getStoredTierId(),
            _noChargeWarn: 0,
            visitedRooms: {},
            revealedRooms: {},
            currentRoomIndex: -1,
            floatTexts: [],
            particles: [],
            levelFlash: 0,
            animTime: 0,
            achFirstKill: false,
            achCombo5: false,
            achExplorer: false,
            comboCount: 0,
            comboTimer: 0,
            runKills: 0,
            runMaxCombo: 0,
            spellLoadStreak: 0,
            spellStreakBuffTimer: 0,
            enemyShots: [],
            minimapHitFlash: 0,
            bossIntroShown: false,
            dashHintShown: false,
            comboAuraGranted: false,
            comboDamageAura: 0,
            comboRampageGranted: false,
            rampageTimer: 0,
            killFeed: [],
            shrines: [],
            damageIndicator: null,
            heartbeatAcc: 0,
            _lastHudScore: -1,
            sessionPlayTime: 0,
        };
    }

    function registerKillCombo(state) {
        if (state.comboTimer > 0) state.comboCount = Math.min(state.comboCount + 1, 12);
        else state.comboCount = 1;
        state.comboTimer = 3.5;
        state.runMaxCombo = Math.max(state.runMaxCombo | 0, state.comboCount);
        state.runKills = (state.runKills | 0) + 1;
        if (state.comboCount === 5 && !state.comboAuraGranted) {
            state.comboAuraGranted = true;
            state.comboDamageAura = 5;
            showToast(state, "Combo x5 — damage aura!", 1500);
            spawnChestParticles(state, state.player.x, state.player.y, "#ffb46b");
        }
        if (state.comboCount >= RAMPAGE_COMBO && !state.comboRampageGranted) {
            state.comboRampageGranted = true;
            triggerRampage(state);
        }
    }

    function loadIntoState(state) {
        var record = global.Storage.Players.getOrCreate(state.username);
        var ss = record && record.saveState ? record.saveState : global.Storage.utils.defaultSaveState();
        state.level = Math.max(1, ss.currentStage | 0);
        state.score = Math.max(0, ss.currentScore | 0);
        state.player = makePlayer(ss.currentHealth);

        var savedInventory = Array.isArray(ss.inventory) ? ss.inventory : [];
        var freshRun = state.level === 1 && state.score === 0 && savedInventory.length === 0;
        state.isFreshRun = freshRun;
        state.inventory = freshRun ? defaultInventory() : ensureInventoryShape(savedInventory);
        state.level3TimeLimit = ss.level3TimeLimit > 0 ? ss.level3TimeLimit : LEVEL3_BASE_TIME;

        // If a level-3 snapshot exists, prefer that (it was captured the moment the
        // shrinking timer started, so dying mid-run keeps players honest).
        if (state.level >= 3 && Array.isArray(ss.snapshotInventory) && ss.snapshotInventory.length) {
            state.score = ss.snapshotScore | 0;
            state.inventory = ensureInventoryShape(ss.snapshotInventory);
        }
        if (ss.typingTier && global.SentenceBank.TIERS[ss.typingTier]) {
            state.typingTier = ss.typingTier;
            global.SentenceBank.setStoredTierId(ss.typingTier);
        } else if (!state.typingTier || !global.SentenceBank.TIERS[state.typingTier]) {
            state.typingTier = global.SentenceBank.getStoredTierId();
        }
        state.personalBest = global.Leaderboard.getPersonalBest(state.baseUsername);
    }

    function persistTypingTier(state) {
        if (!state || !state.username) return;
        var tierId = getTypingTierId(state);
        state.typingTier = tierId;
        global.Storage.Players.updateTypingTier(state.username, tierId);
    }

    function autoSave(state) {
        global.Storage.Players.updateSaveState(
            state.username,
            state.level,
            Math.max(1, Math.round(state.player.hp)),
            state.inventory,
            state.score,
            getTypingTierId(state)
        );
        if (state.map && state.map.seed) {
            var player = global.Storage.Players.getOrCreate(state.username);
            if (player && player.saveState) {
                player.saveState.mapSeed = state.map.seed;
                global.Storage.Players.save(player);
            }
        }
    }

    function advanceLevel(state) {
        state.level += 1;
        state.player.hp = state.player.maxHp;
        state.player.mp = PLAYER_MAX_MP;
        state.player.mpFloat = PLAYER_MAX_MP;
        spawnLevel(state);
        if (state.level >= 3) {
            // Snapshot is consulted on resume so a half-finished timed run
            // restarts from the score / inventory it had when the timer began.
            global.Storage.Players.createLevel3Snapshot(state.username, state.score, state.inventory);
        }
        autoSave(state);
        state.levelFlash = 0.75;
        playSfx("levelClear");
        showToast(state, "Level cleared!", 1600);
        clearTimeout(state._levelToastTimer);
        state._levelToastTimer = setTimeout(function () {
            var tierLabel = global.SentenceBank ? global.SentenceBank.getTierLabel(getTypingTierId(state)) : "";
            showToast(state, "LEVEL " + state.level + (tierLabel ? " · " + tierLabel : ""), 1600);
        }, 1700);
    }

    function isStartTutorialDismissed() {
        try {
            return localStorage.getItem(START_TUTORIAL_KEY) === "1";
        } catch (_e) {
            return false;
        }
    }

    function dismissStartTutorial(state, persist) {
        var overlay = el("overlay-start-tutorial");
        if (overlay) overlay.hidden = true;
        var actionBar = el("hud-action-bar");
        if (actionBar) actionBar.classList.remove("start-tutorial-highlight");
        if (state && state.phase === STATE_START_TUTORIAL) state.phase = STATE_PLAYING;
        if (persist) {
            try {
                localStorage.setItem(START_TUTORIAL_KEY, "1");
            } catch (_e) { /* ignore */ }
        }
    }

    function maybeShowStartTutorial(state) {
        if (!state || !state.isFreshRun || isStartTutorialDismissed()) return;
        var overlay = el("overlay-start-tutorial");
        if (!overlay) return;
        state.phase = STATE_START_TUTORIAL;
        overlay.hidden = false;
        var actionBar = el("hud-action-bar");
        if (actionBar) actionBar.classList.add("start-tutorial-highlight");
    }

    function gameOver(state) {
        state.phase = STATE_GAMEOVER;

        var result = global.Leaderboard.addScore(state.baseUsername, state.score) || {
            personalBest: state.personalBest,
            newPersonalBest: false,
        };
        state.personalBest = result.personalBest;

        global.Storage.Players.resetSaveState(state.username);

        var prog = getRoomProgress(state);
        var node = el("result-score"); if (node) node.textContent = String(state.score);
        node = el("result-level"); if (node) node.textContent = String(state.level);
        node = el("result-rooms"); if (node) node.textContent = prog.cleared + "/" + prog.total;
        node = el("result-kills"); if (node) node.textContent = String(state.runKills | 0);
        node = el("result-combo"); if (node) node.textContent = "x" + (state.runMaxCombo | 0);
        node = el("result-best"); if (node) node.textContent = String(result.personalBest);
        var newRow = el("result-newbest-row"); if (newRow) newRow.hidden = !result.newPersonalBest;
        var coinsEarned = 0;
        if (global.Meta) {
            coinsEarned = global.Meta.coinsFromScore(state.score);
            if (coinsEarned > 0) global.Meta.addCoins(state.baseUsername, coinsEarned);
        }
        var coinsRow = el("result-coins-row");
        var coinsNode = el("result-coins");
        if (coinsRow && coinsNode) {
            if (coinsEarned > 0) {
                coinsRow.hidden = false;
                coinsNode.textContent = "+" + coinsEarned;
            } else {
                coinsRow.hidden = true;
            }
        }
        show(el("overlay-gameover"));
    }

    /* ============================================================ *
     *  Input
     * ============================================================ */
    function createInput() {
        return {
            keys: Object.create(null),
            mouseX: 0, mouseY: 0,
            mouseDown: false,
            shoot: false,
            dashPressed: false,
            touchMoveX: 0,
            touchMoveY: 0,
            touchShoot: false,
        };
    }

    var keydownHandler = null;
    var keyupHandler = null;
    var mousemoveHandler = null;
    var mousedownHandler = null;
    var mouseupHandler = null;
    var contextmenuHandler = null;

    function bindInputs(state, canvas) {
        keydownHandler = function (e) {
            var k = (e.key || "").toLowerCase();

            if (state.phase === STATE_START_TUTORIAL) {
                if (k === "escape" || k === "enter" || k === " ") {
                    dismissStartTutorial(state, true);
                    e.preventDefault();
                }
                return;
            }
            if (state.phase === STATE_SPELLCAST) {
                handleSpellKey(state, k, e);
                return;
            }
            if (state.phase === STATE_INVENTORY) {
                if (k === "escape" || k === "tab") {
                    closeInventory(state);
                    e.preventDefault();
                    return;
                }
                if (k === "enter" || k === " " || k === "spacebar") {
                    if (state.selectedInventorySlot >= 0) {
                        var used = consumePotion(state, state.selectedInventorySlot);
                        if (used) closeInventory(state);
                    } else {
                        showToast(state, "Pick a potion first", 900);
                    }
                    e.preventDefault();
                    return;
                }
                if (k.length === 1 && k >= "1" && k <= "9") {
                    var slot = parseInt(k, 10) - 1;
                    if (slot < INVENTORY_SIZE && state.inventory[slot] && state.inventory[slot] !== "EMPTY") {
                        var used2 = consumePotion(state, slot);
                        if (used2) closeInventory(state);
                    }
                    e.preventDefault();
                    return;
                }
                return;
            }
            if (state.phase === STATE_GAMEOVER) {
                if (k === "r" || k === "enter") {
                    triggerQuickRetry(state);
                    e.preventDefault();
                }
                return;
            }

            if (e.repeat) return;
            state.input.keys[k] = true;

            if (k === "escape") {
                if (state.phase === STATE_PLAYING) {
                    state.phase = STATE_PAUSED;
                    populateRunStats(state, "pause-stats");
                    show(el("overlay-pause"));
                } else if (state.phase === STATE_PAUSED) {
                    state.phase = STATE_PLAYING;
                    hide(el("overlay-pause"));
                }
                e.preventDefault();
                return;
            }

            if (state.phase !== STATE_PLAYING) return;

            if (k === "tab") {
                openInventory(state);
                e.preventDefault();
                return;
            }
            if (k.length === 1 && k >= "1" && k <= "3") {
                useQuickPotion(state, QUICK_POTION_TYPES[parseInt(k, 10) - 1]);
                e.preventDefault();
                return;
            }
            if (k === "enter") {
                startSpellCast(state);
                e.preventDefault();
                return;
            }
            if (k === "e") {
                tryInteract(state);
                e.preventDefault();
                return;
            }
            if (k === " " || k === "spacebar") {
                state.input.shoot = true;
                e.preventDefault();
            }
            if (k === "shift") {
                state.input.dashPressed = true;
                e.preventDefault();
            }
        };

        keyupHandler = function (e) {
            var k = (e.key || "").toLowerCase();
            state.input.keys[k] = false;
            if (k === " " || k === "spacebar") state.input.shoot = false;
        };

        mousemoveHandler = function (e) {
            var rect = canvas.getBoundingClientRect();
            state.input.mouseX = ((e.clientX - rect.left) / rect.width) * VIEW_W;
            state.input.mouseY = ((e.clientY - rect.top) / rect.height) * VIEW_H;
        };

        mousedownHandler = function (e) {
            if (state.phase !== STATE_PLAYING) return;
            state.input.mouseDown = true;
            state.input.shoot = true;
            e.preventDefault();
        };

        mouseupHandler = function () {
            state.input.mouseDown = false;
            state.input.shoot = false;
        };

        contextmenuHandler = function (e) { e.preventDefault(); };

        window.addEventListener("keydown", keydownHandler);
        window.addEventListener("keyup", keyupHandler);
        canvas.addEventListener("mousemove", mousemoveHandler);
        canvas.addEventListener("mousedown", mousedownHandler);
        window.addEventListener("mouseup", mouseupHandler);
        canvas.addEventListener("contextmenu", contextmenuHandler);
    }

    var touchCleanup = null;

    function shouldShowTouchControls() {
        if (global.matchMedia && global.matchMedia("(pointer: coarse)").matches) return true;
        return ("ontouchstart" in global) || ((navigator.maxTouchPoints || 0) > 0);
    }

    function bindTouchControls(state) {
        if (touchCleanup) touchCleanup();
        var panel = el("touch-controls");
        if (!panel) return;
        var show = shouldShowTouchControls();
        panel.hidden = !show;
        if (!show) return;
        panel.classList.add("is-touch-only");

        var joy = el("touch-joystick");
        var knob = el("touch-joystick-knob");
        var fireBtn = el("touch-fire-btn");
        var joyRect = null;
        var joyCx = 0;
        var joyCy = 0;
        var activeTouchId = null;

        function resetJoy() {
            state.input.touchMoveX = 0;
            state.input.touchMoveY = 0;
            if (knob) knob.style.transform = "translate(0px, 0px)";
        }

        function pickTouch(e) {
            if (!e.changedTouches) return null;
            for (var ti = 0; ti < e.changedTouches.length; ti++) {
                var t = e.changedTouches[ti];
                if (activeTouchId === null || t.identifier === activeTouchId) return t;
            }
            return null;
        }

        function onJoyStart(e) {
            e.preventDefault();
            if (!joy) return;
            joyRect = joy.getBoundingClientRect();
            joyCx = joyRect.left + joyRect.width / 2;
            joyCy = joyRect.top + joyRect.height / 2;
            var t = pickTouch(e) || (e.changedTouches && e.changedTouches[0]);
            if (t) activeTouchId = t.identifier;
            onJoyMove(e);
        }

        function onJoyMove(e) {
            if (!joyRect) return;
            var t = pickTouch(e);
            if (!t && e.touches && e.touches.length) t = e.touches[0];
            if (!t) return;
            var dx = t.clientX - joyCx;
            var dy = t.clientY - joyCy;
            var maxR = joyRect.width * 0.38;
            var dlen = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dlen > maxR) { dx = (dx / dlen) * maxR; dy = (dy / dlen) * maxR; }
            state.input.touchMoveX = dx / maxR;
            state.input.touchMoveY = dy / maxR;
            if (knob) knob.style.transform = "translate(" + dx + "px, " + dy + "px)";
        }

        function onJoyEnd() {
            activeTouchId = null;
            joyRect = null;
            resetJoy();
        }

        function onFireDown(e) {
            e.preventDefault();
            state.input.touchShoot = true;
        }

        function onFireUp() {
            state.input.touchShoot = false;
        }

        if (joy) {
            joy.addEventListener("touchstart", onJoyStart, { passive: false });
            joy.addEventListener("touchmove", onJoyMove, { passive: false });
            joy.addEventListener("touchend", onJoyEnd);
            joy.addEventListener("touchcancel", onJoyEnd);
        }
        if (fireBtn) {
            fireBtn.addEventListener("touchstart", onFireDown, { passive: false });
            fireBtn.addEventListener("touchend", onFireUp);
            fireBtn.addEventListener("touchcancel", onFireUp);
        }

        touchCleanup = function () {
            if (joy) {
                joy.removeEventListener("touchstart", onJoyStart);
                joy.removeEventListener("touchmove", onJoyMove);
                joy.removeEventListener("touchend", onJoyEnd);
                joy.removeEventListener("touchcancel", onJoyEnd);
            }
            if (fireBtn) {
                fireBtn.removeEventListener("touchstart", onFireDown);
                fireBtn.removeEventListener("touchend", onFireUp);
                fireBtn.removeEventListener("touchcancel", onFireUp);
            }
            resetJoy();
            state.input.touchShoot = false;
        };
    }

    function unbindInputs(canvas) {
        if (touchCleanup) touchCleanup();
        touchCleanup = null;
        if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
        if (keyupHandler) window.removeEventListener("keyup", keyupHandler);
        if (mousemoveHandler && canvas) canvas.removeEventListener("mousemove", mousemoveHandler);
        if (mousedownHandler && canvas) canvas.removeEventListener("mousedown", mousedownHandler);
        if (mouseupHandler) window.removeEventListener("mouseup", mouseupHandler);
        if (contextmenuHandler && canvas) canvas.removeEventListener("contextmenu", contextmenuHandler);
        keydownHandler = keyupHandler = mousemoveHandler = mousedownHandler = mouseupHandler = contextmenuHandler = null;
    }

    /* ============================================================ *
     *  Update logic
     * ============================================================ */
    function update(state, dt) {
        if (state.phase === STATE_SPELLCAST) {
            // World keeps progressing while typing: MP/HP regen, level countdown,
            // and buff timers all keep ticking so the typing minigame can't be
            // used to stall the level-3 timer or refresh buffs for free.
            regenManaWhileIdle(state, dt);
            updateBuffs(state, dt);
            updateTimer(state, dt);
            updateSpellCast(state, dt);
            return;
        }
        if (state.phase !== STATE_PLAYING) return;

        state.animTime = (state.animTime || 0) + dt;
        state.sessionPlayTime = (state.sessionPlayTime || 0) + dt;
        updateDoorFlashes(state, dt);
        updatePlayer(state, dt);
        updateTraps(state, dt);
        updateFireballs(state, dt);
        updateEnemies(state, dt);
        updateEnemyShots(state, dt);
        checkRoomClearCelebration(state);
        updateTreasures(state, dt);
        updateBuffs(state, dt);
        updateTimer(state, dt);
        if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 4);
        if (state.levelFlash > 0) state.levelFlash = Math.max(0, state.levelFlash - dt);
        updateFloatTexts(state, dt);
        updateParticles(state, dt);
        for (var hi = 0; hi < state.enemies.length; hi++) {
            var he = state.enemies[hi];
            if (he.hitFlash > 0) he.hitFlash = Math.max(0, he.hitFlash - dt);
        }
        if (state.comboTimer > 0) {
            state.comboTimer -= dt;
            if (state.comboTimer <= 0) { state.comboTimer = 0; state.comboCount = 0; }
        }
        if (state.damageIndicator && state.damageIndicator.life > 0) {
            state.damageIndicator.life = Math.max(0, state.damageIndicator.life - dt);
        }
        updateKillFeed(state, dt);
        if (state.comboScoreMultTimer > 0) {
            state.comboScoreMultTimer = Math.max(0, state.comboScoreMultTimer - dt);
            if (state.comboScoreMultTimer <= 0) state.comboScoreMult = 1;
        }
    }

    function regenManaWhileIdle(state, dt) {
        var p = state.player;
        if (p.mpFloat < PLAYER_MAX_MP) {
            p.mpFloat = Math.min(PLAYER_MAX_MP, p.mpFloat + MP_REGEN * dt);
            p.mp = Math.floor(p.mpFloat);
        }
        if (p.shootCooldown > 0) p.shootCooldown = Math.max(0, p.shootCooldown - dt);
        if (p.damageCooldown > 0) p.damageCooldown = Math.max(0, p.damageCooldown - dt);
    }

    function updatePlayer(state, dt) {
        var p = state.player;
        if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
        if (p.dashIFrameTimer > 0) p.dashIFrameTimer = Math.max(0, p.dashIFrameTimer - dt);
        if (state.input.dashPressed) {
            state.input.dashPressed = false;
            tryPerformDash(state);
        }
        if (isShiftHeld(state)) {
            var mvCheck = getMoveVector(state);
            if (mvCheck.len > 0) tryStartDash(state);
        }

        if (p.dashTimer > 0) {
            p.dashTimer = Math.max(0, p.dashTimer - dt);
            var dashSpd = PLAYER_SPEED * DASH_SPEED_MULT;
            var dnx = p.x + p.dashVx * dashSpd * dt;
            var dny = p.y + p.dashVy * dashSpd * dt;
            if (isWalkable(state.map, dnx, p.y, PLAYER_RADIUS)) p.x = dnx;
            if (isWalkable(state.map, p.x, dny, PLAYER_RADIUS)) p.y = dny;
            p.faceX = p.dashVx;
            p.faceY = p.dashVy;
        } else {
            var mvx = 0, mvy = 0;
            var k = state.input.keys;
            if (Math.abs(state.input.touchMoveX) > 0.12 || Math.abs(state.input.touchMoveY) > 0.12) {
                mvx = state.input.touchMoveX;
                mvy = state.input.touchMoveY;
            } else {
                if (k["w"] || k["arrowup"]) mvy -= 1;
                if (k["s"] || k["arrowdown"]) mvy += 1;
                if (k["a"] || k["arrowleft"]) mvx -= 1;
                if (k["d"] || k["arrowright"]) mvx += 1;
            }
            var len = Math.sqrt(mvx * mvx + mvy * mvy);
            if (len > 0) { mvx /= len; mvy /= len; p.faceX = mvx; p.faceY = mvy; }
            var speedMult = p.slowTimer > 0 ? (p.slowMult || 0.65) : 1;
            var nx = p.x + mvx * PLAYER_SPEED * speedMult * dt;
            var ny = p.y + mvy * PLAYER_SPEED * speedMult * dt;
            if (isWalkable(state.map, nx, p.y, PLAYER_RADIUS)) p.x = nx;
            if (isWalkable(state.map, p.x, ny, PLAYER_RADIUS)) p.y = ny;
        }
        trackPlayerRoom(state);

        if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt);

        if (p.shootCooldown > 0) p.shootCooldown -= dt;
        if (p.damageCooldown > 0) p.damageCooldown -= dt;

        if (p.mpFloat < PLAYER_MAX_MP) {
            p.mpFloat = Math.min(PLAYER_MAX_MP, p.mpFloat + MP_REGEN * dt);
            p.mp = Math.floor(p.mpFloat);
        }

        if (state._noChargeWarn > 0) state._noChargeWarn -= dt;

        var wantShoot = state.input.shoot || state.input.mouseDown || state.input.touchShoot;
        if (!wantShoot || p.shootCooldown > 0) return;

        if (!hasHotbarCharge(state)) {
            if (state._noChargeWarn <= 0) {
                showToast(state, "No spell loaded — press Enter to cast", 1100);
                state._noChargeWarn = 1.5;
            }
            return;
        }
        if (p.mp < FIREBALL_COST) return;

        consumeHotbarCharge(state);
        p.mpFloat -= FIREBALL_COST;
        p.mp = Math.floor(p.mpFloat);
        shootFireball(state);
        p.shootCooldown = SHOOT_COOLDOWN;
    }

    function hasHotbarCharge(state) {
        for (var i = 0; i < state.spellHotbar.length; i++) {
            if (state.spellHotbar[i]) return true;
        }
        return false;
    }

    function consumeHotbarCharge(state) {
        for (var i = 0; i < state.spellHotbar.length; i++) {
            if (state.spellHotbar[i]) {
                state.spellHotbar[i] = null;
                return true;
            }
        }
        return false;
    }

    function shootFireball(state) {
        var p = state.player;
        var camera = computeCamera(state);
        var worldTx = state.input.mouseX + camera.x;
        var worldTy = state.input.mouseY + camera.y;
        var dx = worldTx - p.x, dy = worldTy - p.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.0001) { dx = p.faceX; dy = p.faceY; len = Math.sqrt(dx * dx + dy * dy) || 1; }
        dx /= len; dy /= len;
        p.faceX = dx; p.faceY = dy;

        var base = p.strengthTimer > 0 ? FIREBALL_DMG_BOOSTED : FIREBALL_DMG;
        if (state.spellStreakBuffTimer > 0) base = Math.round(base * SPELL_STREAK_DMG_MULT);
        if (state.comboDamageAura > 0) base = Math.round(base * 1.22);
        if (state.rampageTimer > 0) base = Math.round(base * RAMPAGE_DMG_MULT);
        var isCrit = Math.random() < CRIT_CHANCE;
        var dmg = Math.round(base * (isCrit ? CRIT_MULT : 1));
        state.fireballs.push(makeFireball(p.x + dx * 18, p.y + dy * 18, dx * FIREBALL_SPEED, dy * FIREBALL_SPEED, dmg, true, isCrit));
        playSfx(isCrit ? "crit" : "shoot");
        if (isCrit) addFloatText(state, p.x, p.y - 28, "CRIT!", "#fff3b0", { scale: 1.2, vy: -90 });
    }

    function updateFireballs(state, dt) {
        for (var i = state.fireballs.length - 1; i >= 0; i--) {
            var f = state.fireballs[i];
            if (!f.active) { state.fireballs.splice(i, 1); continue; }
            pushFireballTrail(f);
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.life -= dt;
            if (f.life <= 0 || !isWalkable(state.map, f.x, f.y, FIREBALL_RADIUS)) f.active = false;
        }
    }

    function updateEnemyShots(state, dt) {
        if (!state.enemyShots) state.enemyShots = [];
        var p = state.player;
        for (var si = state.enemyShots.length - 1; si >= 0; si--) {
            var s = state.enemyShots[si];
            s.life -= dt;
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            if (s.life <= 0) { state.enemyShots.splice(si, 1); continue; }
            if (!isWalkable(state.map, s.x, s.y, s.radius)) {
                state.enemyShots.splice(si, 1);
                continue;
            }
            if (dist(s.x, s.y, p.x, p.y) < s.radius + PLAYER_RADIUS) {
                if (applyPlayerDamage(state, ENEMY_SHOT_DMG, s.x, s.y)) return;
                state.enemyShots.splice(si, 1);
            }
        }
    }

    function drawEnemyShots(ctx, state) {
        if (!state.enemyShots) return;
        for (var i = 0; i < state.enemyShots.length; i++) {
            var s = state.enemyShots[i];
            var shotColor = s.arch === "archer" ? "#ff8a3d" : "#ff66aa";
            ctx.save();
            ctx.fillStyle = shotColor;
            ctx.shadowColor = shotColor;
            ctx.shadowBlur = s.arch === "archer" ? 14 : 10;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function updateEnemies(state, dt) {
        var p = state.player;
        for (var i = 0; i < state.enemies.length; i++) {
            var e = state.enemies[i];
            if (!e.active || e.hp <= 0) continue;

            if (e.burnTicks > 0) {
                e.burnTickTimer = (e.burnTickTimer || 0) - dt;
                if (e.burnTickTimer <= 0) {
                    e.burnTickTimer = BURN_TICK_INTERVAL;
                    e.hp -= e.burnTickDmg || 8;
                    e.burnTicks--;
                    spawnBurnParticles(state, e.x, e.y);
                    var burnLabel = e.burnStacks > 1 ? "BURN x" + e.burnStacks : "BURN";
                    addFloatText(state, e.x, e.y - e.radius - 6, burnLabel, "#ff8a3d", { vy: -40, life: 0.55 });
                    if (e.hp <= 0) {
                        e.active = false;
                        spawnDeathParticles(state, e.x, e.y, false);
                        registerKillCombo(state);
                        playSfx("kill");
                        continue;
                    }
                }
            }

            var canChase = enemyCanReachPlayer(state, e);
            if (canChase) {
                var dx = p.x - e.x;
                var dy = p.y - e.y;
                var d = Math.sqrt(dx * dx + dy * dy);
                if (d > 0.0001) {
                    var move = true;
                    if (enemyShoots(e.archetype)) {
                        e.shootCooldown = Math.max(0, (e.shootCooldown || 0) - dt);
                        if (d < RANGED_HOLD_RANGE) move = false;
                        else if (d <= RANGED_SHOOT_RANGE) move = false;
                        if (d > 90 && d < RANGED_SHOOT_RANGE && e.shootCooldown <= 0) {
                            var ndx = dx / d, ndy = dy / d;
                            if (!state.enemyShots) state.enemyShots = [];
                            state.enemyShots.push(makeEnemyShot(e.x, e.y, ndx * ENEMY_SHOT_SPEED, ndy * ENEMY_SHOT_SPEED, e.archetype));
                            e.shootCooldown = ENEMY_SHOOT_INTERVAL;
                        }
                    }
                    if (move) {
                        var moveSpd = e.speed;
                        if (e.isBoss && e.maxHp > 0 && e.hp / e.maxHp < 0.5) moveSpd *= 1.55;
                        var sx = (dx / d) * moveSpd * dt;
                        var sy = (dy / d) * moveSpd * dt;
                        if (isWalkable(state.map, e.x + sx, e.y, e.radius)) e.x += sx;
                        if (isWalkable(state.map, e.x, e.y + sy, e.radius)) e.y += sy;
                    }
                }
            }
            var inMelee = canChase && !enemyShoots(e.archetype) && dist(p.x, p.y, e.x, e.y) < e.radius + PLAYER_RADIUS;
            if (inMelee) {
                if (e.attackWindup == null) e.attackWindup = 0;
                if (!playerIsInvulnerable(p) && p.damageCooldown <= 0) {
                    e.attackWindup += dt;
                    if (e.attackWindup >= ENEMY_TELEGRAPH) {
                        applyPlayerDamage(state, ENEMY_DAMAGE, e.x, e.y);
                        if (e.archetype === "fast") {
                            p.slowTimer = 1.4;
                            p.slowMult = 0.62;
                        }
                        e.attackWindup = 0;
                    }
                }
            } else if (e.attackWindup > 0) {
                e.attackWindup = Math.max(0, e.attackWindup - dt * 2);
            }
            for (var j = state.fireballs.length - 1; j >= 0; j--) {
                var f = state.fireballs[j];
                if (!f.active) continue;
                if (dist(f.x, f.y, e.x, e.y) < e.radius + FIREBALL_RADIUS) {
                    f.active = false;
                    e.hp -= f.dmg;
                    e.hitFlash = 0.12;
                    if (f.crit) {
                        e.burnStacks = Math.min((e.burnStacks || 0) + 1, 5);
                        e.burnTicks = Math.max(e.burnTicks || 0, 2) + e.burnStacks;
                        e.burnTickDmg = Math.max(8, Math.round(f.dmg * 0.18)) + (e.burnStacks - 1) * 4;
                        e.burnTickTimer = 0.05;
                        spawnBurnParticles(state, e.x, e.y);
                    }
                    playSfx(f.crit ? "crit" : "hit");
                    var dmgColor = f.crit ? "#fff3b0" : "#ff8a3d";
                    addFloatText(state, e.x, e.y - e.radius, (f.crit ? "CRIT " : "") + "-" + f.dmg, dmgColor, f.crit ? { scale: 1.2 } : null);
                    if (e.hp <= 0) {
                        e.active = false;
                        spawnDeathParticles(state, e.x, e.y, e.isBoss);
                        var pts = e.isBoss ? SCORE_BOSS : SCORE_KILL;
                        if (!e.isBoss) {
                            if (e.isChampion) pts = Math.round(pts * 2.5);
                            else if (e.isElite) pts = Math.round(pts * SCORE_ELITE_MULT);
                            registerKillCombo(state);
                            if (state.comboCount >= 2) {
                                pts = Math.round(pts * (1 + (state.comboCount - 1) * 0.15));
                            }
                        }
                        if (state.comboScoreMultTimer > 0 && state.comboScoreMult > 1) {
                            pts = Math.round(pts * state.comboScoreMult);
                        }
                        pts = applyTypingScore(state, pts);
                        if (!e.isBoss) pushKillFeed(state, enemyDisplayName(e) + " -" + pts);
                        state.score += pts;
                        addFloatText(state, e.x, e.y - e.radius - 12, "+" + pts, "#ffd166");
                        if (state.comboCount >= 2) {
                            addFloatText(state, e.x, e.y - e.radius - 28, "x" + state.comboCount, "#ffb46b");
                        }
                        playSfx("kill");
                        checkKillAchievements(state, e.isBoss);
                        state.shake = e.isBoss ? 0.9 : 0.3;
                        if (e.isBoss) {
                            advanceLevel(state);
                            return;
                        }
                    }
                }
            }
        }
        updateRoomsCleared(state);
    }

    function updateTreasures(state, dt) {
        dt = dt || 0;
        for (var i = 0; i < state.treasures.length; i++) {
            var t = state.treasures[i];
            if (t.openAnim > 0 && t.openAnim < 1) {
                t.openAnim = Math.min(1, t.openAnim + dt * 2.8);
                continue;
            }
            if (t.opened) continue;
            if (t.type !== "ScoreCache") continue;
            if (dist(t.x, t.y, state.player.x, state.player.y) < 20) {
                t.opened = true;
                t.openAnim = 0.001;
                spawnChestParticles(state, t.x, t.y, "#ffd166");
                var cachePts = applyTypingScore(state, SECRET_SCORE_BONUS);
                state.score += cachePts;
                addFloatText(state, state.player.x, state.player.y - 18, "+" + cachePts, "#ffd166", { scale: 1.2 });
                playSfx("pickup");
                showToast(state, "Secret cache! +" + cachePts + " score", 1400);
            }
        }
    }

    function updateBuffs(state, dt) {
        var p = state.player;
        if (p.invincibleTimer > 0) p.invincibleTimer = Math.max(0, p.invincibleTimer - dt);
        if (p.strengthTimer > 0) p.strengthTimer = Math.max(0, p.strengthTimer - dt);
        if (p.dashIFrameTimer > 0) p.dashIFrameTimer = Math.max(0, p.dashIFrameTimer - dt);
        if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
        if (p.slowTimer > 0) p.slowTimer = Math.max(0, p.slowTimer - dt);
        if (state.spellStreakBuffTimer > 0) state.spellStreakBuffTimer = Math.max(0, state.spellStreakBuffTimer - dt);
        if (state.minimapHitFlash > 0) state.minimapHitFlash = Math.max(0, state.minimapHitFlash - dt);
        if (state.comboDamageAura > 0) state.comboDamageAura = Math.max(0, state.comboDamageAura - dt);
        if (state.rampageTimer > 0) state.rampageTimer = Math.max(0, state.rampageTimer - dt);
    }

    function updateTimer(state, dt) {
        if (!state.timerActive) return;
        state.timer -= dt;
        if (state.timer <= 0) {
            state.timer = 0;
            gameOver(state);
        }
    }

    /* ============================================================ *
     *  Render
     * ============================================================ */
    function drawWorldFloatTexts(ctx, state, camera) {
        for (var i = 0; i < state.floatTexts.length; i++) {
            var ft = state.floatTexts[i];
            var alpha = clamp(ft.life / ft.maxLife, 0, 1);
            var sx = ft.x - camera.x;
            var sy = ft.y - camera.y;
            var sc = ft.scale || 1;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(sx, sy);
            ctx.scale(sc, sc);
            ctx.font = "bold 14px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillText(ft.text, 1, 1);
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, 0, 0);
            ctx.restore();
        }
    }

    function computeCamera(state) {
        var p = state.player;
        var camX = p.x - VIEW_W / 2;
        var camY = p.y - VIEW_H / 2;
        if (state.shake > 0) {
            camX += (Math.random() - 0.5) * state.shake * 24;
            camY += (Math.random() - 0.5) * state.shake * 24;
        }
        var b = state.map && state.map.bounds;
        if (b) {
            var mapW = b.maxX - b.minX;
            var mapH = b.maxY - b.minY;
            if (mapW <= VIEW_W) {
                camX = b.minX + (mapW - VIEW_W) / 2;
            } else {
                camX = clamp(camX, b.minX, b.maxX - VIEW_W);
            }
            if (mapH <= VIEW_H) {
                camY = b.minY + (mapH - VIEW_H) / 2;
            } else {
                camY = clamp(camY, b.minY, b.maxY - VIEW_H);
            }
        }
        return { x: camX, y: camY };
    }

    function render(ctx, state) {
        ctx.clearRect(0, 0, VIEW_W, VIEW_H);
        ctx.fillStyle = "#050811";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        if (!state.map) return;

        var camera = computeCamera(state);
        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        for (var i = 0; i < state.map.corridors.length; i++) drawCorridor(ctx, state.map.corridors[i]);
        for (var r = 0; r < state.map.rooms.length; r++) {
            var room = state.map.rooms[r];
            drawRoomFloor(ctx, room, r === state.map.startIndex, r === state.map.bossIndex);
        }
        // Carve open each doorway so the room walls + corridor side walls don't
        // visually disconnect the corridor from the rooms it joins.
        carveDoorways(ctx, state.map);
        drawTraps(ctx, state);
        for (var d = 0; d < state.map.doors.length; d++) drawDoor(ctx, state.map.doors[d]);
        for (var t = 0; t < state.treasures.length; t++) {
            var tr = state.treasures[t];
            if (!roomHasPendingContent(state.map, tr.roomIndex)) drawTreasure(ctx, tr, state.animTime);
        }
        if (state.shrines) {
            for (var si = 0; si < state.shrines.length; si++) {
                var shr = state.shrines[si];
                if (!roomHasPendingContent(state.map, shr.roomIndex)) drawShrine(ctx, shr, state.animTime);
            }
        }
        for (var f = 0; f < state.fireballs.length; f++) drawFireball(ctx, state.fireballs[f]);
        drawEnemyShots(ctx, state);
        drawParticles(ctx, state);
        for (var e = 0; e < state.enemies.length; e++) {
            var en = state.enemies[e];
            if (en.active && !roomHasPendingContent(state.map, en.roomIndex)) drawEnemy(ctx, en, state.animTime);
        }
        drawPlayer(ctx, state.player);
        ctx.restore();
        drawWorldFloatTexts(ctx, state, camera);

        if (state.levelFlash > 0) {
            var la = clamp(state.levelFlash / 0.75, 0, 1) * 0.42;
            ctx.fillStyle = "rgba(255, 209, 102, " + la + ")";
            ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        }
        ctx.fillStyle = floorThemeTint(state.level);
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        drawAimReticle(ctx, state);
        drawDamageIndicator(ctx, state);
    }

    /* ============================================================ *
     *  Public API
     * ============================================================ */
    var loopHandle = null;
    var currentState = null;

    function start(slotUsername, role) {
        global.Screens.showCanvas(true);
        var canvas = el("game");
        var ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;

        if (loopHandle) cancelAnimationFrame(loopHandle);
        unbindInputs(canvas);

        currentState = createState(slotUsername, role);
        loadIntoState(currentState);
        persistTypingTier(currentState);
        if (global.Meta && currentState.player) {
            currentState.player.tintColor = global.Meta.getPlayerColor(currentState.baseUsername);
        }
        spawnLevel(currentState);
        initGameAudio();
        bindInputs(currentState, canvas);
        bindTouchControls(currentState);
        wireGameOverlays(currentState, canvas);

        var hud = el("hud");
        if (hud) hud.hidden = false;
        hide(el("overlay-pause"));
        hide(el("overlay-gameover"));
        hide(el("inventory-overlay"));
        hide(el("spell-overlay"));
        hide(el("overlay-start-tutorial"));
        var actionBarInit = el("hud-action-bar");
        if (actionBarInit) actionBarInit.classList.remove("start-tutorial-highlight");
        if (!currentState.typingTier || !global.SentenceBank.TIERS[currentState.typingTier]) {
            currentState.typingTier = global.SentenceBank.getStoredTierId();
        }
        maybeShowStartTutorial(currentState);

        var slotSuffix = currentState.username !== currentState.baseUsername
            ? currentState.username.substring(currentState.baseUsername.length)
            : "";
        global.Screens.setFooter(currentState.baseUsername + (slotSuffix ? " · " + slotSuffix.replace(/^_+/, "") : ""));

        var last = performance.now();
        function frame(now) {
            var dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            update(currentState, dt);
            render(ctx, currentState);
            refreshHud(currentState);
            loopHandle = requestAnimationFrame(frame);
        }
        loopHandle = requestAnimationFrame(frame);
    }

    function quitToHome(saveFirst) {
        if (!currentState) return;
        if (saveFirst) autoSave(currentState);
        if (loopHandle) { cancelAnimationFrame(loopHandle); loopHandle = null; }
        unbindInputs(el("game"));
        var hud = el("hud");
        if (hud) hud.hidden = true;
        hide(el("overlay-pause"));
        hide(el("overlay-gameover"));
        hide(el("inventory-overlay"));
        hide(el("spell-overlay"));
        dismissStartTutorial(currentState, false);
        global.Screens.renderHome(currentState.baseUsername, currentState.role);
        currentState = null;
    }

    function wireGameOverlays(state, canvas) {
        replaceClickHandler("btn-resume", function () {
            state.phase = STATE_PLAYING;
            hide(el("overlay-pause"));
        });
        replaceClickHandler("btn-save-quit", function () {
            quitToHome(true);
        });
        replaceClickHandler("btn-quit", function () {
            quitToHome(false);
        });
        replaceClickHandler("btn-retry", function () {
            hide(el("overlay-gameover"));
            // Reset and start again from level 1 in the same slot.
            global.Storage.Players.resetSaveState(state.username);
            start(state.username, state.role);
        });
        replaceClickHandler("btn-quick-retry", function () {
            triggerQuickRetry(state);
        });
        replaceClickHandler("btn-back-menu", function () {
            quitToHome(false);
        });
        replaceClickHandler("btn-start-tutorial-dismiss", function () {
            var skip = el("start-tutorial-skip");
            dismissStartTutorial(state, !!(skip && skip.checked));
        });

        replaceClickHandler("inventory-confirm", function () {
            if (state.phase !== STATE_INVENTORY) return;
            if (state.selectedInventorySlot < 0) {
                showToast(state, "Pick a potion first", 900);
                return;
            }
            var used = consumePotion(state, state.selectedInventorySlot);
            if (used) closeInventory(state);
        });
        replaceClickHandler("inventory-close", function () {
            if (state.phase === STATE_INVENTORY) closeInventory(state);
        });

        var potionBar = el("hud-potion-bar");
        if (potionBar && !potionBar._quickPotionWired) {
            potionBar._quickPotionWired = true;
            potionBar.addEventListener("click", function (ev) {
                var btn = ev.target.closest("[data-potion]");
                if (!btn || !currentState || currentState.phase !== STATE_PLAYING) return;
                useQuickPotion(currentState, btn.dataset.potion);
            });
        }

        var spellInput = el("spell-input");
        if (spellInput) {
            var clone = spellInput.cloneNode(true);
            spellInput.parentNode.replaceChild(clone, spellInput);
            clone.addEventListener("input", function () { onSpellInput(state, clone.value); });
            clone.addEventListener("keydown", function (e) {
                if (e.key === "Escape") {
                    failSpellCast(state, "Cancelled");
                    e.preventDefault();
                }
            });
        }
    }

    function replaceClickHandler(id, handler) {
        var node = el(id);
        if (!node) return;
        var clone = node.cloneNode(true);
        node.parentNode.replaceChild(clone, node);
        clone.addEventListener("click", handler);
    }

    function triggerQuickRetry(state) {
        hide(el("overlay-gameover"));
        start(state.username, state.role);
    }

    function syncTypingTierFromStorage(state) {
        if (!state) return global.SentenceBank.getStoredTierId();
        state.typingTier = global.SentenceBank.getStoredTierId();
        return state.typingTier;
    }

    global.Game = {
        start: start,
        quitToHome: quitToHome,
        getAchievements: getUnlockedAchievements,
        getDailySeed: getDailySeed,
        syncTypingTierFromStorage: syncTypingTierFromStorage,
    };
})(window);

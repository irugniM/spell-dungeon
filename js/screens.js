/**
 * Screens module — owns every non-gameplay surface in the app: login,
 * register, password recovery, player home, save-slot picker, stats,
 * admin panel, tutorial, and leaderboard. Each screen renders into the
 * shared `#screen-host` container and uses `App.go(...)` for navigation.
 *
 * The screens are intentionally kept procedural and free of any framework
 * so the whole UI continues to load straight from `index.html` (file:// or
 * a static host) with no build step.
 *
 * Home adds a coin shop (Meta) for robe tints and an animated title;
 * gameplay HUD uses spell grades, kill feed, traps, and minimap pulse.
 */
(function (global) {
    "use strict";

    var BASE_HEALTH = 100;
    var BASE_LEVEL3_TIME = 60;

    function dailyMazeSeed() {
        var d = new Date();
        return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    }

    function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    }

    function formatTierMult(mult) {
        return mult % 1 === 0 ? String(mult) : mult.toFixed(2).replace(/\.?0+$/, "");
    }

    function slotTypingDisplay(tierId) {
        var bank = global.SentenceBank;
        if (!bank) return "—";
        if (!tierId || !bank.TIERS[tierId]) return "—";
        return bank.formatTierDisplay(tierId);
    }

    function buildTypingTierPanel(compact) {
        var bank = global.SentenceBank;
        if (!bank) return el("div");
        var current = bank.getStoredTierId();
        var pillsWrap = el("div", { class: "typing-tier-pills" + (compact ? " compact" : "") });
        bank.listTiers().forEach(function (t) {
            var multStr = formatTierMult(t.scoreMultiplier);
            var pillText = bank.formatTierPillLabel
                ? bank.formatTierPillLabel(t.id)
                : t.label + " · " + (t.wpmRangeLabel || "") + " · " + (t.accuracyGoalLabel || "");
            var btn = el("button", {
                type: "button",
                class: "typing-tier-pill-btn" + (current === t.id ? " active" : ""),
                text: pillText,
                title: (t.wpmRangeLabel || "") + " · " + (t.accuracyGoalLabel || "")
                    + " · ~" + t.targetWpm + " WPM target · ~" + t.timeLimitSec + "s typical timer · score ×" + multStr,
            });
            btn.dataset.tierId = t.id;
            btn.addEventListener("click", function () {
                bank.setStoredTierId(t.id);
                if (global.Game && global.Game.syncTypingTierFromStorage) {
                    global.Game.syncTypingTierFromStorage(null);
                }
                var panel = pillsWrap.closest(".typing-tier-panel");
                if (panel && panel._onTierChange) panel._onTierChange(t.id);
            });
            pillsWrap.appendChild(btn);
        });
        var panel = el("div", { class: "typing-tier-panel" + (compact ? " compact" : "") }, [
            el("h3", { class: "home-section-title", text: compact ? "Typing tier" : "Typing difficulty" }),
            el("p", {
                class: "screen-sub",
                text: compact
                    ? "Dungeon depth auto-scales spell difficulty each level. Home tier is a baseline for new slots."
                    : "Spell sentences get harder as you clear levels (Grade 1–6 → exam tier). Timers follow real-world typing benchmarks. Higher tiers earn more score per kill.",
            }),
            pillsWrap,
            el("p", { class: "typing-tier-legend", text: bank.formatMultiplierLegend() }),
        ]);
        panel._onTierChange = function () {
            var username = panel.dataset.username;
            var role = panel.dataset.role;
            if (username) {
                renderHome(username, role);
            } else {
                panel.querySelectorAll(".typing-tier-pill-btn").forEach(function (b) {
                    b.classList.toggle("active", b.dataset.tierId === bank.getStoredTierId());
                });
            }
        };
        return panel;
    }

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
                if (k === "class") node.className = attrs[k];
                else if (k === "html") node.innerHTML = attrs[k];
                else if (k === "text") node.textContent = attrs[k];
                else if (k === "on" && attrs.on && typeof attrs.on === "object") {
                    for (var ev in attrs.on) {
                        if (!Object.prototype.hasOwnProperty.call(attrs.on, ev)) continue;
                        node.addEventListener(ev, attrs.on[ev]);
                    }
                } else if (k.indexOf("data-") === 0) {
                    node.setAttribute(k, attrs[k]);
                } else if (k === "for") {
                    node.htmlFor = attrs[k];
                } else if (k in node) {
                    node[k] = attrs[k];
                } else {
                    node.setAttribute(k, attrs[k]);
                }
            }
        }
        if (children) appendChildren(node, children);
        return node;
    }

    function appendChildren(parent, children) {
        if (children == null) return;
        if (Array.isArray(children)) {
            for (var i = 0; i < children.length; i++) appendChildren(parent, children[i]);
            return;
        }
        if (typeof children === "string" || typeof children === "number") {
            parent.appendChild(document.createTextNode(String(children)));
            return;
        }
        if (children instanceof Node) {
            parent.appendChild(children);
        }
    }

    function host() {
        return document.getElementById("screen-host");
    }

    function topbar() {
        return document.getElementById("topbar-actions");
    }

    function clearHost() {
        var h = host();
        if (h) h.innerHTML = "";
    }

    function renderTopbar(items) {
        var bar = topbar();
        if (!bar) return;
        bar.innerHTML = "";
        if (!items || !items.length) return;
        items.forEach(function (item) {
            var btnClass = item.kind === "primary"
                ? "primary-btn"
                : item.kind === "ghost"
                    ? "ghost-btn"
                    : "secondary-btn";
            var btn = el("button", { type: "button", class: btnClass, text: item.label });
            btn.addEventListener("click", item.onClick);
            bar.appendChild(btn);
        });
    }

    function setStatus(node, text, kind) {
        if (!node) return;
        node.textContent = text || "";
        node.classList.remove("good", "bad");
        if (kind) node.classList.add(kind);
    }

    function showCanvas(show) {
        var canvas = document.getElementById("canvas-host");
        if (canvas) {
            canvas.hidden = !show;
            canvas.classList.toggle("is-gameplay", !!show);
        }
        document.body.classList.toggle("in-game", !!show);
        var screen = document.getElementById("screen-host");
        if (screen) screen.style.display = show ? "none" : "";
    }

    function setFooter(name) {
        var footer = document.getElementById("footer-name");
        if (footer) footer.textContent = name ? "Signed in as " + name : "";
    }

    /* ------------------------------------------------------------------
     *  Reusable primitives
     * ------------------------------------------------------------------ */
    function makeFormRow(labelText, inputAttrs) {
        var input = el("input", inputAttrs);
        var row = el("label", { class: "form-row" }, [
            el("span", { text: labelText }),
            input,
        ]);
        return { row: row, input: input };
    }

    function makeButton(label, kind, onClick) {
        var cls = kind === "primary"
            ? "primary-btn"
            : kind === "ghost"
                ? "ghost-btn"
                : kind === "danger"
                    ? "secondary-btn danger"
                    : "secondary-btn";
        var btn = el("button", { type: "button", class: cls, text: label });
        if (onClick) btn.addEventListener("click", onClick);
        return btn;
    }

    /* ------------------------------------------------------------------
     *  Login / register / recovery
     * ------------------------------------------------------------------ */
    function renderLogin(prefill) {
        showCanvas(false);
        clearHost();
        renderTopbar([]);
        setFooter("");

        var username = makeFormRow("Player name", { type: "text", autocomplete: "username", value: (prefill && prefill.username) || "" });
        var status = el("p", { class: "status" });

        var play = makeButton("Play", "primary", submit);

        var card = el("section", { class: "screen" }, [
            el("h2", { text: "Enter your name" }),
            el("p", {
                class: "screen-sub",
                text: "Arcade-style login — no password. Stats, coins, and save slots are stored locally per name.",
            }),
            el("div", { class: "form-grid" }, [username.row]),
            el("div", { class: "actions" }, [play]),
            status,
        ]);

        function submit() {
            var u = (username.input.value || "").trim();
            if (!u) {
                setStatus(status, "Please enter a player name.", "bad");
                return;
            }
            if (u.length < 1 || u.length > 16) {
                setStatus(status, "Name must be 1–16 characters.", "bad");
                return;
            }
            if (/_slot/i.test(u)) {
                setStatus(status, 'Name cannot contain "_slot".', "bad");
                return;
            }
            setStatus(status, "Starting…");
            play.disabled = true;
            global.Storage.Accounts.signInOrCreate(u).then(function (role) {
                play.disabled = false;
                if (!role) {
                    setStatus(status, "Could not start session.", "bad");
                    return;
                }
                global.Storage.Session.set(u, role);
                renderHome(u, role);
            });
        }

        username.input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });

        host().appendChild(card);
        username.input.focus();
    }

    function renderRegister() {
        renderLogin();
    }

    function renderRecovery() {
        renderLogin();
    }


    /* ------------------------------------------------------------------
     *  Player home
     * ------------------------------------------------------------------ */
    function renderHome(username, role) {
        showCanvas(false);
        clearHost();
        setFooter(username + (role && role.toLowerCase() === "admin" ? " · Admin" : ""));

        var player = global.Storage.Players.getOrCreate(username);
        var stats = (player && player.statistics) || global.Storage.utils.defaultStatistics();
        var best = global.Leaderboard.getPersonalBest(username);
        var dailySeed = (global.Game && global.Game.getDailySeed)
            ? global.Game.getDailySeed(username)
            : "--------";
        var mapSeed = player && player.saveState && player.saveState.mapSeed;

        var typingPanel = buildTypingTierPanel(false);
        typingPanel.dataset.username = username;
        typingPanel.dataset.role = role || "";

        var statsBox = el("div", { class: "home-stats" }, [
            el("div", { class: "home-stat" }, [el("span", { text: "Avg WPM" }), el("strong", { text: String(Math.round(stats.Wpm)) })]),
            el("div", { class: "home-stat" }, [el("span", { text: "Avg Accuracy" }), el("strong", { text: Math.round(stats.accuracyPercentage) + "%" })]),
            el("div", { class: "home-stat" }, [el("span", { text: "Personal Best" }), el("strong", { text: String(best || 0) })]),
            el("div", { class: "home-stat" }, [el("span", { text: "Total Time" }), el("strong", { text: formatDuration(stats.totalTimePlayed) })]),
        ]);

        var actionGrid = el("div", { class: "home-actions" });

        actionGrid.appendChild(makeButton("New Game", "primary", function () {
            renderSlots(username, role, "new");
        }));
        actionGrid.appendChild(makeButton("Load Game", "secondary", function () {
            renderSlots(username, role, "load");
        }));
        actionGrid.appendChild(makeButton("Stats", "secondary", function () { renderStats(username, role); }));
        actionGrid.appendChild(makeButton("Leaderboard", "secondary", function () { renderLeaderboard(username, role); }));
        actionGrid.appendChild(makeButton("Tutorial", "secondary", function () { renderTutorial(username, role); }));
        if (role && role.toLowerCase() === "admin") {
            actionGrid.appendChild(makeButton("Admin panel", "secondary", function () { renderAdmin(username, role); }));
        }
        actionGrid.appendChild(makeButton("Logout", "ghost", function () {
            global.Storage.Session.clear();
            renderLogin();
        }));

        var achList = el("ul", { class: "achievement-list" });
        var unlocked = (global.Game && global.Game.getAchievements) ? global.Game.getAchievements() : [];
        var allLabels = {
            first_kill: "First blood!",
            combo5: "On fire!",
            combo10: "Unstoppable!",
            explorer: "Fully explored!",
            boss_slayer: "Boss slain!",
            spell_streak: "Arcane rhythm",
        };
        var unlockedIds = {};
        unlocked.forEach(function (a) { unlockedIds[a.id] = true; });
        Object.keys(allLabels).forEach(function (id) {
            var li = el("li", {
                class: unlockedIds[id] ? "achievement unlocked" : "achievement locked",
                text: (unlockedIds[id] ? "✓ " : "○ ") + allLabels[id],
            });
            achList.appendChild(li);
        });

        var coins = global.Meta ? global.Meta.getCoins(username) : 0;
        var shopColors = global.Meta ? global.Meta.SHOP_COLORS : [];
        var activeColorId = global.Meta ? global.Meta.getColorId(username) : "mint";
        var shopStatus = el("p", { class: "status" });
        var shopGrid = el("div", { class: "color-shop-grid" });
        shopColors.forEach(function (def) {
            var owned = global.Meta ? global.Meta.ownsColor(username, def.id) : def.cost === 0;
            var swatch = el("button", {
                type: "button",
                class: "color-swatch" + (activeColorId === def.id ? " active" : "") + (!owned ? " locked" : ""),
                title: def.name + (def.cost > 0 ? " — " + def.cost + " coins" : ""),
            });
            swatch.style.setProperty("--swatch", def.color);
            swatch.appendChild(el("span", { class: "color-swatch-label", text: def.name }));
            if (def.cost > 0 && !owned) {
                swatch.appendChild(el("span", { class: "color-swatch-cost", text: String(def.cost) }));
            }
            swatch.addEventListener("click", function () {
                if (!global.Meta) return;
                if (global.Meta.getColorId(username) === def.id) return;
                if (!global.Meta.ownsColor(username, def.id)) {
                    var buy = global.Meta.buyColor(username, def.id);
                    if (!buy.ok) {
                        setStatus(shopStatus, buy.reason || "Not enough coins.", "bad");
                        return;
                    }
                    setStatus(shopStatus, "Unlocked " + def.name + "!", "good");
                } else {
                    global.Meta.setColorId(username, def.id);
                    setStatus(shopStatus, "Equipped " + def.name + ".", "good");
                }
                renderHome(username, role);
            });
            shopGrid.appendChild(swatch);
        });
        var shopSection = el("div", { class: "color-shop" }, [
            el("h3", { class: "home-section-title", text: "Cosmetic shop" }),
            el("p", { class: "screen-sub", text: "Earn coins from score ÷ 1000 each run. Pick a wizard tint — paid colors unlock once, then equip free." }),
            el("p", { class: "coin-balance", text: "Coins: " + coins }),
            shopGrid,
            shopStatus,
        ]);

        var card = el("section", { class: "screen" }, [
            el("p", { class: "welcome", text: "Welcome, " + username }),
            el("h2", { class: "home-title-animated", text: "Spell Dungeon" }),
            el("p", { class: "screen-sub", text: "Pick a save slot to play, dive into the leaderboard, or check your typing stats." }),
            el("p", { class: "daily-seed", text: "Today's maze code: " + dailySeed }),
            el("p", {
                class: "home-seed",
                text: mapSeed ? "Last run maze seed: " + mapSeed : "Maze seed: — (shown in HUD and pause while playing)",
            }),
            typingPanel,
            statsBox,
            shopSection,
            el("h3", { class: "home-section-title", text: "Achievements" }),
            achList,
            actionGrid,
        ]);

        host().appendChild(card);
    }

    /* ------------------------------------------------------------------
     *  Save slots picker (used for both new game and load)
     * ------------------------------------------------------------------ */
    function renderSlots(username, role, mode) {
        showCanvas(false);
        clearHost();

        var grid = el("div", { class: "slots-grid" });
        for (var i = 1; i <= 4; i++) {
            grid.appendChild(buildSlotCard(username, role, i, mode));
        }

        var actions = el("div", { class: "actions" }, [
            makeButton("Back", "secondary", function () { renderHome(username, role); }),
            makeButton("Logout", "ghost", function () {
                global.Storage.Session.clear();
                renderLogin();
            }),
        ]);

        var heading = mode === "new" ? "New game — pick a slot" : "Load game";
        var sub = mode === "new"
            ? "Selecting a slot will reset the saved progress for that slot before starting a new run."
            : "Click a slot with a saved game to resume.";

        var slotsTyping = buildTypingTierPanel(true);
        slotsTyping._onTierChange = function () {
            renderSlots(username, role, mode);
        };

        var card = el("section", { class: "screen wide" }, [
            el("h2", { text: heading }),
            el("p", { class: "screen-sub", text: sub }),
            slotsTyping,
            grid,
            actions,
        ]);
        host().appendChild(card);
    }

    function buildSlotCard(username, role, slot, mode) {
        var slotName = global.Storage.utils.buildSlotName(username, slot);
        var record = global.Storage.Players.exists(slotName)
            ? global.Storage.Players.getOrCreate(slotName)
            : null;
        var saveState = record && record.saveState;
        var hasData = !!(saveState && (saveState.currentScore > 0 || saveState.currentStage > 1 || (saveState.inventory && saveState.inventory.length > 0)));

        var title = el("div", { class: "slot-title" }, [
            el("span", { text: "Save Slot " + slot }),
            el("span", { text: hasData ? "Used" : "Empty" }),
        ]);

        var meta = el("div", { class: "slot-meta" });
        if (hasData && saveState) {
            meta.appendChild(el("div", { html: "Level <b>" + saveState.currentStage + "</b>" }));
            meta.appendChild(el("div", { html: "Score <b>" + saveState.currentScore + "</b>" }));
            meta.appendChild(el("div", { html: "HP <b>" + Math.round(saveState.currentHealth) + " / " + BASE_HEALTH + "</b>" }));
            meta.appendChild(el("div", {
                class: "slot-tier",
                html: "Typing: <b>" + slotTypingDisplay(saveState.typingTier) + "</b>",
            }));
        } else {
            meta.appendChild(el("div", { text: "No save in this slot yet." }));
            if (mode === "new" && global.SentenceBank) {
                meta.appendChild(el("div", {
                    class: "slot-tier slot-tier-pending",
                    text: "Typing (before start): " + slotTypingDisplay(global.SentenceBank.getStoredTierId()),
                }));
            }
        }

        var classes = "slot-card";
        if (mode === "load" && !hasData) classes += " empty";

        var card = el("button", { type: "button", class: classes }, [title, meta]);
        card.addEventListener("click", function () {
            if (mode === "new") {
                var tierId = global.SentenceBank ? global.SentenceBank.getStoredTierId() : null;
                global.Storage.Players.resetSaveState(slotName, tierId);
                global.Game.start(slotName, role);
            } else if (hasData) {
                global.Game.start(slotName, role);
            }
        });
        return card;
    }

    /* ------------------------------------------------------------------
     *  Player stats
     * ------------------------------------------------------------------ */
    function renderStats(username, role) {
        showCanvas(false);
        clearHost();

        var player = global.Storage.Players.getOrCreate(username);
        var stats = (player && player.statistics) || global.Storage.utils.defaultStatistics();
        var best = global.Leaderboard.getPersonalBest(username);

        var grid = el("div", { class: "stats-grid" }, [
            el("div", { class: "stat" }, [el("span", { text: "Avg WPM" }), el("strong", { text: String(Math.round(stats.Wpm)) })]),
            el("div", { class: "stat" }, [el("span", { text: "Avg Accuracy" }), el("strong", { text: Math.round(stats.accuracyPercentage) + "%" })]),
            el("div", { class: "stat" }, [el("span", { text: "Total Errors" }), el("strong", { text: String(stats.errorCount | 0) })]),
            el("div", { class: "stat" }, [el("span", { text: "Time Played" }), el("strong", { text: formatDuration(stats.totalTimePlayed) })]),
            el("div", { class: "stat" }, [el("span", { text: "Personal Best" }), el("strong", { text: String(best || 0) })]),
            el("div", { class: "stat" }, [el("span", { text: "Account" }), el("strong", { text: username + (role ? " (" + role + ")" : "") })]),
        ]);

        var actions = el("div", { class: "actions" }, [
            makeButton("Back", "secondary", function () { renderHome(username, role); }),
            makeButton("Refresh", "ghost", function () { renderStats(username, role); }),
        ]);

        var card = el("section", { class: "screen" }, [
            el("h2", { text: "Statistics" }),
            el("p", { class: "screen-sub", text: "Stats accumulate from every spell-cast attempt across all of your save slots." }),
            grid,
            actions,
        ]);
        host().appendChild(card);
    }

    /* ------------------------------------------------------------------
     *  Tutorial
     * ------------------------------------------------------------------ */
    function renderTutorial(username, role) {
        showCanvas(false);
        clearHost();

        var rows = [
            ["W A S D / Arrows", "Move the wizard"],
            ["Mouse cursor", "Aim direction"],
            ["Enter", "Cast a spell to load a fireball into the hotbar"],
            ["Space / Left Click", "Fire a loaded fireball (costs 10 MP)"],
            ["Tab", "Open / close inventory"],
            ["1 – 3 (while playing)", "Quick-use Health / Strength / Invincibility from the HUD toolbar"],
            ["1 – 9 (in inventory)", "Use the potion in that inventory slot directly"],
            ["Enter (in inventory)", "Use the currently selected potion"],
            ["E", "Open a door (reveals the unknown room beyond)"],
            ["Shift", "Dash — speed burst, 0.35s invuln, 1.2s cooldown (bar under HP)"],
            ["SND (HUD)", "Toggle game sound — preference saved locally"],
            ["Esc", "Pause game"],
        ];

        var grid = el("div", { class: "tutorial-grid" });
        rows.forEach(function (r) {
            grid.appendChild(el("div", { class: "tutorial-key", text: r[0] }));
            grid.appendChild(el("div", { class: "tutorial-action", text: r[1] }));
        });

        var notes = el("ul", { class: "screen-sub" }, [
            el("li", { text: "Each level is a procedural maze (4–9 rooms on a 3×3 grid) linked by corridors. Clear the current room, then press E at a door to enter an unknown room — enemies and loot only appear once the door opens." }),
            el("li", { text: "The minimap (top-right) shows the maze layout: fog for unrevealed rooms, S for start, B for boss, and a green outline on your current room." }),
            el("li", { text: "Opening a door triggers a room reveal toast (Enemy ambush!, Treasure cache!, or Boss chamber!) when that room spawns its contents." }),
            el("li", { text: "HUD shows rooms cleared, combo streak, dash cooldown bar (left), WPM/ACC meters while typing, and SND to mute Web Audio beeps." }),
            el("li", { text: "Green fast enemies are quicker but fragile; purple tanks are slow with high HP. Two spell successes in a row grant a bonus hotbar charge." }),
            el("li", { text: "Visit every room on a floor for a Fully explored! toast; spell success shows your WPM and accuracy tier." }),
            el("li", { text: "On the home screen, pick a typing tier (Grade 1–6 through IELTS/TOEFL). Pills show real-world WPM bands and accuracy goals (e.g. Grade 1–6 · 5–30 WPM · 80%+ acc). Spell time scales with sentence length; IELTS/TOEFL uses generous timers for exam-style thinking." }),
            el("li", { text: "Type the displayed sentence within the timer shown (it adjusts per sentence). A perfect cast loads a charged fireball into your hotbar (slots 1–6); charged shots deal extra damage." }),
            el("li", { text: "Pickups: green Health hearts auto-heal on contact. Strength and Invincibility potions drop into your inventory for later use. Potion-only rooms count as cleared immediately (no enemies to defeat)." }),
            el("li", { text: "Quick potions: the bottom-right HUD bar shows Health (1), Strength (2), and Invincibility (3) with stack counts — click a slot or press its key during play. Tab still opens the full 12-slot inventory." }),
            el("li", { text: "Loaded fireballs show as \"Fireballs: N\" above the spell hotbar; glowing slots are ready to fire (Space / click, 10 MP each)." }),
            el("li", { text: "When the boss is alive, a BOSS health bar appears under your HP. Below 25% HP a red vignette warns you; below 15% it pulses faster with a heartbeat sound." }),
            el("li", { text: "A red arc on the screen edge points toward the last enemy that hit you. Combo x5 and x10 grant bonus toasts; x10 doubles kill score for 10 seconds." }),
            el("li", { text: "Game over offers Quick retry to restart the same save slot instantly. Hover inventory potions for effect tooltips." }),
            el("li", { text: "Each level scales enemy HP by 1.18 per level. Levels 3+ run a 60s timer (shrinking 5s per level) — defeat the boss before it hits zero." }),
            el("li", { text: "Enemy types: Slime (grunt), Swift (fast), Brute (tank), Archer (ranged). Gold-ring elites have 2× HP and pay double score. Kill feed (top-left) shows each takedown." }),
            el("li", { text: "Combo x5 grants a damage aura; at combo x10 you get RAMPAGE! — a screen flash, toast, and a 2-second fireball damage boost." }),
            el("li", { text: "About 30% of treasure rooms are mystic shrines only — press E for +30 HP, 15s strength, or a bonus spell charge. Your maze seed shows on the HUD and pause menu." }),
            el("li", { text: "A 5-kill combo grants a brief damage aura. Below 15% HP you hear a heartbeat and the screen vignette pulses faster." }),
            el("li", { text: "Higher floors pull longer sentences within your tier. Spell grades S/A/B/C use tier-specific WPM and accuracy bars (e.g. Grade 1–6: S at 90% acc; IELTS emphasizes accuracy). On game over, Quick retry restarts the same save slot without returning to menus." }),
            el("li", { text: "Parry: if you dash within the first 0.2s of an incoming hit, you block damage and see a Parried! toast." }),
            el("li", { text: "Successful spells earn grades S/A/B/C from WPM and accuracy against your tier's goals (shown on the spell overlay). The minimap pulses green when a hotbar charge is ready." }),
            el("li", { text: "Score earns coins for cosmetic colors on the home shop. Watch for red trap tiles and rare secret rooms with bonus chests." }),
        ]);

        var actions = el("div", { class: "actions" }, [
            makeButton(username ? "Back to home" : "Back to login", "secondary", function () {
                if (username) renderHome(username, role);
                else renderLogin();
            }),
        ]);

        var card = el("section", { class: "screen" }, [
            el("h2", { text: "How to play" }),
            grid,
            notes,
            actions,
        ]);
        host().appendChild(card);
    }

    /* ------------------------------------------------------------------
     *  Leaderboard
     * ------------------------------------------------------------------ */
    function renderLeaderboard(username, role) {
        showCanvas(false);
        clearHost();

        var entries = global.Leaderboard.topEntries();
        var list = el("ol", { class: "leaderboard" });
        if (!entries.length) {
            list.appendChild(el("li", { class: "empty", text: "No scores yet — play a run to set a personal best." }));
        } else {
            entries.forEach(function (e) {
                list.appendChild(el("li", { class: "leaderboard-row" }, [
                    el("span", { class: "rank", text: "#" + (e.rank || "—") }),
                    el("span", { class: "name", text: e.username || "" }),
                    el("span", { class: "value", text: String(e.score || 0) }),
                ]));
            });
        }

        var actions = el("div", { class: "actions" }, [
            makeButton(username ? "Back" : "Back to login", "secondary", function () {
                if (username) renderHome(username, role);
                else renderLogin();
            }),
        ]);

        var card = el("section", { class: "screen" }, [
            el("h2", { text: "Leaderboard" }),
            el("p", { class: "screen-sub", text: "Top 10 personal bests on this device." }),
            list,
            actions,
        ]);
        host().appendChild(card);
    }

    /* ------------------------------------------------------------------
     *  Admin panel
     * ------------------------------------------------------------------ */
    function renderAdmin(username, role) {
        showCanvas(false);
        clearHost();

        var listBox = el("div", { class: "admin-list" });
        var detailBox = el("div", { class: "admin-detail" });
        var status = el("p", { class: "status" });

        var selected = null;

        function refreshList() {
            listBox.innerHTML = "";
            var users = global.Storage.Accounts.list();
            users.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
            users.forEach(function (u) {
                var btn = el("button", {
                    type: "button",
                    class: "admin-user" + (selected && selected.toLowerCase() === u.toLowerCase() ? " active" : ""),
                }, [
                    el("span", { text: u }),
                    el("span", { class: "role", text: global.Storage.Accounts.role(u) || "" }),
                ]);
                btn.addEventListener("click", function () { select(u); });
                listBox.appendChild(btn);
            });
            if (!users.length) {
                listBox.appendChild(el("p", { class: "screen-sub", text: "No users." }));
            }
        }

        function refreshDetail() {
            detailBox.innerHTML = "";
            if (!selected) {
                detailBox.appendChild(el("h3", { text: "Select a user" }));
                detailBox.appendChild(el("p", { class: "screen-sub", text: "Click a user on the right to view stats and management actions." }));
                return;
            }

            var record = global.Storage.Players.getOrCreate(selected);
            var stats = (record && record.statistics) || global.Storage.utils.defaultStatistics();
            var best = global.Leaderboard.getPersonalBest(selected);
            var roleLabel = global.Storage.Accounts.role(selected) || "Player";

            detailBox.appendChild(el("h3", { text: selected + " (" + roleLabel + ")" }));
            detailBox.appendChild(el("div", { class: "stats-grid" }, [
                el("div", { class: "stat" }, [el("span", { text: "Personal Best" }), el("strong", { text: String(best || 0) })]),
                el("div", { class: "stat" }, [el("span", { text: "Avg WPM" }), el("strong", { text: String(Math.round(stats.Wpm)) })]),
                el("div", { class: "stat" }, [el("span", { text: "Avg Accuracy" }), el("strong", { text: Math.round(stats.accuracyPercentage) + "%" })]),
                el("div", { class: "stat" }, [el("span", { text: "Total Errors" }), el("strong", { text: String(stats.errorCount | 0) })]),
                el("div", { class: "stat" }, [el("span", { text: "Time Played" }), el("strong", { text: formatDuration(stats.totalTimePlayed) })]),
                el("div", { class: "stat" }, [el("span", { text: "Save Slots" }), el("strong", { text: countSlots(selected) + " / 4" })]),
            ]));

            var controls = el("div", { class: "admin-controls" });
            controls.appendChild(makeButton("Reset Stats", "secondary", function () {
                global.Storage.Players.resetStatistics(selected);
                global.Storage.Players.updateSaveState(selected, 1, BASE_HEALTH, [], 0);
                setStatus(status, "Stats wiped for " + selected, "good");
                refreshDetail();
            }));
            controls.appendChild(makeButton("Wipe Leaderboard", "danger", function () {
                global.Leaderboard.clearAll();
                setStatus(status, "Leaderboard has been completely wiped.", "bad");
                refreshDetail();
            }));
            var deleteBtn = makeButton("Delete Account", "danger", function () {
                if (selected.toLowerCase() === username.toLowerCase()) {
                    setStatus(status, "You cannot delete the account currently in use.", "bad");
                    return;
                }
                if (selected.toLowerCase() === "admin") {
                    setStatus(status, "The default Admin account cannot be deleted.", "bad");
                    return;
                }
                if (!confirm("Delete account '" + selected + "' and all associated saves?")) return;
                if (!global.Storage.Accounts.deleteAccount(selected)) {
                    setStatus(status, "Failed to delete account: " + selected, "bad");
                    return;
                }
                setStatus(status, "Deleted account: " + selected, "good");
                selected = null;
                refreshList();
                refreshDetail();
            });
            controls.appendChild(deleteBtn);

            detailBox.appendChild(controls);
        }

        function select(u) {
            selected = u;
            refreshList();
            refreshDetail();
        }

        var actions = el("div", { class: "actions" }, [
            makeButton("Back", "secondary", function () { renderHome(username, role); }),
            makeButton("Refresh", "ghost", function () { refreshList(); refreshDetail(); }),
            makeButton("Logout", "ghost", function () { global.Storage.Session.clear(); renderLogin(); }),
        ]);

        var card = el("section", { class: "screen wide" }, [
            el("h2", { text: "Admin panel" }),
            el("p", { class: "screen-sub", text: "Manage local player names and wipe the leaderboard." }),
            el("div", { class: "admin-grid" }, [detailBox, listBox]),
            status,
            actions,
        ]);
        host().appendChild(card);

        // Initial population, auto-select first non-admin if available.
        refreshList();
        var users = global.Storage.Accounts.list();
        if (users.length) select(users[0]);
        else refreshDetail();
    }

    function countSlots(baseUsername) {
        var count = 0;
        for (var i = 1; i <= 4; i++) {
            if (global.Storage.Players.exists(global.Storage.utils.buildSlotName(baseUsername, i))) count++;
        }
        return count;
    }

    /* ------------------------------------------------------------------
     *  Helpers
     * ------------------------------------------------------------------ */
    function formatDuration(seconds) {
        var s = Math.max(0, seconds | 0);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var ss = s % 60;
        var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        if (h > 0) return h + "h " + pad(m) + "m";
        if (m > 0) return m + "m " + pad(ss) + "s";
        return ss + "s";
    }

    /* ------------------------------------------------------------------
     *  Public API
     * ------------------------------------------------------------------ */
    global.Screens = {
        renderLogin: renderLogin,
        renderRegister: renderRegister,
        renderRecovery: renderRecovery,
        renderHome: renderHome,
        renderSlots: renderSlots,
        renderStats: renderStats,
        renderTutorial: renderTutorial,
        renderLeaderboard: renderLeaderboard,
        renderAdmin: renderAdmin,
        showCanvas: showCanvas,
        setFooter: setFooter,
        helpers: {
            el: el,
            makeButton: makeButton,
            formatDuration: formatDuration,
            renderTopbar: renderTopbar,
        },
    };
})(window);

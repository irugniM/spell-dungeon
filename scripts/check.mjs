import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXTS = new Set([".html", ".css", ".js", ".mjs", ".md", ".yml", ".py"]);
const SKIP_DIRS = new Set([".git", "node_modules"]);

const STORAGE_KEYS = {
    "js/storage.js": ["spell-dungeon::accounts::v1", "spell-dungeon::players::v1", "spell-dungeon::session::v1"],
    "js/meta.js": ["spell-dungeon::meta-coins::v1", "spell-dungeon::player-color::v1", "spell-dungeon::unlocked-colors::v1"],
    "js/game.js": ["spelldungeon-start-tutorial-dismissed", "spelldungeon-achievements"],
    "js/sentences.js": ["spelldungeon-typing-tier"],
    "js/leaderboard.js": ["spell-dungeon::leaderboard::v1"],
    "js/audio.js": ["spelldungeon-muted", "spellDungeonMuted"],
};

const SPELL_IDS = [
    "spell-overlay",
    "spell-timer-display",
    "spell-prompt",
    "spell-input",
    "spell-meters",
    "spell-wpm-fill",
    "spell-wpm-value",
    "spell-acc-fill",
    "spell-acc-value",
];

const FONTS = [
    ["Cinzel Decorative", /family=Cinzel\+Decorative\b/],
    ["Cinzel", /family=Cinzel(?!\+)\b/],
    ["Source Serif 4", /family=Source\+Serif\+4\b/],
    ["Barlow Condensed", /family=Barlow\+Condensed\b/],
];

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
        } else if (entry.isFile()) {
            out.push(relative(ROOT, join(dir, entry.name)).split("\\").join("/"));
        }
    }
    return out;
}

const allFiles = walk(ROOT);
const textFiles = allFiles.filter((f) => TEXT_EXTS.has(extname(f)));
const jsFiles = allFiles.filter((f) => /^js\/.*\.js$/.test(f));
const html = read("index.html");
const htmlIds = new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]));

function hasClass(markup, name) {
    return [...markup.matchAll(/\sclass=["']([^"']*)["']/g)].some((m) => m[1].split(/\s+/).includes(name));
}

function checkEmoji() {
    const errors = [];
    const pattern = /\p{Extended_Pictographic}|\uFE0F/gu;
    for (const file of textFiles) {
        read(file).split("\n").forEach((line, index) => {
            for (const match of line.matchAll(pattern)) {
                const code = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
                errors.push(`${file}:${index + 1} contains U+${code}`);
            }
        });
    }
    return errors;
}

function checkStorageKeys() {
    const errors = [];
    const expected = new Set();
    for (const [file, keys] of Object.entries(STORAGE_KEYS)) {
        const source = read(file);
        for (const key of keys) {
            expected.add(key);
            if (!source.includes(`"${key}"`)) errors.push(`${file} is missing key "${key}"`);
        }
    }
    const literal = /["'](spell-dungeon::[^"']+|spelldungeon-[^"']+|spellDungeon[A-Z][^"']*)["']/g;
    for (const file of jsFiles) {
        for (const match of read(file).matchAll(literal)) {
            if (!expected.has(match[1])) errors.push(`${file} has unlisted storage key "${match[1]}"`);
        }
    }
    return errors;
}

function checkSpellElements() {
    const errors = SPELL_IDS.filter((id) => !htmlIds.has(id)).map((id) => `index.html is missing #${id}`);
    for (const label of ["WPM", "ACC"]) {
        const pattern = new RegExp(`class="spell-meter-label"[^>]*>\\s*${label}\\s*<`);
        if (!pattern.test(html)) errors.push(`index.html is missing the ${label} meter label`);
    }
    return errors;
}

function checkChromeRemoved() {
    const errors = [];
    if (hasClass(html, "topbar")) errors.push('index.html still has class="topbar"');
    if (/<footer\b/i.test(html)) errors.push("index.html still has <footer>");
    if (hasClass(html, "sidebar")) errors.push('index.html still has class="sidebar"');
    return errors;
}

function checkReferencedIds() {
    const referenced = new Map();
    const dynamic = new Set();
    const note = (id, file) => {
        if (!referenced.has(id)) referenced.set(id, new Set());
        referenced.get(id).add(file);
    };
    for (const file of jsFiles) {
        const source = read(file);
        for (const m of source.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) note(m[1], file);
        for (const m of source.matchAll(/querySelector(?:All)?\(\s*["']#([\w-]+)/g)) note(m[1], file);
        if (file === "js/game.js") {
            for (const m of source.matchAll(/\bel\(\s*["']([^"']+)["']\s*\)/g)) note(m[1], file);
        }
        for (const m of source.matchAll(/\bid=\\?["']([\w-]+)\\?["']/g)) dynamic.add(m[1]);
        for (const m of source.matchAll(/\.id\s*=\s*["']([\w-]+)["']/g)) dynamic.add(m[1]);
        for (const m of source.matchAll(/\bid:\s*["']([\w-]+)["']/g)) dynamic.add(m[1]);
    }
    // audio.js looks up this optional legacy button and tolerates its absence.
    const optional = new Set(["btn-mute"]);
    const errors = [];
    for (const [id, files] of referenced) {
        if (!htmlIds.has(id) && !dynamic.has(id) && !optional.has(id)) {
            errors.push(`#${id} (used in ${[...files].join(", ")}) is not in index.html or created in JS`);
        }
    }
    return errors;
}

function checkFonts() {
    const errors = FONTS.filter(([, pattern]) => !pattern.test(html)).map(([name]) => `index.html is missing font ${name}`);
    if (/Press(\s|\+)Start(\s|\+)2P/i.test(html)) errors.push('index.html still references "Press Start 2P"');
    if (existsSync(join(ROOT, "styles.css")) && /Press(\s|\+)Start(\s|\+)2P/i.test(read("styles.css"))) {
        errors.push('styles.css still references "Press Start 2P"');
    }
    return errors;
}

function checkParse() {
    const errors = [];
    for (const file of allFiles.filter((f) => /\.(js|mjs)$/.test(f))) {
        const result = spawnSync(process.execPath, ["--check", join(ROOT, file)], { encoding: "utf8" });
        if (result.status !== 0) errors.push(`${file} failed to parse: ${(result.stderr || "").trim().split("\n")[0]}`);
    }
    return errors;
}


function loadGameExports() {
    const stubNode = () => ({
        hidden: true,
        textContent: "",
        innerHTML: "",
        className: "",
        dataset: {},
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        appendChild() {},
        cloneNode() { return stubNode(); },
        parentNode: { replaceChild() {} },
    });
    const sandbox = {
        console,
        Math,
        Number,
        String,
        Array,
        Object,
        Date,
        JSON,
        parseInt,
        parseFloat,
        isNaN,
        Infinity,
        setTimeout: () => 0,
        clearTimeout() {},
        requestAnimationFrame: () => 0,
        cancelAnimationFrame() {},
        performance: { now: () => 0 },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: stubNode,
        },
        window: null,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read("js/game.js"), sandbox, { filename: "js/game.js" });
    return sandbox.Game;
}

function checkSpellPromptWrapAndCaret() {
    const errors = [];
    const css = read("styles.css");
    const promptBlock = css.match(/\.spell-prompt\s*\{[^}]*\}/);
    if (!promptBlock) {
        errors.push("styles.css missing .spell-prompt rule");
    } else {
        if (/white-space:\s*pre-wrap/i.test(promptBlock[0])) errors.push(".spell-prompt still uses white-space: pre-wrap");
        if (/overflow-wrap:\s*break-word/i.test(promptBlock[0])) errors.push(".spell-prompt still uses overflow-wrap: break-word");
    }
    const wordBlock = css.match(/\.spell-word\s*\{[^}]*\}/);
    if (!wordBlock || !/white-space:\s*nowrap/i.test(wordBlock[0])) {
        errors.push("styles.css missing .spell-word with white-space: nowrap");
    }

    const Game = loadGameExports();
    if (!Game || typeof Game.buildSpellPromptHtml !== "function") {
        errors.push("Game.buildSpellPromptHtml is not exported");
        return errors;
    }

    const sentence = "The essay thesis should answer a specific question with evidence.";
    const zero = Game.buildSpellPromptHtml(sentence, "");
    const zeroCarets = zero.html.match(/class="spell-caret"/g) || [];
    if (zeroCarets.length !== 1) errors.push(`expected 1 caret at 0 typed, got ${zeroCarets.length}`);
    if (!zero.html.startsWith('<span class="spell-word"><span class="spell-caret"')) {
        errors.push("caret at 0 typed is not placed before the first character");
    }
    const wordMatches = [...zero.html.matchAll(/<span class="spell-word">(.*?)<\/span>(?=<span class="pending"> |<span class="ok"> |<span class="err">|$)/g)];
    const wordsText = wordMatches.map((m) => m[1].replace(/<[^>]+>/g, ""));
    for (const expectedWord of sentence.split(" ")) {
        if (!wordsText.includes(expectedWord)) {
            errors.push(`word "${expectedWord}" was split or missing from .spell-word spans`);
        }
    }

    const mid = Game.buildSpellPromptHtml(sentence, "The ");
    const midCarets = mid.html.match(/class="spell-caret"/g) || [];
    if (midCarets.length !== 1) errors.push(`expected 1 caret mid-sentence, got ${midCarets.length}`);
    if (!mid.html.includes('<span class="spell-word"><span class="spell-caret" aria-hidden="true"></span><span class="pending">e</span>')) {
        errors.push("caret at typed.length=4 is not before 'essay'");
    }
    if (mid.html.endsWith('<span class="spell-caret" aria-hidden="true"></span>')) {
        errors.push("caret appeared after final character while typing mid-sentence");
    }

    const errSpaceInWord = Game.buildSpellPromptHtml("ab cd", "a ");
    if (errSpaceInWord.errors !== 1 || !errSpaceInWord.html.includes('<span class="err">&nbsp;</span>')) {
        errors.push("mistyped space inside a word is not visibly marked as .err");
    }
    const errCharAtSpace = Game.buildSpellPromptHtml("ab cd", "abx");
    if (errCharAtSpace.errors !== 1 || !errCharAtSpace.html.includes('<span class="err">x</span>')) {
        errors.push("mistyped character at a space is not visibly marked as .err");
    }
    return errors;
}

function checkNoBlueCanvas() {
    const errors = [];
    const gameJs = read("js/game.js");
    const bannedHexes = [
        "#050811", "#06080f", "#1a2844", "#243656", "#0f1828", "#0c1424",
        "#0e1a2c", "#0e162a", "#1c0d18", "#280d1f", "#152540", "#131f38",
        "#0d1731", "#0c1528", "#5c1a38", "#2a4a72", "#243a5c", "#121e34",
        "#0e172c", "#1e3050", "#0c142a", "#0a0e18", "#141c30", "#4a1830",
        "#1a3050", "#1e2d4a", "#6a7a9a", "#e8eef8", "#a8b4cc", "#6ec1ff",
    ];
    const lower = gameJs.toLowerCase();
    for (const hex of bannedHexes) {
        if (lower.includes(hex)) errors.push(`js/game.js still contains old blue/slate color ${hex}`);
    }
    const palMatch = gameJs.match(/var PIXEL_PAL = \{([\s\S]*?)\};/);
    if (!palMatch) {
        errors.push("js/game.js missing PIXEL_PAL");
    } else {
        for (const m of palMatch[1].matchAll(/(\w+):\s*"#([0-9a-fA-F]{6})"/g)) {
            const name = m[1];
            const r = parseInt(m[2].slice(0, 2), 16);
            const g = parseInt(m[2].slice(2, 4), 16);
            const b = parseInt(m[2].slice(4, 6), 16);
            if (b > r + 15 && b > g + 15) {
                errors.push(`PIXEL_PAL.${name} (#${m[2]}) is blue-dominant`);
            }
        }
    }
    const shrineMatch = gameJs.match(/function drawShrine\([\s\S]*?\n    function /);
    if (!shrineMatch) {
        errors.push("js/game.js missing drawShrine");
    } else {
        const body = shrineMatch[0];
        const pal = { white: "f4e0c4", goldHi: "fff3b0", gold: "ffd166", goldLo: "b8922e", fire: "ff8a3d", fireHi: "ffd166", fireCore: "fff8e8" };
        const isLight = (hex) => {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return (r + g + b) / 3 >= 180;
        };
        const isEmber = (hex) => {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return r >= 180 && g >= 60 && b <= 120 && r > b + 40;
        };
        let hasLightSlab = false;
        let hasEmberGlow = false;
        for (const m of body.matchAll(/drawRect\(ctx,\s*[^,]+,\s*[^,]+,\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/g)) {
            const width = Number(m[1].trim());
            const height = Number(m[2].trim());
            if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
            let hex = null;
            const palRef = m[3].match(/PIXEL_PAL\.(\w+)/);
            const lit = m[3].match(/#([0-9a-fA-F]{6})/);
            if (palRef && pal[palRef[1]]) hex = pal[palRef[1]];
            else if (lit) hex = lit[1];
            if (!hex) continue;
            if (isLight(hex) && width >= 24 && height >= 4) hasLightSlab = true;
            if (isEmber(hex) && (width >= 32 || height >= 16)) hasEmberGlow = true;
        }
        if (!hasLightSlab) {
            errors.push("drawShrine is missing a light top slab that contrasts with the floor");
        }
        if (!hasEmberGlow || !/globalAlpha/.test(body)) {
            errors.push("drawShrine is missing an ember glow or outline");
        }
    }
    return errors;
}

function stripJsComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
}

function checkFontGlyphs() {
    const errors = [];
    const allowedExtra = new Set([0x00B7, 0x00D7, 0x00F7, 0x2013, 0x2014, 0x2026]);
    const uiFiles = ["index.html", "styles.css", ...jsFiles];
    for (const file of uiFiles) {
        const content = file.endsWith(".js") ? stripJsComments(read(file)) : read(file);
        content.split("\n").forEach((line, idx) => {
            for (const ch of line) {
                const cp = ch.codePointAt(0);
                if (cp > 127 && !allowedExtra.has(cp)) {
                    const hex = cp.toString(16).toUpperCase().padStart(4, "0");
                    errors.push(`${file}:${idx + 1} has unsupported glyph U+${hex} (${ch})`);
                }
            }
        });
    }
    return errors;
}

function checkDebugRouteAndLayout() {
    const errors = [];
    const appJs = read("js/app.js");
    const gameJs = read("js/game.js");
    const css = read("styles.css");
    if (!appJs.includes("startDebug") || !appJs.includes('"boss"') || !appJs.includes('"shrine"')) {
        errors.push("js/app.js missing ?debug=boss / ?debug=shrine route handling");
    }
    if (!gameJs.includes("isDebug") || !gameJs.includes("setupDebugRoom")) {
        errors.push("js/game.js missing debug room setup and isDebug save guards");
    }
    if (!/\.inv-label\s*\{[^}]*overflow-wrap:\s*anywhere/i.test(css)) {
        errors.push("styles.css missing .inv-label overflow-wrap guard");
    }
    if (!/\.slot-card\s*\{[^}]*min-width:\s*0/i.test(css)) {
        errors.push("styles.css missing .slot-card min-width: 0 guard");
    }
    return errors;
}


function createBrowserSandbox() {
    const store = new Map();
    const elements = new Map();
    const listeners = new Map();
    let rafId = 0;
    const rafCallbacks = new Map();
    let nowMs = 1000;

    const makeClassList = () => {
        const set = new Set();
        return {
            add(...names) { names.forEach((n) => set.add(n)); },
            remove(...names) { names.forEach((n) => set.delete(n)); },
            toggle(n, force) {
                if (force === undefined) {
                    if (set.has(n)) { set.delete(n); return false; }
                    set.add(n); return true;
                }
                if (force) set.add(n); else set.delete(n);
                return !!force;
            },
            contains(n) { return set.has(n); },
        };
    };

    const noop = () => {};
    const grad = () => ({ addColorStop: noop });
    const makeCtx2d = () => ({
        canvas: { width: 1280, height: 800 },
        fillStyle: "#000",
        strokeStyle: "#000",
        lineWidth: 1,
        globalAlpha: 1,
        font: "12px monospace",
        textAlign: "left",
        textBaseline: "alphabetic",
        imageSmoothingEnabled: false,
        shadowColor: "transparent",
        shadowBlur: 0,
        save: noop,
        restore: noop,
        translate: noop,
        scale: noop,
        rotate: noop,
        clearRect: noop,
        fillRect: noop,
        strokeRect: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        arc: noop,
        ellipse: noop,
        rect: noop,
        quadraticCurveTo: noop,
        fill: noop,
        stroke: noop,
        clip: noop,
        setLineDash: noop,
        fillText: noop,
        strokeText: noop,
        drawImage: noop,
        measureText: () => ({ width: 20 }),
        createLinearGradient: grad,
        createRadialGradient: grad,
    });

    const makeNode = (id = "") => {
        const nodeListeners = new Map();
        const node = {
            id,
            tagName: "DIV",
            hidden: false,
            textContent: "",
            innerHTML: "",
            value: "",
            checked: false,
            disabled: false,
            width: 1280,
            height: 800,
            className: "",
            dataset: {},
            style: {},
            children: [],
            parentNode: null,
            classList: makeClassList(),
            getContext() { return makeCtx2d(); },
            getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; },
            focus() {},
            select() {},
            closest() { return null; },
            setAttribute(k, v) { node[k] = v; },
            appendChild(child) {
                if (child) {
                    child.parentNode = node;
                    node.children.push(child);
                }
                return child;
            },
            replaceChild(newChild, oldChild) {
                const idx = node.children.indexOf(oldChild);
                if (idx >= 0) node.children[idx] = newChild;
                newChild.parentNode = node;
                if (newChild.id) elements.set(newChild.id, newChild);
                return oldChild;
            },
            cloneNode() {
                const copy = makeNode(node.id);
                copy.tagName = node.tagName;
                copy.className = node.className;
                copy.hidden = node.hidden;
                return copy;
            },
            addEventListener(type, fn) {
                if (!nodeListeners.has(type)) nodeListeners.set(type, []);
                nodeListeners.get(type).push(fn);
            },
            removeEventListener(type, fn) {
                const list = nodeListeners.get(type);
                if (!list) return;
                const idx = list.indexOf(fn);
                if (idx >= 0) list.splice(idx, 1);
            },
            dispatchEvent(ev) {
                const list = nodeListeners.get(ev.type) || [];
                for (const fn of list) fn(ev);
            },
            click() {
                node.dispatchEvent({ type: "click", target: node, preventDefault() {} });
            },
            querySelector() { return null; },
            querySelectorAll() { return []; },
        };
        node.parentNode = {
            replaceChild(newChild, oldChild) {
                newChild.parentNode = this;
                if (newChild.id) elements.set(newChild.id, newChild);
                return oldChild;
            },
        };
        if (id) elements.set(id, node);
        return node;
    };

    const getEl = (id) => {
        if (!elements.has(id)) makeNode(id);
        return elements.get(id);
    };

    for (const id of [
        "game", "minimap", "hud", "hud-rooms", "hud-seed", "hud-hp-text", "hud-hp-fill",
        "hud-mp-text", "hud-mp-fill", "hud-level", "hud-score", "hud-timer-wrap", "hud-timer",
        "hud-quest-list", "hud-potion-bar", "hud-hotbar", "hud-hint", "hud-action-bar",
        "hud-toast", "door-hint", "score-ghost", "dash-cooldown", "dash-cooldown-fill",
        "overlay-pause", "overlay-gameover", "overlay-start-tutorial", "inventory-overlay",
        "spell-overlay", "btn-resume", "btn-save-quit", "btn-quit", "btn-retry",
        "btn-quick-retry", "btn-back-menu", "btn-start-tutorial-dismiss", "inventory-confirm",
        "inventory-close", "canvas-host", "canvas-wrap", "screen-host", "topbar-actions",
        "footer-name", "result-score", "result-level", "result-rooms", "result-kills",
        "result-combo", "result-best", "result-newbest-row", "result-coins-row", "result-coins",
        "touch-controls", "touch-joystick", "touch-joystick-knob", "touch-fire-btn",
    ]) {
        getEl(id);
    }

    const sandbox = {
        console,
        Math,
        Number,
        String,
        Array,
        Object,
        Date,
        JSON,
        Promise,
        TextEncoder,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        Infinity,
        setTimeout: () => 0,
        clearTimeout() {},
        requestAnimationFrame(fn) {
            const id = ++rafId;
            rafCallbacks.set(id, fn);
            return id;
        },
        cancelAnimationFrame(id) { rafCallbacks.delete(id); },
        performance: { now: () => nowMs },
        localStorage: {
            get length() { return store.size; },
            key(i) { return [...store.keys()][i] ?? null; },
            getItem(k) { return store.has(k) ? store.get(k) : null; },
            setItem(k, v) { store.set(String(k), String(v)); },
            removeItem(k) { store.delete(k); },
            clear() { store.clear(); },
        },
        navigator: { maxTouchPoints: 0 },
        matchMedia: () => ({ matches: false }),
        location: { search: "" },
        URLSearchParams,
        Node: function Node() {},
        document: {
            readyState: "complete",
            body: makeNode("body"),
            getElementById: getEl,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: (tag) => {
                const n = makeNode("");
                n.tagName = String(tag || "div").toUpperCase();
                return n;
            },
            createTextNode: (t) => ({ nodeValue: String(t || "") }),
            addEventListener(type, fn) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            removeEventListener() {},
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type);
            if (!list) return;
            const idx = list.indexOf(fn);
            if (idx >= 0) list.splice(idx, 1);
        },
        window: null,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    for (const file of [
        "js/leaderboard.js",
        "js/sentence-banks.js",
        "js/sentences.js",
        "js/storage.js",
        "js/meta.js",
        "js/screens.js",
        "js/game.js",
    ]) {
        vm.runInNewContext(read(file), sandbox, { filename: file });
    }

    const stepFrames = (count, dtMs = 50) => {
        for (let i = 0; i < count; i++) {
            const entries = [...rafCallbacks.entries()];
            rafCallbacks.clear();
            nowMs += dtMs;
            for (const [, fn] of entries) fn(nowMs);
        }
    };

    return { sandbox, getEl, stepFrames };
}

function checkDeathKeepsSaveSlot() {
    const errors = [];
    const { sandbox, getEl, stepFrames } = createBrowserSandbox();
    const { Storage, Game, localStorage } = sandbox;
    localStorage.setItem("spelldungeon-start-tutorial-dismissed", "1");

    // Seed a level-3 run (20s timer) with progress (cleared room, score, seed, inventory)
    Storage.Players.updateSaveState("Hero_slot1", 3, 85, ["Strength"], 450, "standard", {
        mapSeed: 55123,
        clearedRooms: [1],
        safeRoomIndex: 1,
    });
    Storage.Players.updateLevel3TimeLimit("Hero_slot1", 20);

    Game.start("Hero_slot1", "Player");
    const beforeDeath = Game.getStateSnapshot();
    if (!beforeDeath || beforeDeath.level !== 3 || beforeDeath.mapSeed !== 55123) {
        errors.push(`failed to start seeded level-3 run (got ${JSON.stringify(beforeDeath)})`);
        return errors;
    }

    // Run real frames (capped at 0.05s per frame in loop) until the 60s level-3 timer hits 0 and triggers gameOver()
    stepFrames(420, 50);

    const afterDeathSnap = Game.getStateSnapshot();
    if (!afterDeathSnap || afterDeathSnap.phase !== "gameover") {
        errors.push(`expected gameover phase after timer expiry, got ${afterDeathSnap && afterDeathSnap.phase}`);
        return errors;
    }
    if (getEl("overlay-gameover").hidden) {
        errors.push("#overlay-gameover remained hidden after death");
    }

    const savedAfterDeath = Storage.Players.getOrCreate("Hero_slot1").saveState;
    if (savedAfterDeath.currentStage !== 3 || savedAfterDeath.mapSeed !== 55123) {
        errors.push(`death wiped save slot: stage=${savedAfterDeath.currentStage}, seed=${savedAfterDeath.mapSeed}`);
    }
    if (!Array.isArray(savedAfterDeath.clearedRooms) || !savedAfterDeath.clearedRooms.includes(1)) {
        errors.push(`death lost clearedRooms: ${JSON.stringify(savedAfterDeath.clearedRooms)}`);
    }

    // Both Play again (#btn-retry) and Quick retry (#btn-quick-retry) must preserve and reload the safe state
    getEl("btn-retry").click();
    const afterRetry = Game.getStateSnapshot();
    if (!afterRetry || afterRetry.phase !== "playing") {
        errors.push(`#btn-retry did not restart into playing phase (got ${afterRetry && afterRetry.phase})`);
    }
    if (afterRetry.level !== 3 || afterRetry.mapSeed !== 55123 || afterRetry.roomsCleared !== 1) {
        errors.push(`#btn-retry did not restore last safe state: ${JSON.stringify(afterRetry)}`);
    }
    if (afterRetry.hp <= 0) {
        errors.push(`#btn-retry restarted with non-positive hp=${afterRetry.hp}`);
    }

    Game.quitToHome(false);
    return errors;
}

function checkClearedRoomsPersist() {
    const errors = [];
    const { sandbox, getEl, stepFrames } = createBrowserSandbox();
    const { Storage, Game, localStorage } = sandbox;
    localStorage.setItem("spelldungeon-start-tutorial-dismissed", "1");

    Storage.Players.updateSaveState("Hero_slot2", 1, 90, ["Strength"], 250, "standard", {
        mapSeed: 42199,
        clearedRooms: [1, 2],
        safeRoomIndex: 1,
    });

    Game.start("Hero_slot2", "Player");
    const snap1 = Game.getStateSnapshot();
    if (!snap1 || snap1.roomsCleared !== 2 || snap1.roomsTotal !== 4) {
        errors.push(`expected Rooms 2/4 on reload, got ${snap1 && snap1.roomsCleared}/${snap1 && snap1.roomsTotal}`);
    }
    if (snap1 && snap1.safeRoomIndex !== 1) {
        errors.push(`expected safeRoomIndex=1 on reload, got ${snap1.safeRoomIndex}`);
    }
    Game.quitToHome(true);

    const persisted = Storage.Players.getOrCreate("Hero_slot2").saveState;
    if (!Array.isArray(persisted.clearedRooms) || persisted.clearedRooms.length !== 2) {
        errors.push(`quitToHome(true) did not persist clearedRooms: ${JSON.stringify(persisted.clearedRooms)}`);
    }

    Game.start("Hero_slot2", "Player");
    stepFrames(1, 16);
    const snap2 = Game.getStateSnapshot();
    if (!snap2 || snap2.roomsCleared !== 2) {
        errors.push(`second reload lost cleared rooms: ${snap2 && snap2.roomsCleared}`);
    }
    if (getEl("hud-rooms").textContent !== "Rooms 2/4") {
        errors.push(`HUD rooms text expected "Rooms 2/4", got "${getEl("hud-rooms").textContent}"`);
    }
    Game.quitToHome(false);

    // Old save compatibility (no mapSeed, clearedRooms, safeRoomIndex)
    const playersRaw = JSON.parse(localStorage.getItem("spell-dungeon::players::v1"));
    playersRaw.players.push({
        username: "Legacy_slot1",
        statistics: { Wpm: 40, accuracyPercentage: 90, errorCount: 2, totalTimePlayed: 20 },
        saveState: { currentStage: 2, currentHealth: 80, inventory: ["Health"], currentScore: 500, level3TimeLimit: 60 },
    });
    localStorage.setItem("spell-dungeon::players::v1", JSON.stringify(playersRaw));

    Game.start("Legacy_slot1", "Player");
    const legacySnap = Game.getStateSnapshot();
    if (!legacySnap || legacySnap.level !== 2 || legacySnap.score !== 500 || !legacySnap.mapSeed) {
        errors.push(`old save failed to load cleanly: ${JSON.stringify(legacySnap)}`);
    }
    Game.quitToHome(false);
    return errors;
}

function checkMapSeedPersists() {
    const errors = [];
    const { sandbox } = createBrowserSandbox();
    const { Storage, Game, localStorage } = sandbox;
    localStorage.setItem("spelldungeon-start-tutorial-dismissed", "1");

    Game.start("Hero_slot3", "Player");
    const snap1 = Game.getStateSnapshot();
    if (!snap1 || !snap1.mapSeed) {
        errors.push("fresh run did not assign mapSeed");
        return errors;
    }
    const storedSeed = Storage.Players.getOrCreate("Hero_slot3").saveState.mapSeed;
    if (storedSeed !== snap1.mapSeed) {
        errors.push(`stored mapSeed (${storedSeed}) != live mapSeed (${snap1.mapSeed})`);
    }
    Game.quitToHome(true);

    Game.start("Hero_slot3", "Player");
    const snap2 = Game.getStateSnapshot();
    if (!snap2 || snap2.mapSeed !== snap1.mapSeed) {
        errors.push(`mapSeed changed on reload: ${snap1.mapSeed} -> ${snap2 && snap2.mapSeed}`);
    }
    const layout1 = JSON.stringify({ rooms: snap1.rooms.map((r) => [r.index, r.col, r.row]), edges: snap1.edges, s: snap1.startIndex, b: snap1.bossIndex });
    const layout2 = JSON.stringify({ rooms: snap2.rooms.map((r) => [r.index, r.col, r.row]), edges: snap2.edges, s: snap2.startIndex, b: snap2.bossIndex });
    if (layout1 !== layout2) {
        errors.push(`maze geometry changed on reload for seed ${snap1.mapSeed}: ${layout1} vs ${layout2}`);
    }
    Game.quitToHome(false);
    return errors;
}

const checks = [
    ["a. no emoji in text files", checkEmoji],
    ["b. localStorage keys unchanged", checkStorageKeys],
    ["c. spell-cast elements present", checkSpellElements],
    ["d. site chrome removed", checkChromeRemoved],
    ["e. referenced element ids exist", checkReferencedIds],
    ["f. fonts updated", checkFonts],
    ["g. js files parse", checkParse],
    ["h. spell prompt wrap, caret, and mistyped space", checkSpellPromptWrapAndCaret],
    ["i. no blue/navy canvas colours left", checkNoBlueCanvas],
    ["j. no unsupported font glyphs in UI", checkFontGlyphs],
    ["k. debug route and layout guards", checkDebugRouteAndLayout],
    ["l. dying keeps save slot and restarts from last safe state", checkDeathKeepsSaveSlot],
    ["m. cleared rooms persist and restore across save/reload", checkClearedRoomsPersist],
    ["n. maze seed persists and rebuilds identical maze on reload", checkMapSeedPersists],
];

let failed = 0;
for (const [name, run] of checks) {
    const errors = run();
    console.log(`${errors.length ? "FAIL" : "PASS"}  ${name}`);
    for (const error of errors) console.log(`      ${error}`);
    if (errors.length) failed++;
}

console.log(failed ? `\n${failed} of ${checks.length} checks failed.` : `\nAll ${checks.length} checks passed.`);
process.exit(failed ? 1 : 0);

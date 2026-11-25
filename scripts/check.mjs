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

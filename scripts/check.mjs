import { spawnSync } from "node:child_process";
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

const checks = [
    ["a. no emoji in text files", checkEmoji],
    ["b. localStorage keys unchanged", checkStorageKeys],
    ["c. spell-cast elements present", checkSpellElements],
    ["d. site chrome removed", checkChromeRemoved],
    ["e. referenced element ids exist", checkReferencedIds],
    ["f. fonts updated", checkFonts],
    ["g. js files parse", checkParse],
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

/**
 * Local-storage backed persistence layer.
 *
 * Mirrors the data model of the original libGDX `DataManager`:
 *   - Accounts (username, optional legacy password hash, role).
 *   - Player records keyed by username (a "slot" is just a record whose
 *     username matches "<base>_slot<N>").
 *   - Statistics (Wpm, accuracyPercentage, errorCount, totalTimePlayed).
 *   - Save state (currentStage, currentHealth, inventory, currentScore,
 *     level3TimeLimit, snapshotScore, snapshotInventory, typingTier).
 *   - Leaderboard entries (delegated to leaderboard.js).
 *
 * Passwords are hashed with SHA-256 via the SubtleCrypto API. Hashing is
 * async so caller helpers return Promises where required.
 */
(function (global) {
    "use strict";

    var KEY_ACCOUNTS = "spell-dungeon::accounts::v1";
    var KEY_PLAYERS = "spell-dungeon::players::v1";
    var KEY_SESSION = "spell-dungeon::session::v1";

    var DEFAULT_ADMIN = { username: "Admin", password: "", role: "Admin" };
    var BASE_HEALTH = 100;
    var BASE_LEVEL3_TIME = 60;

    /* ------------------------------------------------------------------
     *  Helpers
     * ------------------------------------------------------------------ */
    function safeJsonParse(text, fallback) {
        if (!text) return fallback;
        try {
            var parsed = JSON.parse(text);
            return parsed == null ? fallback : parsed;
        } catch (_e) {
            return fallback;
        }
    }

    function readJson(key, fallback) {
        try {
            return safeJsonParse(global.localStorage.getItem(key), fallback);
        } catch (_e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            global.localStorage.setItem(key, JSON.stringify(value));
        } catch (_e) {
            /* swallow quota errors silently */
        }
    }

    function normaliseUsername(raw) {
        if (raw === null || raw === undefined) return "";
        return String(raw).trim();
    }

    function bytesToHex(buffer) {
        var bytes = new Uint8Array(buffer);
        var out = "";
        for (var i = 0; i < bytes.length; i++) {
            var hex = bytes[i].toString(16);
            if (hex.length < 2) hex = "0" + hex;
            out += hex;
        }
        return out;
    }

    function hashPassword(plain) {
        var data = new TextEncoder().encode(String(plain == null ? "" : plain));
        if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
            return global.crypto.subtle.digest("SHA-256", data).then(bytesToHex);
        }
        // Fallback for unsupported environments — a deterministic FNV-1a hash.
        return Promise.resolve(fnvHash(data));
    }

    function fnvHash(data) {
        var hash = 0x811c9dc5;
        for (var i = 0; i < data.length; i++) {
            hash ^= data[i];
            hash = (hash * 0x01000193) >>> 0;
        }
        return ("00000000" + hash.toString(16)).slice(-8);
    }

    function defaultStatistics() {
        return { Wpm: 0, accuracyPercentage: 0, errorCount: 0, totalTimePlayed: 0 };
    }

    function defaultSaveState() {
        return {
            currentStage: 1,
            currentHealth: BASE_HEALTH,
            inventory: [],
            currentScore: 0,
            level3TimeLimit: BASE_LEVEL3_TIME,
            snapshotScore: 0,
            snapshotInventory: [],
            typingTier: null,
        };
    }

    function defaultPlayerRecord(username) {
        return {
            username: username,
            statistics: defaultStatistics(),
            saveState: defaultSaveState(),
        };
    }

    /* ------------------------------------------------------------------
     *  Accounts
     * ------------------------------------------------------------------ */
    function loadAccounts() {
        var data = readJson(KEY_ACCOUNTS, null);
        if (!data || !Array.isArray(data.users)) return { users: [] };
        return data;
    }

    function saveAccounts(file) {
        writeJson(KEY_ACCOUNTS, file);
    }

    function findUser(file, username) {
        var clean = normaliseUsername(username);
        if (!clean) return null;
        var lower = clean.toLowerCase();
        for (var i = 0; i < file.users.length; i++) {
            var u = file.users[i];
            if (u && typeof u.username === "string" && u.username.toLowerCase() === lower) return u;
        }
        return null;
    }

    function listUsernames() {
        var file = loadAccounts();
        return file.users
            .filter(function (u) {
                return u && typeof u.username === "string";
            })
            .map(function (u) {
                return u.username;
            });
    }

    function usernameExists(username) {
        return findUser(loadAccounts(), username) !== null;
    }

    function getAccountRole(username) {
        var u = findUser(loadAccounts(), username);
        return u ? u.role : null;
    }

    function registerUser(username, plainPassword, role) {
        var clean = normaliseUsername(username);
        if (!clean) return Promise.resolve(false);
        var pw = plainPassword === null || plainPassword === undefined ? "" : String(plainPassword);

        var file = loadAccounts();
        if (findUser(file, clean)) return Promise.resolve(false);

        return hashPassword(pw).then(function (hash) {
            file.users.push({ username: clean, password: hash, role: role || "Player" });
            saveAccounts(file);
            createDefaultPlayerDataIfMissing(clean);
            return true;
        });
    }

    /** Arcade-style sign-in: existing name returns role; new name auto-registers. */
    function signInOrCreate(username) {
        var clean = normaliseUsername(username);
        if (!clean) return Promise.resolve(null);
        if (clean.length < 1 || clean.length > 16) return Promise.resolve(null);
        if (/_slot/i.test(clean)) return Promise.resolve(null);

        var u = findUser(loadAccounts(), clean);
        if (u) return Promise.resolve(u.role);

        return registerUser(clean, "", "Player").then(function (ok) {
            return ok ? "Player" : null;
        });
    }

    function authenticate(username, plainPassword) {
        var clean = normaliseUsername(username);
        if (!clean) return Promise.resolve(null);
        var u = findUser(loadAccounts(), clean);
        if (!u) return Promise.resolve(null);
        if (plainPassword === null || plainPassword === undefined || String(plainPassword) === "") {
            return Promise.resolve(u.role);
        }
        return hashPassword(plainPassword).then(function (hash) {
            return hash === u.password ? u.role : null;
        });
    }

    function resetPassword(username, newPlainPassword) {
        var clean = normaliseUsername(username);
        if (!clean || newPlainPassword === null || newPlainPassword === undefined) return Promise.resolve(false);
        var pw = String(newPlainPassword);
        if (!pw.trim()) return Promise.resolve(false);
        var file = loadAccounts();
        var u = findUser(file, clean);
        if (!u) return Promise.resolve(false);
        return hashPassword(pw).then(function (hash) {
            u.password = hash;
            saveAccounts(file);
            return true;
        });
    }

    function deleteAccount(username) {
        var clean = normaliseUsername(username);
        if (!clean) return false;
        if (clean.toLowerCase() === "admin") return false;

        var accounts = loadAccounts();
        var lower = clean.toLowerCase();
        var removed = false;
        for (var i = accounts.users.length - 1; i >= 0; i--) {
            if (accounts.users[i].username && accounts.users[i].username.toLowerCase() === lower) {
                accounts.users.splice(i, 1);
                removed = true;
            }
        }
        if (!removed) return false;
        saveAccounts(accounts);

        var players = loadPlayers();
        for (var j = players.players.length - 1; j >= 0; j--) {
            var pName = players.players[j].username || "";
            var base = stripSlot(pName).toLowerCase();
            if (base === lower) players.players.splice(j, 1);
        }
        savePlayers(players);

        if (global.Leaderboard && typeof global.Leaderboard.deleteUser === "function") {
            global.Leaderboard.deleteUser(clean);
        }
        return true;
    }

    /* ------------------------------------------------------------------
     *  Player records
     * ------------------------------------------------------------------ */
    function loadPlayers() {
        var data = readJson(KEY_PLAYERS, null);
        if (!data || !Array.isArray(data.players)) return { players: [] };
        return data;
    }

    function savePlayers(file) {
        writeJson(KEY_PLAYERS, file);
    }

    function findPlayer(file, username) {
        var clean = normaliseUsername(username);
        if (!clean) return null;
        var lower = clean.toLowerCase();
        for (var i = 0; i < file.players.length; i++) {
            var p = file.players[i];
            if (p && typeof p.username === "string" && p.username.toLowerCase() === lower) return p;
        }
        return null;
    }

    function ensureFullPlayerShape(record, username) {
        if (!record) record = defaultPlayerRecord(username);
        if (!record.username) record.username = username;
        if (!record.statistics || typeof record.statistics !== "object") record.statistics = defaultStatistics();
        var s = record.statistics;
        if (typeof s.Wpm !== "number") s.Wpm = 0;
        if (typeof s.accuracyPercentage !== "number") s.accuracyPercentage = 0;
        if (typeof s.errorCount !== "number") s.errorCount = 0;
        if (typeof s.totalTimePlayed !== "number") s.totalTimePlayed = 0;

        if (!record.saveState || typeof record.saveState !== "object") record.saveState = defaultSaveState();
        var ss = record.saveState;
        if (typeof ss.currentStage !== "number" || ss.currentStage <= 0) ss.currentStage = 1;
        if (typeof ss.currentHealth !== "number" || ss.currentHealth <= 0) ss.currentHealth = BASE_HEALTH;
        if (!Array.isArray(ss.inventory)) ss.inventory = [];
        if (typeof ss.currentScore !== "number") ss.currentScore = 0;
        if (typeof ss.level3TimeLimit !== "number" || ss.level3TimeLimit <= 0) ss.level3TimeLimit = BASE_LEVEL3_TIME;
        if (typeof ss.snapshotScore !== "number") ss.snapshotScore = 0;
        if (!Array.isArray(ss.snapshotInventory)) ss.snapshotInventory = [];
        if (ss.typingTier != null && typeof ss.typingTier !== "string") ss.typingTier = null;
        return record;
    }

    function createDefaultPlayerDataIfMissing(username) {
        var clean = normaliseUsername(username);
        if (!clean) return;
        var players = loadPlayers();
        if (findPlayer(players, clean)) return;
        players.players.push(defaultPlayerRecord(clean));
        savePlayers(players);
    }

    function getOrCreatePlayerData(username) {
        var clean = normaliseUsername(username);
        if (!clean) return null;
        var players = loadPlayers();
        var existing = findPlayer(players, clean);
        if (existing) return ensureFullPlayerShape(existing, clean);
        var fresh = defaultPlayerRecord(clean);
        players.players.push(fresh);
        savePlayers(players);
        return fresh;
    }

    function playerExists(username) {
        return findPlayer(loadPlayers(), username) !== null;
    }

    function savePlayerData(updatedPlayer) {
        if (!updatedPlayer || !updatedPlayer.username || !String(updatedPlayer.username).trim()) return;
        var clean = normaliseUsername(updatedPlayer.username);
        var file = loadPlayers();
        var existing = findPlayer(file, clean);
        if (!existing) {
            updatedPlayer.username = clean;
            file.players.push(ensureFullPlayerShape(updatedPlayer, clean));
        } else {
            existing.statistics = updatedPlayer.statistics || existing.statistics;
            existing.saveState = updatedPlayer.saveState || existing.saveState;
            ensureFullPlayerShape(existing, clean);
        }
        savePlayers(file);
    }

    function resetSaveState(username, typingTier) {
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.saveState = defaultSaveState();
        if (typingTier != null && typeof typingTier === "string" && typingTier) {
            player.saveState.typingTier = typingTier;
        }
        savePlayerData(player);
    }

    function updateSaveState(username, currentStage, currentHealth, inventory, currentScore, typingTier) {
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.saveState.currentStage = currentStage;
        player.saveState.currentHealth = currentHealth;
        player.saveState.inventory = Array.isArray(inventory) ? inventory.slice() : [];
        player.saveState.currentScore = currentScore;
        if (typingTier != null && typeof typingTier === "string" && typingTier) {
            player.saveState.typingTier = typingTier;
        }
        savePlayerData(player);
    }

    function updateTypingTier(username, typingTier) {
        if (!typingTier || typeof typingTier !== "string") return;
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.saveState.typingTier = typingTier;
        savePlayerData(player);
    }

    function updateLevel3TimeLimit(username, timeLimit) {
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.saveState.level3TimeLimit = timeLimit;
        savePlayerData(player);
    }

    function createLevel3Snapshot(username, score, inventory) {
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.saveState.snapshotScore = score;
        player.saveState.snapshotInventory = Array.isArray(inventory) ? inventory.slice() : [];
        savePlayerData(player);
    }

    function updateStatistics(username, wpm, accuracy, additionalErrors, additionalTime) {
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.statistics.Wpm = wpm;
        player.statistics.accuracyPercentage = accuracy;
        player.statistics.errorCount += Math.max(additionalErrors | 0, 0);
        player.statistics.totalTimePlayed += Math.max(additionalTime | 0, 0);
        savePlayerData(player);
    }

    function resetStatistics(username) {
        var player = getOrCreatePlayerData(username);
        if (!player) return;
        player.statistics = defaultStatistics();
        savePlayerData(player);
    }

    function listPlayers() {
        return loadPlayers().players.slice();
    }

    function stripSlot(username) {
        var u = String(username || "");
        var idx = u.indexOf("_slot");
        return idx >= 0 ? u.substring(0, idx) : u;
    }

    function buildSlotName(baseUsername, slot) {
        return normaliseUsername(baseUsername) + "_slot" + slot;
    }

    /* ------------------------------------------------------------------
     *  Session (active login)
     * ------------------------------------------------------------------ */
    function setSession(username, role) {
        writeJson(KEY_SESSION, { username: username, role: role });
    }

    function getSession() {
        return readJson(KEY_SESSION, null);
    }

    function clearSession() {
        try {
            global.localStorage.removeItem(KEY_SESSION);
        } catch (_e) {
            /* ignore */
        }
    }

    /* ------------------------------------------------------------------
     *  Initial seeding
     * ------------------------------------------------------------------ */
    function ensureDefaultAdmin() {
        var file = loadAccounts();
        if (findUser(file, DEFAULT_ADMIN.username)) {
            createDefaultPlayerDataIfMissing(DEFAULT_ADMIN.username);
            return Promise.resolve();
        }
        return hashPassword(DEFAULT_ADMIN.password).then(function (hash) {
            file.users.push({ username: DEFAULT_ADMIN.username, password: hash, role: DEFAULT_ADMIN.role });
            saveAccounts(file);
            createDefaultPlayerDataIfMissing(DEFAULT_ADMIN.username);
        });
    }

    /* ------------------------------------------------------------------
     *  Public API
     * ------------------------------------------------------------------ */
    global.Storage = {
        Accounts: {
            list: listUsernames,
            exists: usernameExists,
            role: getAccountRole,
            register: registerUser,
            signInOrCreate: signInOrCreate,
            authenticate: authenticate,
            resetPassword: resetPassword,
            deleteAccount: deleteAccount,
        },
        Players: {
            getOrCreate: getOrCreatePlayerData,
            save: savePlayerData,
            exists: playerExists,
            resetSaveState: resetSaveState,
            updateSaveState: updateSaveState,
            updateTypingTier: updateTypingTier,
            updateLevel3TimeLimit: updateLevel3TimeLimit,
            createLevel3Snapshot: createLevel3Snapshot,
            updateStatistics: updateStatistics,
            resetStatistics: resetStatistics,
            listAll: listPlayers,
        },
        Session: {
            set: setSession,
            get: getSession,
            clear: clearSession,
        },
        utils: {
            normaliseUsername: normaliseUsername,
            stripSlot: stripSlot,
            buildSlotName: buildSlotName,
            ensureFullPlayerShape: ensureFullPlayerShape,
            defaultSaveState: defaultSaveState,
            defaultStatistics: defaultStatistics,
        },
        bootstrap: ensureDefaultAdmin,
    };
})(window);

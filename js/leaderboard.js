/**
 * Local-storage backed leaderboard.
 *
 * Mirrors the corrected behaviour from the Java DataManager:
 * - Each player has at most ONE entry, holding their personal best score.
 * - Adding a score for an existing (case-insensitive) username only updates
 *   the stored score when the new score is strictly higher.
 * - Entries are returned sorted by descending score with ranks 1..N.
 */
(function (global) {
    "use strict";

    var STORAGE_KEY = "spell-dungeon::leaderboard::v1";
    var MAX_ENTRIES_DISPLAYED = 50;

    function normaliseUsername(raw) {
        if (raw === null || raw === undefined) return "";
        return String(raw).trim();
    }

    function readRaw() {
        try {
            var json = global.localStorage.getItem(STORAGE_KEY);
            if (!json) return [];
            var parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(function (entry) {
                return entry && typeof entry.username === "string" && Number.isFinite(entry.score);
            });
        } catch (_err) {
            return [];
        }
    }

    function writeRaw(entries) {
        try {
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        } catch (_err) {
            /* swallow quota errors silently to avoid breaking gameplay */
        }
    }

    function sortAndRank(entries) {
        entries.sort(function (a, b) {
            return b.score - a.score;
        });
        for (var i = 0; i < entries.length; i++) {
            entries[i].rank = i + 1;
        }
        return entries;
    }

    function getLeaderboard() {
        return sortAndRank(readRaw().slice());
    }

    function addScore(username, score) {
        var clean = normaliseUsername(username);
        if (!clean) return null;
        if (!Number.isFinite(score)) return null;

        var roundedScore = Math.max(0, Math.floor(score));
        var entries = readRaw();

        var existing = null;
        for (var i = 0; i < entries.length; i++) {
            if (
                typeof entries[i].username === "string" &&
                entries[i].username.toLowerCase() === clean.toLowerCase()
            ) {
                existing = entries[i];
                break;
            }
        }

        var changed = false;
        var newPersonalBest = false;
        if (!existing) {
            entries.push({ username: clean, score: roundedScore });
            changed = true;
            newPersonalBest = roundedScore > 0;
        } else if (roundedScore > existing.score) {
            existing.username = clean;
            existing.score = roundedScore;
            changed = true;
            newPersonalBest = true;
        }

        if (changed) {
            sortAndRank(entries);
            writeRaw(entries);
        }

        return {
            personalBest: existing ? Math.max(existing.score, roundedScore) : roundedScore,
            newPersonalBest: newPersonalBest,
        };
    }

    function getPersonalBest(username) {
        var clean = normaliseUsername(username);
        if (!clean) return 0;
        var entries = readRaw();
        for (var i = 0; i < entries.length; i++) {
            if (
                typeof entries[i].username === "string" &&
                entries[i].username.toLowerCase() === clean.toLowerCase()
            ) {
                return entries[i].score;
            }
        }
        return 0;
    }

    function clearAll() {
        writeRaw([]);
    }

    function deleteUser(username) {
        var clean = normaliseUsername(username);
        if (!clean) return;
        var lower = clean.toLowerCase();
        var entries = readRaw();
        var changed = false;
        for (var i = entries.length - 1; i >= 0; i--) {
            if (typeof entries[i].username === "string" && entries[i].username.toLowerCase() === lower) {
                entries.splice(i, 1);
                changed = true;
            }
        }
        if (changed) {
            sortAndRank(entries);
            writeRaw(entries);
        }
    }

    function topEntries(limit) {
        var max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : MAX_ENTRIES_DISPLAYED;
        return getLeaderboard().slice(0, max);
    }

    global.Leaderboard = {
        getLeaderboard: getLeaderboard,
        topEntries: topEntries,
        addScore: addScore,
        getPersonalBest: getPersonalBest,
        clearAll: clearAll,
        deleteUser: deleteUser,
    };
})(window);

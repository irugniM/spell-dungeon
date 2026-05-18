/**
 * Meta progression — coins from runs and cosmetic player colors (localStorage).
 */
(function (global) {
    "use strict";

    var KEY_COINS = "spell-dungeon::meta-coins::v1";
    var KEY_COLOR = "spell-dungeon::player-color::v1";
    var KEY_UNLOCKED = "spell-dungeon::unlocked-colors::v1";

    var SHOP_COLORS = [
        { id: "mint", name: "Mint", color: "#6cf2a6", cost: 0 },
        { id: "sky", name: "Sky", color: "#6ec1ff", cost: 50 },
        { id: "gold", name: "Gold", color: "#ffd166", cost: 100 },
        { id: "rose", name: "Rose", color: "#ff8ab8", cost: 150 },
    ];

    function readMap(key) {
        try {
            var raw = global.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : {};
        } catch (_e) {
            return {};
        }
    }

    function writeMap(key, map) {
        try {
            global.localStorage.setItem(key, JSON.stringify(map));
        } catch (_e) { /* quota */ }
    }

    function normUser(username) {
        if (!username) return "";
        return String(username).trim();
    }

    function getCoins(username) {
        var u = normUser(username);
        if (!u) return 0;
        var map = readMap(KEY_COINS);
        return Math.max(0, map[u] | 0);
    }

    function addCoins(username, amount) {
        var u = normUser(username);
        if (!u || amount <= 0) return getCoins(u);
        var map = readMap(KEY_COINS);
        map[u] = Math.max(0, (map[u] | 0) + Math.floor(amount));
        writeMap(KEY_COINS, map);
        return map[u];
    }

    function getColorId(username) {
        var u = normUser(username);
        if (!u) return "mint";
        var map = readMap(KEY_COLOR);
        return map[u] || "mint";
    }

    function setColorId(username, colorId) {
        var u = normUser(username);
        if (!u) return false;
        var found = false;
        for (var i = 0; i < SHOP_COLORS.length; i++) {
            if (SHOP_COLORS[i].id === colorId) { found = true; break; }
        }
        if (!found) return false;
        var map = readMap(KEY_COLOR);
        map[u] = colorId;
        writeMap(KEY_COLOR, map);
        return true;
    }

    function getColorDef(colorId) {
        for (var i = 0; i < SHOP_COLORS.length; i++) {
            if (SHOP_COLORS[i].id === colorId) return SHOP_COLORS[i];
        }
        return SHOP_COLORS[0];
    }

    function getPlayerColor(username) {
        return getColorDef(getColorId(username)).color;
    }

    function getUnlocked(username) {
        var u = normUser(username);
        if (!u) return {};
        var map = readMap(KEY_UNLOCKED);
        return map[u] || {};
    }

    function markUnlocked(username, colorId) {
        var u = normUser(username);
        if (!u) return;
        var map = readMap(KEY_UNLOCKED);
        if (!map[u]) map[u] = {};
        map[u][colorId] = true;
        writeMap(KEY_UNLOCKED, map);
    }

    function ownsColor(username, colorId) {
        var def = getColorDef(colorId);
        if (def.cost === 0) return true;
        var unlocked = getUnlocked(username);
        return !!unlocked[colorId];
    }

    function buyColor(username, colorId) {
        var def = getColorDef(colorId);
        if (def.cost === 0) {
            setColorId(username, colorId);
            return { ok: true, coins: getCoins(username) };
        }
        if (ownsColor(username, colorId)) {
            setColorId(username, colorId);
            return { ok: true, coins: getCoins(username) };
        }
        var coins = getCoins(username);
        if (coins < def.cost) return { ok: false, reason: "Not enough coins", coins: coins };
        var map = readMap(KEY_COINS);
        map[normUser(username)] = coins - def.cost;
        writeMap(KEY_COINS, map);
        markUnlocked(username, colorId);
        setColorId(username, colorId);
        return { ok: true, coins: map[normUser(username)] };
    }

    /** Coins earned from a run score (persists across sessions). */
    function coinsFromScore(score) {
        return Math.max(0, Math.floor((score | 0) / 25));
    }

    global.Meta = {
        SHOP_COLORS: SHOP_COLORS,
        getCoins: getCoins,
        addCoins: addCoins,
        getColorId: getColorId,
        setColorId: setColorId,
        getPlayerColor: getPlayerColor,
        getColorDef: getColorDef,
        ownsColor: ownsColor,
        buyColor: buyColor,
        coinsFromScore: coinsFromScore,
    };
})(typeof window !== "undefined" ? window : globalThis);

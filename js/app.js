/**
 * App bootstrap.
 *
 * Seeds the default Admin name, restores any in-flight session, and
 * routes the player into either the player-home screen (if they were
 * previously signed in) or the name-entry screen.
 */
(function (global) {
    "use strict";

    function getDebugMode() {
        try {
            var params = new URLSearchParams(global.location.search || "");
            var mode = (params.get("debug") || "").toLowerCase();
            if (mode === "boss" || mode === "boss-door" || mode === "shrine") return mode;
        } catch (_e) { /* ignore */ }
        return "";
    }

    function boot() {
        global.Storage.bootstrap().then(function () {
            var debugMode = getDebugMode();
            if (debugMode && global.Game && global.Game.startDebug) {
                global.Game.startDebug(debugMode);
                return;
            }
            var session = global.Storage.Session.get();
            if (session && session.username && global.Storage.Accounts.exists(session.username)) {
                var role = global.Storage.Accounts.role(session.username) || session.role || "Player";
                global.Screens.renderHome(session.username, role);
            } else {
                global.Storage.Session.clear();
                global.Screens.renderLogin();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})(window);

/**
 * App bootstrap.
 *
 * Seeds the default Admin name, restores any in-flight session, and
 * routes the player into either the player-home screen (if they were
 * previously signed in) or the name-entry screen.
 */
(function (global) {
    "use strict";

    function boot() {
        global.Storage.bootstrap().then(function () {
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

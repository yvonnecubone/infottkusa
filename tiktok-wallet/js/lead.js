/**
 * Client-side half of the lead instrumentation.
 *
 * The server already knows IP, user-agent, referrer, campaign and geo — it sees
 * them on every request. This file only adds what lives in the browser
 * (timezone, screen, viewport, touch) and the interactions that never hit a URL.
 *
 * Rules: fire and forget, never block a screen, and never define an event name —
 * the server keeps a whitelist and drops anything else.
 */
(function () {
    'use strict';

    function csrf() {
        var tag = document.querySelector('meta[name="csrf-token"]');

        return tag ? tag.getAttribute('content') : '';
    }

    /**
     * One POST helper for the whole app (also used by the upload zones).
     * Resolves with the parsed body, or null when the request was rejected —
     * callers decide whether that deserves a message.
     */
    function post(url, payload) {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRF-TOKEN': csrf(),
                'X-Requested-With': 'XMLHttpRequest',
            },
            credentials: 'same-origin',
            body: JSON.stringify(payload || {}),
        }).then(function (response) {
            return response.ok ? response.json() : null;
        }).catch(function () {
            return null;
        });
    }

    window.post = post;

    /** Read side of the same helper: resolves with the body, or null on failure. */
    window.getJson = function (url) {
        return fetch(url, {
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
        }).then(function (response) {
            return response.ok ? response.json() : null;
        }).catch(function () {
            return null;
        });
    };

    /** Named behaviour, straight to the event log. */
    window.track = function (name, props) {
        post('/_t/event', { name: name, props: props || {} });
    };

    // Sent once per page load: cheap, and it keeps the visit row complete even
    // if the lead never interacts with anything.
    var contextSent = false;

    function sendContext() {
        if (contextSent) {
            return;
        }

        contextSent = true;

        var timezone = '';

        try {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch (error) {
            timezone = '';
        }

        post('/_t/context', {
            timezone: timezone,
            screen: window.screen ? window.screen.width + 'x' + window.screen.height : null,
            viewport: window.innerWidth + 'x' + window.innerHeight,
            touch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
        });
    }

    document.addEventListener('turbo:load', sendContext);

    if (document.readyState !== 'loading') {
        sendContext();
    } else {
        document.addEventListener('DOMContentLoaded', sendContext);
    }
})();

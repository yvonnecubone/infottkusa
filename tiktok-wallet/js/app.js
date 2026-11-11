/**
 * App wiring — no build step. Turbo Drive is already loaded (plain <script>),
 * Alpine loads right after this file (deferred), so anything registered here
 * is in place before Alpine boots.
 */
(function () {
    'use strict';

    /* ---------- Turbo Drive ---------- */

    if (window.Turbo) {
        // Local navigation is near-instant; only show the bar when a visit
        // actually stalls. The bar itself is styled in shell.css (--accent).
        Turbo.setProgressBarDelay(400);
    }

    // shell.css dims .app-main while a visit is in flight.
    var LOADING = 'turbo-loading';

    document.addEventListener('turbo:visit', function () {
        document.documentElement.classList.add(LOADING);
    });

    ['turbo:load', 'turbo:render', 'turbo:visit-cancelled'].forEach(function (event) {
        document.addEventListener(event, function () {
            document.documentElement.classList.remove(LOADING);
        });
    });

    /* ---------- Toast ---------- */

    // Imperative on purpose: the host element (<x-ui.toast>) carries no state,
    // so a Turbo body swap can never restore a stale toast. The timer is kept
    // on the module scope and reset on every call.
    var TOAST_MS = 2500;
    var toastTimer = null;

    function toast(message) {
        var host = document.getElementById('toast');

        if (!host || !message) {
            return;
        }

        var text = document.getElementById('toast-text');

        if (text) {
            text.textContent = message;
        }

        window.clearTimeout(toastTimer);
        host.classList.add('is-visible');

        toastTimer = window.setTimeout(function () {
            host.classList.remove('is-visible');
        }, TOAST_MS);
    }

    window.toast = toast;

    /* ---------- Locked home actions (Send / Receive / Cards / More) ---------- */

    function openLockGate(action) {
        var gate = document.getElementById('lock-gate');
        var kicker = document.getElementById('lock-gate-kicker');

        if (!gate) {
            return;
        }

        if (kicker) {
            kicker.textContent = (action || 'Action') + ' unavailable';
        }

        gate.hidden = false;
        gate.setAttribute('aria-label', (action || 'Action') + ' unavailable');

        if (window.track) {
            window.track('locked_action_tap', { action: action || '' });
        }
    }

    function closeLockGate() {
        var gate = document.getElementById('lock-gate');

        if (gate) {
            gate.hidden = true;
        }
    }

    window.openLockGate = openLockGate;
    window.closeLockGate = closeLockGate;

    document.addEventListener('click', function (event) {
        var hit = event.target.closest('[data-lock-action]');

        if (hit) {
            event.preventDefault();
            openLockGate(hit.getAttribute('data-lock-action') || 'Action');
            return;
        }

        if (event.target.closest('[data-lock-close]')) {
            event.preventDefault();
            closeLockGate();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeLockGate();
            return;
        }

        if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-lock-action]')) {
            event.preventDefault();
            openLockGate(event.target.closest('[data-lock-action]').getAttribute('data-lock-action') || 'Action');
        }
    });

    /* ---------- Document upload ---------- */

    // A slot counts as done when the SERVER has it, not when an input holds a
    // file: that is what lets a lead close the app mid-upload and come back to
    // the same three ticks. The zone paints `--filled` from that same flag, so
    // reading the classes here is reading the server's answer.
    function uploadsReady(form) {
        var zones = form.querySelectorAll('.upload-zone');
        var ready = zones.length > 0;

        Array.prototype.forEach.call(zones, function (zone) {
            var done = zone.classList.contains('upload-zone--filled');

            if (!done) {
                ready = false;
            }

            zone.classList.toggle('upload-zone--error', !done);
        });

        return ready;
    }

    window.uploadsReady = uploadsReady;

    // Alpine factory for a single zone. Picking a file records the slot right
    // away — one POST, metadata only, no file bytes ever leave the device.
    window.uploadZone = function (slot, received, fileName) {
        return {
            slot: slot,
            received: received,
            fileName: fileName || '',
            busy: false,

            pick: function (event) {
                var file = event.target.files && event.target.files[0];

                if (!file || this.busy) {
                    return;
                }

                var zone = this;
                zone.busy = true;
                zone.$el.classList.remove('upload-zone--error');

                window.post('/verification/documents', {
                    slot: slot,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                }).then(function (data) {
                    zone.busy = false;

                    if (!data) {
                        window.toast('Could not send the document. Try again.');
                        return;
                    }

                    // The sheet keeps the running tally; a replaced document
                    // must not count twice.
                    if (!zone.received) {
                        zone.$dispatch('document-received', { slot: slot });
                    }

                    zone.received = true;
                    zone.fileName = file.name;
                    window.chime(660);
                    window.track('document_picked', { slot: slot });
                }).catch(function () {
                    zone.busy = false;
                    window.toast('Could not send the document. Try again.');
                });
            },
        };
    };

    /* ---------- Live support chat ---------- */

    // Everything a chat window owes the person using it: the message goes up
    // immediately, new replies arrive on their own, and the thread follows the
    // conversation unless the lead has scrolled up to read something.
    //
    // What the agent SAYS is never decided here — the server owns the script.
    window.supportChat = function (options) {
        return {
            draft: '',
            sending: false,
            typing: !!options.typing,
            lastId: options.lastId || 0,
            lastDay: options.lastDay || null,
            hasSpoken: !!options.hasSpoken,
            timer: null,
            lastTypingPing: 0,

            init: function () {
                this.jumpToLatest(false);
                this.grow();

                var chat = this;
                this.timer = window.setInterval(function () { chat.poll(); }, options.pollMs || 4000);

                // Turbo swaps the body on navigation; without this the poll of a
                // screen the lead already left would keep firing forever.
                this.$el.addEventListener('chat-teardown', function () { chat.stop(); });
                document.addEventListener('turbo:before-cache', function () { chat.stop(); });
            },

            destroy: function () {
                this.stop();
            },

            stop: function () {
                window.clearInterval(this.timer);
                this.timer = null;
            },

            send: function () {
                var body = this.draft.trim();

                if (!body || this.sending) {
                    return;
                }

                var chat = this;
                this.sending = true;
                this.draft = '';
                this.hasSpoken = true;
                this.grow();

                window.post('/support/chat/messages', { body: body }).then(function (data) {
                    chat.sending = false;

                    if (!data || !data.message) {
                        // Nothing was stored, so give the words back instead of
                        // pretending they were sent.
                        chat.draft = body;
                        chat.grow();
                        window.toast('Message not sent. Try again.');
                        return;
                    }

                    chat.append(data.message);
                    chat.typing = !!data.typing;
                    chat.jumpToLatest(true);
                }).catch(function () {
                    chat.sending = false;
                    chat.draft = body;
                    window.toast('Message not sent. Try again.');
                });
            },

            // A quick-reply chip: put its text in the box and send it down the
            // exact same path as a typed message — the server answers it.
            suggest: function (text) {
                this.draft = text || '';
                this.grow();
                this.send();
            },

            // Asks only for what it has not seen. A reply written by the agent
            // (or, later, by the admin console) shows up here on its own.
            poll: function () {
                var chat = this;
                var stick = this.atBottom();

                window.getJson('/support/chat/messages?after=' + this.lastId).then(function (data) {
                    if (!data) {
                        return;
                    }

                    (data.messages || []).forEach(function (message) { chat.append(message); });

                    chat.typing = !!data.typing;
                    // A handoff mid-chat swaps the header's face and name live —
                    // this is the only thing that keeps them in sync.
                    chat.updateHandler(data.handler);

                    // Only follow the conversation if the lead was already at the
                    // bottom — yanking the thread while they read is hostile.
                    if ((data.messages || []).length && stick) {
                        chat.jumpToLatest(true);
                    }
                });
            },

            // The console shows the lead typing from this alone — throttled so a
            // burst of keystrokes is one request, not one per character. Never
            // awaited: a slow or failed ping must not hold up typing itself.
            pingTyping: function () {
                var now = Date.now();

                if (now - this.lastTypingPing < 2000) {
                    return;
                }

                this.lastTypingPing = now;
                window.post('/support/chat/typing', {});
            },

            // Swaps the header, the typing bubble's face and both hints to
            // whoever is answering now. Plain DOM writes (not Alpine state) so a
            // handoff lands the instant the poll sees it, same as a new message.
            updateHandler: function (handler) {
                if (!handler) {
                    return;
                }

                this.setText('chat-name', handler.name);
                this.setText('chat-role-status', (handler.role || '') + ' · ' + (handler.status || ''));
                this.setText('chat-role-typing', (handler.name || '') + ' is typing…');
                this.setText('chat-hint-idle', handler.response_time);
                this.setText('chat-hint-typing', (handler.name || '') + ' is typing…');

                this.setSrc('chat-avatar-img', handler.avatar);
                this.setSrc('chat-typing-avatar', handler.avatar);

                var bubble = document.getElementById('chat-typing-bubble');

                if (bubble && handler.name) {
                    bubble.setAttribute('aria-label', handler.name + ' is typing');
                }
            },

            setText: function (id, text) {
                var el = document.getElementById(id);

                if (el) {
                    el.textContent = text || '';
                }
            },

            setSrc: function (id, src) {
                var el = document.getElementById(id);

                if (el && src) {
                    el.setAttribute('src', src);
                }
            },

            append: function (message) {
                var thread = document.getElementById('chat-thread');
                var daySlot = document.getElementById('chat-day-template');

                if (!thread) {
                    return;
                }

                if (message.day && message.day !== this.lastDay) {
                    this.lastDay = message.day;

                    if (daySlot) {
                        var day = daySlot.content.cloneNode(true);
                        day.querySelector('.chat__day').textContent = message.day;
                        this.insert(thread, day);
                    }
                }

                var node;

                // A handoff note ("You're now chatting with Ana.") — centred,
                // no bubble, no face — like WhatsApp's own system lines.
                if (message.author === 'system') {
                    var systemSlot = document.getElementById('chat-system-template');

                    if (!systemSlot) {
                        return;
                    }

                    node = systemSlot.content.cloneNode(true);
                    node.querySelector('.chat__system').textContent = message.body;
                } else {
                    var bubble = document.getElementById('chat-bubble-template');

                    if (!bubble) {
                        return;
                    }

                    node = bubble.content.cloneNode(true);
                    node.querySelector('.chat__row').classList.add('chat__row--' + message.author);
                    node.querySelector('.chat__text').textContent = message.body;
                    node.querySelector('.chat__time').textContent = message.time;

                    var avatar = node.querySelector('.chat__row-avatar');
                    var senderAvatar = message.sender && message.sender.avatar;

                    // Only an agent's line carries a face — a human takeover shows
                    // up as a different one appearing mid-conversation. The lead's
                    // own bubble never needs one, so the placeholder is dropped.
                    if (message.author === 'agent' && senderAvatar) {
                        avatar.setAttribute('src', senderAvatar);
                    } else if (avatar) {
                        avatar.remove();
                    }
                }

                this.insert(thread, node);
                this.lastId = Math.max(this.lastId, message.id);
            },

            // The typing bubble is always the last child, so new messages go in
            // above it — never after.
            insert: function (thread, node) {
                var typing = thread.querySelector('.chat__row--typing');

                if (typing) {
                    thread.insertBefore(node, typing);
                } else {
                    thread.appendChild(node);
                }
            },

            atBottom: function () {
                var thread = document.getElementById('chat-thread');

                if (!thread) {
                    return true;
                }

                return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
            },

            jumpToLatest: function (smooth) {
                var thread = document.getElementById('chat-thread');

                if (!thread) {
                    return;
                }

                window.requestAnimationFrame(function () {
                    thread.scrollTo({ top: thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
                });
            },

            // One row tall until the message needs more, capped so the composer
            // can never eat the conversation.
            grow: function () {
                var input = this.$refs.input;

                if (!input) {
                    return;
                }

                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            },
        };
    };

    // Short confirmation tone — the audible half of "it went through". Created
    // per call and torn down by the ramp, so nothing keeps an audio context hot.
    window.chime = function (frequency) {
        try {
            var Ctx = window.AudioContext || window['webkitAudioContext'];

            if (!Ctx) {
                return;
            }

            var context = new Ctx();
            var oscillator = context.createOscillator();
            var gain = context.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.value = frequency || 880;
            gain.gain.setValueAtTime(0.12, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);

            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.45);
        } catch (error) {
            // Audio is decoration: a blocked context must never break the flow.
        }
    };

    /* ---------- the floating support pin ---------- */

    /**
     * The pin lives on every screen, so it is the app's ear for support: it asks
     * the server whether the agent has replied while the lead was somewhere else,
     * updates its own badge, tells the header bell (a window event, so the two
     * never have to know about each other) and chimes once per new reply.
     *
     * It goes quiet on the chat screen — that screen has its own poll — and it
     * stops while the tab is hidden, which matters on a shared host.
     */
    window.supportPin = function (initialUnread) {
        return {
            unread: initialUnread || 0,
            onChat: window.location.pathname.indexOf('/support/chat') === 0,
            timer: null,

            init: function () {
                var pin = this;

                if (this.onChat) {
                    return;
                }

                this.timer = window.setInterval(function () { pin.check(); }, 15000);

                document.addEventListener('turbo:before-cache', function () {
                    window.clearInterval(pin.timer);
                });

                this.$el.addEventListener('pin-teardown', function () {
                    window.clearInterval(pin.timer);
                });
            },

            destroy: function () {
                window.clearInterval(this.timer);
            },

            check: function () {
                var pin = this;

                if (document.hidden) {
                    return;
                }

                window.getJson('/support/status').then(function (data) {
                    if (!data) {
                        return;
                    }

                    var arrived = data.unread > pin.unread;

                    pin.unread = data.unread;
                    window.dispatchEvent(new CustomEvent('support-unread', { detail: { unread: data.unread } }));

                    if (arrived) {
                        window.chime(660);
                    }
                });
            },
        };
    };

    // Server-rendered message: fires on first paint and on every Turbo visit
    // that renders a host carrying `data-message`.
    document.addEventListener('turbo:load', function () {
        var host = document.getElementById('toast');

        if (host && host.dataset.message) {
            toast(host.dataset.message);
        }
    });

    /* ---------- Alpine across Turbo visits ---------- */

    // Turbo swaps <body> on every visit and Alpine's MutationObserver watches
    // `document` with subtree:true, so the incoming tree initialises itself —
    // no manual re-start needed. The one thing Alpine cannot undo for us is the
    // snapshot Turbo caches for the back button: it is taken from the *live*
    // DOM, where Alpine has already stripped x-cloak and inlined transition
    // styles. Restoring both keeps a cached page from flashing an open sheet.
    document.addEventListener('turbo:before-cache', function () {
        var shell = document.querySelector('.app-shell');

        if (shell && window.Alpine) {
            var data = Alpine.$data(shell);
            data.sheetOpen = false;
            data.uploadOpen = false;
        }

        document.querySelectorAll('.sheet').forEach(function (sheet) {
            sheet.setAttribute('x-cloak', '');
            sheet.style.removeProperty('display');
        });

        document.querySelectorAll('.sheet__panel').forEach(function (panel) {
            panel.style.removeProperty('transform');
        });

        // a toast mid-flight must not be baked into the cached snapshot
        window.clearTimeout(toastTimer);

        document.querySelectorAll('.toast').forEach(function (host) {
            host.classList.remove('is-visible');
        });
    });
})();

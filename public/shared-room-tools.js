(function () {
    const EMOJIS = ['😀', '😂', '🔥', '✨', '🎮', '👀', '💜', '🎯', '⚡', '👏'];
    let latestGame = null;
    let uiReady = false;

    function getGameId() {
        return typeof gameId !== 'undefined' ? gameId : null;
    }

    function getProfileUuid() {
        return typeof profile !== 'undefined' && profile ? profile.uuid : null;
    }

    function getCurrentPlayer(game) {
        const uuid = getProfileUuid();
        if (!game || !uuid) return null;
        if (game.player1 && game.player1.uuid === uuid) return game.player1;
        if (game.player2 && game.player2.uuid === uuid) return game.player2;
        return null;
    }

    function getHostUuid(game) {
        if (!game) return null;
        if (game.moderation && game.moderation.hostUuid) return game.moderation.hostUuid;
        if (game.player1 && game.player1.uuid) return game.player1.uuid;
        return null;
    }

    function isHost(game) {
        const uuid = getProfileUuid();
        return !!uuid && getHostUuid(game) === uuid;
    }

    function toast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else if (message) {
            console.log(`[${type}] ${message}`);
        }
    }

    function addStyles() {
        if (document.getElementById('room-tools-styles')) return;
        const style = document.createElement('style');
        style.id = 'room-tools-styles';
        style.textContent = `
            .room-tools-strip {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin: 4px 8px 6px;
                padding: 4px 8px;
                border: 1px solid rgba(0, 229, 255, 0.12);
                border-radius: 8px;
                background: rgba(10, 12, 20, 0.6);
                backdrop-filter: blur(8px);
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            }
            .room-tools-pill {
                font-size: 0.68rem;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: rgba(245, 247, 251, 0.6);
                white-space: nowrap;
            }
            .room-tools-toggle {
                appearance: none;
                border: 1px solid rgba(0, 229, 255, 0.25);
                background: rgba(0, 229, 255, 0.06);
                color: #9deeff;
                border-radius: 6px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 0.68rem;
                font-weight: 600;
                letter-spacing: 0.04em;
                line-height: 1;
                transition: background 150ms, border-color 150ms, transform 150ms;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .room-tools-toggle:hover {
                background: rgba(0, 229, 255, 0.15);
                border-color: rgba(0, 229, 255, 0.5);
                transform: translateY(-0.5px);
            }
            .room-tools-toggle:active {
                transform: translateY(0);
            }
            .room-tools-action,
            .room-tools-emoji {
                appearance: none;
                border: 1px solid rgba(0, 229, 255, 0.18);
                background:
                    linear-gradient(180deg, rgba(20, 25, 36, 0.98), rgba(10, 12, 18, 0.98));
                color: inherit;
                border-radius: 10px;
                padding: 7px 10px;
                cursor: pointer;
                font-size: 0.8rem;
                line-height: 1;
                transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
            }
            .room-tools-action:hover,
            .room-tools-emoji:hover {
                transform: translateY(-1px);
                border-color: rgba(0, 229, 255, 0.42);
                box-shadow:
                    0 0 0 1px rgba(0, 229, 255, 0.12),
                    0 0 16px rgba(0, 229, 255, 0.08);
            }
            .room-tools-panel {
                display: none;
                margin-top: 8px;
                padding: 12px;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 12px;
                background:
                    radial-gradient(circle at top right, rgba(163, 88, 255, 0.09), transparent 30%),
                    radial-gradient(circle at top left, rgba(0, 229, 255, 0.08), transparent 25%),
                    linear-gradient(180deg, rgba(6, 8, 14, 0.98), rgba(8, 10, 16, 0.94));
                box-shadow:
                    0 12px 40px rgba(0, 0, 0, 0.38),
                    inset 0 1px 0 rgba(255,255,255,0.03);
            }
            .room-tools-panel.show {
                display: block;
            }
            .room-tools-section {
                margin-bottom: 12px;
                padding-bottom: 10px;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .room-tools-section:last-child {
                margin-bottom: 0;
                padding-bottom: 0;
                border-bottom: 0;
            }
            .room-tools-title {
                margin: 0 0 6px;
                font-size: 0.76rem;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: var(--text-secondary, #9aa4b2);
            }
            .room-tools-row {
                display: grid;
                gap: 8px;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                align-items: end;
            }
            .room-tools-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .room-tools-field span {
                font-size: 0.72rem;
                color: var(--text-secondary, #9aa4b2);
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }
            .room-tools-row input[type="text"],
            .room-tools-row input[type="number"],
            .room-tools-row select,
            .room-tools-row textarea {
                width: 100%;
                box-sizing: border-box;
                color: inherit;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 10px;
                padding: 8px 10px;
                font: inherit;
                color-scheme: dark;
                background:
                    linear-gradient(180deg, rgba(17, 21, 30, 0.98), rgba(10, 12, 18, 0.98));
            }
            .room-tools-row select,
            .room-tools-row option {
                background: #0d1117;
                color: #f5f7fb;
            }
            .room-tools-row select {
                appearance: none;
                -webkit-appearance: none;
                -moz-appearance: none;
                background:
                    linear-gradient(135deg, rgba(0, 229, 255, 0.9), rgba(163, 88, 255, 0.9)) border-box,
                    linear-gradient(180deg, rgba(12, 16, 24, 0.98), rgba(6, 8, 14, 0.98)) padding-box;
                box-shadow:
                    0 0 0 1px rgba(0, 229, 255, 0.18),
                    inset 0 1px 0 rgba(255, 255, 255, 0.06);
                padding-right: 34px;
                cursor: pointer;
                text-shadow: 0 0 8px rgba(0, 229, 255, 0.08);
                background-image:
                    linear-gradient(45deg, transparent 50%, #9deeff 50%),
                    linear-gradient(135deg, #9deeff 50%, transparent 50%),
                    linear-gradient(180deg, rgba(12, 16, 24, 0.98), rgba(6, 8, 14, 0.98));
                background-position:
                    calc(100% - 16px) calc(50% - 3px),
                    calc(100% - 10px) calc(50% - 3px),
                    0 0;
                background-size:
                    6px 6px,
                    6px 6px,
                    100% 100%;
                background-repeat: no-repeat;
            }
            .room-tools-row select:hover {
                border-color: rgba(0, 229, 255, 0.35);
                box-shadow:
                    0 0 0 1px rgba(0, 229, 255, 0.28),
                    0 0 16px rgba(0, 229, 255, 0.08),
                    inset 0 1px 0 rgba(255, 255, 255, 0.08);
            }
            .room-tools-row select:focus {
                outline: 1px solid rgba(0, 229, 255, 0.75);
                outline-offset: 1px;
            }
            .room-tools-row input[type="text"]::placeholder,
            .room-tools-row textarea::placeholder {
                color: rgba(245, 247, 251, 0.35);
            }
            .room-tools-row textarea {
                min-height: 70px;
                resize: vertical;
            }
            .room-tools-card {
                padding: 10px;
                border-radius: 12px;
                background:
                    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03));
                border: 1px solid rgba(255,255,255,0.08);
                margin-bottom: 8px;
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
            }
            .room-tools-card-head {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                align-items: center;
                margin-bottom: 8px;
                font-size: 0.86rem;
            }
            .room-tools-badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 4px 8px;
                border-radius: 999px;
                font-size: 0.72rem;
                background: rgba(255,255,255,0.08);
                border: 1px solid rgba(255,255,255,0.08);
                color: #f5f7fb;
            }
            .room-tools-muted {
                opacity: 0.55;
            }
            .room-tools-reports {
                max-height: 140px;
                overflow: auto;
                display: grid;
                gap: 6px;
            }
            .room-tools-report {
                padding: 7px 8px;
                border-radius: 10px;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                font-size: 0.78rem;
                line-height: 1.35;
            }
            .room-tools-report small {
                display: block;
                color: var(--text-secondary, #9aa4b2);
                margin-top: 4px;
            }
            .room-tools-emoji-bar {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin: 8px 0 4px;
            }
            .room-tools-composer {
                position: relative;
            }
            .room-tools-input-wrap {
                position: relative;
                width: 100%;
            }
            .room-tools-emoji-trigger {
                appearance: none;
                position: absolute;
                right: 14px;
                top: 12px;
                width: 38px;
                min-width: 38px;
                height: 38px;
                padding: 0;
                border-radius: 10px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid rgba(0, 229, 255, 0.18);
                background: linear-gradient(180deg, rgba(20, 25, 36, 0.98), rgba(10, 12, 18, 0.98));
                box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.06);
                cursor: pointer;
                transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
                font-size: 1rem;
                line-height: 1;
            }
            .room-tools-emoji-trigger:hover {
                transform: translateY(-1px);
                border-color: rgba(0, 229, 255, 0.42);
                box-shadow:
                    0 0 0 1px rgba(0, 229, 255, 0.12),
                    0 0 16px rgba(0, 229, 255, 0.08);
            }
            .room-tools-emoji-trigger:focus {
                outline: 1px solid rgba(0, 229, 255, 0.75);
                outline-offset: 1px;
            }
            .room-tools-emoji-popup {
                position: absolute;
                right: 10px;
                top: 8px;
                display: none;
                gap: 6px;
                flex-wrap: wrap;
                width: min(240px, calc(100vw - 40px));
                padding: 10px;
                border: 1px solid rgba(0, 229, 255, 0.18);
                border-radius: 12px;
                background:
                    radial-gradient(circle at top right, rgba(163, 88, 255, 0.12), transparent 30%),
                    linear-gradient(180deg, rgba(6, 8, 14, 0.98), rgba(8, 10, 16, 0.96));
                box-shadow:
                    0 12px 40px rgba(0, 0, 0, 0.38),
                    0 0 0 1px rgba(0, 229, 255, 0.06);
                z-index: 8;
            }
            .room-tools-emoji-popup.show {
                display: flex;
            }
            .room-tools-emoji-popup::after {
                content: '';
                position: absolute;
                right: 18px;
                top: -6px;
                width: 10px;
                height: 10px;
                background: rgba(8, 10, 16, 0.96);
                border-left: 1px solid rgba(0, 229, 255, 0.18);
                border-top: 1px solid rgba(0, 229, 255, 0.18);
                transform: rotate(45deg);
            }
            .room-tools-emoji-popup .room-tools-emoji {
                margin: 0;
            }
            .room-tools-emoji {
                padding: 6px 8px;
                min-width: 34px;
                border-radius: 999px;
            }
            .room-tools-host-label {
                margin: 0 0 8px;
                font-size: 0.75rem;
                color: #9deeff;
                letter-spacing: 0.04em;
            }
            .room-tools-footer-note {
                margin-top: 8px;
                font-size: 0.72rem;
                color: var(--text-secondary, #9aa4b2);
                line-height: 1.35;
            }
            .room-tools-self-state {
                margin-left: auto;
                font-size: 0.72rem;
                color: #9deeff;
                text-align: right;
            }
            .chat-sidebar {
                position: relative;
                overflow: hidden;
                border: 1px solid rgba(0, 229, 255, 0.14);
                box-shadow:
                    0 0 0 1px rgba(0, 229, 255, 0.05),
                    0 0 24px rgba(0, 229, 255, 0.10),
                    0 0 44px rgba(163, 88, 255, 0.08),
                    0 20px 50px rgba(0, 0, 0, 0.6);
                background:
                    radial-gradient(circle at top, rgba(0, 229, 255, 0.10), transparent 35%),
                    radial-gradient(circle at bottom, rgba(163, 88, 255, 0.08), transparent 28%),
                    rgba(10, 10, 20, 0.88);
            }
            .chat-sidebar::before {
                content: '';
                position: absolute;
                inset: 0;
                pointer-events: none;
                border-radius: inherit;
                background:
                    linear-gradient(180deg, rgba(157, 238, 255, 0.14), transparent 18%),
                    linear-gradient(90deg, rgba(0, 229, 255, 0.16), transparent 22%, transparent 78%, rgba(163, 88, 255, 0.18));
                mix-blend-mode: screen;
                opacity: 0.65;
            }
            .chat-sidebar > * {
                position: relative;
                z-index: 1;
            }
            .chat-header {
                background:
                    linear-gradient(180deg, rgba(0, 229, 255, 0.10), rgba(0, 0, 0, 0.36)),
                    rgba(0, 0, 0, 0.4);
                color: #9deeff;
                text-shadow: 0 0 10px rgba(0, 229, 255, 0.35);
                border-bottom: 1px solid rgba(0, 229, 255, 0.12);
                box-shadow: inset 0 -1px 0 rgba(163, 88, 255, 0.12);
            }
            .chat-messages {
                background:
                    radial-gradient(circle at top, rgba(0, 229, 255, 0.04), transparent 30%),
                    rgba(0, 0, 0, 0.15);
            }
            .chat-input-row {
                position: relative;
                background:
                    linear-gradient(180deg, rgba(10, 12, 18, 0.95), rgba(6, 8, 12, 0.98));
                border-top: 1px solid rgba(0, 229, 255, 0.08);
            }
            .chat-input-row #chat-input {
                width: 100%;
                padding-right: 54px;
            }
            @supports (backdrop-filter: blur(1px)) {
                .chat-sidebar {
                    backdrop-filter: blur(10px) saturate(1.1);
                }
            }
        `;
        document.head.appendChild(style);
    }

    function setComposerState(game) {
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('btn-send-chat');
        const voiceBtn = document.getElementById('btn-toggle-voice');
        const current = getCurrentPlayer(game);
        const moderation = game && game.moderation ? game.moderation : null;

        const blocked = !!(moderation && current && moderation.blockedUuids && moderation.blockedUuids.includes(current.uuid));
        const muted = !!(moderation && current && moderation.mutedUuids && moderation.mutedUuids.includes(current.uuid));
        const chatOff = !!(moderation && moderation.chatEnabled === false);
        const voiceOff = !!(moderation && moderation.voiceEnabled === false);

        if (input) {
            input.disabled = blocked || muted || chatOff;
            input.placeholder = blocked
                ? 'You are blocked in this room'
                : muted
                    ? 'You are muted in this room'
                    : chatOff
                        ? 'Chat is disabled by the host'
                        : 'Type message...';
        }
        if (sendBtn) {
            sendBtn.disabled = blocked || muted || chatOff;
        }
        if (voiceBtn) {
            voiceBtn.disabled = voiceOff || blocked || muted;
            if (voiceOff) {
                voiceBtn.innerText = '🔒 VOICE OFF';
            } else if (blocked || muted) {
                voiceBtn.innerText = '🔒 VOICE LOCKED';
            }
        }
        const selfState = document.getElementById('room-tools-self-state');
        if (selfState) {
            if (blocked) {
                selfState.textContent = 'You are blocked from this room.';
            } else if (muted) {
                selfState.textContent = 'You are muted in this room.';
            } else if (chatOff) {
                selfState.textContent = 'Chat is disabled by the host.';
            } else if (voiceOff) {
                selfState.textContent = 'Voice is disabled by the host.';
            } else {
                selfState.textContent = '';
            }
        }
    }

    function insertEmoji(emoji) {
        const input = document.getElementById('chat-input');
        if (!input) return;
        input.value = `${input.value || ''}${emoji}`;
        input.focus();
    }

    function closeEmojiPopup() {
        const popup = document.getElementById('room-tools-emoji-popup');
        const btn = document.getElementById('room-tools-emoji-trigger');
        if (popup) popup.classList.remove('show');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function toggleEmojiPopup() {
        const popup = document.getElementById('room-tools-emoji-popup');
        const btn = document.getElementById('room-tools-emoji-trigger');
        if (!popup || !btn) return;
        const open = popup.classList.toggle('show');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function buildEmojiPicker() {
        const inputRow = document.getElementById('chat-input-row');
        if (!inputRow || document.getElementById('room-tools-emoji-trigger')) return;
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('btn-send-chat');
        if (!input || !sendBtn) return;

        const trigger = document.createElement('button');
        trigger.id = 'room-tools-emoji-trigger';
        trigger.type = 'button';
        trigger.className = 'room-tools-emoji-trigger';
        trigger.setAttribute('aria-label', 'Insert emoji');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.textContent = '😊';
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleEmojiPopup();
        });

        const popup = document.createElement('div');
        popup.id = 'room-tools-emoji-popup';
        popup.className = 'room-tools-emoji-popup';
        EMOJIS.forEach(emoji => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'room-tools-emoji';
            btn.textContent = emoji;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                insertEmoji(emoji);
                closeEmojiPopup();
            });
            popup.appendChild(btn);
        });

        const holder = document.createElement('div');
        holder.className = 'room-tools-input-wrap';
        input.parentNode.insertBefore(holder, input);
        holder.appendChild(input);
        holder.appendChild(trigger);
        holder.appendChild(popup);
    }

    async function postAction(payload) {
        const gid = getGameId();
        const uuid = getProfileUuid();
        if (!gid || !uuid) return;
        const base = typeof basePath !== 'undefined' ? basePath : '';
        const res = await fetch(`${base}/api/moderation/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: gid, uuid, ...payload })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Moderation action failed.');
        }
        return res.json().catch(() => ({}));
    }

    function renderReports(reports) {
        const el = document.getElementById('room-tools-reports');
        if (!el) return;
        el.innerHTML = '';
        const list = Array.isArray(reports) ? reports.slice().reverse() : [];
        if (!list.length) {
            el.innerHTML = '<div class="room-tools-report">No reports yet.</div>';
            return;
        }
        list.forEach(report => {
            const row = document.createElement('div');
            row.className = 'room-tools-report';
            const target = report.targetUuid || 'room';
            row.innerHTML = `<strong>${escapeHtml(report.reason || 'Report')}</strong><small>${escapeHtml(report.reporterName || 'Player')} → ${escapeHtml(target)} • ${new Date(report.createdAt || Date.now()).toLocaleString()}</small>${report.details ? `<small>${escapeHtml(report.details)}</small>` : ''}`;
            el.appendChild(row);
        });
    }

    function renderPlayers(game) {
        const container = document.getElementById('room-tools-players');
        if (!container) return;
        container.innerHTML = '';

        const uuid = getProfileUuid();
        const isAdmin = isHost(game);
        const players = [
            game && game.player1 ? { slot: 'Player 1', player: game.player1 } : null,
            game && game.player2 ? { slot: 'Player 2', player: game.player2 } : null
        ].filter(Boolean);

        if (!players.length) {
            container.innerHTML = '<div class="room-tools-report">No active players yet.</div>';
            return;
        }

        players.forEach(({ slot, player }) => {
            const card = document.createElement('div');
            card.className = 'room-tools-card';
            const isSelf = player.uuid === uuid;
            const isHostPlayer = game && game.moderation && game.moderation.hostUuid === player.uuid;
            const blocked = !!(game && game.moderation && game.moderation.blockedUuids.includes(player.uuid));
            const muted = !!(game && game.moderation && game.moderation.mutedUuids.includes(player.uuid));

            card.innerHTML = `
                <div class="room-tools-card-head">
                    <strong>${escapeHtml(slot)}: ${escapeHtml(player.name || 'Unknown')}</strong>
                    <span class="room-tools-badge">${isSelf ? 'You' : isHostPlayer ? 'Host' : 'Guest'}</span>
                </div>
                <div class="room-tools-row" style="margin-bottom:6px;">
                    <span class="room-tools-badge ${blocked ? '' : 'room-tools-muted'}">${blocked ? 'Blocked' : 'Not blocked'}</span>
                    <span class="room-tools-badge ${muted ? '' : 'room-tools-muted'}">${muted ? 'Muted' : 'Not muted'}</span>
                </div>
            `;

            if (isAdmin && !isSelf) {
                const controls = document.createElement('div');
                controls.className = 'room-tools-row';
                controls.innerHTML = `
                    <button class="room-tools-action" data-action="mute">Mute</button>
                    <button class="room-tools-action" data-action="unmute">Unmute</button>
                    <button class="room-tools-action" data-action="block">Block</button>
                    <button class="room-tools-action" data-action="unblock">Unblock</button>
                    <button class="room-tools-action" data-action="kick">Kick</button>
                `;
                controls.querySelectorAll('button').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            await postAction({ action: btn.dataset.action, targetUuid: player.uuid });
                            toast(`Applied ${btn.dataset.action} to ${player.name}.`, 'success');
                        } catch (err) {
                            toast(err.message || 'Moderation action failed.', 'error');
                        }
                    });
                });
                card.appendChild(controls);
            } else {
                const controls = document.createElement('div');
                controls.className = 'room-tools-row';
                controls.innerHTML = `
                    <button class="room-tools-action" data-action="report">Report Player</button>
                `;
                controls.querySelector('button').addEventListener('click', async () => {
                    const reason = prompt('Report reason?');
                    if (!reason) return;
                    try {
                        await postAction({ action: 'report', targetUuid: player.uuid, reason });
                        toast('Report sent.', 'success');
                    } catch (err) {
                        toast(err.message || 'Report failed.', 'error');
                    }
                });
                card.appendChild(controls);
            }

            container.appendChild(card);
        });
    }

    function renderHostControls(game) {
        const controls = document.getElementById('room-tools-host-controls');
        const hostSection = document.getElementById('room-tools-host-section');
        if (!controls || !hostSection) return;
        const admin = isHost(game);
        hostSection.style.display = admin ? 'block' : 'none';
        controls.innerHTML = '';
        if (!admin) return;

        const moderation = game && game.moderation ? game.moderation : {};
        controls.innerHTML = `
            <div class="room-tools-host-label">Only the room creator can change these session settings.</div>
            <div class="room-tools-row" style="margin-bottom:6px;">
                <label class="room-tools-field">
                    <span>Visibility</span>
                    <select id="room-tools-visibility">
                        <option value="public" ${moderation.visibility !== 'private' ? 'selected' : ''}>Public</option>
                        <option value="private" ${moderation.visibility === 'private' ? 'selected' : ''}>Private</option>
                    </select>
                </label>
                <label class="room-tools-field">
                    <span>Chat</span>
                    <select id="room-tools-chat-enabled">
                        <option value="true" ${moderation.chatEnabled !== false ? 'selected' : ''}>On</option>
                        <option value="false" ${moderation.chatEnabled === false ? 'selected' : ''}>Off</option>
                    </select>
                </label>
                <label class="room-tools-field">
                    <span>Voice</span>
                    <select id="room-tools-voice-enabled">
                        <option value="true" ${moderation.voiceEnabled !== false ? 'selected' : ''}>On</option>
                        <option value="false" ${moderation.voiceEnabled === false ? 'selected' : ''}>Off</option>
                    </select>
                </label>
                <label class="room-tools-field" style="min-width: 150px;">
                    <span>Slow mode</span>
                    <input id="room-tools-slow-mode" type="number" min="0" max="60" value="${parseInt(moderation.slowModeSeconds, 10) || 0}" />
                </label>
            </div>
            <div class="room-tools-row" style="grid-template-columns: repeat(auto-fit, minmax(160px, auto)); justify-content: start;">
                <button class="room-tools-action" id="room-tools-save">Save settings</button>
                <button class="room-tools-action" id="room-tools-clear-reports">Clear reports</button>
            </div>
        `;

        const saveBtn = document.getElementById('room-tools-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                try {
                    await postAction({
                        action: 'set-room',
                        visibility: document.getElementById('room-tools-visibility')?.value || 'public',
                        chatEnabled: document.getElementById('room-tools-chat-enabled')?.value !== 'false',
                        voiceEnabled: document.getElementById('room-tools-voice-enabled')?.value !== 'false',
                        slowModeSeconds: document.getElementById('room-tools-slow-mode')?.value || 0
                    });
                    toast('Room settings updated.', 'success');
                } catch (err) {
                    toast(err.message || 'Failed to save room settings.', 'error');
                }
            });
        }

        const clearBtn = document.getElementById('room-tools-clear-reports');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                try {
                    await postAction({ action: 'clear-reports' });
                    toast('Reports cleared.', 'success');
                } catch (err) {
                    toast(err.message || 'Failed to clear reports.', 'error');
                }
            });
        }
    }

    function renderPanel(game) {
        const panel = document.getElementById('room-tools-panel');
        const toggle = document.getElementById('room-tools-toggle');
        const summary = document.getElementById('room-tools-summary');
        if (!panel || !toggle || !summary) return;

        const admin = isHost(game);
        toggle.textContent = admin ? '🛡️ HOST CONTROLS' : '⚑ PLAYER TOOLS';
        summary.textContent = game && game.moderation
            ? `${game.moderation.visibility === 'private' ? 'Private room' : 'Public room'} • Chat ${game.moderation.chatEnabled === false ? 'off' : 'on'} • Voice ${game.moderation.voiceEnabled === false ? 'off' : 'on'}`
            : 'Room tools ready';
        toggle.title = admin ? 'Host-only session controls' : 'Player tools and reporting';

        renderHostControls(game);
        renderPlayers(game);
        renderReports(game && game.moderation ? game.moderation.reports : []);
        setComposerState(game);
    }

    function buildUi() {
        if (uiReady) return;
        const sidebar = document.getElementById('chat-sidebar');
        if (!sidebar) return;

        const messages = document.getElementById('chat-messages');
        if (!messages) return;

        uiReady = true;
        addStyles();

        const strip = document.createElement('div');
        strip.className = 'room-tools-strip';
        strip.innerHTML = `
            <button id="room-tools-toggle" class="room-tools-toggle" type="button">🛡️ ROOM TOOLS</button>
            <span id="room-tools-summary" class="room-tools-pill"></span>
            <span id="room-tools-self-state" class="room-tools-self-state"></span>
        `;
        sidebar.insertBefore(strip, messages);

        const panel = document.createElement('div');
        panel.id = 'room-tools-panel';
        panel.className = 'room-tools-panel';
        panel.innerHTML = `
            <div class="room-tools-section" id="room-tools-host-section">
                <div class="room-tools-title">Room settings</div>
                <div id="room-tools-host-controls"></div>
            </div>
            <div class="room-tools-section">
                <div class="room-tools-title">Players</div>
                <div id="room-tools-players"></div>
            </div>
            <div class="room-tools-section">
                <div class="room-tools-title">Recent reports</div>
                <div class="room-tools-reports" id="room-tools-reports"></div>
            </div>
            <div class="room-tools-footer-note">Room tools are in-memory for the active session. Reports and settings reset when the server restarts.</div>
        `;
        sidebar.insertBefore(panel, messages);

        buildEmojiPicker();

        const toggle = document.getElementById('room-tools-toggle');
        toggle.addEventListener('click', () => {
            panel.classList.toggle('show');
            closeEmojiPopup();
        });

        if (typeof socket !== 'undefined' && socket && !socket.__roomToolsPatched) {
            socket.__roomToolsPatched = true;
            socket.on('update', (data) => {
                latestGame = data && data.game ? data.game : data;
                renderPanel(latestGame);
            });
            socket.on('room_notice', (notice) => {
                const message = notice && notice.message ? notice.message : 'Room notice.';
                toast(message, notice && notice.type === 'warning' ? 'warning' : notice && notice.type === 'error' ? 'error' : 'info');
            });
        }

        document.addEventListener('click', (e) => {
            const popup = document.getElementById('room-tools-emoji-popup');
            const trigger = document.getElementById('room-tools-emoji-trigger');
            if (!popup || !trigger) return;
            if (popup.contains(e.target) || trigger.contains(e.target)) return;
            closeEmojiPopup();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeEmojiPopup();
            }
        });

        if (latestGame) {
            renderPanel(latestGame);
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function start() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', buildUi);
        } else {
            buildUi();
        }
    }

    start();
})();

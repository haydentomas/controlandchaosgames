const DEFAULT_MODERATION = () => ({
    visibility: 'public',
    chatEnabled: true,
    voiceEnabled: true,
    slowModeSeconds: 0,
    blockedUuids: [],
    mutedUuids: [],
    reports: [],
    hostUuid: null,
    lastChatAtByUuid: {},
    updatedAt: Date.now()
});

function ensureModeration(game) {
    if (!game) return null;
    if (!game.moderation) {
        game.moderation = DEFAULT_MODERATION();
    }

    const moderation = game.moderation;
    moderation.visibility = moderation.visibility === 'private' ? 'private' : 'public';
    moderation.chatEnabled = moderation.chatEnabled !== false;
    moderation.voiceEnabled = moderation.voiceEnabled !== false;
    moderation.slowModeSeconds = Math.max(0, Math.min(60, parseInt(moderation.slowModeSeconds, 10) || 0));
    moderation.blockedUuids = Array.isArray(moderation.blockedUuids) ? [...new Set(moderation.blockedUuids.filter(Boolean))] : [];
    moderation.mutedUuids = Array.isArray(moderation.mutedUuids) ? [...new Set(moderation.mutedUuids.filter(Boolean))] : [];
    moderation.reports = Array.isArray(moderation.reports) ? moderation.reports.slice(-25) : [];
    moderation.lastChatAtByUuid = moderation.lastChatAtByUuid && typeof moderation.lastChatAtByUuid === 'object' ? moderation.lastChatAtByUuid : {};

    if (!moderation.hostUuid && game.player1 && game.player1.uuid) {
        moderation.hostUuid = game.player1.uuid;
    }

    moderation.updatedAt = Date.now();
    return moderation;
}

function getPlayer(game, uuid) {
    if (!game || !uuid) return null;
    if (game.player1 && game.player1.uuid === uuid) return game.player1;
    if (game.player2 && game.player2.uuid === uuid) return game.player2;
    return null;
}

function isHost(game, uuid) {
    const moderation = ensureModeration(game);
    if (!moderation || !uuid) return false;
    if (moderation.hostUuid) return moderation.hostUuid === uuid;
    return !!(game && game.player1 && game.player1.uuid === uuid);
}

function isBlocked(game, uuid) {
    const moderation = ensureModeration(game);
    return !!(moderation && uuid && moderation.blockedUuids.includes(uuid));
}

function isMuted(game, uuid) {
    const moderation = ensureModeration(game);
    return !!(moderation && uuid && moderation.mutedUuids.includes(uuid));
}

function canSpeak(game, uuid, kind = 'chat') {
    const moderation = ensureModeration(game);
    const player = getPlayer(game, uuid);
    if (!moderation || !player) return { allowed: false, reason: 'You are not in this room.' };
    if (isBlocked(game, uuid)) return { allowed: false, reason: 'You are blocked from this room.' };
    if (isMuted(game, uuid)) return { allowed: false, reason: 'You are muted in this room.' };
    if (kind === 'chat' && moderation.chatEnabled === false) return { allowed: false, reason: 'Chat is disabled in this room.' };
    if (kind === 'voice' && moderation.voiceEnabled === false) return { allowed: false, reason: 'Voice is disabled in this room.' };
    return { allowed: true };
}

function makeRoomSnapshot(game) {
    if (!game) return null;
    ensureModeration(game);
    return {
        id: game.id,
        player1: game.player1,
        player2: game.player2,
        status: game.status,
        winner: game.winner,
        moderation: game.moderation
    };
}

function clearPlayerPresence(player) {
    if (!player) return;
    player.connected = false;
    player.toyEnabled = false;
}

function removePlayerFromGame(game, uuid) {
    if (!game || !uuid) return false;
    let removed = false;
    if (game.player1 && game.player1.uuid === uuid) {
        clearPlayerPresence(game.player1);
        game.player1 = null;
        removed = true;
    }
    if (game.player2 && game.player2.uuid === uuid) {
        clearPlayerPresence(game.player2);
        game.player2 = null;
        removed = true;
    }
    if (removed) {
        const moderation = ensureModeration(game);
        if (moderation.hostUuid === uuid) {
            moderation.hostUuid = game.player1 && game.player1.uuid ? game.player1.uuid : (game.player2 && game.player2.uuid ? game.player2.uuid : null);
        }
    }
    return removed;
}

function addUnique(list, value) {
    if (!value) return;
    if (!list.includes(value)) list.push(value);
}

function removeValue(list, value) {
    const idx = list.indexOf(value);
    if (idx >= 0) list.splice(idx, 1);
}

function registerRoutes(options) {
    const {
        app,
        mountPath = '',
        games,
        snapshotGame = makeRoomSnapshot,
        emitGameUpdate = () => {},
        endToyControl = () => {},
        onPlayerRemoved = () => {}
    } = options;

    app.post(`${mountPath}/api/moderation/action`, (req, res) => {
        const {
            gameId,
            uuid,
            action,
            targetUuid,
            reason,
            details,
            visibility,
            chatEnabled,
            voiceEnabled,
            slowModeSeconds
        } = req.body || {};

        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });
        const moderation = ensureModeration(game);
        const actorIsHost = isHost(game, uuid);
        const actor = getPlayer(game, uuid);

        if (!actor && action !== 'report') {
            return res.status(403).json({ error: 'You are not in this room.' });
        }

        if (action !== 'report' && !actorIsHost) {
            return res.status(403).json({ error: 'Only the room host can manage moderation settings.' });
        }

        if (action === 'set-room') {
            moderation.visibility = visibility === 'private' ? 'private' : 'public';
            moderation.chatEnabled = chatEnabled === false || chatEnabled === 'false' ? false : true;
            moderation.voiceEnabled = voiceEnabled === false || voiceEnabled === 'false' ? false : true;
            moderation.slowModeSeconds = Math.max(0, Math.min(60, parseInt(slowModeSeconds, 10) || 0));
        } else if (action === 'mute') {
            if (!targetUuid) return res.status(400).json({ error: 'Missing target.' });
            addUnique(moderation.mutedUuids, targetUuid);
        } else if (action === 'unmute') {
            if (!targetUuid) return res.status(400).json({ error: 'Missing target.' });
            removeValue(moderation.mutedUuids, targetUuid);
        } else if (action === 'block') {
            if (!targetUuid) return res.status(400).json({ error: 'Missing target.' });
            addUnique(moderation.blockedUuids, targetUuid);
            addUnique(moderation.mutedUuids, targetUuid);
            const removed = removePlayerFromGame(game, targetUuid);
            if (removed) {
                endToyControl(gameId, true);
                game.status = 'abandoned';
                onPlayerRemoved(game, targetUuid);
            }
        } else if (action === 'unblock') {
            if (!targetUuid) return res.status(400).json({ error: 'Missing target.' });
            removeValue(moderation.blockedUuids, targetUuid);
        } else if (action === 'kick') {
            if (!targetUuid) return res.status(400).json({ error: 'Missing target.' });
            const removed = removePlayerFromGame(game, targetUuid);
            if (removed) {
                endToyControl(gameId, true);
                game.status = 'abandoned';
                onPlayerRemoved(game, targetUuid);
            }
        } else if (action === 'report') {
            const report = {
                id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                reporterUuid: uuid || null,
                reporterName: actor ? actor.name : 'Guest',
                targetUuid: targetUuid || null,
                reason: (reason || 'Room report').toString().slice(0, 120),
                details: (details || '').toString().slice(0, 500),
                createdAt: Date.now()
            };
            moderation.reports.push(report);
            moderation.reports = moderation.reports.slice(-25);
        } else if (action === 'clear-reports') {
            moderation.reports = [];
        } else {
            return res.status(400).json({ error: 'Unknown moderation action.' });
        }

        moderation.updatedAt = Date.now();
        emitGameUpdate(gameId, snapshotGame(game));
        res.json({ success: true, game: snapshotGame(game) });
    });
}

function handleChatMessage(options) {
    const {
        socket,
        gameId,
        games,
        playerUuid,
        data,
        emitGameUpdate = () => {}
    } = options;

    const game = games[gameId];
    if (!game) return false;
    ensureModeration(game);
    const player = getPlayer(game, playerUuid);
    const access = canSpeak(game, playerUuid, 'chat');
    if (!access.allowed) {
        if (socket && typeof socket.emit === 'function') {
            socket.emit('room_notice', { type: 'error', message: access.reason });
        }
        return false;
    }

    const text = (data && typeof data.text === 'string' ? data.text : '').trim();
    if (!text) return false;

    const now = Date.now();
    const moderation = game.moderation;
    const lastSent = moderation.lastChatAtByUuid[playerUuid] || 0;
    const slowModeMs = (moderation.slowModeSeconds || 0) * 1000;
    if (slowModeMs > 0 && now - lastSent < slowModeMs) {
        if (socket && typeof socket.emit === 'function') {
            const waitSec = Math.ceil((slowModeMs - (now - lastSent)) / 1000);
            socket.emit('room_notice', {
                type: 'warning',
                message: `Slow mode is active. Please wait ${waitSec}s before sending another message.`
            });
        }
        return false;
    }

    moderation.lastChatAtByUuid[playerUuid] = now;
    moderation.updatedAt = now;
    const message = {
        sender: data.sender || (player ? player.name : 'Player'),
        senderUuid: playerUuid || null,
        text,
        createdAt: now
    };
    emitGameUpdate(gameId, game);
    return message;
}

function handleVoiceSignal(options) {
    const { socket, gameId, games, playerUuid, data } = options;
    const game = games[gameId];
    if (!game) return false;
    ensureModeration(game);
    const access = canSpeak(game, playerUuid, 'voice');
    if (!access.allowed) {
        if (socket && typeof socket.emit === 'function') {
            socket.emit('room_notice', { type: 'error', message: access.reason });
        }
        return false;
    }
    return data;
}

module.exports = {
    ensureModeration,
    makeRoomSnapshot,
    isHost,
    isBlocked,
    isMuted,
    canSpeak,
    clearPlayerPresence,
    removePlayerFromGame,
    registerRoutes,
    handleChatMessage,
    handleVoiceSignal
};

const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

let gamesRef = null;

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    gamesRef = games;
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('memorymatch', games, gameIo);

    const activeIntervals = {};

    function getPlayerByUuid(game, uuid) {
        if (game.player1 && game.player1.uuid === uuid) return game.player1;
        if (game.player2 && game.player2.uuid === uuid) return game.player2;
        return null;
    }

    function clearLovenseMatchState(player) {
        if (!player) return;
        player.connected = false;
        player.toyEnabled = false;
    }

    function isToyActive(player) {
        return player && player.connected && player.toyEnabled && player.uuid && !player.uuid.startsWith('cpu-') && !player.uuid.startsWith('browser_');
    }

    function startToyControl(gameId) {
        const game = games[gameId];
        if (!game || !game.toyControl) return;

        if (activeIntervals[gameId]) {
            clearInterval(activeIntervals[gameId]);
        }

        let tick = 0;
        activeIntervals[gameId] = setInterval(() => {
            const activeGame = games[gameId];
            if (!activeGame || !activeGame.toyControl || !activeGame.toyControl.active) {
                if (activeIntervals[gameId]) {
                    clearInterval(activeIntervals[gameId]);
                    delete activeIntervals[gameId];
                }
                return;
            }

            const remainingMs = activeGame.toyControl.endTime - Date.now();
            const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
            if (remainingSec <= 0) {
                endToyControl(gameId, false, true);
                return;
            }

            if (activeGame.toyControl.controllerUuid === 'cpu-bot' && tick % 8 === 0) {
                const patterns = ['constant', 'pulse', 'wave', 'chaos', 'heartbeat', 'escalator', 'tease'];
                activeGame.toyControl.currentPattern = patterns[Math.floor(Math.random() * patterns.length)];
                activeGame.toyControl.currentStrength = Math.floor(Math.random() * 12) + 5;
            }

            const targetUuid = activeGame.toyControl.targetUuid;
            const targetPlayer = getPlayerByUuid(activeGame, targetUuid);

            let activeStrength = activeGame.toyControl.currentStrength;
            const pattern = activeGame.toyControl.currentPattern;

            if (pattern === 'pulse') {
                activeStrength = (Math.floor(tick / 2) % 2 === 0) ? activeGame.toyControl.currentStrength : 0;
            } else if (pattern === 'wave') {
                const factor = (Math.sin(tick * Math.PI / 6) + 1) / 2;
                activeStrength = Math.round(factor * activeGame.toyControl.currentStrength);
            } else if (pattern === 'chaos') {
                activeStrength = Math.round(Math.random() * activeGame.toyControl.currentStrength);
            } else if (pattern === 'heartbeat') {
                let cycleLength = 4;
                if (remainingSec > 80) cycleLength = 6;
                else if (remainingSec > 40) cycleLength = 4;
                else if (remainingSec > 15) cycleLength = 3;
                else cycleLength = 2;

                const cycleIndex = tick % cycleLength;
                if (cycleLength === 6 || cycleLength === 4) {
                    activeStrength = (cycleIndex === 0 || cycleIndex === 2) ? activeGame.toyControl.currentStrength : 0;
                } else if (cycleLength === 3) {
                    activeStrength = (cycleIndex === 0 || cycleIndex === 1) ? activeGame.toyControl.currentStrength : 0;
                } else {
                    activeStrength = activeGame.toyControl.currentStrength;
                }
            } else if (pattern === 'escalator') {
                const rampStep = tick % 20;
                activeStrength = Math.round((rampStep / 19) * activeGame.toyControl.currentStrength);
            } else if (pattern === 'tease') {
                const teaseStep = tick % 20;
                if (teaseStep < 12) {
                    activeStrength = (teaseStep % 2 === 0) ? Math.min(activeGame.toyControl.currentStrength, 3) : 0;
                } else if (teaseStep < 16) {
                    const progress = (teaseStep - 12) / 4;
                    activeStrength = Math.round(3 + progress * (activeGame.toyControl.currentStrength - 3));
                } else if (teaseStep < 18) {
                    activeStrength = activeGame.toyControl.currentStrength;
                } else {
                    activeStrength = 0;
                }
            }

            if (targetPlayer && isToyActive(targetPlayer)) {
                lovenseHelper.triggerVibration(targetUuid, 'toy_control', { strength: activeStrength, duration: 2 });
            }

            gameIo.to(gameId).emit('toy_control_tick', {
                currentStrength: activeStrength,
                userStrength: activeGame.toyControl.currentStrength,
                pattern: activeGame.toyControl.currentPattern,
                remainingSec
            });

            tick++;
        }, 500);
    }

    function clearLovenseConnections(game) {
        if (!game) return;
        clearLovenseMatchState(game.player1);
        clearLovenseMatchState(game.player2);
    }

    function endToyControl(gameId, quiet = false, clearConnections = false) {
        const game = games[gameId];
        if (!game) return;

        if (activeIntervals[gameId]) {
            clearInterval(activeIntervals[gameId]);
            delete activeIntervals[gameId];
        }

        if (game.toyControl) {
            const targetUuid = game.toyControl.targetUuid;
            const targetPlayer = getPlayerByUuid(game, targetUuid);
            if (targetPlayer && isToyActive(targetPlayer)) {
                lovenseHelper.triggerVibration(targetUuid, 'stop', { strength: 0, duration: 1 });
            }

            if (clearConnections) {
                clearLovenseConnections(game);
            }

            game.toyControl = null;
            if (!quiet) {
                gameIo.to(gameId).emit('toy_control_end');
                gameIo.to(gameId).emit('update', sanitizeGameState(game));
            }
        }
    }

    function handleGameWin(game, gameId) {
        const player1 = game.player1;
        const player2 = game.player2;
        if (!player1 || !player2) return;

        const durationSec = (game.vibeMode === 'normal') ? 60 : 120;

        if (!game.isCpuMatch) {
            const winnerPlayer = game.winner === 1 ? player1 : player2;
            const loserPlayer = game.winner === 1 ? player2 : player1;
            const targetHasToy = isToyActive(loserPlayer);

            if (targetHasToy) {
                game.toyControl = {
                    active: true,
                    controllerUuid: winnerPlayer.uuid,
                    controllerName: winnerPlayer.name,
                    targetUuid: loserPlayer.uuid,
                    targetName: loserPlayer.name,
                    durationSec,
                    endTime: Date.now() + durationSec * 1000,
                    currentStrength: 5,
                    currentPattern: 'constant'
                };
                startToyControl(gameId);
            } else {
                game.toyControl = {
                    active: true,
                    controllerUuid: winnerPlayer.uuid,
                    controllerName: winnerPlayer.name,
                    targetUuid: loserPlayer.uuid,
                    targetName: loserPlayer.name,
                    durationSec: 0,
                    endTime: Date.now(),
                    currentStrength: 0,
                    currentPattern: 'constant',
                    noToyTarget: true
                };
            }
        } else {
            // CPU Match
            if (game.winner === 2) {
                // CPU Won, player 1 lost
                const targetHasToy = isToyActive(player1);
                if (targetHasToy) {
                    game.toyControl = {
                        active: true,
                        controllerUuid: 'cpu-bot',
                        controllerName: 'CyberBot 🤖',
                        targetUuid: player1.uuid,
                        targetName: player1.name,
                        durationSec,
                        endTime: Date.now() + durationSec * 1000,
                        currentStrength: 5,
                        currentPattern: 'constant'
                    };
                    startToyControl(gameId);
                } else {
                    game.toyControl = {
                        active: true,
                        controllerUuid: 'cpu-bot',
                        controllerName: 'CyberBot 🤖',
                        targetUuid: player1.uuid,
                        targetName: player1.name,
                        durationSec: 0,
                        endTime: Date.now(),
                        currentStrength: 0,
                        currentPattern: 'constant',
                        noToyTarget: true
                    };
                }
            } else if (game.winner === 1) {
                // User won against CPU
                game.toyControl = {
                    active: true,
                    controllerUuid: player1.uuid,
                    controllerName: player1.name,
                    targetUuid: 'cpu-bot',
                    targetName: 'CyberBot 🤖',
                    durationSec: 0,
                    endTime: Date.now(),
                    currentStrength: 0,
                    currentPattern: 'constant',
                    cpuNoToy: true
                };
            }
        }
    }

    const EMOJIS = [
        '🤖', '👽', '👻', '👾', '🚀', '🛸', 
        '🌌', '🌠', '☄️', '🪐', '🔮', '🧬', 
        '⚡', '🔥', '💧', '💎', '👑', '🍀'
    ];

    function createShuffledBoard() {
        const deck = [];
        EMOJIS.forEach(emoji => {
            deck.push(emoji);
            deck.push(emoji);
        });

        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        return deck.map((emoji, index) => ({
            id: index,
            emoji: emoji,
            state: 'down'
        }));
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                board: createShuffledBoard(),
                flippedCards: [],
                lockBoard: false,
                turn: 1,
                status: 'waiting',
                winner: 0,
                score1: 0,
                score2: 0,
                vibeMode: 'fun',
                toyControl: null
            };
        }
        return games[gameId];
    }

    function sanitizeGameState(game) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            score1: game.score1,
            score2: game.score2,
            turn: game.turn,
            status: game.status,
            winner: game.winner,
            lockBoard: game.lockBoard,
            vibeMode: game.vibeMode,
            toyControl: game.toyControl,
            board: game.board.map(card => ({
                id: card.id,
                state: card.state,
                emoji: (card.state === 'flipped' || card.state === 'matched') ? card.emoji : null
            }))
        };
    }

    app.get(`${mountPath}/board/:gameId`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // List active rooms
    app.get(`${mountPath}/api/rooms`, (req, res) => {
        const roomList = Object.values(games)
            .filter(g => g.id !== 'lobby')
            .map(g => ({
                id: g.id,
                player1: g.player1,
                player2: g.player2,
                status: g.status,
                winner: g.winner
            }));
        res.json(roomList);
    });

    // Leave Match
    app.post(`${mountPath}/api/leave`, (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (game) {
            endToyControl(gameId, true);
            let playerLeft = false;
            if (game.player1 && game.player1.uuid === uuid) {
                clearLovenseMatchState(game.player1);
                game.player1 = null;
                playerLeft = true;
            }
            if (game.player2 && game.player2.uuid === uuid) {
                clearLovenseMatchState(game.player2);
                game.player2 = null;
                playerLeft = true;
            }
            if (playerLeft) {
                game.status = 'abandoned';
                gameIo.to(gameId).emit('update', sanitizeGameState(game));
            }
        }
        res.json({ success: true });
    });

    // Matchmaking Join
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameState(game) });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameState(game) });
            }
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameState(game) });
            }
            if (role === '2' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameState(game) });
            }
        }

        let assignedRole = null;
        if (!game.player1 && role !== '2') {
            game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = '1';
        } else if (!game.player2 && role !== '1') {
            game.player2 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = '2';
        }

        if (assignedRole) {
            const targetPlayer = assignedRole === '1' ? game.player1 : game.player2;
            if (targetPlayer && !uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
                lovenseHelper.getQrCode(uuid, name).then(result => {
                    const p = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
                    if (p) {
                        p.qrCode = result.qrCode;
                        p.linkCode = result.linkCode;
                        p.qrError = result.error;
                        gameIo.to(gameId).emit('update', sanitizeGameState(game));
                    }
                });
            }

            if (game.player1 && game.player2) {
                game.status = 'playing';
            }
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
            return res.json({ success: true, role: assignedRole, game: sanitizeGameState(game) });
        }

        res.json({ success: true, role: 'spectator', game: sanitizeGameState(game) });
    });

    // Join CPU API
    app.post(`${mountPath}/api/join-cpu`, (req, res) => {
        const { gameId, uuid, name } = req.body;
        const game = getGame(gameId);
        game.lastActive = Date.now();

        game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        game.board = createShuffledBoard(); // Reset board
        game.winner = 0;
        game.score1 = 0;
        game.score2 = 0;

        if (!uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
            lovenseHelper.getQrCode(uuid, name).then(result => {
                if (game.player1 && game.player1.uuid === uuid) {
                    game.player1.qrCode = result.qrCode;
                    game.player1.linkCode = result.linkCode;
                    game.player1.qrError = result.error;
                    gameIo.to(gameId).emit('update', sanitizeGameState(game));
                }
            });
        }

        gameIo.to(gameId).emit('update', sanitizeGameState(game));
        res.json({ success: true, role: '1', game: sanitizeGameState(game) });
    });

    // Set CPU Difficulty API
    app.post(`${mountPath}/api/set-difficulty`, (req, res) => {
        const { gameId, difficulty } = req.body;
        const game = games[gameId];
        if (game) {
            game.difficulty = difficulty || 'medium';
            game.status = 'playing';
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
        }
        res.json({ success: true, game: sanitizeGameState(game) });
    });

    // Test Lovense Vibration API
    app.post(`${mountPath}/api/vibe/test`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: "Player not registered." });
        await lovenseHelper.triggerVibration(player.uuid, 'move');
        res.json({ success: true });
    });

    // Verify Lovense Connection API
    app.post(`${mountPath}/api/vibe/verify`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: "Player not registered." });
        
        const result = await lovenseHelper.verifyConnection(player.uuid);
        if (result.success) {
            player.connected = true;
            player.toyEnabled = true;
            await lovenseHelper.triggerVibration(player.uuid, 'move');
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error || "Verification failed." });
        }
    });

    app.post(`${mountPath}/api/debug/toy-control-test`, (req, res) => {
        const { gameId, uuid, result } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });

        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: 'Must be in the game to test.' });

        const opponent = (player === game.player1) ? game.player2 : game.player1;
        const hasHumanOpponent = !!(opponent && opponent.uuid && !opponent.uuid.startsWith('cpu-'));
        const opponentHasToy = isToyActive(opponent);
        const selfHasToy = isToyActive(player);

        game.status = 'won';
        game.winner = (result === 'lose') ? (player === game.player1 ? 2 : 1) : (player === game.player1 ? 1 : 2);
        const durationSec = (game.vibeMode === 'normal') ? 60 : 120;

        const targetPlayer = (result === 'lose') ? player : opponent;
        const targetHasToy = targetPlayer ? isToyActive(targetPlayer) : false;

        if (hasHumanOpponent) {
            if (targetHasToy) {
                game.toyControl = {
                    active: true,
                    controllerUuid: (result === 'lose') ? opponent.uuid : player.uuid,
                    controllerName: (result === 'lose') ? opponent.name : player.name,
                    targetUuid: targetPlayer.uuid,
                    targetName: targetPlayer.name,
                    durationSec,
                    endTime: Date.now() + durationSec * 1000,
                    currentStrength: 5,
                    currentPattern: 'constant'
                };
            } else {
                game.toyControl = {
                    active: true,
                    controllerUuid: (result === 'lose') ? opponent.uuid : player.uuid,
                    controllerName: (result === 'lose') ? opponent.name : player.name,
                    targetUuid: targetPlayer ? targetPlayer.uuid : null,
                    targetName: targetPlayer ? targetPlayer.name : 'Opponent',
                    durationSec: 0,
                    endTime: Date.now(),
                    currentStrength: 0,
                    currentPattern: 'constant',
                    noToyTarget: true
                };
            }
        } else {
            // CPU Match
            if (result === 'lose') {
                if (selfHasToy) {
                    game.toyControl = {
                        active: true,
                        controllerUuid: 'cpu-bot',
                        controllerName: 'CyberBot 🤖',
                        targetUuid: player.uuid,
                        targetName: player.name,
                        durationSec,
                        endTime: Date.now() + durationSec * 1000,
                        currentStrength: 5,
                        currentPattern: 'constant'
                    };
                } else {
                    game.toyControl = {
                        active: true,
                        controllerUuid: 'cpu-bot',
                        controllerName: 'CyberBot 🤖',
                        targetUuid: player.uuid,
                        targetName: player.name,
                        durationSec: 0,
                        endTime: Date.now(),
                        currentStrength: 0,
                        currentPattern: 'constant',
                        noToyTarget: true
                    };
                }
            } else {
                game.toyControl = {
                    active: true,
                    controllerUuid: player.uuid,
                    controllerName: player.name,
                    targetUuid: 'cpu-bot',
                    targetName: 'CyberBot 🤖',
                    durationSec: 0,
                    endTime: Date.now(),
                    currentStrength: 0,
                    currentPattern: 'constant',
                    cpuNoToy: true
                };
            }
        }

        if (game.toyControl && game.toyControl.durationSec > 0) {
            startToyControl(gameId);
        }
        gameIo.to(gameId).emit('update', sanitizeGameState(game));
        res.json({ success: true, game: sanitizeGameState(game) });
    });

    app.post(`${mountPath}/api/vibe/disconnect`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });
        const player = getPlayerByUuid(game, uuid);
        if (!player) return res.status(400).json({ error: 'Player not registered.' });

        await lovenseHelper.disconnectToy(player.uuid);

        const isActiveToyTarget = game.toyControl && game.toyControl.active && game.toyControl.targetUuid === player.uuid;
        const isActiveToyController = game.toyControl && game.toyControl.active && game.toyControl.controllerUuid === player.uuid;

        if (isActiveToyTarget || isActiveToyController) {
            endToyControl(gameId, true);
        } else {
            lovenseHelper.triggerVibration(player.uuid, 'stop');
        }

        clearLovenseMatchState(player);
        gameIo.to(gameId).emit('update', sanitizeGameState(game));
        res.json({ success: true });
    });

    app.post(`${mountPath}/api/toggle-vibe-mode`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            game.vibeMode = game.vibeMode === 'normal' ? 'fun' : 'normal';
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
            res.json({ success: true, vibeMode: game.vibeMode });
        } else {
            res.status(404).json({ error: 'Game not found.' });
        }
    });

    // Reset Match
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            game.board = createShuffledBoard();
            game.flippedCards = [];
            game.lockBoard = false;
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            game.winner = 0;
            game.score1 = 0;
            game.score2 = 0;
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
        }
        res.json({ success: true, game: sanitizeGameState(game) });
    });

    // Flip card move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, cardIndex } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });
        if (game.lockBoard) return res.status(400).json({ error: "Waiting for cards to flip back." });

        const idx = parseInt(cardIndex);
        if (isNaN(idx) || idx < 0 || idx >= 36) {
            return res.status(400).json({ error: "Invalid card coordinate." });
        }

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot flip cards." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const card = game.board[idx];
        if (card.state !== 'down') {
            return res.status(400).json({ error: "Card is already face up." });
        }

        // Reveal card
        card.state = 'flipped';
        game.flippedCards.push(idx);

        if (game.flippedCards.length === 1) {
            // First card flipped
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
            if (playerNum === 1) {
                if (game.player1) lovenseHelper.triggerVibration(game.player1.uuid, 'move');
            } else {
                if (game.player2) lovenseHelper.triggerVibration(game.player2.uuid, 'move');
            }
            return res.json({ success: true, game: sanitizeGameState(game) });
        }

        if (game.flippedCards.length === 2) {
            const idx1 = game.flippedCards[0];
            const idx2 = game.flippedCards[1];
            const card1 = game.board[idx1];
            const card2 = game.board[idx2];

            if (card1.emoji === card2.emoji) {
                // Match!
                card1.state = 'matched';
                card2.state = 'matched';
                game.flippedCards = [];
                
                if (playerNum === 1) game.score1++;
                else game.score2++;

                const vibeQueue = [];

                // Check if all 18 pairs are matched
                const matchedCount = game.board.filter(c => c.state === 'matched').length;
                if (matchedCount === 36) {
                    game.status = 'won';
                    if (game.score1 > game.score2) {
                        game.winner = 1;
                        if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'win' });
                        if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'lose' });
                    } else if (game.score2 > game.score1) {
                        game.winner = 2;
                        if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'lose' });
                        if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'win' });
                    } else {
                        game.winner = 3; // Draw
                    }
                    handleGameWin(game, gameId);
                } else {
                    // Match extra turn
                    if (playerNum === 1) {
                        if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                    } else {
                        if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                    }
                }

                // Player gets another turn
                gameIo.to(gameId).emit('update', sanitizeGameState(game));

                vibeQueue.forEach(item => {
                    if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
                });

                // If CPU match and turn remains CPU (2)
                if (game.isCpuMatch && game.status === 'playing' && game.turn === 2) {
                    cpuAi.makeMove('memorymatch', game, gameIo);

                    setTimeout(() => {
                        const updatedGame = games[gameId];
                        if (!updatedGame || !updatedGame.player1 || updatedGame.toyControl) return;

                        if (updatedGame.status === 'won') {
                            handleGameWin(updatedGame, gameId);
                            gameIo.to(gameId).emit('update', sanitizeGameState(updatedGame));
                        }
                    }, 1500);
                }

                return res.json({ success: true, game: sanitizeGameState(game) });
            } else {
                // Mismatch! Lock and delay
                game.lockBoard = true;
                gameIo.to(gameId).emit('update', sanitizeGameState(game));

                // Trigger mismatch move feedback immediately for the active player
                if (playerNum === 1) {
                    if (game.player1) lovenseHelper.triggerVibration(game.player1.uuid, 'move');
                } else {
                    if (game.player2) lovenseHelper.triggerVibration(game.player2.uuid, 'move');
                }

                setTimeout(() => {
                    // Turn cards back down
                    card1.state = 'down';
                    card2.state = 'down';
                    game.flippedCards = [];
                    game.lockBoard = false;

                    // Pass turn to other player
                    game.turn = playerNum === 1 ? 2 : 1;

                    gameIo.to(gameId).emit('update', sanitizeGameState(game));

                    // Trigger turn alert vibration for the player who now gets their turn
                    if (game.turn === 1) {
                        if (game.player1) lovenseHelper.triggerVibration(game.player1.uuid, 'turn_alert');
                    } else {
                        if (game.player2) lovenseHelper.triggerVibration(game.player2.uuid, 'turn_alert');
                    }

                    // If CPU match and it is now CPU's turn
                    if (game.isCpuMatch && game.status === 'playing' && game.turn === 2) {
                        cpuAi.makeMove('memorymatch', game, gameIo);

                        setTimeout(() => {
                            const updatedGame = games[gameId];
                            if (!updatedGame || !updatedGame.player1 || updatedGame.toyControl) return;

                            if (updatedGame.status === 'won') {
                                handleGameWin(updatedGame, gameId);
                                gameIo.to(gameId).emit('update', sanitizeGameState(updatedGame));
                            }
                        }, 1500);
                    }
                }, 1500);

                return res.json({ success: true, game: sanitizeGameState(game) });
            }
        }
    });

    // Inactive room scheduler
    setInterval(() => {
        const now = Date.now();
        Object.keys(games).forEach(gameId => {
            const game = games[gameId];
            const roomSockets = gameIo.adapter.rooms.get(gameId);
            const activeSocketCount = roomSockets ? roomSockets.size : 0;
            
            if (activeSocketCount === 0) {
                if (!game.emptySince) {
                    game.emptySince = now;
                } else if (now - game.emptySince > 120000) {
                    console.log(`Cleaning up inactive Memory Match room: ${gameId}`);
                    delete games[gameId];
                }
            } else {
                delete game.emptySince;
            }
        });
    }, 60000);

    gameIo.on('connection', (socket) => {
        let currentRoom = null;
        let playerUuid = null;

        socket.on('join_game', (gameId, uuid) => {
            currentRoom = gameId;
            playerUuid = uuid;
            socket.join(gameId);
            const game = getGame(gameId);
            socket.emit('update', sanitizeGameState(game));
        });

        socket.on('control_toy', (data) => {
            const { gameId, strength, pattern } = data;
            const game = games[gameId];
            if (game && game.toyControl && game.toyControl.active && game.toyControl.controllerUuid === playerUuid) {
                game.toyControl.currentStrength = Math.min(20, Math.max(0, parseInt(strength, 10) || 0));
                game.toyControl.currentPattern = pattern || 'constant';
            }
        });

        socket.on('stop_toy_control', (data) => {
            const { gameId } = data;
            const game = games[gameId];
            if (game && game.toyControl && game.toyControl.active) {
                endToyControl(gameId);
            }
        });

        socket.on('voice_signal', (data) => {
            if (currentRoom) socket.to(currentRoom).emit('voice_signal', data);
        });

        socket.on('chat_message', (data) => {
            if (currentRoom) gameIo.to(currentRoom).emit('chat_message', data);
        });

        socket.on('disconnect', () => {
            if (currentRoom && playerUuid) {
                const game = games[currentRoom];
                if (game) {
                    endToyControl(currentRoom, true);
                    let playerLeft = false;
                    if (game.player1 && game.player1.uuid === playerUuid) {
                        clearLovenseMatchState(game.player1);
                        game.player1 = null;
                        playerLeft = true;
                    }
                    if (game.player2 && game.player2.uuid === playerUuid) {
                        clearLovenseMatchState(game.player2);
                        game.player2 = null;
                        playerLeft = true;
                    }
                    if (playerLeft) {
                        game.status = 'abandoned';
                        gameIo.to(currentRoom).emit('update', sanitizeGameState(game));
                    }
                }
            }
        });
    });
}

function getRooms() {
    return Object.values(gamesRef || {}).map(game => ({
        id: game.id,
        player1: game.player1,
        player2: game.player2,
        status: game.status,
        winner: game.winner
    }));
}

if (require.main === module) {
    const http = require('http');
    const socketIo = require('socket.io');
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server);

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    init(app, io, '');

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
        console.log(`Memory Match Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

// server.js (Simple Connect 4)
const express = require('express');
const path = require('path');
const lovenseHelper = require('../lovense_helper.js');

let gamesRef = null;

// Wrap everything in an init function to mount it dynamically
function init(app, io, mountPath = '') {
    // Static files handled by parent server, but we can also register it here:
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    gamesRef = games;
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('fourinarow', games, gameIo);

    function startToyControl(gameId) {
        const game = games[gameId];
        if (!game || !game.toyControl) return;

        if (game.toyControlInterval) {
            clearInterval(game.toyControlInterval);
        }

        let tick = 0;
        game.toyControlInterval = setInterval(() => {
            const activeGame = games[gameId];
            if (!activeGame || !activeGame.toyControl || !activeGame.toyControl.active) {
                clearInterval(activeGame.toyControlInterval);
                delete activeGame.toyControlInterval;
                return;
            }

            const remainingMs = activeGame.toyControl.endTime - Date.now();
            const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

            if (remainingSec <= 0) {
                endToyControl(gameId);
                return;
            }

            // CPU behavior if CPU is controlling (changes every 4 seconds in 500ms ticks)
            if (activeGame.toyControl.controllerUuid === 'cpu-bot') {
                if (tick % 8 === 0) {
                    const patterns = ['constant', 'pulse', 'wave', 'chaos', 'heartbeat', 'escalator', 'tease'];
                    activeGame.toyControl.currentPattern = patterns[Math.floor(Math.random() * patterns.length)];
                    activeGame.toyControl.currentStrength = Math.floor(Math.random() * 12) + 5; // 5 to 16
                }
            }

            const targetUuid = activeGame.toyControl.targetUuid;
            const targetPlayer = getPlayerByUuid(activeGame, targetUuid);

            let activeStrength = activeGame.toyControl.currentStrength;
            const pattern = activeGame.toyControl.currentPattern;

            if (pattern === 'pulse') {
                activeStrength = (Math.floor(tick / 2) % 2 === 0) ? activeGame.toyControl.currentStrength : 0;
            } else if (pattern === 'wave') {
                const factor = (Math.sin(tick * Math.PI / 6) + 1) / 2; // Cycle of 12 ticks (6 seconds)
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
                if (cycleLength === 6) {
                    activeStrength = (cycleIndex === 0 || cycleIndex === 2) ? activeGame.toyControl.currentStrength : 0;
                } else if (cycleLength === 4) {
                    activeStrength = (cycleIndex === 0 || cycleIndex === 2) ? activeGame.toyControl.currentStrength : 0;
                } else if (cycleLength === 3) {
                    activeStrength = (cycleIndex === 0 || cycleIndex === 1) ? activeGame.toyControl.currentStrength : 0;
                } else {
                    activeStrength = activeGame.toyControl.currentStrength;
                }
            } else if (pattern === 'escalator') {
                const rampStep = tick % 20; // 10 seconds ramp
                activeStrength = Math.round((rampStep / 19) * activeGame.toyControl.currentStrength);
            } else if (pattern === 'tease') {
                const teaseStep = tick % 20; // 10 seconds cycle
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
                // Keep active duration low (2 seconds) to stop if loop crashes/clears
                lovenseHelper.triggerVibration(targetUuid, 'toy_control', { strength: activeStrength, duration: 2 });
            }

            gameIo.to(gameId).emit('toy_control_tick', {
                currentStrength: activeStrength,
                userStrength: activeGame.toyControl.currentStrength,
                pattern: activeGame.toyControl.currentPattern,
                remainingSec: remainingSec
            });

            tick++;
        }, 500);
    }

    function endToyControl(gameId, quiet = false) {
        const game = games[gameId];
        if (!game) return;

        if (game.toyControlInterval) {
            clearInterval(game.toyControlInterval);
            delete game.toyControlInterval;
        }

        if (game.toyControl) {
            const targetUuid = game.toyControl.targetUuid;
            const targetPlayer = getPlayerByUuid(game, targetUuid);
            if (targetPlayer && isToyActive(targetPlayer)) {
                lovenseHelper.triggerVibration(targetUuid, 'toy_control_stop', { strength: 0, duration: 1 });
            }
            delete game.toyControl;
        }

        if (!quiet) {
            gameIo.to(gameId).emit('toy_control_end');
            gameIo.to(gameId).emit('update', game);
        }
    }

    // Helper: Initialize an empty board (7 columns, 6 rows)
    function createEmptyBoard() {
        const board = [];
        for (let r = 0; r < 6; r++) {
            board.push(new Array(7).fill(0));
        }
        return board;
    }

    // Check for Win (4-in-a-row)
    function checkWin(board) {
        const ROWS = 6;
        const COLS = 7;

        // Horizontal
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS - 3; c++) {
                const p = board[r][c];
                if (p !== 0 && p === board[r][c+1] && p === board[r][c+2] && p === board[r][c+3]) {
                    return { winner: p, coords: [[r, c], [r, c+1], [r, c+2], [r, c+3]] };
                }
            }
        }

        // Vertical
        for (let r = 0; r < ROWS - 3; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = board[r][c];
                if (p !== 0 && p === board[r+1][c] && p === board[r+2][c] && p === board[r+3][c]) {
                    return { winner: p, coords: [[r, c], [r+1, c], [r+2, c], [r+3, c]] };
                }
            }
        }

        // Diagonal Up-Right
        for (let r = 0; r < ROWS - 3; r++) {
            for (let c = 0; c < COLS - 3; c++) {
                const p = board[r][c];
                if (p !== 0 && p === board[r+1][c+1] && p === board[r+2][c+2] && p === board[r+3][c+3]) {
                    return { winner: p, coords: [[r, c], [r+1, c+1], [r+2, c+2], [r+3, c+3]] };
                }
            }
        }

        // Diagonal Down-Right
        for (let r = 3; r < ROWS; r++) {
            for (let c = 0; c < COLS - 3; c++) {
                const p = board[r][c];
                if (p !== 0 && p === board[r-1][c+1] && p === board[r-2][c+2] && p === board[r-3][c+3]) {
                    return { winner: p, coords: [[r, c], [r-1, c+1], [r-2, c+2], [r-3, c+3]] };
                }
            }
        }

        return null;
    }

    // Check for Draw (board full)
    function checkDraw(board) {
        return board[5].every(cell => cell !== 0);
    }

    function getPlayerByUuid(game, uuid) {
        if (game.player1 && game.player1.uuid === uuid) return game.player1;
        if (game.player2 && game.player2.uuid === uuid) return game.player2;
        return null;
    }

    function isToyActive(player) {
        return !!(player && player.connected && player.toyEnabled !== false);
    }

    function addVibeIfActive(vibeQueue, player, type, options) {
        if (isToyActive(player)) {
            vibeQueue.push({ uuid: player.uuid, type, options });
        }
    }

    // Returns max contiguous chain length (1-4) created by the latest move.
    function getMaxChainFromMove(board, row, col, playerNum) {
        const directions = [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1]
        ];

        let maxChain = 1;

        for (const [dr, dc] of directions) {
            let chain = 1;

            let r = row + dr;
            let c = col + dc;
            while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === playerNum) {
                chain++;
                r += dr;
                c += dc;
            }

            r = row - dr;
            c = col - dc;
            while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === playerNum) {
                chain++;
                r -= dr;
                c -= dc;
            }

            if (chain > maxChain) {
                maxChain = chain;
            }
        }

        return Math.min(4, maxChain);
    }

    // Retrieve or Initialize Game
    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // Red (uuid, name)
                player2: null, // Yellow (uuid, name)
                board: createEmptyBoard(),
                turn: 1, // Red starts
                status: 'waiting', // waiting, playing, won, draw
                vibeMode: 'fun', // fun, normal
                winner: 0,
                winCoords: [],
                lastActive: Date.now()
            };
        }
        return games[gameId];
    }

    // Serve Spectator Page
    app.get(`${mountPath}/board/:gameId`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // List Active Rooms API
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

    // Join API
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);
        game.lastActive = Date.now();

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'red', game });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'yellow', game });
            }
        } else {
            if (role === 'red' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'red', game });
            }
            if (role === 'yellow' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'yellow', game });
            }
        }

        let assignedRole = null;

        if (role === 'red') {
            if (game.player1) return res.status(400).json({ error: "Red slot already taken." });
            game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'red';
        } else if (role === 'yellow') {
            if (game.player2) return res.status(400).json({ error: "Yellow slot already taken." });
            game.player2 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'yellow';
        } else {
            // Auto assign
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'red';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'yellow';
            } else {
                return res.status(400).json({ error: "Game is full." });
            }
        }

        const targetPlayer = assignedRole === 'red' ? game.player1 : game.player2;
        if (targetPlayer && !uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
            lovenseHelper.getQrCode(uuid, name).then(result => {
                const p = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
                if (p) {
                    p.qrCode = result.qrCode;
                    p.linkCode = result.linkCode;
                    p.qrError = result.error;
                    gameIo.to(gameId).emit('update', game);
                }
            });
        }

        if (game.player1 && game.player2) {
            game.status = 'playing';
        }

        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, role: assignedRole, game });
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
        game.board = createEmptyBoard();
        game.winner = 0;
        game.winCoords = [];

        if (!uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
            lovenseHelper.getQrCode(uuid, name).then(result => {
                if (game.player1 && game.player1.uuid === uuid) {
                    game.player1.qrCode = result.qrCode;
                    game.player1.linkCode = result.linkCode;
                    game.player1.qrError = result.error;
                    gameIo.to(gameId).emit('update', game);
                }
            });
        }

        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, role: 'red', game });
    });

    // Set CPU Difficulty API
    app.post(`${mountPath}/api/set-difficulty`, (req, res) => {
        const { gameId, difficulty } = req.body;
        const game = games[gameId];
        if (game) {
            game.difficulty = difficulty || 'medium';
            game.status = 'playing';
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Test Lovense Vibration API
    app.post(`${mountPath}/api/vibe/test`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        const player = getPlayerByUuid(game, uuid);
        if (!player) return res.status(400).json({ error: "Player not registered." });
        if (!isToyActive(player)) return res.status(400).json({ error: "Toy is not connected." });
        await lovenseHelper.triggerVibration(player.uuid, 'move');
        res.json({ success: true });
    });

    // Verify Lovense Connection API
    app.post(`${mountPath}/api/vibe/verify`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        const player = getPlayerByUuid(game, uuid);
        if (!player) return res.status(400).json({ error: "Player not registered." });

        const result = await lovenseHelper.verifyConnection(player.uuid);
        if (result.success) {
            player.connected = true;
            player.toyEnabled = true;
            await lovenseHelper.triggerVibration(player.uuid, 'move');
            gameIo.to(gameId).emit('update', game);
            return res.json({ success: true });
        }

        res.status(400).json({ error: result.error || "Verification failed." });
    });

    // Manual local disconnect from this game (stops all game-triggered vibrations)
    app.post(`${mountPath}/api/vibe/disconnect`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        const player = getPlayerByUuid(game, uuid);
        if (!player) return res.status(400).json({ error: "Player not registered." });

        await lovenseHelper.disconnectToy(player.uuid);
        player.connected = false;
        player.toyEnabled = false;
        if (game.toyControl && game.toyControl.active) {
            game.toyControl.active = false;
        }
        gameIo.to(gameId).emit('update', game);
        res.json({ success: true });
    });

    // Set room vibration mode (fun / normal)
    app.post(`${mountPath}/api/vibe/mode`, (req, res) => {
        const { gameId, mode } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });

        const nextMode = (mode || '').toLowerCase();
        if (nextMode !== 'fun' && nextMode !== 'normal') {
            return res.status(400).json({ error: "Invalid vibe mode." });
        }

        game.vibeMode = nextMode;
        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, mode: nextMode, game });
    });

    // Leave API
    app.post(`${mountPath}/api/leave`, (req, res) => {
        const { gameId, uuid } = req.body;
        if (!gameId || !uuid) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = games[gameId];
        if (game) {
            let playerLeft = false;
            if (game.player1 && game.player1.uuid === uuid) {
                game.player1 = null;
                playerLeft = true;
            } else if (game.player2 && game.player2.uuid === uuid) {
                game.player2 = null;
                playerLeft = true;
            }

            if (playerLeft) {
                endToyControl(gameId, true);
                game.lastActive = Date.now();
                if (game.status === 'playing') {
                    game.status = 'abandoned';
                    gameIo.to(gameId).emit('update', game);
                    setTimeout(() => {
                        delete games[gameId];
                    }, 1000);
                } else {
                    if (!game.player1 && !game.player2) {
                        console.log(`Both players left. Deleting game room: ${gameId}`);
                        delete games[gameId];
                        gameIo.to(gameId).emit('update', null);
                    } else {
                        gameIo.to(gameId).emit('update', game);
                    }
                }
            }
        }
        res.json({ success: true });
    });

    // Reset Game API
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            endToyControl(gameId, true);
            game.lastActive = Date.now();
            game.board = createEmptyBoard();
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            if (game.isCpuMatch) {
                game.status = 'playing';
            }
            game.winner = 0;
            game.winCoords = [];
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Drop Token API
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, role, uuid, col } = req.body;
        const game = games[gameId];

        if (!game) return res.status(404).json({ error: "Game not found." });
        game.lastActive = Date.now();
        if (game.status !== 'playing') return res.status(400).json({ error: "Game is not active." });

        let activeRole = role;
        if (uuid) {
            if (game.player1 && game.player1.uuid === uuid && game.player2 && game.player2.uuid === uuid) {
                activeRole = game.turn === 1 ? 'red' : 'yellow';
            } else if (game.player1 && game.player1.uuid === uuid) {
                activeRole = 'red';
            } else if (game.player2 && game.player2.uuid === uuid) {
                activeRole = 'yellow';
            } else {
                return res.status(400).json({ error: "You are not a registered player in this game." });
            }
        }

        if (!activeRole) {
            return res.status(400).json({ error: "Player role not specified." });
        }

        const playerNum = activeRole === 'red' ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const c = parseInt(col);
        if (isNaN(c) || c < 0 || c > 6) return res.status(400).json({ error: "Invalid column." });

        // Find lowest empty row in column
        let r = -1;
        for (let row = 0; row < 6; row++) {
            if (game.board[row][c] === 0) {
                r = row;
                break;
            }
        }

        if (r === -1) return res.status(400).json({ error: "Column is full." });

        // Make the move
        game.board[r][c] = playerNum;

        // Check for Win or Draw
        const winResult = checkWin(game.board);
        const vibeQueue = [];

        if (winResult) {
            game.status = 'won';
            game.winner = winResult.winner;
            game.winCoords = winResult.coords;
            addVibeIfActive(vibeQueue, game.player1, game.winner === 1 ? 'win' : 'lose');
            addVibeIfActive(vibeQueue, game.player2, game.winner === 2 ? 'win' : 'lose');

            // Setup Toy Control phase
            if (!game.isCpuMatch) {
                const winnerPlayer = game.winner === 1 ? game.player1 : game.player2;
                const loserPlayer = game.winner === 1 ? game.player2 : game.player1;

                if (isToyActive(loserPlayer)) {
                    const durationSec = (game.vibeMode === 'normal') ? 60 : 120;

                    game.toyControl = {
                        active: true,
                        controllerUuid: winnerPlayer.uuid,
                        controllerName: winnerPlayer.name,
                        targetUuid: loserPlayer.uuid,
                        targetName: loserPlayer.name,
                        durationSec: durationSec,
                        endTime: Date.now() + durationSec * 1000,
                        currentStrength: 5,
                        currentPattern: 'constant'
                    };

                    setTimeout(() => {
                        startToyControl(gameId);
                    }, 50);
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
                // VS CPU: If player won, there's no CPU toy to control
                if (game.winner === 1) {
                    game.toyControl = {
                        active: true,
                        controllerUuid: game.player1.uuid,
                        controllerName: game.player1.name,
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
        } else if (checkDraw(game.board)) {
            game.status = 'draw';
        } else {
            game.turn = playerNum === 1 ? 2 : 1;
            const vibeMode = (game.vibeMode || 'fun');

            // Dynamic vibration profile tuned for a more playful feel:
            // - Main pulse scales hard with chain pressure.
            // - Combo plays add a quick echo pulse.
            // - Threatening plays send a stronger alert to the opponent.
            const chain = getMaxChainFromMove(game.board, r, c, playerNum);
            const randomOffset = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
            const moveStrength = vibeMode === 'fun'
                ? Math.min(20, Math.max(3, 4 + (chain * 4) + Math.floor(r / 2) + randomOffset))
                : Math.min(20, Math.max(2, 3 + (chain * 4) + Math.floor(r / 2) + randomOffset));
            const alertStrength = vibeMode === 'fun'
                ? Math.min(20, Math.max(3, 5 + ((chain - 1) * 4) + randomOffset))
                : Math.min(20, Math.max(2, 4 + ((chain - 1) * 3) + randomOffset));
            const moveDuration = (vibeMode === 'fun' && chain >= 3) ? 2 : 1;

            // Queue move vibration for current player, turn alert for opponent
            if (playerNum === 1) {
                addVibeIfActive(vibeQueue, game.player1, 'move', { strength: moveStrength, duration: moveDuration });
                addVibeIfActive(vibeQueue, game.player2, 'turn_alert', { strength: alertStrength, duration: 1 });

                // Combo echo pulse for satisfying streak buildup
                if (vibeMode === 'fun' && chain >= 2) {
                    addVibeIfActive(vibeQueue, game.player1, 'move', {
                        strength: Math.max(2, moveStrength - 2),
                        duration: 1,
                        delayMs: 220
                    });
                }

                // Strong pressure pulse to opponent when a dangerous line appears
                if (vibeMode === 'fun' && chain >= 3) {
                    addVibeIfActive(vibeQueue, game.player2, 'turn_alert', {
                        strength: Math.min(20, alertStrength + 4),
                        duration: 1,
                        delayMs: 140
                    });
                }
            } else {
                addVibeIfActive(vibeQueue, game.player2, 'move', { strength: moveStrength, duration: moveDuration });
                addVibeIfActive(vibeQueue, game.player1, 'turn_alert', { strength: alertStrength, duration: 1 });

                if (vibeMode === 'fun' && chain >= 2) {
                    addVibeIfActive(vibeQueue, game.player2, 'move', {
                        strength: Math.max(2, moveStrength - 2),
                        duration: 1,
                        delayMs: 220
                    });
                }

                if (vibeMode === 'fun' && chain >= 3) {
                    addVibeIfActive(vibeQueue, game.player1, 'turn_alert', {
                        strength: Math.min(20, alertStrength + 4),
                        duration: 1,
                        delayMs: 140
                    });
                }
            }

            // High-stack drop adds a tiny rumble tail to make tense late-game moves feel heavier.
            if (vibeMode === 'fun' && r >= 4) {
                const actor = playerNum === 1 ? game.player1 : game.player2;
                addVibeIfActive(vibeQueue, actor, 'move', {
                    strength: Math.min(20, moveStrength + 1),
                    duration: 1,
                    delayMs: 420
                });
            }
        }

        // Broadcast update
        gameIo.to(gameId).emit('update', { game, lastMove: { r, c, player: playerNum } });

        // Trigger player vibrations
        vibeQueue.forEach(item => {
            if (!item.uuid) return;
            const options = item.options ? { ...item.options } : {};
            const delayMs = options.delayMs || 0;
            delete options.delayMs;

            const trigger = () => lovenseHelper.triggerVibration(item.uuid, item.type, options);
            if (delayMs > 0) {
                setTimeout(trigger, delayMs);
            } else {
                trigger();
            }
        });

        // If CPU match and now it is CPU's turn (Player 2)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === 2) {
            setTimeout(() => {
                const cpuCol = getBestCpuMove(game.board, 2, 1, game.difficulty);
                const rCpu = getLowestEmptyRow(game.board, cpuCol);
                if (rCpu !== -1) {
                    game.board[rCpu][cpuCol] = 2;
                    const winResultCpu = checkWin(game.board);
                    const cpuVibeQueue = [];
                    if (winResultCpu) {
                        game.status = 'won';
                        game.winner = 2;
                        game.winCoords = winResultCpu.coords;
                        if (game.player1) cpuVibeQueue.push({ uuid: game.player1.uuid, type: 'lose' });

                        // CPU wins vs Player 1 (Red)
                        if (game.player1) {
                            const durationSec = (game.vibeMode === 'normal') ? 60 : 120;
                            game.toyControl = {
                                active: true,
                                controllerUuid: 'cpu-bot',
                                controllerName: 'CyberBot 🤖',
                                targetUuid: game.player1.uuid,
                                targetName: game.player1.name,
                                durationSec: durationSec,
                                endTime: Date.now() + durationSec * 1000,
                                currentStrength: 5,
                                currentPattern: 'constant'
                            };

                            setTimeout(() => {
                                startToyControl(gameId);
                            }, 50);
                        }
                    } else if (checkDraw(game.board)) {
                        game.status = 'draw';
                    } else {
                        game.turn = 1;
                        // Calculate alerts for CPU turn completed
                        const randomOffsetCpu = Math.floor(Math.random() * 3) - 1;
                        const alertStrengthCpu = Math.min(20, Math.max(1, 5 + randomOffsetCpu));
                        addVibeIfActive(cpuVibeQueue, game.player1, 'turn_alert', { strength: alertStrengthCpu, duration: 1 });
                    }
                    gameIo.to(gameId).emit('update', { game, lastMove: { r: rCpu, c: cpuCol, player: 2 } });
                    cpuVibeQueue.forEach(item => {
                        if (!item.uuid) return;
                        const options = item.options ? { ...item.options } : {};
                        const delayMs = options.delayMs || 0;
                        delete options.delayMs;

                        const trigger = () => lovenseHelper.triggerVibration(item.uuid, item.type, options);
                        if (delayMs > 0) {
                            setTimeout(trigger, delayMs);
                        } else {
                            trigger();
                        }
                    });
                }
            }, 1000);
        }

        res.json({ success: true, game });
    });

    function getLowestEmptyRow(board, c) {
        for (let row = 0; row < 6; row++) {
            if (board[row][c] === 0) return row;
        }
        return -1;
    }

    function getBestCpuMove(board, cpuVal, playerVal, difficulty) {
        // Easy: 100% random moves
        if (difficulty === 'easy') {
            const validCols = [];
            for (let c = 0; c < 7; c++) {
                if (getLowestEmptyRow(board, c) !== -1) validCols.push(c);
            }
            return validCols[Math.floor(Math.random() * validCols.length)] || 3;
        }
        
        // Medium: 50% random chance
        if (difficulty === 'medium') {
            if (Math.random() < 0.5) {
                const validCols = [];
                for (let c = 0; c < 7; c++) {
                    if (getLowestEmptyRow(board, c) !== -1) validCols.push(c);
                }
                return validCols[Math.floor(Math.random() * validCols.length)] || 3;
            }
        }

        // Hard / Smart path
        // 1. Can CPU win in 1 move?
        for (let c = 0; c < 7; c++) {
            let r = getLowestEmptyRow(board, c);
            if (r !== -1) {
                board[r][c] = cpuVal;
                const win = checkWin(board);
                board[r][c] = 0;
                if (win) return c;
            }
        }
        // 2. Can Player win in 1 move? Block them!
        for (let c = 0; c < 7; c++) {
            let r = getLowestEmptyRow(board, c);
            if (r !== -1) {
                board[r][c] = playerVal;
                const win = checkWin(board);
                board[r][c] = 0;
                if (win) return c;
            }
        }
        // 3. Prefer center, then outer columns
        const preferred = [3, 2, 4, 1, 5, 0, 6];
        for (let c of preferred) {
            if (getLowestEmptyRow(board, c) !== -1) return c;
        }
        return 0;
    }

    // Socket.io namespace configuration
    gameIo.on('connection', (socket) => {
        let currentRoom = null;
        let playerUuid = null;

        socket.on('join_game', (gameId, uuid) => {
            currentRoom = gameId;
            playerUuid = uuid;
            socket.join(gameId);
            const game = getGame(gameId);
            game.lastActive = Date.now();
            socket.emit('update', game);
        });

        socket.on('control_toy', (data) => {
            const { gameId, strength, pattern } = data;
            const game = games[gameId];
            if (game && game.toyControl && game.toyControl.active) {
                if (game.toyControl.controllerUuid === playerUuid) {
                    game.toyControl.currentStrength = Math.min(20, Math.max(0, parseInt(strength) || 0));
                    game.toyControl.currentPattern = pattern || 'constant';
                    
                    const targetPlayer = getPlayerByUuid(game, game.toyControl.targetUuid);
                    if (targetPlayer && isToyActive(targetPlayer)) {
                        lovenseHelper.triggerVibration(game.toyControl.targetUuid, 'toy_control_direct', { 
                            strength: game.toyControl.currentStrength, 
                            duration: 2 
                        });
                    }
                    
                    gameIo.to(gameId).emit('toy_control_tick', {
                        currentStrength: game.toyControl.currentStrength,
                        userStrength: game.toyControl.currentStrength,
                        pattern: game.toyControl.currentPattern,
                        remainingSec: Math.max(0, Math.ceil((game.toyControl.endTime - Date.now()) / 1000))
                    });
                }
            }
        });

        socket.on('stop_toy_control', (data) => {
            const { gameId } = data;
            const game = games[gameId];
            if (game && game.toyControl && game.toyControl.active) {
                if (game.toyControl.targetUuid === playerUuid || game.toyControl.controllerUuid === playerUuid) {
                    if (game.toyControl.targetUuid === playerUuid) {
                        const targetPlayer = getPlayerByUuid(game, playerUuid);
                        if (targetPlayer) {
                            targetPlayer.connected = false;
                            targetPlayer.toyEnabled = false;
                        }
                    }
                    endToyControl(gameId);
                }
            }
        });

        socket.on('voice_signal', (data) => {
            if (currentRoom) {
                socket.to(currentRoom).emit('voice_signal', data);
            }
        });

        socket.on('chat_message', (msg) => {
            if (currentRoom) {
                gameIo.to(currentRoom).emit('chat_message', msg);
            }
        });

        socket.on('disconnect', () => {
            if (currentRoom && playerUuid) {
                const game = games[currentRoom];
                if (game) {
                    let playerLeft = false;
                    if (game.player1 && game.player1.uuid === playerUuid) {
                        game.player1 = null;
                        playerLeft = true;
                    } else if (game.player2 && game.player2.uuid === playerUuid) {
                        game.player2 = null;
                        playerLeft = true;
                    }

                    if (playerLeft) {
                        endToyControl(currentRoom, true);
                        game.lastActive = Date.now();
                        if (game.status === 'playing') {
                            game.status = 'abandoned';
                            gameIo.to(currentRoom).emit('update', game);
                            setTimeout(() => {
                                delete games[currentRoom];
                            }, 1000);
                        } else {
                            if (!game.player1 && !game.player2) {
                                delete games[currentRoom];
                                gameIo.to(currentRoom).emit('update', null);
                            } else {
                                gameIo.to(currentRoom).emit('update', game);
                            }
                        }
                    }
                }
            }
        });
    });

    // Cleanup inactive games every 1 minute
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        const inactiveTime = 30 * 60 * 1000; // 30 minutes
        const emptyRoomInactiveTime = 2 * 60 * 1000; // 2 minutes if no sockets are connected
        
        for (const gameId in games) {
            if (gameId === 'lobby') continue;
            const game = games[gameId];
            
            const roomSockets = gameIo.adapter.rooms.get(gameId);
            const numSockets = roomSockets ? roomSockets.size : 0;
            
            const currentInactiveLimit = numSockets === 0 ? emptyRoomInactiveTime : inactiveTime;
            
            if (game.lastActive && (now - game.lastActive > currentInactiveLimit)) {
                console.log(`Cleaning up inactive Connect 4 game room (${numSockets} sockets): ${gameId}`);
                delete games[gameId];
            }
        }
    }, 60 * 1000);
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

// Standalone execution support
if (require.main === module) {
    const http = require('http');
    const socketIo = require('socket.io');
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server);

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    init(app, io, '');

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Simple Connect 4 Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

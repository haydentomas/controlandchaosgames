// server.js (Multiplayer Tic Tac Toe Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

let gamesRef = null;

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    gamesRef = games;
    const activeIntervals = {};
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('tictactoe', games, gameIo);

    function createEmptyBoard(size) {
        const board = [];
        for (let r = 0; r < size; r++) {
            board.push(new Array(size).fill(0));
        }
        return board;
    }

    function getGame(gameId, size = 3) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // X (uuid, name)
                player2: null, // O (uuid, name)
                board: createEmptyBoard(size),
                size: size,
                turn: 1, // Player 1 starts
                status: 'waiting', // waiting, playing, won, draw
                winner: 0,
                winCoords: [],
                vibeMode: 'fun',
                toyControl: null
            };
        }
        return games[gameId];
    }

    function getPlayerByUuid(game, uuid) {
        if (game.player1 && game.player1.uuid === uuid) return game.player1;
        if (game.player2 && game.player2.uuid === uuid) return game.player2;
        return null;
    }

    function isToyActive(player) {
        return player && player.connected && player.toyEnabled && player.uuid && !player.uuid.startsWith('cpu-') && !player.uuid.startsWith('browser_');
    }

    function ensurePlayerQr(game, gameId, uuid, name) {
        if (!game || !uuid || !name) return;
        if (uuid.startsWith('cpu-') || uuid.startsWith('browser_')) return;

        const p = (game.player1 && game.player1.uuid === uuid)
            ? game.player1
            : ((game.player2 && game.player2.uuid === uuid) ? game.player2 : null);
        if (!p) return;

        // Rehydrate QR data for re-joins if it is missing from state.
        if (p.qrCode || p.linkCode) return;

        lovenseHelper.getQrCode(uuid, name).then(result => {
            const current = (game.player1 && game.player1.uuid === uuid)
                ? game.player1
                : ((game.player2 && game.player2.uuid === uuid) ? game.player2 : null);
            if (!current) return;

            current.qrCode = result.qrCode;
            current.linkCode = result.linkCode;
            current.qrError = result.error;
            gameIo.to(gameId).emit('update', game);
        });
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
                endToyControl(gameId);
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

    function endToyControl(gameId, quiet = false) {
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

            game.toyControl = null;
            if (!quiet) {
                gameIo.to(gameId).emit('toy_control_end');
                gameIo.to(gameId).emit('update', game);
            }
        }
    }

    // Win Length mapping
    function getWinLength(size) {
        if (size === 6) return 4;
        if (size === 10) return 5;
        return 3; // default 3x3
    }

    // Generic Win Checker
    function checkWin(board, size, winLength) {
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const p = board[r][c];
                if (p === 0) continue;

                // Horizontal
                if (c + winLength <= size) {
                    let match = true;
                    const coords = [];
                    for (let k = 0; k < winLength; k++) {
                        if (board[r][c+k] !== p) { match = false; break; }
                        coords.push([r, c+k]);
                    }
                    if (match) return { winner: p, coords };
                }

                // Vertical
                if (r + winLength <= size) {
                    let match = true;
                    const coords = [];
                    for (let k = 0; k < winLength; k++) {
                        if (board[r+k][c] !== p) { match = false; break; }
                        coords.push([r+k, c]);
                    }
                    if (match) return { winner: p, coords };
                }

                // Diagonal Down-Right
                if (r + winLength <= size && c + winLength <= size) {
                    let match = true;
                    const coords = [];
                    for (let k = 0; k < winLength; k++) {
                        if (board[r+k][c+k] !== p) { match = false; break; }
                        coords.push([r+k, c+k]);
                    }
                    if (match) return { winner: p, coords };
                }

                // Diagonal Up-Right
                if (r - winLength + 1 >= 0 && c + winLength <= size) {
                    let match = true;
                    const coords = [];
                    for (let k = 0; k < winLength; k++) {
                        if (board[r-k][c+k] !== p) { match = false; break; }
                        coords.push([r-k, c+k]);
                    }
                    if (match) return { winner: p, coords };
                }
            }
        }
        return null;
    }

    function checkDraw(board, size) {
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (board[r][c] === 0) return false;
            }
        }
        return true;
    }

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

    // Inactive room cleanup (Runs every 1 minute)
    setInterval(() => {
        const now = Date.now();
        Object.keys(games).forEach(gameId => {
            const game = games[gameId];
            const roomSockets = gameIo.adapter.rooms.get(gameId);
            const activeSocketCount = roomSockets ? roomSockets.size : 0;
            
            if (activeSocketCount === 0) {
                if (!game.emptySince) {
                    game.emptySince = now;
                } else if (now - game.emptySince > 120000) { // 2 minutes empty -> delete
                    console.log(`Cleaning up inactive Tic Tac Toe game room (0 sockets): ${gameId}`);
                    delete games[gameId];
                }
            } else {
                delete game.emptySince;
            }
        });
    }, 60000);

    // Join Game
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role, size } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const boardSize = size ? parseInt(size) : 3;
        const game = getGame(gameId, boardSize);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                ensurePlayerQr(game, gameId, uuid, name);
                return res.json({ success: true, role: 'X', game });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                ensurePlayerQr(game, gameId, uuid, name);
                return res.json({ success: true, role: 'O', game });
            }
        } else {
            if (role === 'X' && game.player1 && game.player1.uuid === uuid) {
                ensurePlayerQr(game, gameId, uuid, name);
                return res.json({ success: true, role: 'X', game });
            }
            if (role === 'O' && game.player2 && game.player2.uuid === uuid) {
                ensurePlayerQr(game, gameId, uuid, name);
                return res.json({ success: true, role: 'O', game });
            }
        }

        let assignedRole = null;

        if (role === 'X') {
            if (game.player1) return res.status(400).json({ error: "X slot already taken." });
            game.player1 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'X';
        } else if (role === 'O') {
            if (game.player2) return res.status(400).json({ error: "O slot already taken." });
            game.player2 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'O';
        } else {
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'X';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'O';
            } else {
                return res.status(400).json({ error: "Game is full." });
            }
        }

        const targetPlayer = assignedRole === 'X' ? game.player1 : game.player2;
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
        const game = getGame(gameId, 3); // Defaults to 3x3 for CPU quick setup
        game.lastActive = Date.now();

        game.player1 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        game.board = createEmptyBoard(3);
        game.winner = 0;
        game.winCoords = [];
        game.toyControl = null;

        // Default to 3x3 quick games where CPU is available.
        game.size = 3;


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
        res.json({ success: true, role: 'X', game });
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

    app.post(`${mountPath}/api/debug/toy-control-test`, (req, res) => {
        const { gameId, uuid, result } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });

        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: 'Must be in the game to test.' });

        const opponent = (player === game.player1) ? game.player2 : game.player1;
        const hasHumanOpponent = !!(opponent && opponent.uuid && opponent.uuid !== 'cpu-bot');
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
        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, game });
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
            gameIo.to(gameId).emit('update', game);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error || "Verification failed." });
        }
    });

    app.post(`${mountPath}/api/vibe/disconnect`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: 'Player not registered.' });

        await lovenseHelper.disconnectToy(player.uuid);
        if (game.toyControl && game.toyControl.active && (game.toyControl.targetUuid === player.uuid || game.toyControl.controllerUuid === player.uuid)) {
            endToyControl(gameId, true);
        } else {
            lovenseHelper.triggerVibration(player.uuid, 'stop');
        }

        player.connected = false;
        player.toyEnabled = false;
        gameIo.to(gameId).emit('update', game);
        res.json({ success: true });
    });

    app.post(`${mountPath}/api/toggle-vibe-mode`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            game.vibeMode = game.vibeMode === 'normal' ? 'fun' : 'normal';
            gameIo.to(gameId).emit('update', game);
            res.json({ success: true, vibeMode: game.vibeMode });
        } else {
            res.status(404).json({ error: 'Game not found.' });
        }
    });

    // Reset Game (Accepts new board size option)
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId, size, uuid } = req.body;
        const game = games[gameId];

        if (game) {
            endToyControl(gameId, true);
        }
        
        // Enforce that only player1 (the creator/starter) can change grid size or reset
        if (game && game.player1 && game.player1.uuid !== uuid) {
            return res.status(403).json({ error: "Only the game creator (Player X) can change grid size or reset the match." });
        }

        const newSize = size ? parseInt(size) : (game ? game.size : 3);
        
        const freshGame = {
            id: gameId,
            player1: game ? game.player1 : null,
            player2: game ? game.player2 : null,
            board: createEmptyBoard(newSize),
            size: newSize,
            turn: 1,
            status: game && game.player1 && game.player2 ? 'playing' : 'waiting',
            isCpuMatch: game ? game.isCpuMatch : false,
            difficulty: game ? game.difficulty : 'medium',
            winner: 0,
            winCoords: [],
            vibeMode: game ? (game.vibeMode || 'fun') : 'fun',
            toyControl: null
        };
        if (freshGame.isCpuMatch) {
            freshGame.status = 'playing';
        }

        games[gameId] = freshGame;
        gameIo.to(gameId).emit('update', freshGame);
        res.json({ success: true, game: freshGame });
    });

    // Drop Token / Place Move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, role, uuid, row, col } = req.body;
        const game = games[gameId];

        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game is not active." });

        let activeRole = role;
        if (uuid) {
            if (game.player1 && game.player1.uuid === uuid && game.player2 && game.player2.uuid === uuid) {
                activeRole = game.turn === 1 ? 'X' : 'O';
            } else if (game.player1 && game.player1.uuid === uuid) {
                activeRole = 'X';
            } else if (game.player2 && game.player2.uuid === uuid) {
                activeRole = 'O';
            } else {
                return res.status(400).json({ error: "You are not a registered player." });
            }
        }

        if (!activeRole) {
            return res.status(400).json({ error: "Player role not specified." });
        }

        const playerNum = activeRole === 'X' ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const r = parseInt(row);
        const c = parseInt(col);
        if (isNaN(r) || isNaN(c) || r < 0 || r >= game.size || c < 0 || c >= game.size) {
            return res.status(400).json({ error: "Invalid board coordinate." });
        }

        if (game.board[r][c] !== 0) {
            return res.status(400).json({ error: "Cell is already taken." });
        }

        // Place the piece
        game.board[r][c] = playerNum;

        // Check Win/Draw
        const winLength = getWinLength(game.size);
        const winResult = checkWin(game.board, game.size, winLength);
        const vibeQueue = [];
        
        if (winResult) {
            game.status = 'won';
            game.winner = winResult.winner;
            game.winCoords = winResult.coords;
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: game.winner === 1 ? 'win' : 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: game.winner === 2 ? 'win' : 'lose' });

            if (!game.isCpuMatch) {
                const winnerPlayer = game.winner === 1 ? game.player1 : game.player2;
                const loserPlayer = game.winner === 1 ? game.player2 : game.player1;
                if (winnerPlayer && loserPlayer) {
                    const durationSec = (game.vibeMode === 'normal') ? 60 : 120;
                    if (isToyActive(loserPlayer)) {
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
                        setTimeout(() => startToyControl(gameId), 50);
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
                }
            } else if (game.winner === 1 && game.player1) {
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
        } else if (checkDraw(game.board, game.size)) {
            game.status = 'draw';
        } else {
            game.turn = playerNum === 1 ? 2 : 1;
            
            // Queue vibrations for standard turns
            if (playerNum === 1) {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
            }
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { r, c, player: playerNum } });

        // Trigger player vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
        });

        // If CPU match and turn shifts to CPU (O / 2)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === 2) {
            cpuAi.makeMove('tictactoe', game, gameIo, checkWin, checkDraw);

            setTimeout(() => {
                const updatedGame = games[gameId];
                if (!updatedGame || !updatedGame.player1 || updatedGame.toyControl) return;

                if (updatedGame.status === 'won' && updatedGame.winner === 2) {
                    const durationSec = (updatedGame.vibeMode === 'normal') ? 60 : 120;
                    const hasToy = isToyActive(updatedGame.player1);
                    updatedGame.toyControl = {
                        active: true,
                        controllerUuid: 'cpu-bot',
                        controllerName: 'CyberBot 🤖',
                        targetUuid: updatedGame.player1.uuid,
                        targetName: updatedGame.player1.name,
                        durationSec: hasToy ? durationSec : 0,
                        endTime: hasToy ? (Date.now() + durationSec * 1000) : Date.now(),
                        currentStrength: hasToy ? 5 : 0,
                        currentPattern: 'constant',
                        noToyTarget: !hasToy
                    };
                    if (hasToy) {
                        startToyControl(gameId);
                    }
                    gameIo.to(gameId).emit('update', updatedGame);
                } else if (updatedGame.status === 'won' && updatedGame.winner === 1) {
                    updatedGame.toyControl = {
                        active: true,
                        controllerUuid: updatedGame.player1.uuid,
                        controllerName: updatedGame.player1.name,
                        targetUuid: 'cpu-bot',
                        targetName: 'CyberBot 🤖',
                        durationSec: 0,
                        endTime: Date.now(),
                        currentStrength: 0,
                        currentPattern: 'constant',
                        cpuNoToy: true
                    };
                    gameIo.to(gameId).emit('update', updatedGame);
                }
            }, 1500);
        }
        res.json({ success: true, game });
    });

    app.post(`${mountPath}/api/leave`, (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (game) {
            endToyControl(gameId, true);
            let playerLeft = false;
            if (game.player1 && game.player1.uuid === uuid) {
                game.player1 = null;
                playerLeft = true;
            }
            if (game.player2 && game.player2.uuid === uuid) {
                game.player2 = null;
                playerLeft = true;
            }
            if (playerLeft) {
                game.status = 'abandoned';
                gameIo.to(gameId).emit('update', game);
            }
        }
        res.json({ success: true });
    });

    gameIo.on('connection', (socket) => {
        let currentRoom = null;
        let playerUuid = null;

        socket.on('join_game', (gameId, uuid) => {
            currentRoom = gameId;
            playerUuid = uuid;
            socket.join(gameId);
            const game = getGame(gameId, 3);
            socket.emit('update', game);
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
            if (currentRoom) {
                socket.to(currentRoom).emit('voice_signal', data);
            }
        });

        socket.on('chat_message', (data) => {
            if (currentRoom) {
                gameIo.to(currentRoom).emit('chat_message', data);
            }
        });

        socket.on('disconnect', () => {
            if (currentRoom && playerUuid) {
                const game = games[currentRoom];
                if (game) {
                    endToyControl(currentRoom, true);
                    let playerLeft = false;
                    if (game.player1 && game.player1.uuid === playerUuid) {
                        game.player1 = null;
                        playerLeft = true;
                    }
                    if (game.player2 && game.player2.uuid === playerUuid) {
                        game.player2 = null;
                        playerLeft = true;
                    }
                    if (playerLeft) {
                        game.status = 'abandoned';
                        gameIo.to(currentRoom).emit('update', game);
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

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Tic Tac Toe Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

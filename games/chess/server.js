// server.js (Simple Multiplayer Chess Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');
const roomModeration = require('../shared_room_moderation.js');

let gamesRef = null;

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    gamesRef = games;
    const activeIntervals = {};
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('chess', games, gameIo);
    roomModeration.registerRoutes({
        app,
        mountPath,
        games,
        snapshotGame: game => game,
        emitGameUpdate: (gameId, game) => gameIo.to(gameId).emit('update', game),
        endToyControl
    });

    // Initial Chess Board State (8x8)
    // Row 0 is Rank 8 (Black side), Row 7 is Rank 1 (White side)
    function createInitialBoard() {
        return [
            ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'], // Row 0 (Black pieces)
            ['bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp'], // Row 1 (Black pawns)
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            ['wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp'], // Row 6 (White pawns)
            ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']  // Row 7 (White pieces)
        ];
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // White (uuid, name)
                player2: null, // Black (uuid, name)
                board: createInitialBoard(),
                turn: 'white',
                status: 'waiting', // waiting, playing, won, draw
                winner: null,
                history: [],
                vibeMode: 'fun',
                toyControl: null,
                captured: { white: [], black: [] }
            };
            roomModeration.ensureModeration(games[gameId]);
        }
        return games[gameId];
    }

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

    function isValidMove(board, fr, fc, tr, tc) {
        if (fr === tr && fc === tc) return false;
        const piece = board[fr][fc];
        if (!piece) return false;

        const color = piece[0]; // 'w' or 'b'
        const type = piece[1]; // 'p', 'r', 'n', 'b', 'q', 'k'

        const target = board[tr][tc];
        if (target && target[0] === color) return false; // Cannot capture own piece

        const dr = tr - fr;
        const dc = tc - fc;

        switch (type) {
            case 'p': {
                if (color === 'w') {
                    // White moves up (r decreases)
                    if (dc === 0) {
                        // Normal move
                        if (dr === -1 && !target) return true;
                        // Double move from starting rank
                        if (fr === 6 && dr === -2 && !board[5][fc] && !target) return true;
                    } else if (Math.abs(dc) === 1 && dr === -1) {
                        // Capture
                        if (target && target[0] === 'b') return true;
                    }
                } else {
                    // Black moves down (r increases)
                    if (dc === 0) {
                        // Normal move
                        if (dr === 1 && !target) return true;
                        // Double move from starting rank
                        if (fr === 1 && dr === 2 && !board[2][fc] && !target) return true;
                    } else if (Math.abs(dc) === 1 && dr === 1) {
                        // Capture
                        if (target && target[0] === 'w') return true;
                    }
                }
                return false;
            }
            case 'n': {
                return (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2);
            }
            case 'r': {
                if (dr !== 0 && dc !== 0) return false;
                return isPathClear(board, fr, fc, tr, tc);
            }
            case 'b': {
                if (Math.abs(dr) !== Math.abs(dc)) return false;
                return isPathClear(board, fr, fc, tr, tc);
            }
            case 'q': {
                if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return false;
                return isPathClear(board, fr, fc, tr, tc);
            }
            case 'k': {
                return Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
            }
        }
        return false;
    }

    function isPathClear(board, fr, fc, tr, tc) {
        const stepR = Math.sign(tr - fr);
        const stepC = Math.sign(tc - fc);

        let r = fr + stepR;
        let c = fc + stepC;

        while (r !== tr || c !== tc) {
            if (board[r][c]) return false;
            r += stepR;
            c += stepC;
        }
        return true;
    }

    function isKingInCheck(board, color) {
        const colorChar = color[0];
        let kr = -1, kc = -1;
        const targetKing = colorChar === 'w' ? 'wk' : 'bk';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c] === targetKing) {
                    kr = r;
                    kc = c;
                    break;
                }
            }
            if (kr !== -1) break;
        }
        
        if (kr === -1) return false;
        
        const oppColor = colorChar === 'w' ? 'b' : 'w';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece && piece.startsWith(oppColor)) {
                    if (isValidMove(board, r, c, kr, kc)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function hasLegalMoves(board, color) {
        const colorChar = color[0];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece && piece.startsWith(colorChar)) {
                    for (let tr = 0; tr < 8; tr++) {
                        for (let tc = 0; tc < 8; tc++) {
                            if (isValidMove(board, r, c, tr, tc)) {
                                const tempBoard = board.map(row => [...row]);
                                tempBoard[tr][tc] = tempBoard[r][c];
                                tempBoard[r][c] = null;
                                if (!isKingInCheck(tempBoard, colorChar)) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
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
                // Keep duration low (2s) to prevent lock-ups if server process gets blocked
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
                winner: g.winner,
                moderation: g.moderation
            }));
        res.json(roomList);
    });

    // Join Game
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);
        roomModeration.ensureModeration(game);

        // Resolve existing user
        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'white', game });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'black', game });
            }
        } else {
            if (role === 'white' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'white', game });
            }
            if (role === 'black' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'black', game });
            }
        }

        let assignedRole = null;

        if (role === 'white') {
            if (game.player1) return res.status(400).json({ error: "White slot already taken." });
            game.player1 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'white';
        } else if (role === 'black') {
            if (game.player2) return res.status(400).json({ error: "Black slot already taken." });
            game.player2 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'black';
        } else {
            // Auto assign
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'white';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'black';
            } else {
                return res.status(400).json({ error: "Game is full." });
            }
        }

        const targetPlayer = assignedRole === 'white' ? game.player1 : game.player2;
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

    // Reset Game
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            endToyControl(gameId, true);
            clearLovenseMatchState(game.player1);
            clearLovenseMatchState(game.player2);
            game.board = createInitialBoard();
            game.turn = 'white';
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            game.winner = null;
            game.history = [];
            game.captured = { white: [], black: [] };
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Make Chess Move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, role, uuid, fromRow, fromCol, toRow, toCol } = req.body;
        const game = games[gameId];

        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game is not active." });

        let activeRole = role;
        if (uuid) {
            if (game.player1 && game.player1.uuid === uuid && game.player2 && game.player2.uuid === uuid) {
                activeRole = game.turn; // Solo test support
            } else if (game.player1 && game.player1.uuid === uuid) {
                activeRole = 'white';
            } else if (game.player2 && game.player2.uuid === uuid) {
                activeRole = 'black';
            } else {
                return res.status(400).json({ error: "You are not a registered player." });
            }
        }

        if (game.turn !== activeRole) {
            return res.status(400).json({ error: "Not your turn." });
        }

        const fr = parseInt(fromRow);
        const fc = parseInt(fromCol);
        const tr = parseInt(toRow);
        const tc = parseInt(toCol);

        if (isNaN(fr) || isNaN(fc) || isNaN(tr) || isNaN(tc) ||
            fr < 0 || fr > 7 || fc < 0 || fc > 7 || tr < 0 || tr > 7 || tc < 0 || tc > 7) {
            return res.status(400).json({ error: "Invalid coordinate bounds." });
        }

        const piece = game.board[fr][fc];
        if (!piece) {
            return res.status(400).json({ error: "No piece at source square." });
        }

        // Basic verification: Piece color matching player turn
        const isWhitePiece = piece.startsWith('w');
        if ((activeRole === 'white' && !isWhitePiece) || (activeRole === 'black' && isWhitePiece)) {
            return res.status(400).json({ error: "That piece does not belong to you." });
        }

        // Strict move verification
        if (!isValidMove(game.board, fr, fc, tr, tc)) {
            return res.status(400).json({ error: "Invalid chess move." });
        }

        // Simulate move to ensure King is not left in check (Check evasion validation)
        const tempBoardForCheck = game.board.map(row => [...row]);
        tempBoardForCheck[tr][tc] = piece;
        tempBoardForCheck[fr][fc] = null;
        if (isKingInCheck(tempBoardForCheck, activeRole)) {
            return res.status(400).json({ error: "Move leaves King in check." });
        }

        // Make the move
        const targetPiece = game.board[tr][tc];
        game.board[tr][tc] = piece;
        game.board[fr][fc] = null;

        // Auto pawn promotion to Queen
        if (piece === 'wp' && tr === 0) {
            game.board[tr][tc] = 'wq';
        } else if (piece === 'bp' && tr === 7) {
            game.board[tr][tc] = 'bq';
        }

        // Track captured pieces
        if (targetPiece) {
            if (!game.captured) game.captured = { white: [], black: [] };
            if (targetPiece.startsWith('w')) {
                game.captured.white.push(targetPiece);
            } else if (targetPiece.startsWith('b')) {
                game.captured.black.push(targetPiece);
            }
        }

        // Turn management
        game.turn = activeRole === 'white' ? 'black' : 'white';

        // Check for Check, Checkmate, and Stalemate
        const oppColor = game.turn;
        const oppHasMoves = hasLegalMoves(game.board, oppColor);
        const oppInCheck = isKingInCheck(game.board, oppColor);
        const vibeQueue = [];
        const vibeMode = game.vibeMode || 'fun';
        const isCapture = targetPiece !== null;

        game.checkState = oppInCheck ? oppColor : null;

        if (oppInCheck && !oppHasMoves) {
            // Checkmate!
            game.status = 'won';
            game.winner = activeRole;
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: game.winner === 'white' ? 'win' : 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: game.winner === 'black' ? 'win' : 'lose' });

            // Setup Toy Control phase
            if (!game.isCpuMatch) {
                const winnerPlayer = game.winner === 'white' ? game.player1 : game.player2;
                const loserPlayer = game.winner === 'white' ? game.player2 : game.player1;
                const durationSec = (game.vibeMode === 'normal') ? 60 : 120;

                if (isToyActive(loserPlayer)) {
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
                if (game.winner === 'white') {
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
        } else if (!oppInCheck && !oppHasMoves) {
            // Stalemate (Draw)
            game.status = 'draw';
            game.winner = null;
        } else {
            // Normal game move/capture/check vibrations
            const activePlayer = activeRole === 'white' ? game.player1 : game.player2;
            const targetPlayer = activeRole === 'white' ? game.player2 : game.player1;

            if (oppInCheck) {
                if (targetPlayer) vibeQueue.push({ uuid: targetPlayer.uuid, type: 'threat' });
                if (activePlayer) vibeQueue.push({ uuid: activePlayer.uuid, type: 'move' });
            } else if (isCapture) {
                if (vibeMode === 'fun') {
                    if (activePlayer) vibeQueue.push({ uuid: activePlayer.uuid, type: 'win', options: { strength: 16, duration: 1 } });
                    if (targetPlayer) vibeQueue.push({ uuid: targetPlayer.uuid, type: 'lose', options: { strength: 18, duration: 2 } });
                } else {
                    if (activePlayer) vibeQueue.push({ uuid: activePlayer.uuid, type: 'move', options: { strength: 12, duration: 1 } });
                    if (targetPlayer) vibeQueue.push({ uuid: targetPlayer.uuid, type: 'turn_alert', options: { strength: 10, duration: 1 } });
                }
            } else {
                if (activePlayer) vibeQueue.push({ uuid: activePlayer.uuid, type: 'move' });
                if (targetPlayer) vibeQueue.push({ uuid: targetPlayer.uuid, type: 'turn_alert' });
            }
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });

        // Trigger vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) {
                const options = item.options ? { ...item.options } : {};
                lovenseHelper.triggerVibration(item.uuid, item.type, options);
            }
        });

        // If CPU match and turn shifts to CPU (Black)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === 'black') {
            cpuAi.makeMove('chess', game, gameIo);
            
            // Check if CPU won after it makes its move
            setTimeout(() => {
                const updatedGame = games[gameId];
                if (updatedGame && updatedGame.status === 'won' && updatedGame.winner === 'black') {
                    if (updatedGame.player1) {
                        const durationSec = (updatedGame.vibeMode === 'normal') ? 60 : 120;
                        updatedGame.toyControl = {
                            active: true,
                            controllerUuid: 'cpu-bot',
                            controllerName: 'CyberBot 🤖',
                            targetUuid: updatedGame.player1.uuid,
                            targetName: updatedGame.player1.name,
                            durationSec: durationSec,
                            endTime: Date.now() + durationSec * 1000,
                            currentStrength: 5,
                            currentPattern: 'constant'
                        };
                        startToyControl(gameId);
                        gameIo.to(gameId).emit('update', updatedGame);
                    }
                }
            }, 1500);
        }

        res.json({ success: true, game });
    });

    // Join CPU API
    app.post(`${mountPath}/api/join-cpu`, (req, res) => {
        const { gameId, uuid, name } = req.body;
        const game = getGame(gameId);
        roomModeration.ensureModeration(game);
        game.lastActive = Date.now();

        game.player1 = { uuid, name, connected: false, toyEnabled: false, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 'white';
        game.board = createInitialBoard();
        game.winner = null;
        game.history = [];

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
        res.json({ success: true, role: 'white', game });
    });

    // Set CPU Difficulty API
    app.post(`${mountPath}/api/set-difficulty`, (req, res) => {
        const { gameId, difficulty } = req.body;
        const game = games[gameId];
        if (game) {
            roomModeration.ensureModeration(game);
            game.difficulty = difficulty || 'medium';
            game.status = 'playing';
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Debug Toy Control Test API
    app.post(`${mountPath}/api/debug/toy-control-test`, (req, res) => {
        const { gameId, uuid, result } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        roomModeration.ensureModeration(game);

        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: "Must be in the game to test." });

        const opponent = (player === game.player1) ? game.player2 : game.player1;
        const hasHumanOpponent = !!(opponent && opponent.uuid && opponent.uuid !== 'cpu-bot');
        const opponentHasToy = isToyActive(opponent);
        const selfHasToy = isToyActive(player);

        game.status = 'won';

        const durationSec = (game.vibeMode === 'normal') ? 60 : 120;

        const targetPlayer = (result === 'lose') ? player : opponent;
        const targetHasToy = targetPlayer ? isToyActive(targetPlayer) : false;

        if (hasHumanOpponent) {
            if (result === 'lose') {
                game.winner = (player === game.player1) ? 'black' : 'white';
            } else {
                game.winner = (player === game.player1) ? 'white' : 'black';
            }

            if (targetHasToy) {
                game.toyControl = {
                    active: true,
                    controllerUuid: (result === 'lose') ? opponent.uuid : player.uuid,
                    controllerName: (result === 'lose') ? opponent.name : player.name,
                    targetUuid: targetPlayer.uuid,
                    targetName: targetPlayer.name,
                    durationSec: durationSec,
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
                game.winner = (player === game.player1) ? 'black' : 'white';
                if (selfHasToy) {
                    game.toyControl = {
                        active: true,
                        controllerUuid: 'cpu-bot',
                        controllerName: 'CyberBot 🤖',
                        targetUuid: player.uuid,
                        targetName: player.name,
                        durationSec: durationSec,
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
                game.winner = (player === game.player1) ? 'white' : 'black';
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
        roomModeration.ensureModeration(game);
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
        roomModeration.ensureModeration(game);
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

    // Manual local disconnect from this game (stops all game-triggered vibrations)
    app.post(`${mountPath}/api/vibe/disconnect`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        roomModeration.ensureModeration(game);
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: "Player not registered." });

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

    // Toggle Vibe Mode API
    app.post(`${mountPath}/api/toggle-vibe-mode`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            roomModeration.ensureModeration(game);
            game.vibeMode = game.vibeMode === 'normal' ? 'fun' : 'normal';
            gameIo.to(gameId).emit('update', game);
            res.json({ success: true, vibeMode: game.vibeMode });
        } else {
            res.status(404).json({ error: "Game not found." });
        }
    });

    // Leave Game / Exit Match
    app.post(`${mountPath}/api/leave`, (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (game) {
            roomModeration.ensureModeration(game);
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
                gameIo.to(gameId).emit('update', game);
            }
        }
        res.json({ success: true });
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
                    console.log(`Cleaning up inactive Chess game room (0 sockets): ${gameId}`);
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
            socket.emit('update', game);
        });

        socket.on('control_toy', (data) => {
            const { gameId, strength, pattern } = data;
            const game = games[gameId];
            if (game && game.toyControl && game.toyControl.active) {
                if (game.toyControl.controllerUuid === playerUuid) {
                    game.toyControl.currentStrength = Math.min(20, Math.max(0, parseInt(strength) || 0));
                    game.toyControl.currentPattern = pattern || 'constant';
                }
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
                const forwarded = roomModeration.handleVoiceSignal({ socket, gameId: currentRoom, games, playerUuid, data });
                if (forwarded) socket.to(currentRoom).emit('voice_signal', forwarded);
            }
        });

        socket.on('chat_message', (data) => {
            if (currentRoom) {
                const message = roomModeration.handleChatMessage({ socket, gameId: currentRoom, games, playerUuid, data });
                if (message) gameIo.to(currentRoom).emit('chat_message', message);
            }
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
        winner: game.winner,
        moderation: game.moderation
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
        console.log(`Chess Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

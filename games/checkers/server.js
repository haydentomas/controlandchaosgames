// server.js (Multiplayer Checkers Game Module)
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
    lovenseHelper.registerModule('checkers', games, gameIo);

    // Standard Checkers Initial setup
    // 1 = Red, 2 = Red King
    // -1 = Black, -2 = Black King
    // 0 = Empty
    function createInitialBoard() {
        const board = [];
        for (let r = 0; r < 8; r++) {
            const row = [];
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) {
                    if (r < 3) row.push(-1);
                    else if (r > 4) row.push(1);
                    else row.push(0);
                } else {
                    row.push(0);
                }
            }
            board.push(row);
        }
        return board;
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                board: createInitialBoard(),
                turn: 1,
                status: 'waiting',
                winner: 0,
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

    function clearLovenseMatchState(player) {
        if (!player) return;
        player.connected = false;
        player.toyEnabled = false;
    }

    function isToyActive(player) {
        return player && player.connected && player.toyEnabled && player.uuid && !player.uuid.startsWith('cpu-') && !player.uuid.startsWith('browser_');
    }

    function countPieces(board) {
        let red = 0;
        let black = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c] > 0) red++;
                else if (board[r][c] < 0) black++;
            }
        }
        return { red, black };
    }

    function hasAnyLegalMove(board, playerVal) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece === 0) continue;
                if ((playerVal === 1 && piece < 0) || (playerVal === -1 && piece > 0)) continue;

                const isKing = Math.abs(piece) === 2;
                const dirs = [];
                if (isKing || playerVal === 1) dirs.push([-1, -1], [-1, 1]);
                if (isKing || playerVal === -1) dirs.push([1, -1], [1, 1]);

                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === 0) {
                        return true;
                    }

                    const jr = r + dr * 2;
                    const jc = c + dc * 2;
                    if (jr < 0 || jr > 7 || jc < 0 || jc > 7) continue;
                    const mid = board[nr][nc];
                    if (mid === 0) continue;

                    const isOpponentMid = (playerVal === 1 && mid < 0) || (playerVal === -1 && mid > 0);
                    if (isOpponentMid && board[jr][jc] === 0) {
                        return true;
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

    app.get(`${mountPath}/board/:gameId`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

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

    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: 'Missing parameters.' });
        }

        const game = getGame(gameId);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) return res.json({ success: true, role: 'red', game });
            if (game.player2 && game.player2.uuid === uuid) return res.json({ success: true, role: 'black', game });
        } else {
            if (role === 'red' && game.player1 && game.player1.uuid === uuid) return res.json({ success: true, role: 'red', game });
            if (role === 'black' && game.player2 && game.player2.uuid === uuid) return res.json({ success: true, role: 'black', game });
        }

        let assignedRole = null;
        if (role === 'red') {
            if (game.player1) return res.status(400).json({ error: 'Red slot already taken.' });
            game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'red';
        } else if (role === 'black') {
            if (game.player2) return res.status(400).json({ error: 'Black slot already taken.' });
            game.player2 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'black';
        } else if (!game.player1) {
            game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'red';
        } else if (!game.player2) {
            game.player2 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'black';
        } else {
            return res.status(400).json({ error: 'Game is full.' });
        }

        if (!uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
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

        if (game.player1 && game.player2) game.status = 'playing';

        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, role: assignedRole, game });
    });

    app.post(`${mountPath}/api/join-cpu`, (req, res) => {
        const { gameId, uuid, name } = req.body;
        const game = getGame(gameId);
        game.lastActive = Date.now();

        game.player1 = { uuid, name, connected: false, toyEnabled: true, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        game.board = createInitialBoard();
        game.winner = 0;
        game.toyControl = null;

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
        const durationSec = (game.vibeMode === 'normal') ? 60 : 120;

        const targetPlayer = (result === 'lose') ? player : opponent;
        const targetHasToy = targetPlayer ? isToyActive(targetPlayer) : false;

        if (hasHumanOpponent) {
            if (result === 'lose') {
                game.winner = (player === game.player1) ? -1 : 1;
            } else {
                game.winner = (player === game.player1) ? 1 : -1;
            }

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
                game.winner = (player === game.player1) ? -1 : 1;
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
                game.winner = (player === game.player1) ? 1 : -1;
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

    app.post(`${mountPath}/api/vibe/test`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: 'Player not registered.' });
        await lovenseHelper.triggerVibration(player.uuid, 'move');
        res.json({ success: true });
    });

    app.post(`${mountPath}/api/vibe/verify`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: 'Game not found.' });
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: 'Player not registered.' });

        const result = await lovenseHelper.verifyConnection(player.uuid);
        if (result.success) {
            player.connected = true;
            player.toyEnabled = true;
            await lovenseHelper.triggerVibration(player.uuid, 'move');
            gameIo.to(gameId).emit('update', game);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error || 'Verification failed.' });
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

    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            endToyControl(gameId, true);
            clearLovenseMatchState(game.player1);
            clearLovenseMatchState(game.player2);
            game.board = createInitialBoard();
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            if (game.isCpuMatch) game.status = 'playing';
            game.winner = 0;
            game.toyControl = null;
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, role, uuid, fromRow, fromCol, toRow, toCol } = req.body;
        const game = games[gameId];

        if (!game) return res.status(404).json({ error: 'Game not found.' });
        if (game.status !== 'playing') return res.status(400).json({ error: 'Game is not active.' });

        let activeRole = role;
        if (uuid) {
            if (game.player1 && game.player1.uuid === uuid && game.player2 && game.player2.uuid === uuid) {
                activeRole = game.turn === 1 ? 'red' : 'black';
            } else if (game.player1 && game.player1.uuid === uuid) {
                activeRole = 'red';
            } else if (game.player2 && game.player2.uuid === uuid) {
                activeRole = 'black';
            } else {
                return res.status(400).json({ error: 'You are not a registered player.' });
            }
        }

        const playerVal = activeRole === 'red' ? 1 : -1;
        const expectedTurn = activeRole === 'red' ? 1 : -1;
        if (game.turn !== expectedTurn) return res.status(400).json({ error: 'Not your turn.' });

        const fr = parseInt(fromRow, 10);
        const fc = parseInt(fromCol, 10);
        const tr = parseInt(toRow, 10);
        const tc = parseInt(toCol, 10);

        if (isNaN(fr) || isNaN(fc) || isNaN(tr) || isNaN(tc) || fr < 0 || fr > 7 || fc < 0 || fc > 7 || tr < 0 || tr > 7 || tc < 0 || tc > 7) {
            return res.status(400).json({ error: 'Invalid coordinate bounds.' });
        }

        const piece = game.board[fr][fc];
        if (piece === 0) return res.status(400).json({ error: 'No piece at source square.' });
        if ((playerVal === 1 && piece < 0) || (playerVal === -1 && piece > 0)) {
            return res.status(400).json({ error: 'That piece does not belong to you.' });
        }
        if (game.board[tr][tc] !== 0) return res.status(400).json({ error: 'Target cell is not empty.' });

        const rowDiff = tr - fr;
        const colDiff = tc - fc;
        const absRowDiff = Math.abs(rowDiff);
        const absColDiff = Math.abs(colDiff);
        if (absRowDiff !== absColDiff) return res.status(400).json({ error: 'Moves must be diagonal.' });

        const isKing = Math.abs(piece) === 2;
        if (!isKing) {
            if (playerVal === 1 && rowDiff > 0) return res.status(400).json({ error: 'Normal Red piece cannot move backwards.' });
            if (playerVal === -1 && rowDiff < 0) return res.status(400).json({ error: 'Normal Black piece cannot move backwards.' });
        }

        let captured = false;
        let midRow = null;
        let midCol = null;
        if (absRowDiff === 1) {
            // Simple move
        } else if (absRowDiff === 2) {
            midRow = fr + (rowDiff / 2);
            midCol = fc + (colDiff / 2);
            const midPiece = game.board[midRow][midCol];
            if (midPiece !== 0 && ((playerVal === 1 && midPiece < 0) || (playerVal === -1 && midPiece > 0))) {
                captured = true;
            } else {
                return res.status(400).json({ error: 'Invalid jump. No opponent piece to capture.' });
            }
        } else {
            return res.status(400).json({ error: 'Move distance is too long.' });
        }

        let finalPiece = piece;
        if (playerVal === 1 && tr === 0 && piece === 1) finalPiece = 2;
        else if (playerVal === -1 && tr === 7 && piece === -1) finalPiece = -2;

        game.board[tr][tc] = finalPiece;
        game.board[fr][fc] = 0;
        if (captured) game.board[midRow][midCol] = 0;

        const counts = countPieces(game.board);
        const vibeQueue = [];

        if (counts.red === 0) {
            game.status = 'won';
            game.winner = -1;
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'win' });
        } else if (counts.black === 0) {
            game.status = 'won';
            game.winner = 1;
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'win' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'lose' });
        } else {
            game.turn = expectedTurn === 1 ? -1 : 1;

            if (!hasAnyLegalMove(game.board, game.turn)) {
                game.status = 'won';
                game.winner = expectedTurn;
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: game.winner === 1 ? 'win' : 'lose' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: game.winner === -1 ? 'win' : 'lose' });
            } else if (expectedTurn === 1) {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
            }
        }

        if (game.status === 'won') {
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
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });

        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
        });

        if (game.isCpuMatch && game.status === 'playing' && game.turn === -1) {
            cpuAi.makeMove('checkers', game, gameIo);

            setTimeout(() => {
                const updatedGame = games[gameId];
                if (!updatedGame || !updatedGame.player1 || updatedGame.toyControl) return;

                if (updatedGame.status === 'won' && updatedGame.winner === -1) {
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
                    console.log(`Cleaning up inactive Checkers game room (0 sockets): ${gameId}`);
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
        console.log(`Checkers Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

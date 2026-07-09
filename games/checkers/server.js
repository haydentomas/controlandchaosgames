// server.js (Multiplayer Checkers Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
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
                    if (r < 3) row.push(-1); // Black piece
                    else if (r > 4) row.push(1);  // Red piece
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
                player1: null, // Red (uuid, name)
                player2: null, // Black (uuid, name)
                board: createInitialBoard(),
                turn: 1, // Red starts (1)
                status: 'waiting', // waiting, playing, won, draw
                winner: 0
            };
        }
        return games[gameId];
    }

    function countPieces(board) {
        let red = 0, black = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c] > 0) red++;
                else if (board[r][c] < 0) black++;
            }
        }
        return { red, black };
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

    // Leave Game / Exit Match
    app.post(`${mountPath}/api/leave`, (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (game) {
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
                    console.log(`Cleaning up inactive Checkers game room (0 sockets): ${gameId}`);
                    delete games[gameId];
                }
            } else {
                delete game.emptySince;
            }
        });
    }, 60000);

    // Join Game
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'red', game });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'black', game });
            }
        } else {
            if (role === 'red' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'red', game });
            }
            if (role === 'black' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'black', game });
            }
        }

        let assignedRole = null;

        if (role === 'red') {
            if (game.player1) return res.status(400).json({ error: "Red slot already taken." });
            game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'red';
        } else if (role === 'black') {
            if (game.player2) return res.status(400).json({ error: "Black slot already taken." });
            game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'black';
        } else {
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'red';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'black';
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

        game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        game.board = createInitialBoard();
        game.winner = 0;

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
            gameIo.to(gameId).emit('update', game);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error || "Verification failed." });
        }
    });

    // Reset Game
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            game.board = createInitialBoard();
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            if (game.isCpuMatch) {
                game.status = 'playing';
            }
            game.winner = 0;
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Move checker
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, role, uuid, fromRow, fromCol, toRow, toCol } = req.body;
        const game = games[gameId];

        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game is not active." });

        let activeRole = role;
        if (uuid) {
            if (game.player1 && game.player1.uuid === uuid && game.player2 && game.player2.uuid === uuid) {
                activeRole = game.turn === 1 ? 'red' : 'black';
            } else if (game.player1 && game.player1.uuid === uuid) {
                activeRole = 'red';
            } else if (game.player2 && game.player2.uuid === uuid) {
                activeRole = 'black';
            } else {
                return res.status(400).json({ error: "You are not a registered player." });
            }
        }

        const playerVal = activeRole === 'red' ? 1 : -1;
        const expectedTurn = activeRole === 'red' ? 1 : -1;
        if (game.turn !== expectedTurn) return res.status(400).json({ error: "Not your turn." });

        const fr = parseInt(fromRow);
        const fc = parseInt(fromCol);
        const tr = parseInt(toRow);
        const tc = parseInt(toCol);

        if (isNaN(fr) || isNaN(fc) || isNaN(tr) || isNaN(tc) ||
            fr < 0 || fr > 7 || fc < 0 || fc > 7 || tr < 0 || tr > 7 || tc < 0 || tc > 7) {
            return res.status(400).json({ error: "Invalid coordinate bounds." });
        }

        const piece = game.board[fr][fc];
        if (piece === 0) {
            return res.status(400).json({ error: "No piece at source square." });
        }

        // Color check
        if ((playerVal === 1 && piece < 0) || (playerVal === -1 && piece > 0)) {
            return res.status(400).json({ error: "That piece does not belong to you." });
        }

        if (game.board[tr][tc] !== 0) {
            return res.status(400).json({ error: "Target cell is not empty." });
        }

        const rowDiff = tr - fr;
        const colDiff = tc - fc;
        const absRowDiff = Math.abs(rowDiff);
        const absColDiff = Math.abs(colDiff);

        if (absRowDiff !== absColDiff) {
            return res.status(400).json({ error: "Moves must be diagonal." });
        }

        const isKing = Math.abs(piece) === 2;

        // Normal pieces can only move forward
        if (!isKing) {
            if (playerVal === 1 && rowDiff > 0) return res.status(400).json({ error: "Normal Red piece cannot move backwards." });
            if (playerVal === -1 && rowDiff < 0) return res.status(400).json({ error: "Normal Black piece cannot move backwards." });
        }

        let isMoveValid = false;
        let captured = false;
        let midRow = null;
        let midCol = null;

        if (absRowDiff === 1) {
            // Simple Move
            isMoveValid = true;
        } else if (absRowDiff === 2) {
            // Jump Capture
            midRow = fr + (rowDiff / 2);
            midCol = fc + (colDiff / 2);
            const midPiece = game.board[midRow][midCol];
            
            // Mid piece must belong to opponent
            if (midPiece !== 0 && ((playerVal === 1 && midPiece < 0) || (playerVal === -1 && midPiece > 0))) {
                isMoveValid = true;
                captured = true;
            } else {
                return res.status(400).json({ error: "Invalid jump. No opponent piece to capture." });
            }
        } else {
            return res.status(400).json({ error: "Move distance is too long." });
        }

        if (!isMoveValid) {
            return res.status(400).json({ error: "Invalid move." });
        }

        // Execute Move
        let finalPiece = piece;

        // King promotion
        if (playerVal === 1 && tr === 0 && piece === 1) {
            finalPiece = 2; // Red King
        } else if (playerVal === -1 && tr === 7 && piece === -1) {
            finalPiece = -2; // Black King
        }

        game.board[tr][tc] = finalPiece;
        game.board[fr][fc] = 0;

        if (captured) {
            game.board[midRow][midCol] = 0;
        }

        // Verify remaining pieces to check win
        const counts = countPieces(game.board);
        const vibeQueue = [];

        if (counts.red === 0) {
            game.status = 'won';
            game.winner = -1; // Black wins
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'win' });
        } else if (counts.black === 0) {
            game.status = 'won';
            game.winner = 1; // Red wins
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'win' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'lose' });
        } else {
            // Switch Turn
            game.turn = expectedTurn === 1 ? -1 : 1;
            // standard turns
            if (expectedTurn === 1) {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
            }
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });

        // Trigger player vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
        });

        // If CPU match and turn shifts to CPU (Black / -1)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === -1) {
            cpuAi.makeMove('checkers', game, gameIo);
        }
        res.json({ success: true, game });
    });

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
    module.exports = { init };
}

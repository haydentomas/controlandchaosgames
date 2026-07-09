// server.js (Simple Multiplayer Chess Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('chess', games, gameIo);

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
                history: []
            };
        }
        return games[gameId];
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

    // Join Game
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);

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
            game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'white';
        } else if (role === 'black') {
            if (game.player2) return res.status(400).json({ error: "Black slot already taken." });
            game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'black';
        } else {
            // Auto assign
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'white';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
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
            game.board = createInitialBoard();
            game.turn = 'white';
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            game.winner = null;
            game.history = [];
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

        // Make the move
        const targetPiece = game.board[tr][tc];
        game.board[tr][tc] = piece;
        game.board[fr][fc] = null;

        // Turn management
        game.turn = activeRole === 'white' ? 'black' : 'white';

        // Check if King was captured (simple win condition for arcade quick play)
        const vibeQueue = [];
        if (targetPiece && targetPiece.endsWith('k')) {
            game.status = 'won';
            game.winner = activeRole;
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: game.winner === 'white' ? 'win' : 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: game.winner === 'black' ? 'win' : 'lose' });
        } else {
            // Queue turn vibrations
            if (activeRole === 'white') {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
            }
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });

        // Trigger vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
        });

        // If CPU match and turn shifts to CPU (Black)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === 'black') {
            cpuAi.makeMove('chess', game, gameIo);
        }
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
        console.log(`Chess Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

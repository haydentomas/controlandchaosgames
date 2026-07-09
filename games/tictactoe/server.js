// server.js (Multiplayer Tic Tac Toe Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
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
                winCoords: []
            };
        }
        return games[gameId];
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
                return res.json({ success: true, role: 'X', game });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'O', game });
            }
        } else {
            if (role === 'X' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: 'X', game });
            }
            if (role === 'O' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: 'O', game });
            }
        }

        let assignedRole = null;

        if (role === 'X') {
            if (game.player1) return res.status(400).json({ error: "X slot already taken." });
            game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'X';
        } else if (role === 'O') {
            if (game.player2) return res.status(400).json({ error: "O slot already taken." });
            game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'O';
        } else {
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'X';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
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

        game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        game.board = createEmptyBoard(3);
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

    // Reset Game (Accepts new board size option)
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId, size, uuid } = req.body;
        const game = games[gameId];
        
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
            winCoords: []
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
            const game = getGame(gameId, 3);
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
        console.log(`Tic Tac Toe Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

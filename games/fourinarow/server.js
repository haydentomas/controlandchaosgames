// server.js (Simple Connect 4)
const express = require('express');
const path = require('path');

// Wrap everything in an init function to mount it dynamically
function init(app, io, mountPath = '') {
    // Static files handled by parent server, but we can also register it here:
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    // Game Store (In-Memory)
    const games = {};

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
            game.player1 = { uuid, name };
            assignedRole = 'red';
        } else if (role === 'yellow') {
            if (game.player2) return res.status(400).json({ error: "Yellow slot already taken." });
            game.player2 = { uuid, name };
            assignedRole = 'yellow';
        } else {
            // Auto assign
            if (!game.player1) {
                game.player1 = { uuid, name };
                assignedRole = 'red';
            } else if (!game.player2) {
                game.player2 = { uuid, name };
                assignedRole = 'yellow';
            } else {
                return res.status(400).json({ error: "Game is full." });
            }
        }

        if (game.player1 && game.player2) {
            game.status = 'playing';
        }

        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, role: assignedRole, game });
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
            game.lastActive = Date.now();
            game.board = createEmptyBoard();
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
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
        if (winResult) {
            game.status = 'won';
            game.winner = winResult.winner;
            game.winCoords = winResult.coords;
        } else if (checkDraw(game.board)) {
            game.status = 'draw';
        } else {
            game.turn = playerNum === 1 ? 2 : 1;
        }

        // Broadcast update
        gameIo.to(gameId).emit('update', { game, lastMove: { r, c, player: playerNum } });

        res.json({ success: true, game });
    });

    // Socket.io namespace configuration
    const gameIo = io.of(mountPath || '/');
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
    module.exports = { init };
}

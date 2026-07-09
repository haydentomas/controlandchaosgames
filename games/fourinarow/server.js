// server.js (Simple Connect 4)
const express = require('express');
const path = require('path');
const lovenseHelper = require('../lovense_helper.js');

// Wrap everything in an init function to mount it dynamically
function init(app, io, mountPath = '') {
    // Static files handled by parent server, but we can also register it here:
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('fourinarow', games, gameIo);

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
            game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'red';
        } else if (role === 'yellow') {
            if (game.player2) return res.status(400).json({ error: "Yellow slot already taken." });
            game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = 'yellow';
        } else {
            // Auto assign
            if (!game.player1) {
                game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
                assignedRole = 'red';
            } else if (!game.player2) {
                game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
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

        game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
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
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: "Player not registered." });
        await lovenseHelper.triggerVibration(player.uuid, 'move');
        res.json({ success: true });
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
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: game.winner === 1 ? 'win' : 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: game.winner === 2 ? 'win' : 'lose' });
        } else if (checkDraw(game.board)) {
            game.status = 'draw';
        } else {
            game.turn = playerNum === 1 ? 2 : 1;
            // Queue move vibration for current player, turn alert for opponent
            if (playerNum === 1) {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
            }
        }

        // Broadcast update
        gameIo.to(gameId).emit('update', { game, lastMove: { r, c, player: playerNum } });

        // Trigger player vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
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
                    } else if (checkDraw(game.board)) {
                        game.status = 'draw';
                    } else {
                        game.turn = 1;
                        if (game.player1) cpuVibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
                    }
                    gameIo.to(gameId).emit('update', { game, lastMove: { r: rCpu, c: cpuCol, player: 2 } });
                    cpuVibeQueue.forEach(item => {
                        if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
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

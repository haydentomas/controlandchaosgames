// server.js (Multiplayer Dots and Boxes Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('dotsandboxes', games, gameIo);

    function createEmptyBoard() {
        return {
            hLines: Array(5).fill(null).map(() => Array(4).fill(false)), // 5 rows of 4 horizontal lines
            vLines: Array(4).fill(null).map(() => Array(5).fill(false)), // 4 rows of 5 vertical lines
            boxes: Array(4).fill(null).map(() => Array(4).fill(0)), // 4x4 boxes claimed by (0: unclaimed, 1: P1, 2: P2)
            score1: 0,
            score2: 0
        };
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // X (uuid, name)
                player2: null, // O (uuid, name)
                board: createEmptyBoard(),
                turn: 1, // Player 1 starts
                status: 'waiting', // waiting, playing, won, abandoned
                winner: 0
            };
        }
        return games[gameId];
    }

    // Check if a box at (r, c) is completed
    function isBoxCompleted(board, r, c) {
        if (r < 0 || r >= 4 || c < 0 || c >= 4) return false;
        
        const top = board.hLines[r][c];
        const bottom = board.hLines[r+1][c];
        const left = board.vLines[r][c];
        const right = board.vLines[r][c+1];

        return top && bottom && left && right;
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

    // Matchmaking Join
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game });
            }
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game });
            }
            if (role === '2' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game });
            }
        }

        let assignedRole = null;
        if (!game.player1 && role !== '2') {
            game.player1 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = '1';
        } else if (!game.player2 && role !== '1') {
            game.player2 = { uuid, name, connected: false, qrCode: null, linkCode: null, qrError: null };
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
                        gameIo.to(gameId).emit('update', game);
                    }
                });
            }

            if (game.player1 && game.player2) {
                game.status = 'playing';
            }
            gameIo.to(gameId).emit('update', game);
            return res.json({ success: true, role: assignedRole, game });
        }

        res.json({ success: true, role: 'spectator', game });
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
        game.board = createEmptyBoard(); // Reset board
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
        res.json({ success: true, role: '1', game });
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

    // Reset Match
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            game.board = createEmptyBoard();
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            game.winner = 0;
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Draw line move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, type, r, c } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const row = parseInt(r);
        const col = parseInt(c);

        if (type !== 'H' && type !== 'V') return res.status(400).json({ error: "Invalid line type." });

        // Boundaries checks
        if (type === 'H') {
            if (row < 0 || row >= 5 || col < 0 || col >= 4) return res.status(400).json({ error: "Out of bounds." });
            if (game.board.hLines[row][col]) return res.status(400).json({ error: "Line already drawn." });
        } else {
            if (row < 0 || row >= 4 || col < 0 || col >= 5) return res.status(400).json({ error: "Out of bounds." });
            if (game.board.vLines[row][col]) return res.status(400).json({ error: "Line already drawn." });
        }

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot draw lines." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        // Draw line
        if (type === 'H') {
            game.board.hLines[row][col] = true;
        } else {
            game.board.vLines[row][col] = true;
        }

        // Check if any boxes completed
        let boxesCompleted = 0;
        const boxesToCheck = [];

        if (type === 'H') {
            // Check box above and box below
            if (row > 0) boxesToCheck.push([row-1, col]);
            if (row < 4) boxesToCheck.push([row, col]);
        } else {
            // Check box left and box right
            if (col > 0) boxesToCheck.push([row, col-1]);
            if (col < 4) boxesToCheck.push([row, col]);
        }

        boxesToCheck.forEach(([br, bc]) => {
            if (game.board.boxes[br][bc] === 0 && isBoxCompleted(game.board, br, bc)) {
                game.board.boxes[br][bc] = playerNum;
                boxesCompleted++;
                if (playerNum === 1) game.board.score1++;
                else game.board.score2++;
            }
        });

        const vibeQueue = [];

        // Toggle turn or grant extra turn
        if (boxesCompleted === 0) {
            game.turn = playerNum === 1 ? 2 : 1;
            // Turn shifted
            if (playerNum === 1) {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
            }
        } else {
            // Extra turn
            if (playerNum === 1) {
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
            } else {
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
            }
        }

        // Check if all 16 boxes claimed
        const totalClaimed = game.board.score1 + game.board.score2;
        if (totalClaimed === 16) {
            game.status = 'won';
            vibeQueue.length = 0; // Clear turn vibes on game over
            if (game.board.score1 > game.board.score2) {
                game.winner = 1;
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'win' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'lose' });
            } else if (game.board.score2 > game.board.score1) {
                game.winner = 2;
                if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'lose' });
                if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'win' });
            } else {
                game.winner = 3; // Draw
            }
        }

        gameIo.to(gameId).emit('update', game);

        // Trigger vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
        });

        // If CPU match and turn is CPU (2)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === 2) {
            cpuAi.makeMove('dotsandboxes', game, gameIo);
        }

        res.json({ success: true, game });
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
                    console.log(`Cleaning up inactive Dots & Boxes game room: ${gameId}`);
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
            if (currentRoom) socket.to(currentRoom).emit('voice_signal', data);
        });

        socket.on('chat_message', (data) => {
            if (currentRoom) gameIo.to(currentRoom).emit('chat_message', data);
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

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
        console.log(`Dots & Boxes Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

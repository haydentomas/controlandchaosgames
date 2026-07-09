// server.js (Multiplayer Reversi Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');

    function createEmptyBoard() {
        const board = Array(8).fill(null).map(() => Array(8).fill(0));
        // Reversi initial center tiles
        board[3][3] = 2; // O (Light/Blue)
        board[3][4] = 1; // X (Dark/Purple)
        board[4][3] = 1; // X (Dark/Purple)
        board[4][4] = 2; // O (Light/Blue)
        return board;
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

    const DIRS = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
    ];

    // Find all cells to flip if a token is placed at (r, c) by playerNum
    function getFlips(board, r, c, playerNum) {
        if (board[r][c] !== 0) return [];
        const opponent = playerNum === 1 ? 2 : 1;
        const flips = [];

        for (const [dr, dc] of DIRS) {
            let tr = r + dr;
            let tc = c + dc;
            const directionFlips = [];

            while (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && board[tr][tc] === opponent) {
                directionFlips.push([tr, tc]);
                tr += dr;
                tc += dc;
            }

            if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && board[tr][tc] === playerNum) {
                // Closed group found, capture it
                flips.push(...directionFlips);
            }
        }
        return flips;
    }

    // Check if player has any valid moves
    function hasValidMoves(board, playerNum) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (getFlips(board, r, c, playerNum).length > 0) return true;
            }
        }
        return false;
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
        if (!game.player1 && role !== 'O') {
            game.player1 = { uuid, name };
            assignedRole = 'X';
        } else if (!game.player2 && role !== 'X') {
            game.player2 = { uuid, name };
            assignedRole = 'O';
        }

        if (assignedRole) {
            if (game.player1 && game.player2) {
                game.status = 'playing';
            }
            gameIo.to(gameId).emit('update', game);
            return res.json({ success: true, role: assignedRole, game });
        }

        res.json({ success: true, role: 'spectator', game });
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

    // Place move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, row, col } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const r = parseInt(row);
        const c = parseInt(col);
        if (r < 0 || r >= 8 || c < 0 || c >= 8) {
            return res.status(400).json({ error: "Invalid board coordinate." });
        }

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot make moves." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const flips = getFlips(game.board, r, c, playerNum);
        if (flips.length === 0) {
            return res.status(400).json({ error: "Move must capture at least one opponent disc." });
        }

        // Place token and flip
        game.board[r][c] = playerNum;
        flips.forEach(([fr, fc]) => {
            game.board[fr][fc] = playerNum;
        });

        // Determine next turn
        const nextPlayer = playerNum === 1 ? 2 : 1;
        
        if (hasValidMoves(game.board, nextPlayer)) {
            game.turn = nextPlayer;
        } else if (hasValidMoves(game.board, playerNum)) {
            // Next player has no valid moves, current player goes again (turn skip!)
            game.turn = playerNum;
        } else {
            // Neither player has valid moves -> Game Over
            let p1Count = 0;
            let p2Count = 0;
            for (let tr = 0; tr < 8; tr++) {
                for (let tc = 0; tc < 8; tc++) {
                    if (game.board[tr][tc] === 1) p1Count++;
                    if (game.board[tr][tc] === 2) p2Count++;
                }
            }
            game.status = 'won';
            if (p1Count > p2Count) game.winner = 1;
            else if (p2Count > p1Count) game.winner = 2;
            else game.winner = 3; // Draw
        }

        gameIo.to(gameId).emit('update', game);
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
                    console.log(`Cleaning up inactive Reversi game room: ${gameId}`);
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
        console.log(`Reversi Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

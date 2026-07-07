// server.js (Multiplayer Tic Tac Toe Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};

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
            game.player1 = { uuid, name };
            assignedRole = 'X';
        } else if (role === 'O') {
            if (game.player2) return res.status(400).json({ error: "O slot already taken." });
            game.player2 = { uuid, name };
            assignedRole = 'O';
        } else {
            if (!game.player1) {
                game.player1 = { uuid, name };
                assignedRole = 'X';
            } else if (!game.player2) {
                game.player2 = { uuid, name };
                assignedRole = 'O';
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

    // Reset Game (Accepts new board size option)
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId, size } = req.body;
        const game = games[gameId];
        const newSize = size ? parseInt(size) : (game ? game.size : 3);
        
        const freshGame = {
            id: gameId,
            player1: game ? game.player1 : null,
            player2: game ? game.player2 : null,
            board: createEmptyBoard(newSize),
            size: newSize,
            turn: 1,
            status: game && game.player1 && game.player2 ? 'playing' : 'waiting',
            winner: 0,
            winCoords: []
        };

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
        
        if (winResult) {
            game.status = 'won';
            game.winner = winResult.winner;
            game.winCoords = winResult.coords;
        } else if (checkDraw(game.board, game.size)) {
            game.status = 'draw';
        } else {
            game.turn = playerNum === 1 ? 2 : 1;
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { r, c, player: playerNum } });
        res.json({ success: true, game });
    });

    const gameIo = io.of(mountPath || '/');
    gameIo.on('connection', (socket) => {
        socket.on('join_game', (gameId) => {
            socket.join(gameId);
            // Default load size 3
            const game = getGame(gameId, 3);
            socket.emit('update', game);
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

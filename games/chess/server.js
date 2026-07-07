// server.js (Simple Multiplayer Chess Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};

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
            game.player1 = { uuid, name };
            assignedRole = 'white';
        } else if (role === 'black') {
            if (game.player2) return res.status(400).json({ error: "Black slot already taken." });
            game.player2 = { uuid, name };
            assignedRole = 'black';
        } else {
            // Auto assign
            if (!game.player1) {
                game.player1 = { uuid, name };
                assignedRole = 'white';
            } else if (!game.player2) {
                game.player2 = { uuid, name };
                assignedRole = 'black';
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
        if (targetPiece && targetPiece.endsWith('k')) {
            game.status = 'won';
            game.winner = activeRole;
        }

        gameIo.to(gameId).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });
        res.json({ success: true, game });
    });

    const gameIo = io.of(mountPath || '/');
    gameIo.on('connection', (socket) => {
        socket.on('join_game', (gameId) => {
            socket.join(gameId);
            const game = getGame(gameId);
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
        console.log(`Chess Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

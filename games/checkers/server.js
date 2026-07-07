// server.js (Multiplayer Checkers Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};

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
            game.player1 = { uuid, name };
            assignedRole = 'red';
        } else if (role === 'black') {
            if (game.player2) return res.status(400).json({ error: "Black slot already taken." });
            game.player2 = { uuid, name };
            assignedRole = 'black';
        } else {
            if (!game.player1) {
                game.player1 = { uuid, name };
                assignedRole = 'red';
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
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
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
        if (counts.red === 0) {
            game.status = 'won';
            game.winner = -1; // Black wins
        } else if (counts.black === 0) {
            game.status = 'won';
            game.winner = 1; // Red wins
        } else {
            // Switch Turn
            game.turn = expectedTurn === 1 ? -1 : 1;
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
        console.log(`Checkers Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

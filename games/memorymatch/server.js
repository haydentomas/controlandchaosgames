// server.js (Multiplayer Memory Match Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');

    const EMOJIS = [
        '🤖', '👽', '👻', '👾', '🚀', '🛸', 
        '🌌', '🌠', '☄️', '🪐', '🔮', '🧬', 
        '⚡', '🔥', '💧', '💎', '👑', '🍀'
    ];

    function createShuffledBoard() {
        // Create 18 pairs = 36 cards
        const deck = [];
        EMOJIS.forEach(emoji => {
            deck.push(emoji);
            deck.push(emoji);
        });

        // Fisher-Yates Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        return deck.map((emoji, index) => ({
            id: index,
            emoji: emoji,
            state: 'down' // down, flipped, matched
        }));
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // P1 (uuid, name)
                player2: null, // P2 (uuid, name)
                board: createShuffledBoard(),
                flippedCards: [], // Indices of currently flipped cards on the active turn
                lockBoard: false, // Temporary lock during mismatch delays
                turn: 1, // Player 1 starts
                status: 'waiting', // waiting, playing, won, abandoned
                winner: 0,
                score1: 0,
                score2: 0
            };
        }
        return games[gameId];
    }

    // Sanitize game state for players (anti-cheat: hide unrevealed card values)
    function sanitizeGameState(game) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            score1: game.score1,
            score2: game.score2,
            turn: game.turn,
            status: game.status,
            winner: game.winner,
            lockBoard: game.lockBoard,
            board: game.board.map(card => ({
                id: card.id,
                state: card.state,
                // Only send the emoji if it is flipped or matched
                emoji: (card.state === 'flipped' || card.state === 'matched') ? card.emoji : null
            }))
        };
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
                gameIo.to(gameId).emit('update', sanitizeGameState(game));
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
                return res.json({ success: true, role: '1', game: sanitizeGameState(game) });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameState(game) });
            }
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameState(game) });
            }
            if (role === '2' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameState(game) });
            }
        }

        let assignedRole = null;
        if (!game.player1 && role !== '2') {
            game.player1 = { uuid, name };
            assignedRole = '1';
        } else if (!game.player2 && role !== '1') {
            game.player2 = { uuid, name };
            assignedRole = '2';
        }

        if (assignedRole) {
            if (game.player1 && game.player2) {
                game.status = 'playing';
            }
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
            return res.json({ success: true, role: assignedRole, game: sanitizeGameState(game) });
        }

        res.json({ success: true, role: 'spectator', game: sanitizeGameState(game) });
    });

    // Reset Match
    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            game.board = createShuffledBoard();
            game.flippedCards = [];
            game.lockBoard = false;
            game.turn = 1;
            game.status = game.player1 && game.player2 ? 'playing' : 'waiting';
            game.winner = 0;
            game.score1 = 0;
            game.score2 = 0;
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
        }
        res.json({ success: true, game: sanitizeGameState(game) });
    });

    // Flip card move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, cardIndex } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });
        if (game.lockBoard) return res.status(400).json({ error: "Waiting for cards to flip back." });

        const idx = parseInt(cardIndex);
        if (isNaN(idx) || idx < 0 || idx >= 36) {
            return res.status(400).json({ error: "Invalid card coordinate." });
        }

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot flip cards." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const card = game.board[idx];
        if (card.state !== 'down') {
            return res.status(400).json({ error: "Card is already face up." });
        }

        // Reveal card
        card.state = 'flipped';
        game.flippedCards.push(idx);

        if (game.flippedCards.length === 1) {
            // First card flipped
            gameIo.to(gameId).emit('update', sanitizeGameState(game));
            return res.json({ success: true, game: sanitizeGameState(game) });
        }

        if (game.flippedCards.length === 2) {
            const idx1 = game.flippedCards[0];
            const idx2 = game.flippedCards[1];
            const card1 = game.board[idx1];
            const card2 = game.board[idx2];

            if (card1.emoji === card2.emoji) {
                // Match!
                card1.state = 'matched';
                card2.state = 'matched';
                game.flippedCards = [];
                
                if (playerNum === 1) game.score1++;
                else game.score2++;

                // Check if all 18 pairs are matched
                const matchedCount = game.board.filter(c => c.state === 'matched').length;
                if (matchedCount === 36) {
                    game.status = 'won';
                    if (game.score1 > game.score2) game.winner = 1;
                    else if (game.score2 > game.score1) game.winner = 2;
                    else game.winner = 3; // Draw
                }

                // Player gets another turn
                gameIo.to(gameId).emit('update', sanitizeGameState(game));
                return res.json({ success: true, game: sanitizeGameState(game) });
            } else {
                // Mismatch! Lock and delay
                game.lockBoard = true;
                gameIo.to(gameId).emit('update', sanitizeGameState(game));

                setTimeout(() => {
                    // Turn cards back down
                    card1.state = 'down';
                    card2.state = 'down';
                    game.flippedCards = [];
                    game.lockBoard = false;

                    // Pass turn to other player
                    game.turn = playerNum === 1 ? 2 : 1;

                    gameIo.to(gameId).emit('update', sanitizeGameState(game));
                }, 1500);

                return res.json({ success: true, game: sanitizeGameState(game) });
            }
        }
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
                    console.log(`Cleaning up inactive Memory Match room: ${gameId}`);
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
            socket.emit('update', sanitizeGameState(game));
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
                        gameIo.to(currentRoom).emit('update', sanitizeGameState(game));
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
        console.log(`Memory Match Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

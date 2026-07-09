const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer Go Fish Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');

    const SUITS = ['S', 'H', 'D', 'C'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    function createFreshDeck() {
        const deck = [];
        SUITS.forEach(suit => {
            RANKS.forEach(rank => {
                deck.push({ suit, rank });
            });
        });
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    // Check for books (4 cards of same rank) and remove them
    function checkAndLayBooks(hand, booksList) {
        const counts = {};
        hand.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
        
        let foundBook = false;
        Object.keys(counts).forEach(rank => {
            if (counts[rank] === 4) {
                booksList.push(rank);
                // Remove cards from hand
                for (let i = hand.length - 1; i >= 0; i--) {
                    if (hand[i].rank === rank) hand.splice(i, 1);
                }
                foundBook = true;
            }
        });
        return foundBook;
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                deck: [],
                hand1: [],
                hand2: [],
                books1: [], // books laid by P1
                books2: [], // books laid by P2
                turn: 1, // P1 starts
                status: 'waiting', // waiting, playing, won, abandoned
                winner: 0,
                lastActionText: 'Game initialized.'
            };
        }
        return games[gameId];
    }

    function sanitizeGameState(game, playerRole) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            books1: game.books1,
            books2: game.books2,
            deckCount: game.deck.length,
            turn: game.turn,
            status: game.status,
            winner: game.winner,
            lastActionText: game.lastActionText,
            // Sanitize hand cards
            hand1: playerRole === '1' ? game.hand1 : game.hand1.map(() => ({ hidden: true })),
            hand2: playerRole === '2' ? game.hand2 : game.hand2.map(() => ({ hidden: true })),
            hand1Count: game.hand1.length,
            hand2Count: game.hand2.length
        };
    }

    function broadcastGameUpdate(game) {
        const roomSockets = gameIo.adapter.rooms.get(game.id);
        if (roomSockets) {
            for (const socketId of roomSockets) {
                const socket = gameIo.sockets.get(socketId);
                if (socket) {
                    const role = socket.playerRole || 'spectator';
                    socket.emit('update', sanitizeGameState(game, role));
        // If CPU match and turn shifts to CPU (Player 2 / Black / O)
        if (game.isCpuMatch && game.status === 'playing' && (game.turn === 2 || game.turn === 'black' || game.turn === 'O')) {
            cpuAi.makeMove('gofish', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
        }

                }
            }
        }
    }

    app.get(`${mountPath}/board/:gameId`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

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
                broadcastGameUpdate(game);
            }
        }
        res.json({ success: true });
    });

    // Join CPU API
    app.post(`${mountPath}/api/join-cpu`, (req, res) => {
        const { gameId, uuid, name } = req.body;
        const game = getGame(gameId);
        game.lastActive = Date.now();

        game.player1 = { uuid, name };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        
        // Reset boards for specific game needs
        if (typeof createEmptyBoard !== 'undefined') {
            game.board = createEmptyBoard(game.size || 3);
        }
        
        game.winner = 0;
        game.winCoords = [];

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

    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) return res.json({ success: true, role: '1', game: sanitizeGameState(game, '1') });
            if (game.player2 && game.player2.uuid === uuid) return res.json({ success: true, role: '2', game: sanitizeGameState(game, '2') });
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) return res.json({ success: true, role: '1', game: sanitizeGameState(game, '1') });
            if (role === '2' && game.player2 && game.player2.uuid === uuid) return res.json({ success: true, role: '2', game: sanitizeGameState(game, '2') });
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
                game.deck = createFreshDeck();
                game.hand1 = [];
                game.hand2 = [];
                game.books1 = [];
                game.books2 = [];
                for (let i = 0; i < 7; i++) {
                    game.hand1.push(game.deck.pop());
                    game.hand2.push(game.deck.pop());
                }
                game.status = 'playing';
                game.turn = 1;
                game.lastActionText = "Ocean deals complete. P1's turn to ask.";
            }
            broadcastGameUpdate(game);
            return res.json({ success: true, role: assignedRole, game: sanitizeGameState(game, assignedRole) });
        }

        res.json({ success: true, role: 'spectator', game: sanitizeGameState(game, 'spectator') });
    });

    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            if (game.player1 && game.player2) {
                game.deck = createFreshDeck();
                game.hand1 = [];
                game.hand2 = [];
                game.books1 = [];
                game.books2 = [];
                for (let i = 0; i < 7; i++) {
                    game.hand1.push(game.deck.pop());
                    game.hand2.push(game.deck.pop());
                }
                game.status = 'playing';
                game.turn = 1;
                game.lastActionText = "Ocean deals complete. P1's turn to ask.";
            } else {
                game.status = 'waiting';
            }
            game.winner = 0;
            broadcastGameUpdate(game);
        }
        res.json({ success: true });
    });

    // Make Go Fish Ask Move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, action, rank } = req.body; // action: ask
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot play." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const ownHand = playerNum === 1 ? game.hand1 : game.hand2;
        const oppHand = playerNum === 1 ? game.hand2 : game.hand1;
        const ownBooks = playerNum === 1 ? game.books1 : game.books2;

        if (action === 'ask') {
            // Validate player holds at least one card of the asked rank
            const holdsRank = ownHand.some(c => c.rank === rank);
            if (!holdsRank) {
                return res.status(400).json({ error: `You must hold at least one ${rank} to ask for it.` });
            }

            // Look for matching cards in opponent's hand
            const matches = oppHand.filter(c => c.rank === rank);
            
            if (matches.length > 0) {
                // Steal successful!
                // Remove from opponent
                for (let i = oppHand.length - 1; i >= 0; i--) {
                    if (oppHand[i].rank === rank) oppHand.splice(i, 1);
                }
                // Add to player
                ownHand.push(...matches);
                game.lastActionText = `Steal! Player ${playerNum} took ${matches.length} card(s) of rank ${rank} from opponent.`;

                // Check books
                checkAndLayBooks(ownHand, ownBooks);

                // Player retains turn because they successfully stole cards!
            } else {
                // Go Fish!
                game.lastActionText = `Go Fish! Opponent had no ${rank}s.`;
                
                if (game.deck.length > 0) {
                    const fishedCard = game.deck.pop();
                    ownHand.push(fishedCard);
                    
                    if (fishedCard.rank === rank) {
                        game.lastActionText += ` Lucky Fish! Player ${playerNum} drew a ${rank} from the Ocean.`;
                        checkAndLayBooks(ownHand, ownBooks);
                        // Retain turn on lucky draw
                    } else {
                        checkAndLayBooks(ownHand, ownBooks);
                        // Turn passes to opponent
                        game.turn = playerNum === 1 ? 2 : 1;
                    }
                } else {
                    // Ocean empty: just pass turn
                    game.turn = playerNum === 1 ? 2 : 1;
                }
            }

            // Handle empty hand scenarios (draw automatically from ocean if hand is empty)
            if (game.hand1.length === 0 && game.deck.length > 0) {
                game.hand1.push(game.deck.pop());
            }
            if (game.hand2.length === 0 && game.deck.length > 0) {
                game.hand2.push(game.deck.pop());
            }

            // Check final win condition
            const totalBooks = game.books1.length + game.books2.length;
            if (totalBooks === 13 || (game.hand1.length === 0 && game.hand2.length === 0 && game.deck.length === 0)) {
                game.status = 'won';
                if (game.books1.length > game.books2.length) game.winner = 1;
                else if (game.books2.length > game.books1.length) game.winner = 2;
                else game.winner = 3; // Tie
            }
        }

        broadcastGameUpdate(game);
        res.json({ success: true });
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
                    console.log(`Cleaning up inactive Go Fish room: ${gameId}`);
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
            let role = 'spectator';
            if (game.player1 && game.player1.uuid === uuid) role = '1';
            if (game.player2 && game.player2.uuid === uuid) role = '2';

            socket.playerRole = role;
            socket.emit('update', sanitizeGameState(game, role));
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
                        broadcastGameUpdate(game);
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
        console.log(`Go Fish Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

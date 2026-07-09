const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer Gin Rummy Game Module)
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

    // Deadwood Evaluator
    function getCardValue(rank) {
        if (['J', 'Q', 'K'].includes(rank)) return 10;
        if (rank === 'A') return 1;
        return parseInt(rank);
    }

    function calculateDeadwood(hand) {
        const rankValues = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
        
        // Find best sets and runs combination
        // Since it's a 10-card hand, we can find combinations using a backtracking search
        let minDeadwood = hand.reduce((sum, c) => sum + getCardValue(c.rank), 0);

        function checkMeld(cards) {
            if (cards.length < 3) return false;
            // Check Set (same rank)
            const sameRank = cards.every(c => c.rank === cards[0].rank);
            if (sameRank) return true;

            // Check Run (same suit, consecutive ranks)
            const sameSuit = cards.every(c => c.suit === cards[0].suit);
            if (sameSuit) {
                const sorted = cards.map(c => rankValues[c.rank]).sort((a,b) => a-b);
                let consecutive = true;
                for (let i = 0; i < sorted.length - 1; i++) {
                    if (sorted[i+1] - sorted[i] !== 1) {
                        consecutive = false;
                        break;
                    }
                }
                if (consecutive) return true;
            }
            return false;
        }

        // Backtracking search to group melds
        function findMelds(cardsLeft, currentDeadwood) {
            if (currentDeadwood < minDeadwood) {
                minDeadwood = currentDeadwood;
            }
            if (cardsLeft.length < 3) return;

            // Try to find all valid combinations of size 3, 4, etc.
            for (let i = 0; i < cardsLeft.length; i++) {
                for (let j = i + 1; j < cardsLeft.length; j++) {
                    for (let k = j + 1; k < cardsLeft.length; k++) {
                        const triple = [cardsLeft[i], cardsLeft[j], cardsLeft[k]];
                        if (checkMeld(triple)) {
                            // Valid meld, recurse with remaining cards
                            const remaining = cardsLeft.filter((c, idx) => idx !== i && idx !== j && idx !== k);
                            const tripleValue = triple.reduce((sum, c) => sum + getCardValue(c.rank), 0);
                            findMelds(remaining, currentDeadwood - tripleValue);
                        }
                        // Check quad (4 cards)
                        for (let l = k + 1; l < cardsLeft.length; l++) {
                            const quad = [cardsLeft[i], cardsLeft[j], cardsLeft[k], cardsLeft[l]];
                            if (checkMeld(quad)) {
                                const remaining = cardsLeft.filter((c, idx) => idx !== i && idx !== j && idx !== k && idx !== l);
                                const quadValue = quad.reduce((sum, c) => sum + getCardValue(c.rank), 0);
                                findMelds(remaining, currentDeadwood - quadValue);
                            }
                        }
                    }
                }
            }
        }

        findMelds(hand, minDeadwood);
        return minDeadwood;
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                score1: 0,
                score2: 0,
                deck: [],
                hand1: [],
                hand2: [],
                discardPile: [],
                turn: 1, // Player 1 starts
                turnPhase: 'draw', // draw or discard
                status: 'waiting',
                winner: 0,
                lastActionText: 'Game initialized.',
                deadwood1: 0,
                deadwood2: 0
            };
        }
        return games[gameId];
    }

    function startNewRound(game) {
        game.deck = createFreshDeck();
        game.hand1 = [];
        game.hand2 = [];
        for (let i = 0; i < 10; i++) {
            game.hand1.push(game.deck.pop());
            game.hand2.push(game.deck.pop());
        }
        game.discardPile = [game.deck.pop()];
        game.turnPhase = 'draw';
        game.turn = 1;
        game.deadwood1 = calculateDeadwood(game.hand1);
        game.deadwood2 = calculateDeadwood(game.hand2);
        game.lastActionText = "New round started. P1 to Draw.";
    }

    function sanitizeGameState(game, playerRole) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            score1: game.score1,
            score2: game.score2,
            discardTop: game.discardPile[game.discardPile.length - 1] || null,
            deckCount: game.deck.length,
            turn: game.turn,
            turnPhase: game.turnPhase,
            status: game.status,
            winner: game.winner,
            lastActionText: game.lastActionText,
            deadwood1: playerRole === '1' ? game.deadwood1 : 0,
            deadwood2: playerRole === '2' ? game.deadwood2 : 0,
            // Sanitize hand cards
            hand1: (playerRole === '1' || game.status === 'won') ? game.hand1 : game.hand1.map(() => ({ hidden: true })),
            hand2: (playerRole === '2' || game.status === 'won') ? game.hand2 : game.hand2.map(() => ({ hidden: true })),
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
            cpuAi.makeMove('ginrummy', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
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
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameState(game, '1') });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameState(game, '2') });
            }
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameState(game, '1') });
            }
            if (role === '2' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameState(game, '2') });
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
                game.score1 = 0;
                game.score2 = 0;
                startNewRound(game);
                game.status = 'playing';
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
            game.score1 = 0;
            game.score2 = 0;
            if (game.player1 && game.player2) {
                startNewRound(game);
                game.status = 'playing';
            } else {
                game.status = 'waiting';
            }
            game.winner = 0;
            broadcastGameUpdate(game);
        }
        res.json({ success: true });
    });

    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, action, cardIndex, source } = req.body; // action: draw, discard, knock
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot draw cards." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const hand = playerNum === 1 ? game.hand1 : game.hand2;

        if (action === 'draw') {
            if (game.turnPhase !== 'draw') return res.status(400).json({ error: "Draw phase already complete." });

            if (source === 'deck') {
                if (game.deck.length === 0) {
                    // Draw pile empty: declare draw
                    game.lastActionText = "Draw pile empty. Round ends in a tie.";
                    startNewRound(game);
                    broadcastGameUpdate(game);
                    return res.json({ success: true });
                }
                hand.push(game.deck.pop());
                game.lastActionText = `Player ${playerNum} draws from Deck.`;
            } else if (source === 'discard') {
                if (game.discardPile.length === 0) return res.status(400).json({ error: "Discard pile is empty." });
                hand.push(game.discardPile.pop());
                game.lastActionText = `Player ${playerNum} draws from Discards.`;
            }

            game.turnPhase = 'discard';
            if (playerNum === 1) game.deadwood1 = calculateDeadwood(game.hand1);
            else game.deadwood2 = calculateDeadwood(game.hand2);

        } else if (action === 'discard') {
            if (game.turnPhase !== 'discard') return res.status(400).json({ error: "Draw first before discarding." });
            const idx = parseInt(cardIndex);
            if (isNaN(idx) || idx < 0 || idx >= hand.length) return res.status(400).json({ error: "Invalid card selection." });

            const card = hand.splice(idx, 1)[0];
            game.discardPile.push(card);
            game.lastActionText = `Player ${playerNum} discards.`;

            // Calculate deadwood
            if (playerNum === 1) game.deadwood1 = calculateDeadwood(game.hand1);
            else game.deadwood2 = calculateDeadwood(game.hand2);

            // Pass turn
            game.turn = playerNum === 1 ? 2 : 1;
            game.turnPhase = 'draw';

        } else if (action === 'knock') {
            const dw = playerNum === 1 ? game.deadwood1 : game.deadwood2;
            if (dw > 10) return res.status(400).json({ error: "Deadwood must be 10 or less to Knock." });

            // Evaluate round outcome
            const dw1 = game.deadwood1;
            const dw2 = game.deadwood2;
            
            let points = 0;
            if (playerNum === 1) {
                if (dw1 === 0) {
                    // Gin!
                    points = 25 + dw2;
                    game.score1 += points;
                    game.lastActionText = `Player 1 declares GIN! Scores +${points} points.`;
                } else if (dw1 < dw2) {
                    points = dw2 - dw1;
                    game.score1 += points;
                    game.lastActionText = `Player 1 Knocks. Scores +${points} points.`;
                } else {
                    // Undercut! Player 2 wins
                    points = 25 + (dw1 - dw2);
                    game.score2 += points;
                    game.lastActionText = `Player 1 Knocks but gets UNDERCUT by Player 2! P2 scores +${points} points.`;
                }
            } else {
                if (dw2 === 0) {
                    // Gin!
                    points = 25 + dw1;
                    game.score2 += points;
                    game.lastActionText = `Player 2 declares GIN! Scores +${points} points.`;
                } else if (dw2 < dw1) {
                    points = dw1 - dw2;
                    game.score2 += points;
                    game.lastActionText = `Player 2 Knocks. Scores +${points} points.`;
                } else {
                    // Undercut! Player 1 wins
                    points = 25 + (dw2 - dw1);
                    game.score1 += points;
                    game.lastActionText = `Player 2 Knocks but gets UNDERCUT by Player 1! P1 scores +${points} points.`;
                }
            }

            // Check match win limit (100 points)
            if (game.score1 >= 100) {
                game.status = 'won';
                game.winner = 1;
            } else if (game.score2 >= 100) {
                game.status = 'won';
                game.winner = 2;
            } else {
                // Auto start next round
                startNewRound(game);
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
                    console.log(`Cleaning up inactive Rummy room: ${gameId}`);
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
        console.log(`Rummy Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

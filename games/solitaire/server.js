const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer Solitaire Duel Game Module)
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

    function setupSolitaireBoard(deck) {
        const d = [...deck];
        const tableau = [[], [], [], [], [], [], []];
        for (let i = 0; i < 7; i++) {
            for (let j = i; j < 7; j++) {
                const card = d.pop();
                card.revealed = (i === j); // Only top card is revealed initially
                tableau[j].push(card);
            }
        }
        return {
            stock: d,
            waste: [],
            foundation: [[], [], [], []], // 0: S, 1: H, 2: D, 3: C
            tableau
        };
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                score1: 0,
                score2: 0,
                status: 'waiting',
                winner: 0,
                lastActionText: 'Game initialized.',
                board1: null,
                board2: null
            };
        }
        return games[gameId];
    }

    // Move validation helpers
    const rankValues = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
    
    function isValidTableauMove(card, destCard) {
        if (!destCard) return card.rank === 'K'; // Only Kings on empty columns
        
        // Colors must be opposite
        const isCardRed = ['H', 'D'].includes(card.suit);
        const isDestRed = ['H', 'D'].includes(destCard.suit);
        if (isCardRed === isDestRed) return false;

        // Rank must be exactly 1 lower
        return rankValues[destCard.rank] - rankValues[card.rank] === 1;
    }

    function isValidFoundationMove(card, suitIndex) {
        const targetSuit = ['S', 'H', 'D', 'C'][suitIndex];
        if (card.suit !== targetSuit) return false;

        const fPile = this; // context passed in caller
        if (fPile.length === 0) return card.rank === 'A';

        const topCard = fPile[fPile.length - 1];
        return rankValues[card.rank] - rankValues[topCard.rank] === 1;
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

    function broadcastGameUpdate(game) {
        // Solitaire states are entirely client-facing but synchronized on scores
        gameIo.to(game.id).emit('update', game);
        // If CPU match and turn shifts to CPU (Player 2 / Black / O)
        if (game.isCpuMatch && game.status === 'playing' && (game.turn === 2 || game.turn === 'black' || game.turn === 'O')) {
            cpuAi.makeMove('solitaire', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
        }

    }

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
            if (game.player1 && game.player1.uuid === uuid) return res.json({ success: true, role: '1', game });
            if (game.player2 && game.player2.uuid === uuid) return res.json({ success: true, role: '2', game });
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) return res.json({ success: true, role: '1', game });
            if (role === '2' && game.player2 && game.player2.uuid === uuid) return res.json({ success: true, role: '2', game });
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
                // Initialize both Solitaire boards with the EXACT same shuffled deck for fairness!
                const deck = createFreshDeck();
                game.board1 = setupSolitaireBoard(deck);
                game.board2 = setupSolitaireBoard(deck);
                game.score1 = 0;
                game.score2 = 0;
                game.status = 'playing';
            }
            broadcastGameUpdate(game);
            return res.json({ success: true, role: assignedRole, game });
        }

        res.json({ success: true, role: 'spectator', game });
    });

    app.post(`${mountPath}/api/reset`, (req, res) => {
        const { gameId } = req.body;
        const game = games[gameId];
        if (game) {
            if (game.player1 && game.player2) {
                const deck = createFreshDeck();
                game.board1 = setupSolitaireBoard(deck);
                game.board2 = setupSolitaireBoard(deck);
                game.score1 = 0;
                game.score2 = 0;
                game.status = 'playing';
            } else {
                game.status = 'waiting';
            }
            game.winner = 0;
            broadcastGameUpdate(game);
        }
        res.json({ success: true });
    });

    // Score reporting endpoint (to keep score values synchronized on server and spectators)
    app.post(`${mountPath}/api/score`, (req, res) => {
        const { gameId, uuid, score } = req.body;
        const game = games[gameId];
        if (game && game.status === 'playing') {
            if (game.player1 && game.player1.uuid === uuid) {
                game.score1 = score;
                if (score >= 500) {
                    game.status = 'won';
                    game.winner = 1;
                }
            } else if (game.player2 && game.player2.uuid === uuid) {
                game.score2 = score;
                if (score >= 500) {
                    game.status = 'won';
                    game.winner = 2;
                }
            }
            broadcastGameUpdate(game);
        }
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
                    console.log(`Cleaning up inactive Solitaire room: ${gameId}`);
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
        console.log(`Solitaire Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

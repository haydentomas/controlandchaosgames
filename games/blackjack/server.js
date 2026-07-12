// server.js (Multiplayer Blackjack Duel Game Module)
const express = require('express');
const path = require('path');

let gamesRef = null;

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    gamesRef = games;
    const gameIo = io.of(mountPath || '/');

    const SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    function createFreshDeck() {
        const deck = [];
        SUITS.forEach(suit => {
            RANKS.forEach(rank => {
                deck.push({ suit, rank });
            });
        });
        // Shuffle deck
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    function calculateHandValue(hand) {
        let value = 0;
        let aces = 0;
        hand.forEach(card => {
            if (card.rank === 'A') {
                aces++;
                value += 11;
            } else if (['J', 'Q', 'K'].includes(card.rank)) {
                value += 10;
            } else {
                value += parseInt(card.rank);
            }
        });
        while (value > 21 && aces > 0) {
            value -= 10;
            aces--;
        }
        return value;
    }

    function startRound(game) {
        game.deck = createFreshDeck();
        game.hand1 = [game.deck.pop(), game.deck.pop()];
        game.hand2 = [game.deck.pop(), game.deck.pop()];
        game.score1 = calculateHandValue(game.hand1);
        game.score2 = calculateHandValue(game.hand2);
        game.turn = 1;
        game.player1Stood = false;
        game.player2Stood = false;
        game.status = 'playing';
        game.winner = 0;
        game.lastActionText = game.isCpuMatch ? 'Match dealt. Your turn.' : 'Match dealt. Player 1 starts.';
    }

    function scheduleCpuTurn(game) {
        if (!game || !game.isCpuMatch || game.status !== 'playing' || game.turn !== 2 || game.cpuTurnPending) {
            return;
        }

        game.cpuTurnPending = true;
        setTimeout(() => {
            game.cpuTurnPending = false;
            resolveCpuTurn(game);
        }, 900);
    }

    function broadcastGameUpdate(game) {
        gameIo.to(game.id).emit('update', game);
        scheduleCpuTurn(game);
    }

    function resolveCpuTurn(game) {
        if (!game || !game.isCpuMatch || game.status !== 'playing' || game.turn !== 2) {
            return;
        }

        const playerScore = game.score1;
        const cpuScore = game.score2;
        let shouldHit = false;

        if (cpuScore < 21) {
            switch (game.difficulty) {
                case 'easy':
                    shouldHit = cpuScore < 14 || (cpuScore < 18 && Math.random() < 0.5);
                    break;
                case 'hard':
                    shouldHit = cpuScore < 17 || (playerScore <= 21 && cpuScore < playerScore && cpuScore < 19);
                    break;
                default:
                    shouldHit = cpuScore < 16 || (playerScore <= 21 && cpuScore < playerScore && cpuScore < 18 && Math.random() < 0.65);
                    break;
            }
        }

        if (shouldHit && game.deck.length > 0) {
            const card = game.deck.pop();
            if (card) {
                game.hand2.push(card);
                game.score2 = calculateHandValue(game.hand2);
                game.lastActionText = 'CyberBot hits.';
                if (game.score2 > 21) {
                    game.player2Stood = true;
                    game.lastActionText = 'CyberBot busts.';
                    resolveRoundOutcome(game);
                }
            }
        } else {
            game.player2Stood = true;
            game.lastActionText = 'CyberBot stands.';
            resolveRoundOutcome(game);
        }

        broadcastGameUpdate(game);
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // P1 (uuid, name)
                player2: null, // P2 (uuid, name)
                deck: createFreshDeck(),
                hand1: [], // Cards for player 1
                hand2: [], // Cards for player 2
                turn: 1, // Player 1 starts
                status: 'waiting', // waiting, playing, won, abandoned
                winner: 0, // 1: P1, 2: P2, 3: Draw
                score1: 0, // hand value P1
                score2: 0, // hand value P2
                player1Stood: false,
                player2Stood: false,
                isCpuMatch: false,
                difficulty: 'medium',
                lastActionText: 'Waiting for players.',
                cpuTurnPending: false
            };
        }
        return games[gameId];
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

    app.post(`${mountPath}/api/join-cpu`, (req, res) => {
        const { gameId, uuid, name } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: 'Missing parameters.' });
        }

        const game = getGame(gameId);
        game.player1 = { uuid, name };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖' };
        game.isCpuMatch = true;
        game.difficulty = 'medium';
        game.hand1 = [];
        game.hand2 = [];
        game.deck = [];
        game.score1 = 0;
        game.score2 = 0;
        game.turn = 1;
        game.player1Stood = false;
        game.player2Stood = false;
        game.status = 'cpu_difficulty_select';
        game.winner = 0;
        game.lastActionText = 'Select a CPU difficulty to begin.';
        game.cpuTurnPending = false;

        broadcastGameUpdate(game);
        res.json({ success: true, role: '1', game });
    });

    app.post(`${mountPath}/api/set-difficulty`, (req, res) => {
        const { gameId, difficulty } = req.body;
        const game = games[gameId];
        if (!game) {
            return res.status(404).json({ error: 'Game not found.' });
        }

        game.difficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
        startRound(game);
        broadcastGameUpdate(game);
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
            game.player1 = { uuid, name };
            assignedRole = '1';
        } else if (!game.player2 && role !== '1') {
            game.player2 = { uuid, name };
            assignedRole = '2';
        }

        if (assignedRole) {
            if (game.player1 && game.player2) {
                game.isCpuMatch = false;
                startRound(game);
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
                startRound(game);
            } else {
                game.deck = createFreshDeck();
                game.hand1 = [];
                game.hand2 = [];
                game.score1 = 0;
                game.score2 = 0;
                game.turn = 1;
                game.player1Stood = false;
                game.player2Stood = false;
                game.status = 'waiting';
                game.winner = 0;
                game.lastActionText = 'Waiting for players.';
            }
            broadcastGameUpdate(game);
        }
        res.json({ success: true, game });
    });

    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, action } = req.body; // action: 'hit' or 'stand'
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot draw cards." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        if (action === 'hit') {
            const card = game.deck.pop();
            if (playerNum === 1) {
                game.hand1.push(card);
                game.score1 = calculateHandValue(game.hand1);
                if (game.score1 > 21) {
                    // Bust! Auto-stand
                    game.player1Stood = true;
                    game.turn = 2;
                    game.lastActionText = 'Player 1 busts.';
                } else {
                    game.lastActionText = 'Player 1 hits.';
                }
            } else {
                game.hand2.push(card);
                game.score2 = calculateHandValue(game.hand2);
                if (game.score2 > 21) {
                    // Bust! Auto-stand
                    game.player2Stood = true;
                    game.lastActionText = 'Player 2 busts.';
                    resolveRoundOutcome(game);
                } else {
                    game.lastActionText = 'Player 2 hits.';
                }
            }
        } else if (action === 'stand') {
            if (playerNum === 1) {
                game.player1Stood = true;
                game.turn = 2;
                game.lastActionText = 'Player 1 stands.';
            } else {
                game.player2Stood = true;
                game.lastActionText = 'Player 2 stands.';
                resolveRoundOutcome(game);
            }
        }

        broadcastGameUpdate(game);
        res.json({ success: true, game });
    });

    function resolveRoundOutcome(game) {
        game.status = 'won';
        const s1 = game.score1;
        const s2 = game.score2;

        if (s1 > 21 && s2 > 21) {
            game.winner = 3; // Draw
        } else if (s1 > 21) {
            game.winner = 2; // P2 wins
        } else if (s2 > 21) {
            game.winner = 1; // P1 wins
        } else {
            if (s1 > s2) game.winner = 1;
            else if (s2 > s1) game.winner = 2;
            else game.winner = 3; // Draw
        }
    }

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
                    console.log(`Cleaning up inactive Blackjack room: ${gameId}`);
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

function getRooms() {
    return Object.values(gamesRef || {}).map(game => ({
        id: game.id,
        player1: game.player1,
        player2: game.player2,
        status: game.status,
        winner: game.winner
    }));
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
        console.log(`Blackjack Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

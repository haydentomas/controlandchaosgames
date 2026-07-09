const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer War Arcade Battle Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');

    const SUITS = ['S', 'H', 'D', 'C'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const rankValues = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};

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

    function setupWarMatch(game) {
        const deck = createFreshDeck();
        game.drawPile1 = deck.slice(0, 26);
        game.drawPile2 = deck.slice(26);
        
        game.hand1 = [];
        game.hand2 = [];
        for (let i = 0; i < 5; i++) {
            game.hand1.push(game.drawPile1.pop());
            game.hand2.push(game.drawPile2.pop());
        }

        game.score1 = 0;
        game.score2 = 0;
        
        game.playedCard1 = null;
        game.playedCard2 = null;

        game.power1 = 'Shield'; // Shields loss
        game.power2 = 'Double'; // Doubles score
        
        game.powerUsed1 = false;
        game.powerUsed2 = false;

        game.powerActive1 = false;
        game.powerActive2 = false;

        game.status = 'playing';
        game.winner = 0;
        game.lastActionText = "War Arcade Battle initiated! Select a card to launch.";
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                drawPile1: [],
                drawPile2: [],
                hand1: [],
                hand2: [],
                score1: 0,
                score2: 0,
                playedCard1: null,
                playedCard2: null,
                power1: 'Shield',
                power2: 'Double',
                powerUsed1: false,
                powerUsed2: false,
                powerActive1: false,
                powerActive2: false,
                status: 'waiting',
                winner: 0,
                lastActionText: ''
            };
        }
        return games[gameId];
    }

    function sanitizeGameState(game, playerRole) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            score1: game.score1,
            score2: game.score2,
            drawCount1: game.drawPile1.length,
            drawCount2: game.drawPile2.length,
            playedCard1: (game.playedCard1 && game.playedCard2) ? game.playedCard1 : (game.playedCard1 ? { hidden: true } : null),
            playedCard2: (game.playedCard1 && game.playedCard2) ? game.playedCard2 : (game.playedCard2 ? { hidden: true } : null),
            power1: game.power1,
            power2: game.power2,
            powerUsed1: game.powerUsed1,
            powerUsed2: game.powerUsed2,
            powerActive1: game.powerActive1,
            powerActive2: game.powerActive2,
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
            cpuAi.makeMove('war', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
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
                setupWarMatch(game);
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
                setupWarMatch(game);
            } else {
                game.status = 'waiting';
            }
            game.winner = 0;
            broadcastGameUpdate(game);
        }
        res.json({ success: true });
    });

    // Make war card move or activate power
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, action, cardIndex } = req.body; // action: play, power
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot fight." });

        const playerNum = isP1 ? 1 : 2;
        const hand = playerNum === 1 ? game.hand1 : game.hand2;

        if (action === 'power') {
            if (playerNum === 1) {
                if (game.powerUsed1) return res.status(400).json({ error: "Power already used." });
                game.powerActive1 = true;
                game.powerUsed1 = true;
            } else {
                if (game.powerUsed2) return res.status(400).json({ error: "Power already used." });
                game.powerActive2 = true;
                game.powerUsed2 = true;
            }
            game.lastActionText = `Player ${playerNum} activated Power-up!`;

        } else if (action === 'play') {
            const idx = parseInt(cardIndex);
            if (isNaN(idx) || idx < 0 || idx >= hand.length) return res.status(400).json({ error: "Invalid card selection." });

            if (playerNum === 1) {
                if (game.playedCard1) return res.status(400).json({ error: "Card already played." });
                game.playedCard1 = hand.splice(idx, 1)[0];
            } else {
                if (game.playedCard2) return res.status(400).json({ error: "Card already played." });
                game.playedCard2 = hand.splice(idx, 1)[0];
            }

            game.lastActionText = `Player ${playerNum} selected a card.`;

            // If both played, resolve round
            if (game.playedCard1 && game.playedCard2) {
                resolveBattleRound(game);
            }
        }

        broadcastGameUpdate(game);
        res.json({ success: true });
    });

    function resolveBattleRound(game) {
        const v1 = rankValues[game.playedCard1.rank];
        const v2 = rankValues[game.playedCard2.rank];

        let basePoints = 1;
        if (game.playedCard1.rank === game.playedCard2.rank) {
            // Tie breaks: higher suit wins
            const suitValues = { 'S': 4, 'H': 3, 'D': 2, 'C': 1 };
            const s1 = suitValues[game.playedCard1.suit];
            const s2 = suitValues[game.playedCard2.suit];
            
            if (s1 > s2) {
                applyRoundWin(game, 1, 2, basePoints);
            } else {
                applyRoundWin(game, 2, 1, basePoints);
            }
        } else if (v1 > v2) {
            applyRoundWin(game, 1, 2, basePoints);
        } else {
            applyRoundWin(game, 2, 1, basePoints);
        }

        // Automatic draw refill
        if (game.drawPile1.length > 0) game.hand1.push(game.drawPile1.pop());
        if (game.drawPile2.length > 0) game.hand2.push(game.drawPile2.pop());

        // Check match limit
        if (game.hand1.length === 0 && game.hand2.length === 0) {
            game.status = 'won';
            if (game.score1 > game.score2) game.winner = 1;
            else if (game.score2 > game.score1) game.winner = 2;
            else game.winner = 3;
        }

        // Reset round fields
        setTimeout(() => {
            game.playedCard1 = null;
            game.playedCard2 = null;
            game.powerActive1 = false;
            game.powerActive2 = false;
            broadcastGameUpdate(game);
        }, 3000);
    }

    function applyRoundWin(game, winnerNum, loserNum, basePoints) {
        const winnerPower = winnerNum === 1 ? game.powerActive1 : game.powerActive2;
        const winnerPowerType = winnerNum === 1 ? game.power1 : game.power2;

        const loserPower = loserNum === 1 ? game.powerActive1 : game.powerActive2;
        const loserPowerType = loserNum === 1 ? game.power1 : game.power2;

        let points = basePoints;
        if (winnerPower && winnerPowerType === 'Double') {
            points *= 2;
        }

        if (loserPower && loserPowerType === 'Shield') {
            points = 0; // Shielded!
            game.lastActionText = `Player ${winnerNum} wins the battle round but Player ${loserNum} SHIELDED the loss! (+0 pts)`;
        } else {
            game.lastActionText = `Player ${winnerNum} wins the battle round! (+${points} pts)`;
        }

        if (winnerNum === 1) game.score1 += points;
        else game.score2 += points;
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
                    console.log(`Cleaning up inactive War room: ${gameId}`);
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
        console.log(`War Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

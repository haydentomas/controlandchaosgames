const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer Speed/Spit Game Module)
const express = require('express');
const path = require('path');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');

    const SUITS = ['S', 'H', 'D', 'C'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const rankValues = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};

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

    function setupSpeedMatch(game) {
        const deck = createFreshDeck();
        
        // P1 cards
        game.drawPile1 = deck.slice(0, 15);
        game.activeSlots1 = deck.slice(15, 19);
        
        // P2 cards
        game.drawPile2 = deck.slice(19, 34);
        game.activeSlots2 = deck.slice(34, 38);

        // Center piles
        game.centerPile1 = [deck[38]];
        game.centerPile2 = [deck[39]];
        
        // Reserve piles for stuck flips
        game.reserveFlipDeck = deck.slice(40);
        
        game.stuck1 = false;
        game.stuck2 = false;
        game.status = 'playing';
        game.winner = 0;
        game.lastActionText = "Speed duel starts! Race to shed all cards.";
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                drawPile1: [],
                activeSlots1: [],
                drawPile2: [],
                activeSlots2: [],
                centerPile1: [],
                centerPile2: [],
                reserveFlipDeck: [],
                stuck1: false,
                stuck2: false,
                status: 'waiting',
                winner: 0,
                lastActionText: ''
            };
        }
        return games[gameId];
    }

    // Sanitize state for security: hide opponent draw pile detail
    function sanitizeGameState(game, playerRole) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            centerTop1: game.centerPile1[game.centerPile1.length - 1] || null,
            centerTop2: game.centerPile2[game.centerPile2.length - 1] || null,
            drawCount1: game.drawPile1.length,
            drawCount2: game.drawPile2.length,
            activeSlots1: playerRole === '1' ? game.activeSlots1 : game.activeSlots1.map(c => c ? { hidden: false, suit: c.suit, rank: c.rank } : null),
            activeSlots2: playerRole === '2' ? game.activeSlots2 : game.activeSlots2.map(c => c ? { hidden: false, suit: c.suit, rank: c.rank } : null),
            stuck1: game.stuck1,
            stuck2: game.stuck2,
            status: game.status,
            winner: game.winner,
            lastActionText: game.lastActionText
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
            cpuAi.makeMove('speed', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
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
                setupSpeedMatch(game);
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
                setupSpeedMatch(game);
            } else {
                game.status = 'waiting';
            }
            game.winner = 0;
            broadcastGameUpdate(game);
        }
        res.json({ success: true });
    });

    // Speed real-time play card move
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, action, slotIndex, targetPile } = req.body; // action: play or stuck
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot play cards." });

        const playerNum = isP1 ? 1 : 2;

        if (action === 'stuck') {
            if (playerNum === 1) game.stuck1 = true;
            else game.stuck2 = true;

            game.lastActionText = `Player ${playerNum} claims they are stuck.`;

            // If both players claim stuck, flip next cards from reserve flip deck
            if (game.stuck1 && game.stuck2) {
                if (game.reserveFlipDeck.length >= 2) {
                    game.centerPile1.push(game.reserveFlipDeck.pop());
                    game.centerPile2.push(game.reserveFlipDeck.pop());
                    game.lastActionText = "Both players stuck. Flipped new cards to center.";
                } else {
                    // Recycle center cards
                    const card1 = game.centerPile1.pop();
                    const card2 = game.centerPile2.pop();
                    const combined = [...game.centerPile1, ...game.centerPile2];
                    
                    // Shuffle recycled cards
                    for (let i = combined.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [combined[i], combined[j]] = [combined[j], combined[i]];
                    }
                    game.reserveFlipDeck = combined;
                    game.centerPile1 = [card1];
                    game.centerPile2 = [card2];
                    
                    if (game.reserveFlipDeck.length >= 2) {
                        game.centerPile1.push(game.reserveFlipDeck.pop());
                        game.centerPile2.push(game.reserveFlipDeck.pop());
                        game.lastActionText = "Stuck deck recycled & flipped new center cards.";
                    }
                }
                game.stuck1 = false;
                game.stuck2 = false;
            }

        } else if (action === 'play') {
            const idx = parseInt(slotIndex);
            if (isNaN(idx) || idx < 0 || idx > 3) return res.status(400).json({ error: "Invalid slot selection." });

            const activeSlots = playerNum === 1 ? game.activeSlots1 : game.activeSlots2;
            const drawPile = playerNum === 1 ? game.drawPile1 : game.drawPile2;
            const card = activeSlots[idx];

            if (!card) return res.status(400).json({ error: "Card slot is empty." });

            const pile = targetPile === 1 ? game.centerPile1 : game.centerPile2;
            const topCard = pile[pile.length - 1];

            // Validate difference is exactly 1 rank (Ace-2 loops)
            const r1 = rankValues[card.rank];
            const r2 = rankValues[topCard.rank];
            const diff = Math.abs(r1 - r2);
            const isLoop = (r1 === 1 && r2 === 13) || (r1 === 13 && r2 === 1);

            if (diff !== 1 && !isLoop) {
                return res.status(400).json({ error: "Rank must be exactly 1 higher or lower." });
            }

            // Move card to center pile
            pile.push(card);
            
            // Refill slot from draw pile
            if (drawPile.length > 0) {
                activeSlots[idx] = drawPile.pop();
            } else {
                activeSlots[idx] = null;
            }

            // Check stuck clears
            game.stuck1 = false;
            game.stuck2 = false;

            game.lastActionText = `Player ${playerNum} played card.`;

            // Check win condition
            const totalRemaining = activeSlots.filter(c => c !== null).length;
            if (totalRemaining === 0) {
                game.status = 'won';
                game.winner = playerNum;
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
                    console.log(`Cleaning up inactive Speed room: ${gameId}`);
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
        console.log(`Speed Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

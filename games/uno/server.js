const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer Uno Game Module)
const express = require('express');
const path = require('path');

let gamesRef = null;

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    gamesRef = games;
    const gameIo = io.of(mountPath || '/');

    const COLORS = ['Red', 'Blue', 'Yellow', 'Green'];
    const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw2'];

    function createFreshDeck() {
        const deck = [];
        COLORS.forEach(color => {
            VALUES.forEach(val => {
                // Uno has two of each number (except 0) and actions. We'll add one copy for speedier 2p games
                deck.push({ color, value: val });
            });
        });
        // Add Wilds
        for (let i = 0; i < 4; i++) {
            deck.push({ color: 'Wild', value: 'Wild' });
            deck.push({ color: 'Wild', value: 'Draw4' });
        }
        // Shuffle deck
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
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
                discardPile: [], // Cards played
                activeColor: '', // Color active (especially for Wilds)
                turn: 1, // Player 1 starts
                status: 'waiting', // waiting, playing, won, abandoned
                winner: 0
            };
        }
        return games[gameId];
    }

    // Sanitize hands for anti-cheat: only send a player's own cards
    function sanitizeGameState(game, playerRole) {
        return {
            id: game.id,
            player1: game.player1,
            player2: game.player2,
            activeColor: game.activeColor,
            turn: game.turn,
            status: game.status,
            winner: game.winner,
            discardTop: game.discardPile[game.discardPile.length - 1] || null,
            deckCount: game.deck.length,
            // Sanitize hand lists: spectators get card counts only, players get their own card details
            hand1: playerRole === '1' ? game.hand1 : game.hand1.map(() => ({ hidden: true })),
            hand2: playerRole === '2' ? game.hand2 : game.hand2.map(() => ({ hidden: true })),
            hand1Count: game.hand1.length,
            hand2Count: game.hand2.length
        };
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
        // Send custom updates to each socket separately based on their role
        const roomSockets = gameIo.adapter.rooms.get(game.id);
        if (roomSockets) {
            for (const socketId of roomSockets) {
                const socket = gameIo.sockets.get(socketId);
                if (socket) {
                    const role = socket.playerRole || 'spectator';
                    socket.emit('update', sanitizeGameState(game, role));
        // If CPU match and turn shifts to CPU (Player 2 / Black / O)
        if (game.isCpuMatch && game.status === 'playing' && (game.turn === 2 || game.turn === 'black' || game.turn === 'O')) {
            cpuAi.makeMove('uno', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
        }

                }
            }
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
                // Initialize hands
                game.deck = createFreshDeck();
                game.hand1 = [];
                game.hand2 = [];
                for (let i = 0; i < 7; i++) {
                    game.hand1.push(game.deck.pop());
                    game.hand2.push(game.deck.pop());
                }
                
                // Find a non-wild starting card for discard pile
                let firstCard = game.deck.pop();
                while (firstCard.color === 'Wild') {
                    game.deck.unshift(firstCard);
                    firstCard = game.deck.pop();
                }
                game.discardPile.push(firstCard);
                game.activeColor = firstCard.color;
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
            game.deck = createFreshDeck();
            game.hand1 = [];
            game.hand2 = [];
            game.discardPile = [];
            if (game.player1 && game.player2) {
                for (let i = 0; i < 7; i++) {
                    game.hand1.push(game.deck.pop());
                    game.hand2.push(game.deck.pop());
                }
                let firstCard = game.deck.pop();
                while (firstCard.color === 'Wild') {
                    game.deck.unshift(firstCard);
                    firstCard = game.deck.pop();
                }
                game.discardPile.push(firstCard);
                game.activeColor = firstCard.color;
                game.status = 'playing';
            } else {
                game.status = 'waiting';
            }
            game.turn = 1;
            game.winner = 0;
            broadcastGameUpdate(game);
        }
        res.json({ success: true });
    });

    // Make move (play card or draw card)
    app.post(`${mountPath}/api/move`, (req, res) => {
        const { gameId, uuid, action, cardIndex, wildColor } = req.body; // action: 'play' or 'draw'
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot play cards." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const hand = playerNum === 1 ? game.hand1 : game.hand2;
        const oppHand = playerNum === 1 ? game.hand2 : game.hand1;

        if (action === 'draw') {
            // Player draws 1 card
            if (game.deck.length === 0) {
                // Recycle discard pile except top card
                const topCard = game.discardPile.pop();
                game.deck = game.discardPile;
                game.discardPile = [topCard];
                // Shuffle deck
                for (let i = game.deck.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [game.deck[i], game.deck[j]] = [game.deck[j], game.deck[i]];
                }
            }

            const card = game.deck.pop();
            hand.push(card);

            // Turn only passes if the drawn card cannot be played immediately
            // To make game simple: draw passes turn automatically
            game.turn = playerNum === 1 ? 2 : 1;

        } else if (action === 'play') {
            const idx = parseInt(cardIndex);
            if (isNaN(idx) || idx < 0 || idx >= hand.length) {
                return res.status(400).json({ error: "Invalid card selection." });
            }

            const card = hand[idx];
            const topCard = game.discardPile[game.discardPile.length - 1];

            // Validate compatibility
            const matchesColor = card.color === game.activeColor;
            const matchesValue = card.value === topCard.value;
            const isWild = card.color === 'Wild';

            if (!matchesColor && !matchesValue && !isWild) {
                return res.status(400).json({ error: "Card does not match color or rank." });
            }

            // Remove card from hand
            hand.splice(idx, 1);
            game.discardPile.push(card);

            // Handle wild colors
            if (isWild) {
                if (!COLORS.includes(wildColor)) {
                    // Default to Red if color was missing
                    game.activeColor = 'Red';
                } else {
                    game.activeColor = wildColor;
                }
            } else {
                game.activeColor = card.color;
            }

            // Check win condition
            if (hand.length === 0) {
                game.status = 'won';
                game.winner = playerNum;
                broadcastGameUpdate(game);
                return res.json({ success: true, game: sanitizeGameState(game, playerNum.toString()) });
            }

            // Handle actions
            const nextPlayer = playerNum === 1 ? 2 : 1;
            
            if (card.value === 'Skip' || card.value === 'Reverse') {
                // In 2 player, Reverse acts like a Skip
                game.turn = playerNum; // Turn stays on current player!
            } else if (card.value === 'Draw2') {
                // Opponent draws 2 and turn skipped
                oppHand.push(game.deck.pop());
                oppHand.push(game.deck.pop());
                game.turn = playerNum; // stays on current player
            } else if (card.value === 'Draw4') {
                // Opponent draws 4 and turn skipped
                oppHand.push(game.deck.pop());
                oppHand.push(game.deck.pop());
                oppHand.push(game.deck.pop());
                oppHand.push(game.deck.pop());
                game.turn = playerNum; // stays on current player
            } else {
                game.turn = nextPlayer;
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
                    console.log(`Cleaning up inactive Uno room: ${gameId}`);
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
        console.log(`Uno Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init, getRooms };
}

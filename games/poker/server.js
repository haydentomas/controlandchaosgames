const cpuAi = require('../cpu_ai.js');
// server.js (Multiplayer Texas Hold'em Poker Game Module)
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

    // A simplified heads-up poker hand evaluator returning a numerical score (0-9) + tiebreaker
    function evaluateHand(cards) {
        // Find best 5 cards combination from the 7 cards
        let bestScore = -1;
        
        function getCombinations(arr, k) {
            const result = [];
            function helper(comb, start) {
                if (comb.length === k) {
                    result.push([...comb]);
                    return;
                }
                for (let i = start; i < arr.length; i++) {
                    comb.push(arr[i]);
                    helper(comb, i + 1);
                    comb.pop();
                }
            }
            helper([], 0);
            return result;
        }

        const combos = getCombinations(cards, 5);
        
        combos.forEach(combo => {
            const score = get5CardScore(combo);
            if (score > bestScore) {
                bestScore = score;
            }
        });
        
        return bestScore;
    }

    function get5CardScore(fiveCards) {
        // Values sorted descending
        const rankValues = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
        const ranks = fiveCards.map(c => rankValues[c.rank]).sort((a,b) => b-a);
        const suits = fiveCards.map(c => c.suit);
        
        const isFlush = suits.every(s => s === suits[0]);
        
        // Check straight
        let isStraight = false;
        if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
            isStraight = true;
        }
        // Ace-low straight (A-2-3-4-5)
        if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
            isStraight = true;
        }

        // Count rank frequencies
        const counts = {};
        ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
        const freq = Object.values(counts).sort((a,b) => b-a);
        
        // Base category values:
        // Straight Flush: 8, Quads: 7, Full House: 6, Flush: 5, Straight: 4, Trips: 3, Two Pair: 2, Pair: 1, High: 0
        let category = 0;
        if (isFlush && isStraight) category = 8;
        else if (freq[0] === 4) category = 7;
        else if (freq[0] === 3 && freq[1] === 2) category = 6;
        else if (isFlush) category = 5;
        else if (isStraight) category = 4;
        else if (freq[0] === 3) category = 3;
        else if (freq[0] === 2 && freq[1] === 2) category = 2;
        else if (freq[0] === 2) category = 1;

        // Create a tiebreaker rank value
        let tiebreaker = 0;
        ranks.forEach((r, i) => {
            tiebreaker += r * Math.pow(15, 4 - i);
        });

        return category * 10000000 + tiebreaker;
    }

    function startNewRound(game) {
        game.deck = createFreshDeck();
        game.hand1 = [game.deck.pop(), game.deck.pop()];
        game.hand2 = [game.deck.pop(), game.deck.pop()];
        game.community = [];
        
        // Deal 5 community cards to deck pool, to reveal them in stages
        game.flopCards = [game.deck.pop(), game.deck.pop(), game.deck.pop()];
        game.turnCard = game.deck.pop();
        game.riverCard = game.deck.pop();

        game.pot = 40; // Blinds post
        game.chips1 -= 20;
        game.chips2 -= 20;
        
        game.currentBet = 20;
        game.p1Bet = 20;
        game.p2Bet = 20;
        
        game.stage = 'preflop'; // preflop, flop, turnriver, showdown
        game.turn = 1; // P1 starts action
        game.lastActionText = "Blinds posted. P1 to act.";
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null,
                player2: null,
                chips1: 1000,
                chips2: 1000,
                deck: [],
                hand1: [],
                hand2: [],
                community: [],
                pot: 0,
                currentBet: 0,
                p1Bet: 0,
                p2Bet: 0,
                stage: 'preflop',
                turn: 1,
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
            chips1: game.chips1,
            chips2: game.chips2,
            community: game.community,
            pot: game.pot,
            currentBet: game.currentBet,
            p1Bet: game.p1Bet,
            p2Bet: game.p2Bet,
            stage: game.stage,
            turn: game.turn,
            status: game.status,
            winner: game.winner,
            lastActionText: game.lastActionText,
            // Hole cards hidden unless showdown
            hand1: (playerRole === '1' || game.stage === 'showdown') ? game.hand1 : [{ hidden: true }, { hidden: true }],
            hand2: (playerRole === '2' || game.stage === 'showdown') ? game.hand2 : [{ hidden: true }, { hidden: true }]
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
            cpuAi.makeMove('poker', game, gameIo, typeof checkWin !== 'undefined' ? checkWin : null, typeof checkDraw !== 'undefined' ? checkDraw : null);
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
                game.chips1 = 1000;
                game.chips2 = 1000;
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
            game.chips1 = 1000;
            game.chips2 = 1000;
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
        const { gameId, uuid, action, raiseAmount } = req.body; // action: check, call, raise, fold
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Game not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot bet." });

        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        const ownChips = playerNum === 1 ? game.chips1 : game.chips2;
        const ownBet = playerNum === 1 ? game.p1Bet : game.p2Bet;
        const oppBet = playerNum === 1 ? game.p2Bet : game.p1Bet;

        let nextStage = false;

        if (action === 'fold') {
            // Fold! Opponent wins pot immediately
            game.lastActionText = `Player ${playerNum} folds.`;
            if (playerNum === 1) game.chips2 += game.pot;
            else game.chips1 += game.pot;
            
            // Check if match is over
            checkMatchOver(game);
            return;
        } else if (action === 'check') {
            if (ownBet !== oppBet) return res.status(400).json({ error: "Cannot check. Must call or fold." });
            game.lastActionText = `Player ${playerNum} checks.`;
            
            // If turn is passed, advance stage
            if (playerNum === 2) nextStage = true;
            else game.turn = 2;

        } else if (action === 'call') {
            const diff = oppBet - ownBet;
            if (diff <= 0) return res.status(400).json({ error: "No bet to call. Check instead." });
            
            if (playerNum === 1) {
                game.chips1 -= diff;
                game.p1Bet += diff;
            } else {
                game.chips2 -= diff;
                game.p2Bet += diff;
            }
            game.pot += diff;
            game.lastActionText = `Player ${playerNum} calls.`;
            
            // Advance stage after call
            nextStage = true;

        } else if (action === 'raise') {
            const raiseVal = parseInt(raiseAmount);
            if (isNaN(raiseVal) || raiseVal <= 0 || raiseVal > ownChips) {
                return res.status(400).json({ error: "Invalid raise value." });
            }
            
            const totalBet = oppBet + raiseVal;
            const diff = totalBet - ownBet;
            
            if (playerNum === 1) {
                game.chips1 -= diff;
                game.p1Bet = totalBet;
            } else {
                game.chips2 -= diff;
                game.p2Bet = totalBet;
            }
            game.pot += diff;
            game.currentBet = totalBet;
            game.lastActionText = `Player ${playerNum} raises to ${totalBet}.`;
            
            // Toggle turn to other player
            game.turn = playerNum === 1 ? 2 : 1;
        }

        if (nextStage) {
            advancePokerStage(game);
        }

        broadcastGameUpdate(game);
        res.json({ success: true });
    });

    function advancePokerStage(game) {
        // Reset bets for next round
        game.p1Bet = 0;
        game.p2Bet = 0;
        game.currentBet = 0;

        if (game.stage === 'preflop') {
            game.stage = 'flop';
            game.community.push(...game.flopCards);
            game.turn = 1;
            game.lastActionText = "Flop dealt. Player 1 to act.";
        } else if (game.stage === 'flop') {
            game.stage = 'turnriver';
            game.community.push(game.turnCard);
            game.community.push(game.riverCard);
            game.turn = 1;
            game.lastActionText = "Turn & River dealt. Player 1 to act.";
        } else if (game.stage === 'turnriver') {
            // Showdown!
            game.stage = 'showdown';
            
            const score1 = evaluateHand([...game.hand1, ...game.community]);
            const score2 = evaluateHand([...game.hand2, ...game.community]);

            if (score1 > score2) {
                game.chips1 += game.pot;
                game.lastActionText = "Player 1 wins Showdown!";
            } else if (score2 > score1) {
                game.chips2 += game.pot;
                game.lastActionText = "Player 2 wins Showdown!";
            } else {
                game.chips1 += game.pot / 2;
                game.chips2 += game.pot / 2;
                game.lastActionText = "Showdown split pot (Draw)!";
            }
            
            setTimeout(() => {
                checkMatchOver(game);
            }, 5000);
        }
    }

    function checkMatchOver(game) {
        if (game.chips1 <= 0) {
            game.status = 'won';
            game.winner = 2; // P2 wins match
        } else if (game.chips2 <= 0) {
            game.status = 'won';
            game.winner = 1; // P1 wins match
        } else {
            // Auto start next round
            startNewRound(game);
        }
        broadcastGameUpdate(game);
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
                    console.log(`Cleaning up inactive Poker room: ${gameId}`);
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
        console.log(`Poker Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

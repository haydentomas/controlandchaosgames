// server.js (Multiplayer Naval Clash Game Module)
const express = require('express');
const path = require('path');
const cpuAi = require('../cpu_ai.js');
const lovenseHelper = require('../lovense_helper.js');

function init(app, io, mountPath = '') {
    app.use(`${mountPath}`, express.static(path.join(__dirname, 'public')));

    const games = {};
    const gameIo = io.of(mountPath || '/');
    lovenseHelper.registerModule('navalclash', games, gameIo);

    function createEmptyBoard() {
        // Return 10x10 empty matrix
        const board = [];
        for (let r = 0; r < 10; r++) {
            board.push(new Array(10).fill(0));
        }
        return board;
    }

    function getGame(gameId) {
        if (!games[gameId]) {
            games[gameId] = {
                id: gameId,
                player1: null, // { uuid, name, ready: false, ships: [] }
                player2: null, // { uuid, name, ready: false, ships: [] }
                shots1: [], // Player 1's shots: { r, c, hit, sunkShip }
                shots2: [], // Player 2's shots: { r, c, hit, sunkShip }
                turn: 1, // Player 1 starts
                status: 'waiting', // waiting, placement, playing, won, abandoned
                winner: 0
            };
        }
        return games[gameId];
    }

    // Check if ship coordinates are fully hit
    function isShipSunk(ship, shots) {
        return ship.coords.every(([sr, sc]) => 
            shots.some(s => s.r === sr && s.c === sc)
        );
    }

    // Check if player has lost all ships
    function allShipsSunk(playerShips, playerReceivedShots) {
        if (!playerShips || playerShips.length === 0) return true;
        return playerShips.every(ship => isShipSunk(ship, playerReceivedShots));
    }

    // Check if ship placements are valid
    function validateShips(ships) {
        if (!Array.isArray(ships) || ships.length !== 5) return false;
        
        const shipSizes = {
            'carrier': 5,
            'battleship': 4,
            'destroyer': 3,
            'submarine': 3,
            'patrol': 2
        };

        const grid = Array(10).fill(null).map(() => Array(10).fill(false));

        for (const ship of ships) {
            const expectedSize = shipSizes[ship.name];
            if (!expectedSize) return false;
            if (!Array.isArray(ship.coords) || ship.coords.length !== expectedSize) return false;

            // Check linear alignment
            const rows = ship.coords.map(([r, c]) => r);
            const cols = ship.coords.map(([r, c]) => c);

            const allSameRow = rows.every(r => r === rows[0]);
            const allSameCol = cols.every(c => c === cols[0]);

            if (!allSameRow && !allSameCol) return false;

            // Check continuity
            if (allSameRow) {
                const colsSorted = [...cols].sort((a, b) => a - b);
                for (let i = 0; i < colsSorted.length - 1; i++) {
                    if (colsSorted[i+1] - colsSorted[i] !== 1) return false;
                }
            } else {
                const rowsSorted = [...rows].sort((a, b) => a - b);
                for (let i = 0; i < rowsSorted.length - 1; i++) {
                    if (rowsSorted[i+1] - rowsSorted[i] !== 1) return false;
                }
            }

            // Check overlaps and bounds
            for (const [r, c] of ship.coords) {
                if (r < 0 || r >= 10 || c < 0 || c >= 10) return false;
                if (grid[r][c]) return false; // Overlap!
                grid[r][c] = true;
            }
        }
        return true;
    }

    app.get(`${mountPath}/board/:gameId`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // List Active Rooms API
    app.get(`${mountPath}/api/rooms`, (req, res) => {
        const roomList = Object.values(games)
            .filter(g => g.id !== 'lobby')
            .map(g => ({
                id: g.id,
                player1: g.player1 ? { name: g.player1.name } : null,
                player2: g.player2 ? { name: g.player2.name } : null,
                status: g.status,
                winner: g.winner
            }));
        res.json(roomList);
    });

    // Leave Game / Exit Match
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
                gameIo.to(gameId).emit('update', game);
            }
        }
        res.json({ success: true });
    });

    // Inactive room cleanup (Runs every 1 minute)
    setInterval(() => {
        const now = Date.now();
        Object.keys(games).forEach(gameId => {
            const game = games[gameId];
            const roomSockets = gameIo.adapter.rooms.get(gameId);
            const activeSocketCount = roomSockets ? roomSockets.size : 0;
            
            if (activeSocketCount === 0) {
                if (!game.emptySince) {
                    game.emptySince = now;
                } else if (now - game.emptySince > 120000) { // 2 minutes empty -> delete
                    console.log(`Cleaning up inactive Naval Clash game room (0 sockets): ${gameId}`);
                    delete games[gameId];
                }
            } else {
                delete game.emptySince;
            }
        });
    }, 60000);

    // Join Game
    app.post(`${mountPath}/api/join`, (req, res) => {
        const { gameId, uuid, name, role } = req.body;
        if (!gameId || !uuid || !name) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        const game = getGame(gameId);

        if (!role) {
            if (game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameForPlayer(game, uuid) });
            }
            if (game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameForPlayer(game, uuid) });
            }
        } else {
            if (role === '1' && game.player1 && game.player1.uuid === uuid) {
                return res.json({ success: true, role: '1', game: sanitizeGameForPlayer(game, uuid) });
            }
            if (role === '2' && game.player2 && game.player2.uuid === uuid) {
                return res.json({ success: true, role: '2', game: sanitizeGameForPlayer(game, uuid) });
            }
        }

        let assignedRole = null;
        if (!game.player1 && role !== '2') {
            game.player1 = { uuid, name, ready: false, ships: [], connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = '1';
        } else if (!game.player2 && role !== '1') {
            game.player2 = { uuid, name, ready: false, ships: [], connected: false, qrCode: null, linkCode: null, qrError: null };
            assignedRole = '2';
        }

        if (assignedRole) {
            const targetPlayer = assignedRole === '1' ? game.player1 : game.player2;
            if (targetPlayer && !uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
                lovenseHelper.getQrCode(uuid, name).then(result => {
                    const p = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
                    if (p) {
                        p.qrCode = result.qrCode;
                        p.linkCode = result.linkCode;
                        p.qrError = result.error;
                        gameIo.to(gameId).emit('update', game);
                    }
                });
            }

            if (game.player1 && game.player2) {
                game.status = 'placement';
            }
            gameIo.to(gameId).emit('update', game);
            return res.json({ success: true, role: assignedRole, game: sanitizeGameForPlayer(game, uuid) });
        }

        res.json({ success: true, role: 'spectator', game: sanitizeGameForPlayer(game, uuid) });
    });

    // Helper: Generate CPU Ships
    function generateCpuShips() {
        const shipSizes = {
            'carrier': 5,
            'battleship': 4,
            'destroyer': 3,
            'submarine': 3,
            'patrol': 2
        };
        const ships = [];
        const grid = Array(10).fill(null).map(() => Array(10).fill(false));

        for (const [name, size] of Object.entries(shipSizes)) {
            let placed = false;
            while (!placed) {
                const horizontal = Math.random() < 0.5;
                const r = Math.floor(Math.random() * (horizontal ? 10 : (10 - size + 1)));
                const c = Math.floor(Math.random() * (horizontal ? (10 - size + 1) : 10));

                const coords = [];
                let overlap = false;
                for (let i = 0; i < size; i++) {
                    const currR = r + (horizontal ? 0 : i);
                    const currC = c + (horizontal ? i : 0);
                    if (grid[currR][currC]) {
                        overlap = true;
                        break;
                    }
                    coords.push([currR, currC]);
                }

                if (!overlap) {
                    coords.forEach(([currR, currC]) => {
                        grid[currR][currC] = true;
                    });
                    ships.push({ name, coords });
                    placed = true;
                }
            }
        }
        return ships;
    }

    // Join CPU API
    app.post(`${mountPath}/api/join-cpu`, (req, res) => {
        const { gameId, uuid, name } = req.body;
        const game = getGame(gameId);
        game.lastActive = Date.now();

        game.player1 = { uuid, name, ready: false, ships: [], connected: false, qrCode: null, linkCode: null, qrError: null };
        game.player2 = { uuid: 'cpu-bot', name: 'CyberBot 🤖', ready: false, ships: [] };
        game.isCpuMatch = true;
        game.status = 'cpu_difficulty_select';
        game.turn = 1;
        game.shots1 = [];
        game.shots2 = [];
        game.winner = 0;

        if (!uuid.startsWith('cpu-') && !uuid.startsWith('browser_')) {
            lovenseHelper.getQrCode(uuid, name).then(result => {
                if (game.player1 && game.player1.uuid === uuid) {
                    game.player1.qrCode = result.qrCode;
                    game.player1.linkCode = result.linkCode;
                    game.player1.qrError = result.error;
                    gameIo.to(gameId).emit('update', game);
                }
            });
        }

        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, role: '1', game: sanitizeGameForPlayer(game, uuid) });
    });

    // Set CPU Difficulty API
    app.post(`${mountPath}/api/set-difficulty`, (req, res) => {
        const { gameId, difficulty } = req.body;
        const game = games[gameId];
        if (game) {
            game.difficulty = difficulty || 'medium';
            game.status = 'placement'; // Advance to placement step
            gameIo.to(gameId).emit('update', game);
        }
        res.json({ success: true, game });
    });

    // Test Lovense Vibration API
    app.post(`${mountPath}/api/vibe/test`, async (req, res) => {
        const { gameId, uuid } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        const player = (game.player1 && game.player1.uuid === uuid) ? game.player1 : (game.player2 && game.player2.uuid === uuid ? game.player2 : null);
        if (!player) return res.status(400).json({ error: "Player not registered." });
        await lovenseHelper.triggerVibration(player.uuid, 'move');
        res.json({ success: true });
    });

    // Lock / Ready Fleet Placement
    app.post(`${mountPath}/api/lock-fleet`, (req, res) => {
        const { gameId, uuid, ships } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });

        if (!validateShips(ships)) {
            return res.status(400).json({ error: "Invalid ship layout. Verify placements." });
        }

        let player = null;
        if (game.player1 && game.player1.uuid === uuid) player = game.player1;
        if (game.player2 && game.player2.uuid === uuid) player = game.player2;

        if (!player) return res.status(403).json({ error: "You are not a player in this match." });

        player.ships = ships;
        player.ready = true;

        if (game.isCpuMatch && game.player1.ready) {
            game.player2.ships = generateCpuShips();
            game.player2.ready = true;
            game.status = 'playing';
            game.turn = 1;
        }

        if (game.player1.ready && game.player2.ready) {
            game.status = 'playing';
            game.turn = 1;
        }

        gameIo.to(gameId).emit('update', game);
        res.json({ success: true, game: sanitizeGameForPlayer(game, uuid) });
    });

    // Fire coordinates API
    app.post(`${mountPath}/api/fire`, (req, res) => {
        const { gameId, uuid, row, col } = req.body;
        const game = games[gameId];
        if (!game) return res.status(404).json({ error: "Game not found." });
        if (game.status !== 'playing') return res.status(400).json({ error: "Match not active." });

        const isP1 = game.player1 && game.player1.uuid === uuid;
        const isP2 = game.player2 && game.player2.uuid === uuid;

        if (!isP1 && !isP2) return res.status(403).json({ error: "Spectators cannot fire shots." });

        // Enforce Turn
        const playerNum = isP1 ? 1 : 2;
        if (game.turn !== playerNum) return res.status(400).json({ error: "Not your turn." });

        // Validate targets
        const targetRow = parseInt(row);
        const targetCol = parseInt(col);
        if (isNaN(targetRow) || isNaN(targetCol) || targetRow < 0 || targetRow >= 10 || targetCol < 0 || targetCol >= 10) {
            return res.status(400).json({ error: "Coordinate out of bounds." });
        }

        const myShots = playerNum === 1 ? game.shots1 : game.shots2;
        const targetShips = playerNum === 1 ? game.player2.ships : game.player1.ships;

        // Check duplicate shot
        const alreadyFired = myShots.some(s => s.r === targetRow && s.c === targetCol);
        if (alreadyFired) return res.status(400).json({ error: "Already targeted this cell." });

        // Check if Hit
        let isHit = false;
        let sunkName = null;
        
        for (const ship of targetShips) {
            const hitSegment = ship.coords.find(([sr, sc]) => sr === targetRow && sc === targetCol);
            if (hitSegment) {
                isHit = true;
                
                // Add shot temporary to check if ship is sunk
                const tempShots = [...myShots, { r: targetRow, c: targetCol, hit: true }];
                if (isShipSunk(ship, tempShots)) {
                    sunkName = ship.name;
                }
                break;
            }
        }

        const shotResult = { r: targetRow, c: targetCol, hit: isHit, sunkShip: sunkName };
        myShots.push(shotResult);

        // Check Win Condition
        const opponentReceivedShots = playerNum === 1 ? game.shots1 : game.shots2;
        const opponentShips = playerNum === 1 ? game.player2.ships : game.player1.ships;
        const vibeQueue = [];

        if (allShipsSunk(opponentShips, opponentReceivedShots)) {
            game.status = 'won';
            game.winner = playerNum;
            if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: game.winner === 1 ? 'win' : 'lose' });
            if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: game.winner === 2 ? 'win' : 'lose' });
        } else {
            // Toggle turn
            game.turn = playerNum === 1 ? 2 : 1;
            
            // Queue hit/miss/turn alert vibes
            if (playerNum === 1) {
                if (isHit) {
                    if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'move' });
                    if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'hit' });
                } else {
                    if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'miss' });
                    if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'turn_alert' });
                }
            } else {
                if (isHit) {
                    if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'move' });
                    if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'hit' });
                } else {
                    if (game.player2) vibeQueue.push({ uuid: game.player2.uuid, type: 'miss' });
                    if (game.player1) vibeQueue.push({ uuid: game.player1.uuid, type: 'turn_alert' });
                }
            }
        }

        gameIo.to(gameId).emit('update', game);

        // Trigger player vibrations
        vibeQueue.forEach(item => {
            if (item.uuid) lovenseHelper.triggerVibration(item.uuid, item.type);
        });

        // If CPU match and turn shifts to CPU (Player 2 / turn === 2)
        if (game.isCpuMatch && game.status === 'playing' && game.turn === 2) {
            cpuAi.makeMove('navalclash', game, gameIo);
        }
        res.json({ success: true, game: sanitizeGameForPlayer(game, uuid) });
    });

    // Helper: Hide opponent's ships from client payloads to prevent cheating
    function sanitizeGameForPlayer(game, uuid) {
        if (!game) return null;
        
        const sanitized = JSON.parse(JSON.stringify(game));
        
        // Hide player1 ships from player2 and spectators
        if (sanitized.player1 && sanitized.player1.uuid !== uuid) {
            sanitized.player1.ships = [];
        }
        // Hide player2 ships from player1 and spectators
        if (sanitized.player2 && sanitized.player2.uuid !== uuid) {
            sanitized.player2.ships = [];
        }

        return sanitized;
    }

    gameIo.on('connection', (socket) => {
        let currentRoom = null;
        let playerUuid = null;

        socket.on('join_game', (gameId, uuid) => {
            currentRoom = gameId;
            playerUuid = uuid;
            socket.join(gameId);
            const game = getGame(gameId);
            socket.emit('update', sanitizeGameForPlayer(game, uuid));
        });

        socket.on('voice_signal', (data) => {
            if (currentRoom) {
                socket.to(currentRoom).emit('voice_signal', data);
            }
        });

        socket.on('chat_message', (data) => {
            if (currentRoom) {
                gameIo.to(currentRoom).emit('chat_message', data);
            }
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
                        gameIo.to(currentRoom).emit('update', game);
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
        console.log(`Naval Clash Server running standalone on port ${PORT}`);
    });
} else {
    module.exports = { init };
}

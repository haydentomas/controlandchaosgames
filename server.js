// server.js (Game Terminal Server)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Terminal Lobby static files at root
app.use('/', express.static(path.join(__dirname, 'public')));

// Mount Four in a Row Game
const fourinarowPath = path.join(__dirname, 'games', 'fourinarow', 'server.js');
try {
    const fourinarow = require(fourinarowPath);
    if (typeof fourinarow.init === 'function') {
        fourinarow.init(app, io, '/games/fourinarow');
        console.log('Successfully mounted Four in a Row game at /games/fourinarow');
    } else {
        console.error('Four in a Row module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Four in a Row game module:', err);
}

// Mount Chess Game
const chessPath = path.join(__dirname, 'games', 'chess', 'server.js');
try {
    const chess = require(chessPath);
    if (typeof chess.init === 'function') {
        chess.init(app, io, '/games/chess');
        console.log('Successfully mounted Chess game at /games/chess');
    } else {
        console.error('Chess module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Chess game module:', err);
}

// Mount Tic Tac Toe Game
const tictactoePath = path.join(__dirname, 'games', 'tictactoe', 'server.js');
try {
    const tictactoe = require(tictactoePath);
    if (typeof tictactoe.init === 'function') {
        tictactoe.init(app, io, '/games/tictactoe');
        console.log('Successfully mounted Tic Tac Toe game at /games/tictactoe');
    } else {
        console.error('Tic Tac Toe module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Tic Tac Toe game module:', err);
}

// Mount Checkers Game
const checkersPath = path.join(__dirname, 'games', 'checkers', 'server.js');
try {
    const checkers = require(checkersPath);
    if (typeof checkers.init === 'function') {
        checkers.init(app, io, '/games/checkers');
        console.log('Successfully mounted Checkers game at /games/checkers');
    } else {
        console.error('Checkers module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Checkers game module:', err);
}

// Mount Naval Clash Game
const navalClashPath = path.join(__dirname, 'games', 'navalclash', 'server.js');
try {
    const navalclash = require(navalClashPath);
    if (typeof navalclash.init === 'function') {
        navalclash.init(app, io, '/games/navalclash');
        console.log('Successfully mounted Naval Clash game at /games/navalclash');
    } else {
        console.error('Naval Clash module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Naval Clash game module:', err);
}

// Mount Reversi Game
const reversiPath = path.join(__dirname, 'games', 'reversi', 'server.js');
try {
    const reversi = require(reversiPath);
    if (typeof reversi.init === 'function') {
        reversi.init(app, io, '/games/reversi');
        console.log('Successfully mounted Reversi game at /games/reversi');
    } else {
        console.error('Reversi module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Reversi game module:', err);
}

// Mount Dots and Boxes Game
const dotsAndBoxesPath = path.join(__dirname, 'games', 'dotsandboxes', 'server.js');
try {
    const dotsandboxes = require(dotsAndBoxesPath);
    if (typeof dotsandboxes.init === 'function') {
        dotsandboxes.init(app, io, '/games/dotsandboxes');
        console.log('Successfully mounted Dots and Boxes game at /games/dotsandboxes');
    } else {
        console.error('Dots and Boxes module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Dots and Boxes game module:', err);
}

// Mount Memory Match Game
const memoryMatchPath = path.join(__dirname, 'games', 'memorymatch', 'server.js');
try {
    const memorymatch = require(memoryMatchPath);
    if (typeof memorymatch.init === 'function') {
        memorymatch.init(app, io, '/games/memorymatch');
        console.log('Successfully mounted Memory Match game at /games/memorymatch');
    } else {
        console.error('Memory Match module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Memory Match game module:', err);
}

// Global Terminal API / Sockets can be added here if needed

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`=== Game Terminal Server running on port ${PORT} ===`);
    console.log(`Lobby: http://localhost:${PORT}`);
    console.log(`Four in a Row PG directly: http://localhost:${PORT}/games/fourinarow/board/lobby?debug=true`);
    console.log(`Naval Clash PG directly: http://localhost:${PORT}/games/navalclash/board/lobby?debug=true`);
    console.log(`Reversi PG directly: http://localhost:${PORT}/games/reversi/board/lobby?debug=true`);
    console.log(`Dots and Boxes PG directly: http://localhost:${PORT}/games/dotsandboxes/board/lobby?debug=true`);
    console.log(`Memory Match PG directly: http://localhost:${PORT}/games/memorymatch/board/lobby?debug=true`);
});

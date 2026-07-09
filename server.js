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

// Global Terminal API / Sockets can be added here if needed

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`=== Game Terminal Server running on port ${PORT} ===`);
    console.log(`Lobby: http://localhost:${PORT}`);
    console.log(`Four in a Row PG directly: http://localhost:${PORT}/games/fourinarow/board/lobby?debug=true`);
});

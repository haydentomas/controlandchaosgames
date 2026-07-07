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

// Mount Connect 4 Game
const connect4Path = path.join(__dirname, 'games', 'connect4', 'server.js');
try {
    const connect4 = require(connect4Path);
    if (typeof connect4.init === 'function') {
        connect4.init(app, io, '/games/connect4');
        console.log('Successfully mounted Connect 4 game at /games/connect4');
    } else {
        console.error('Connect 4 module found but init function is missing.');
    }
} catch (err) {
    console.error('Failed to load Connect 4 game module:', err);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=== Game Terminal Server running on port ${PORT} ===`);
    console.log(`Lobby: http://localhost:${PORT}`);
    console.log(`Connect 4 PG directly: http://localhost:${PORT}/games/connect4/board/lobby?debug=true`);
});

// cpu_ai.js - Shared CPU opponent logic for all games
const rankValues = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
const lovenseHelper = require('./lovense_helper.js');

function makeMove(gameName, game, gameIo, checkWin, checkDraw, getWinLength) {
    if (game.status !== 'playing') return;
    const isChessCpuTurn = (gameName === 'chess' && game.turn === 'black');
    const isCheckersCpuTurn = (gameName === 'checkers' && game.turn === -1);
    const isGeneralCpuTurn = (game.turn === 2);
    if (!isChessCpuTurn && !isCheckersCpuTurn && !isGeneralCpuTurn) return;

    setTimeout(() => {
        try {
            switch (gameName) {
                case 'tictactoe':
                    resolveTicTacToe(game, gameIo, checkWin, checkDraw);
                    break;
                case 'reversi':
                    resolveReversi(game, gameIo, checkWin, checkDraw);
                    break;
                case 'checkers':
                    resolveCheckers(game, gameIo, checkWin, checkDraw);
                    break;
                case 'chess':
                    resolveChess(game, gameIo);
                    break;
                case 'navalclash':
                    resolveNavalClash(game, gameIo);
                    break;
                case 'dotsandboxes':
                    resolveDotsAndBoxes(game, gameIo);
                    break;
                case 'memorymatch':
                    resolveMemoryMatch(game, gameIo);
                    break;
                case 'navalclash':
                    resolveNavalClash(game, gameIo);
                    break;
                case 'blackjack':
                    resolveBlackjack(game, gameIo);
                    break;
                case 'uno':
                    resolveUno(game, gameIo);
                    break;
                case 'poker':
                    resolvePoker(game, gameIo);
                    break;
                case 'ginrummy':
                    resolveGinRummy(game, gameIo);
                    break;
                case 'gofish':
                    resolveGoFish(game, gameIo);
                    break;
                case 'war':
                    resolveWar(game, gameIo);
                    break;
                case 'solitaire':
                    // Solitaire CPU is continuous and initiated elsewhere, but we can register it
                    break;
                case 'speed':
                    // Speed CPU is continuous and initiated elsewhere
                    break;
            }
            triggerCpuVibe(game, gameName);
        } catch (err) {
            console.error(`Error executing CPU move for ${gameName}:`, err);
        }
    }, 1200);
}

function triggerCpuVibe(game, gameName) {
    if (gameName === 'chess') return; // Handled directly inside resolveChess
    let humanPlayer = null;
    if (game.player1 && game.player1.uuid !== 'cpu-bot' && !game.player1.uuid.startsWith('cpu')) {
        humanPlayer = game.player1;
    } else if (game.player2 && game.player2.uuid !== 'cpu-bot' && !game.player2.uuid.startsWith('cpu')) {
        humanPlayer = game.player2;
    }

    if (humanPlayer && humanPlayer.connected) {
        let type = null;
        if (game.status === 'won') {
            type = 'lose';
        } else if (game.status === 'playing') {
            if (gameName === 'navalclash') {
                const lastShot = game.shots2[game.shots2.length - 1];
                if (lastShot && lastShot.hit) {
                    type = 'hit';
                } else {
                    type = 'turn_alert';
                }
            } else {
                type = 'turn_alert';
            }
        }
        if (type) {
            lovenseHelper.triggerVibration(humanPlayer.uuid, type);
        }
    }
}

// -------------------------------------------------------------
// GAME-SPECIFIC SOLVERS
// -------------------------------------------------------------

function scoreTicTacToeCell(game, r, c, player, size, winLen) {
    let score = 0;
    const dirs = [
        [0, 1], [1, 0], [1, 1], [1, -1]
    ];
    for (let [dr, dc] of dirs) {
        let count = 1;
        let openEnds = 0;
        
        // Positive direction
        let step = 1;
        while (true) {
            const nr = r + dr * step;
            const nc = c + dc * step;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                if (game.board[nr][nc] === player) {
                    count++;
                } else {
                    if (game.board[nr][nc] === 0) openEnds++;
                    break;
                }
            } else {
                break;
            }
            step++;
        }
        
        // Negative direction
        step = 1;
        while (true) {
            const nr = r - dr * step;
            const nc = c - dc * step;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                if (game.board[nr][nc] === player) {
                    count++;
                } else {
                    if (game.board[nr][nc] === 0) openEnds++;
                    break;
                }
            } else {
                break;
            }
            step++;
        }
        
        // Dead end check: count total space (placed + empty) in this direction
        let space = 1;
        let s = 1;
        while (true) {
            const nr = r + dr * s;
            const nc = c + dc * s;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && (game.board[nr][nc] === player || game.board[nr][nc] === 0)) {
                space++;
            } else {
                break;
            }
            s++;
        }
        s = 1;
        while (true) {
            const nr = r - dr * s;
            const nc = c - dc * s;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && (game.board[nr][nc] === player || game.board[nr][nc] === 0)) {
                space++;
            } else {
                break;
            }
            s++;
        }
        
        if (space < winLen) continue; // Dead end corridor
        
        if (count >= winLen) {
            score += 10000;
        } else if (count === winLen - 1) {
            score += openEnds === 2 ? 2000 : 500;
        } else if (count === winLen - 2) {
            score += openEnds === 2 ? 400 : 100;
        } else if (count === winLen - 3) {
            score += openEnds === 2 ? 80 : 20;
        } else {
            score += count;
        }
    }
    return score;
}

function resolveTicTacToe(game, gameIo, checkWin, checkDraw) {
    const size = game.size || 3;
    const winLen = (size === 6) ? 4 : (size === 10) ? 5 : 3;

    // Find all empty cells
    const emptyCells = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (game.board[r][c] === 0) emptyCells.push({ r, c });
        }
    }
    if (emptyCells.length === 0) return;

    let chosen = emptyCells[Math.floor(Math.random() * emptyCells.length)];

    const isSmart = (game.difficulty === 'hard') || (game.difficulty === 'medium' && Math.random() >= 0.5);

    if (game.difficulty !== 'easy' && isSmart) {
        let bestCell = null;
        let maxScore = -1;

        for (let cell of emptyCells) {
            const attackScore = scoreTicTacToeCell(game, cell.r, cell.c, 2, size, winLen);
            const defenseScore = scoreTicTacToeCell(game, cell.r, cell.c, 1, size, winLen);

            let totalScore = 0;
            if (attackScore >= 10000) {
                totalScore = 100000 + attackScore;
            } else if (defenseScore >= 10000) {
                totalScore = 50000 + defenseScore;
            } else {
                totalScore = attackScore + defenseScore * 1.1;
                // Center-proximity bonus
                const distToCenter = Math.abs(cell.r - size / 2) + Math.abs(cell.c - size / 2);
                totalScore += (size * 2 - distToCenter) * 0.1;
            }

            if (totalScore > maxScore) {
                maxScore = totalScore;
                bestCell = cell;
            }
        }
        if (bestCell) {
            chosen = bestCell;
        }
    }

    game.board[chosen.r][chosen.c] = 2;
    const winResult = checkWin(game.board, size, winLen);
    if (winResult) {
        game.status = 'won';
        game.winner = 2;
        game.winCoords = winResult.coords;
    } else if (checkDraw(game.board, size)) {
        game.status = 'draw';
    } else {
        game.turn = 1;
    }
    gameIo.to(game.id).emit('update', game);
}

function resolveReversi(game, gameIo, checkWin, checkDraw) {
    function getReversiFlips(board, r, c, player) {
        if (board[r][c] !== 0) return [];
        const opponent = player === 1 ? 2 : 1;
        const flips = [];
        const dirs = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];

        for (let [dr, dc] of dirs) {
            let currR = r + dr;
            let currC = c + dc;
            const path = [];
            while (currR >= 0 && currR < 8 && currC >= 0 && currC < 8 && board[currR][currC] === opponent) {
                path.push([currR, currC]);
                currR += dr;
                currC += dc;
            }
            if (currR >= 0 && currR < 8 && currC >= 0 && currC < 8 && board[currR][currC] === player) {
                flips.push(...path);
            }
        }
        return flips;
    }

    function hasReversiMoves(board, player) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (getReversiFlips(board, r, c, player).length > 0) return true;
            }
        }
        return false;
    }

    const validMoves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const flips = getReversiFlips(game.board, r, c, 2);
            if (flips.length > 0) {
                validMoves.push({ r, c, flips });
            }
        }
    }

    if (validMoves.length === 0) {
        if (hasReversiMoves(game.board, 1)) {
            game.turn = 1;
        } else {
            // End Game
            resolveReversiEndGame(game);
        }
        gameIo.to(game.id).emit('update', game);
        return;
    }

    let chosen = null;
    const corners = [[0, 0], [0, 7], [7, 0], [7, 7]];
    const cornerMoves = validMoves.filter(m => corners.some(([cr, cc]) => cr === m.r && cc === m.c));

    if (game.difficulty === 'hard' || (game.difficulty === 'medium' && Math.random() < 0.5)) {
        if (cornerMoves.length > 0) {
            chosen = cornerMoves[Math.floor(Math.random() * cornerMoves.length)];
        } else {
            // Prioritize move with most flips
            validMoves.sort((a, b) => b.flips.length - a.flips.length);
            chosen = validMoves[0];
        }
    } else {
        chosen = validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    // Apply move
    game.board[chosen.r][chosen.c] = 2;
    chosen.flips.forEach(([fr, fc]) => {
        game.board[fr][fc] = 2;
    });

    // Toggle turn
    if (hasReversiMoves(game.board, 1)) {
        game.turn = 1;
    } else if (hasReversiMoves(game.board, 2)) {
        game.turn = 2; // CPU plays again
        // Trigger CPU again recursively via makeMove
        setTimeout(() => makeMove('reversi', game, gameIo), 1200);
    } else {
        resolveReversiEndGame(game);
    }

    gameIo.to(game.id).emit('update', game);
}

function resolveReversiEndGame(game) {
    let p1Count = 0;
    let p2Count = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (game.board[r][c] === 1) p1Count++;
            if (game.board[r][c] === 2) p2Count++;
        }
    }
    game.status = 'won';
    if (p1Count > p2Count) game.winner = 1;
    else if (p2Count > p1Count) game.winner = 2;
    else game.winner = 3; // Draw
}

function resolveCheckers(game, gameIo, checkWin, checkDraw) {
    function hasAnyLegalMoveForPlayer(board, playerVal) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece === 0) continue;
                if ((playerVal === 1 && piece < 0) || (playerVal === -1 && piece > 0)) continue;

                const isKing = Math.abs(piece) === 2;
                const dirs = [];
                if (isKing || playerVal === 1) dirs.push([-1, -1], [-1, 1]);
                if (isKing || playerVal === -1) dirs.push([1, -1], [1, 1]);

                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === 0) {
                        return true;
                    }

                    const jr = r + dr * 2;
                    const jc = c + dc * 2;
                    if (jr < 0 || jr > 7 || jc < 0 || jc > 7) continue;
                    const mid = board[nr][nc];
                    if (mid === 0) continue;

                    const isOpponentMid = (playerVal === 1 && mid < 0) || (playerVal === -1 && mid > 0);
                    if (isOpponentMid && board[jr][jc] === 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    const jumps = [];
    const regularMoves = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = game.board[r][c];
            if (piece === -1 || piece === -2) {
                const dirs = [[1, -1], [1, 1]];
                if (piece === -2) {
                    dirs.push([-1, -1], [-1, 1]);
                }

                for (let [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                        if (game.board[nr][nc] === 0) {
                            regularMoves.push({ from: [r, c], to: [nr, nc], capture: false });
                        } else if (game.board[nr][nc] > 0) {
                            const jr = nr + dr;
                            const jc = nc + dc;
                            if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8) {
                                if (game.board[jr][jc] === 0) {
                                    jumps.push({ from: [r, c], to: [jr, jc], mid: [nr, nc], capture: true });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let chosen = null;
    if (jumps.length > 0) {
        chosen = jumps[Math.floor(Math.random() * jumps.length)];
    } else if (regularMoves.length > 0) {
        chosen = regularMoves[Math.floor(Math.random() * regularMoves.length)];
    }

    if (!chosen) {
        game.status = 'won';
        game.winner = 1;
        gameIo.to(game.id).emit('update', game);
        return;
    }

    const fr = chosen.from[0];
    const fc = chosen.from[1];
    const tr = chosen.to[0];
    const tc = chosen.to[1];
    let piece = game.board[fr][fc];

    if (piece === -1 && tr === 7) {
        piece = -2;
    }

    game.board[tr][tc] = piece;
    game.board[fr][fc] = 0;

    if (chosen.capture) {
        game.board[chosen.mid[0]][chosen.mid[1]] = 0;
    }

    let redCount = 0;
    let blackCount = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (game.board[r][c] > 0) redCount++;
            if (game.board[r][c] < 0) blackCount++;
        }
    }

    if (redCount === 0) {
        game.status = 'won';
        game.winner = -1;
    } else if (blackCount === 0) {
        game.status = 'won';
        game.winner = 1;
    } else {
        game.turn = 1;
        if (!hasAnyLegalMoveForPlayer(game.board, 1)) {
            game.status = 'won';
            game.winner = -1;
        }
    }

    gameIo.to(game.id).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });
}

function resolveChess(game, gameIo) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = game.board[r][c];
            if (piece && piece.startsWith('b')) {
                const type = piece[1];
                if (type === 'p') {
                    if (r + 1 < 8 && !game.board[r+1][c]) {
                        moves.push({ from: [r, c], to: [r+1, c], weight: 0 });
                        if (r === 1 && !game.board[r+2][c]) {
                            moves.push({ from: [r, c], to: [r+2, c], weight: 0 });
                        }
                    }
                    for (let dc of [-1, 1]) {
                        if (r + 1 < 8 && c + dc >= 0 && c + dc < 8) {
                            const tgt = game.board[r+1][c+dc];
                            if (tgt && tgt.startsWith('w')) {
                                moves.push({ from: [r, c], to: [r+1, c+dc], weight: getPieceValue(tgt[1]) });
                            }
                        }
                    }
                } else {
                    const dirs = [];
                    let step = 8;
                    if (type === 'r') { dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]); }
                    else if (type === 'b') { dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]); }
                    else if (type === 'q' || type === 'k') {
                        dirs.push([1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]);
                        if (type === 'k') step = 1;
                    } else if (type === 'n') {
                        dirs.push([2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]);
                        step = 1;
                    }

                    for (let [dr, dc] of dirs) {
                        for (let s = 1; s <= step; s++) {
                            const nr = r + dr * s;
                            const nc = c + dc * s;
                            if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
                            const tgt = game.board[nr][nc];
                            if (!tgt) {
                                moves.push({ from: [r, c], to: [nr, nc], weight: 0 });
                            } else {
                                if (tgt.startsWith('w')) {
                                    moves.push({ from: [r, c], to: [nr, nc], weight: getPieceValue(tgt[1]) });
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Filter moves to only keep those that do not leave the Black King in check
    const legalMoves = [];
    for (let mv of moves) {
        const tempBoard = game.board.map(row => [...row]);
        tempBoard[mv.to[0]][mv.to[1]] = tempBoard[mv.from[0]][mv.from[1]];
        tempBoard[mv.from[0]][mv.from[1]] = null;
        if (!isKingInCheck(tempBoard, 'b')) {
            legalMoves.push(mv);
        }
    }

    if (legalMoves.length === 0) {
        const inCheck = isKingInCheck(game.board, 'b');
        if (inCheck) {
            game.status = 'won';
            game.winner = 'white';
        } else {
            game.status = 'draw';
            game.winner = null;
        }
        game.checkState = null;
        gameIo.to(game.id).emit('update', game);
        return;
    }

    legalMoves.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    
    let chosen = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    if (game.difficulty === 'hard') {
        chosen = legalMoves[0];
    } else if (game.difficulty === 'medium') {
        chosen = Math.random() < 0.5 ? legalMoves[0] : legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    const fr = chosen.from[0];
    const fc = chosen.from[1];
    const tr = chosen.to[0];
    const tc = chosen.to[1];

    const piece = game.board[fr][fc];
    const targetPiece = game.board[tr][tc];

    game.board[tr][tc] = piece;
    game.board[fr][fc] = null;

    // Auto pawn promotion for Black
    if (piece === 'bp' && tr === 7) {
        game.board[tr][tc] = 'bq';
    }

    // Track captures
    if (targetPiece) {
        if (!game.captured) game.captured = { white: [], black: [] };
        if (targetPiece.startsWith('w')) {
            game.captured.white.push(targetPiece);
        } else if (targetPiece.startsWith('b')) {
            game.captured.black.push(targetPiece);
        }
    }

    game.turn = 'white';

    // Check for check/checkmate/stalemate on White after CPU moves
    const oppColor = 'white';
    const oppHasMoves = hasLegalMoves(game.board, 'w');
    const oppInCheck = isKingInCheck(game.board, 'w');

    game.checkState = oppInCheck ? oppColor : null;

    if (oppInCheck && !oppHasMoves) {
        game.status = 'won';
        game.winner = 'black';
    } else if (!oppInCheck && !oppHasMoves) {
        game.status = 'draw';
        game.winner = null;
    }

    // Trigger CPU move vibrations for the human player
    const humanPlayer = game.player1;
    if (humanPlayer && humanPlayer.connected && humanPlayer.toyEnabled) {
        const isCapture = targetPiece !== null;
        const vibeMode = game.vibeMode || 'fun';
        
        if (game.status === 'won') {
            lovenseHelper.triggerVibration(humanPlayer.uuid, 'lose');
        } else if (isCapture) {
            if (vibeMode === 'fun') {
                lovenseHelper.triggerVibration(humanPlayer.uuid, 'lose', { strength: 18, duration: 2 });
            } else {
                lovenseHelper.triggerVibration(humanPlayer.uuid, 'turn_alert', { strength: 10, duration: 1 });
            }
        } else {
            lovenseHelper.triggerVibration(humanPlayer.uuid, 'turn_alert');
        }
    }

    gameIo.to(game.id).emit('update', { game, lastMove: { from: [fr, fc], to: [tr, tc] } });
}

function getPieceValue(type) {
    if (type === 'k') return 1000;
    if (type === 'q') return 9;
    if (type === 'r') return 5;
    if (type === 'b' || type === 'n') return 3;
    return 1;
}

function resolveDotsAndBoxes(game, gameIo) {
    const board = game.board;
    if (!board) return;

    // Helper: count how many lines of a box are drawn
    function countBoxLines(br, bc) {
        let count = 0;
        if (board.hLines[br][bc]) count++;
        if (board.hLines[br+1][bc]) count++;
        if (board.vLines[br][bc]) count++;
        if (board.vLines[br][bc+1]) count++;
        return count;
    }

    const availableLines = [];

    // Horizontal Lines: 5 rows (0..4), 4 cols (0..3)
    for (let r = 0; r <= 4; r++) {
        for (let c = 0; c < 4; c++) {
            if (!board.hLines[r][c]) {
                // Determine boxes this line belongs to
                const associatedBoxes = [];
                if (r < 4) associatedBoxes.push([r, c]);
                if (r > 0) associatedBoxes.push([r-1, c]);

                // Classify move based on box lines count
                let isCompleting = false;
                let isBad = false; // creates 3rd line for opponent
                for (const [br, bc] of associatedBoxes) {
                    const linesDrawn = countBoxLines(br, bc);
                    if (linesDrawn === 3) isCompleting = true;
                    if (linesDrawn === 2) isBad = true;
                }

                availableLines.push({ type: 'H', r, c, isCompleting, isBad });
            }
        }
    }

    // Vertical Lines: 4 rows (0..3), 5 cols (0..4)
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c <= 4; c++) {
            if (!board.vLines[r][c]) {
                const associatedBoxes = [];
                if (c < 4) associatedBoxes.push([r, c]);
                if (c > 0) associatedBoxes.push([r, c-1]);

                let isCompleting = false;
                let isBad = false;
                for (const [br, bc] of associatedBoxes) {
                    const linesDrawn = countBoxLines(br, bc);
                    if (linesDrawn === 3) isCompleting = true;
                    if (linesDrawn === 2) isBad = true;
                }

                availableLines.push({ type: 'V', r, c, isCompleting, isBad });
            }
        }
    }

    if (availableLines.length === 0) return;

    let chosen = null;
    const completing = availableLines.filter(l => l.isCompleting);
    const safe = availableLines.filter(l => !l.isCompleting && !l.isBad);
    const bad = availableLines.filter(l => l.isBad);

    if (game.difficulty === 'hard' || (game.difficulty === 'medium' && Math.random() < 0.5)) {
        if (completing.length > 0) {
            chosen = completing[Math.floor(Math.random() * completing.length)];
        } else if (safe.length > 0) {
            chosen = safe[Math.floor(Math.random() * safe.length)];
        } else {
            chosen = bad[Math.floor(Math.random() * bad.length)];
        }
    } else {
        chosen = availableLines[Math.floor(Math.random() * availableLines.length)];
    }

    // Draw the line
    if (chosen.type === 'H') {
        board.hLines[chosen.r][chosen.c] = true;
    } else {
        board.vLines[chosen.r][chosen.c] = true;
    }

    // Check completed boxes
    let completedAny = false;
    const boxesToCheck = [];
    if (chosen.type === 'H') {
        if (chosen.r < 4) boxesToCheck.push([chosen.r, chosen.c]);
        if (chosen.r > 0) boxesToCheck.push([chosen.r - 1, chosen.c]);
    } else {
        if (chosen.c < 4) boxesToCheck.push([chosen.r, chosen.c]);
        if (chosen.c > 0) boxesToCheck.push([chosen.r, chosen.c - 1]);
    }

    boxesToCheck.forEach(([br, bc]) => {
        // Helper inline check box completed
        const top = board.hLines[br][bc];
        const bottom = board.hLines[br+1][bc];
        const left = board.vLines[br][bc];
        const right = board.vLines[br][bc+1];
        const isDone = top && bottom && left && right;

        if (isDone && board.boxes[br][bc] === 0) {
            board.boxes[br][bc] = 2; // claimed by CPU
            board.score2++;
            completedAny = true;
        }
    });

    if (completedAny) {
        // CPU gets another turn
        game.turn = 2;
        // Trigger CPU again recursively via makeMove
        setTimeout(() => makeMove('dotsandboxes', game, gameIo), 1200);
    } else {
        game.turn = 1; // Hand turn back to player
    }

    // Check win condition
    if (board.score1 + board.score2 === 16) {
        game.status = 'won';
        if (board.score1 > board.score2) game.winner = 1;
        else if (board.score2 > board.score1) game.winner = 2;
        else game.winner = 3;
    }

    gameIo.to(game.id).emit('update', game);
}

function resolveMemoryMatch(game, gameIo) {
    function sanitize(g) {
        return {
            id: g.id,
            player1: g.player1,
            player2: g.player2,
            score1: g.score1,
            score2: g.score2,
            turn: g.turn,
            status: g.status,
            winner: g.winner,
            lockBoard: g.lockBoard,
            board: g.board.map(card => ({
                id: card.id,
                state: card.state,
                emoji: (card.state === 'flipped' || card.state === 'matched') ? card.emoji : null
            }))
        };
    }

    game.cpuMemory = game.cpuMemory || {};
    game.board.forEach((card, index) => {
        if (card.state === 'flipped' || card.state === 'matched') {
            game.cpuMemory[index] = card.emoji;
        }
    });

    const memory = {};
    for (let idx in game.cpuMemory) {
        if (game.board[idx].state !== 'matched') {
            memory[idx] = game.cpuMemory[idx];
        }
    }

    const faceDownIndices = [];
    game.board.forEach((card, index) => {
        if (card.state === 'down') faceDownIndices.push(index);
    });
    if (faceDownIndices.length === 0) return;

    let choice1 = null;
    let choice2 = null;

    const valuesInMemory = {};
    for (let idx in memory) {
        const emoji = memory[idx];
        if (!valuesInMemory[emoji]) valuesInMemory[emoji] = [];
        valuesInMemory[emoji].push(parseInt(idx));
    }

    let knownPair = null;
    for (let emoji in valuesInMemory) {
        if (valuesInMemory[emoji].length >= 2) {
            knownPair = valuesInMemory[emoji].slice(0, 2);
            break;
        }
    }

    const difficulty = game.difficulty || 'medium';
    let rememberMatch = false;
    if (difficulty === 'hard') {
        rememberMatch = true;
    } else if (difficulty === 'medium') {
        rememberMatch = Math.random() < 0.5;
    }

    if (knownPair && rememberMatch) {
        choice1 = knownPair[0];
        choice2 = knownPair[1];
    } else {
        choice1 = faceDownIndices[Math.floor(Math.random() * faceDownIndices.length)];
        const emoji1 = game.board[choice1].emoji;
        let matchingIndex = null;
        for (let idx in memory) {
            if (parseInt(idx) !== choice1 && memory[idx] === emoji1) {
                matchingIndex = parseInt(idx);
                break;
            }
        }

        if (matchingIndex !== null && rememberMatch) {
            choice2 = matchingIndex;
        } else {
            const remaining = faceDownIndices.filter(idx => idx !== choice1);
            choice2 = remaining[Math.floor(Math.random() * remaining.length)];
        }
    }

    // Flip first card
    game.board[choice1].state = 'flipped';
    game.flippedCards = [choice1];
    game.cpuMemory[choice1] = game.board[choice1].emoji;
    gameIo.to(game.id).emit('update', sanitize(game));

    setTimeout(() => {
        if (game.status !== 'playing') return;

        // Flip second card
        game.board[choice2].state = 'flipped';
        game.flippedCards = [choice1, choice2];
        game.cpuMemory[choice2] = game.board[choice2].emoji;
        gameIo.to(game.id).emit('update', sanitize(game));

        setTimeout(() => {
            if (game.status !== 'playing') return;

            const card1 = game.board[choice1];
            const card2 = game.board[choice2];

            if (card1.emoji === card2.emoji) {
                // Match
                card1.state = 'matched';
                card2.state = 'matched';
                game.flippedCards = [];
                game.score2++;

                const matchedCount = game.board.filter(c => c.state === 'matched').length;
                if (matchedCount === 36) {
                    game.status = 'won';
                    if (game.score1 > game.score2) game.winner = 1;
                    else if (game.score2 > game.score1) game.winner = 2;
                    else game.winner = 3;
                }

                gameIo.to(game.id).emit('update', sanitize(game));

                if (game.status === 'playing') {
                    setTimeout(() => {
                        resolveMemoryMatch(game, gameIo);
                    }, 1200);
                }
            } else {
                // Mismatch
                game.lockBoard = true;
                gameIo.to(game.id).emit('update', sanitize(game));

                setTimeout(() => {
                    card1.state = 'down';
                    card2.state = 'down';
                    game.flippedCards = [];
                    game.lockBoard = false;
                    game.turn = 1;
                    gameIo.to(game.id).emit('update', sanitize(game));
                }, 1500);
            }
        }, 1500);
    }, 1500);
}

function resolveNavalClash(game, gameIo) {
    // Naval Clash CPU strike
    const hits = [];
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
            if (game.radar1[r][c] === 0) hits.push({ r, c }); // un-fired
        }
    }
    if (hits.length === 0) return;

    const chosen = hits[Math.floor(Math.random() * hits.length)];
    // Check if hit P1 ship
    const cellValue = game.grid1[chosen.r][chosen.c];
    if (cellValue > 0) {
        game.radar1[chosen.r][chosen.c] = 2; // Hit
        game.grid1[chosen.r][chosen.c] = -1; // Damaged
        // Extra turn on hit
        game.turn = 2;
    } else {
        game.radar1[chosen.r][chosen.c] = 1; // Miss
        game.turn = 1;
    }
    gameIo.to(game.id).emit('update', game);
}

function resolveBlackjack(game, gameIo) {
    // Dealer/CPU card decisions
    // In Blackjack Duel, Player 2 is CPU.
    // Stand or Hit based on hand value
    let score = calculateBlackjackHand(game.hand2);
    if (score < 17) {
        // Hit
        game.hand2.push(game.deck.pop());
        game.lastActionText = "Dealer hits.";
    } else {
        // Stand
        game.turn = 1;
        game.lastActionText = "Dealer stands.";
    }
    gameIo.to(game.id).emit('update', game);
}

function calculateBlackjackHand(hand) {
    let score = 0;
    let aces = 0;
    hand.forEach(c => {
        if (c.rank === 'A') aces++;
        else if (['K', 'Q', 'J'].includes(c.rank)) score += 10;
        else score += parseInt(c.rank);
    });
    for (let i = 0; i < aces; i++) {
        if (score + 11 <= 21) score += 11;
        else score += 1;
    }
    return score;
}

function resolveUno(game, gameIo) {
    // Uno CPU Move
    const topCard = game.discardPile[game.discardPile.length - 1];
    if (!topCard) return;

    // Filter out any undefined/null cards in hand
    const playable = game.hand2.filter(c => {
        if (!c) return false;
        // Match active color (can be wild color chosen by opponent) or value
        const matchesColor = c.color === game.activeColor || c.color === 'Wild';
        const matchesValue = c.value === topCard.value;
        return matchesColor || matchesValue;
    });

    if (playable.length > 0) {
        // Play first valid card
        const card = playable[0];
        const idx = game.hand2.indexOf(card);
        game.hand2.splice(idx, 1);
        game.discardPile.push(card);
        
        if (card.color === 'Wild') {
            // CyberBot chooses its most frequent color or fallback to Red
            const counts = { 'Red': 0, 'Blue': 0, 'Yellow': 0, 'Green': 0 };
            game.hand2.forEach(c => {
                if (c && counts[c.color] !== undefined) counts[c.color]++;
            });
            let bestColor = 'Red';
            let maxCount = -1;
            for (const col in counts) {
                if (counts[col] > maxCount) {
                    maxCount = counts[col];
                    bestColor = col;
                }
            }
            game.activeColor = bestColor;
        } else {
            game.activeColor = card.color;
        }

        // Handle special cards for turns
        if (card.value === 'Skip' || card.value === 'Reverse') {
            game.turn = 2; // CPU gets another turn
            // Schedule another CPU move
            setTimeout(() => {
                if (game.status === 'playing' && game.turn === 2) {
                    resolveUno(game, gameIo);
                }
            }, 1500);
        } else if (card.value === 'Draw2') {
            game.hand1.push(game.deck.pop() || createFreshDeckCard(game));
            game.hand1.push(game.deck.pop() || createFreshDeckCard(game));
            game.turn = 2; // CPU gets another turn
            setTimeout(() => {
                if (game.status === 'playing' && game.turn === 2) {
                    resolveUno(game, gameIo);
                }
            }, 1500);
        } else if (card.value === 'Draw4') {
            game.hand1.push(game.deck.pop() || createFreshDeckCard(game));
            game.hand1.push(game.deck.pop() || createFreshDeckCard(game));
            game.hand1.push(game.deck.pop() || createFreshDeckCard(game));
            game.hand1.push(game.deck.pop() || createFreshDeckCard(game));
            game.turn = 2; // CPU gets another turn
            setTimeout(() => {
                if (game.status === 'playing' && game.turn === 2) {
                    resolveUno(game, gameIo);
                }
            }, 1500);
        } else {
            game.turn = 1;
        }

        game.lastActionText = `CyberBot played ${card.color} ${card.value}.`;

        // Check win condition
        if (game.hand2.filter(c => c).length === 0) {
            game.status = 'won';
            game.winner = 2;
            game.lastActionText = "CyberBot wins the game!";
        }
    } else {
        // Draw card
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
        
        const drawn = game.deck.pop();
        if (drawn) {
            game.hand2.push(drawn);
            game.lastActionText = "CyberBot drew a card.";
        }
        game.turn = 1;
    }
    gameIo.to(game.id).emit('update', game);
}

function createFreshDeckCard(game) {
    const colors = ['Red', 'Blue', 'Yellow', 'Green'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw2'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const value = values[Math.floor(Math.random() * values.length)];
    return { color, value };
}

function resolvePoker(game, gameIo) {
    // Poker CPU fold/call decisions
    // CPU checks/calls
    game.turn = 1;
    gameIo.to(game.id).emit('update', game);
}

function resolveGinRummy(game, gameIo) {
    // Draw from Stock/Discard then Discard
    if (game.deck.length > 0) {
        game.hand2.push(game.deck.pop());
        // Discard first card
        game.discardPile.push(game.hand2.pop());
    }
    game.turn = 1;
    gameIo.to(game.id).emit('update', game);
}

function resolveGoFish(game, gameIo) {
    // CPU Asks player for rank it holds
    if (game.hand2.length > 0) {
        const rank = game.hand2[Math.floor(Math.random() * game.hand2.length)].rank;
        gameIo.to(game.id).emit('request_cpu_fish', { rank });
    }
}

function resolveWar(game, gameIo) {
    // CPU plays a card from hand
    if (game.hand2.length > 0) {
        game.playedCard2 = game.hand2.pop();
        game.turn = 1;
    }
    gameIo.to(game.id).emit('update', game);
}

function resolveNavalClash(game, gameIo) {
    const targeted = new Set(game.shots2.map(s => `${s.r},${s.c}`));
    let targetRow = null;
    let targetCol = null;

    let huntCoords = [];
    if (game.difficulty !== 'easy') {
        const hitShots = game.shots2.filter(s => s.hit && !s.sunkShip);
        for (const hit of hitShots) {
            const adjacents = [
                [hit.r - 1, hit.c],
                [hit.r + 1, hit.c],
                [hit.r, hit.c - 1],
                [hit.r, hit.c + 1]
            ];
            for (const [ar, ac] of adjacents) {
                if (ar >= 0 && ar < 10 && ac >= 0 && ac < 10 && !targeted.has(`${ar},${ac}`)) {
                    huntCoords.push([ar, ac]);
                }
            }
        }
    }

    if (game.difficulty === 'medium' && Math.random() < 0.5) {
        huntCoords = [];
    }

    if (huntCoords.length > 0) {
        const chosen = huntCoords[Math.floor(Math.random() * huntCoords.length)];
        targetRow = chosen[0];
        targetCol = chosen[1];
    } else {
        const candidates = [];
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 10; c++) {
                if (!targeted.has(`${r},${c}`)) {
                    if (game.difficulty === 'hard') {
                        if ((r + c) % 2 === 0) candidates.push([r, c]);
                    } else {
                        candidates.push([r, c]);
                    }
                }
            }
        }

        const pool = candidates.length > 0 ? candidates : (() => {
            const backup = [];
            for (let r = 0; r < 10; r++) {
                for (let c = 0; c < 10; c++) {
                    if (!targeted.has(`${r},${c}`)) backup.push([r, c]);
                }
            }
            return backup;
        })();

        if (pool.length > 0) {
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            targetRow = chosen[0];
            targetCol = chosen[1];
        }
    }

    if (targetRow === null || targetCol === null) return;

    let isHit = false;
    let sunkName = null;
    const targetShips = game.player1.ships;

    for (const ship of targetShips) {
        const hitSegment = ship.coords.find(([sr, sc]) => sr === targetRow && sc === targetCol);
        if (hitSegment) {
            isHit = true;
            const tempShots = [...game.shots2, { r: targetRow, c: targetCol, hit: true }];
            const isSunk = ship.coords.every(([sr, sc]) => 
                tempShots.some(s => s.r === sr && s.c === sc)
            );
            if (isSunk) {
                sunkName = ship.name;
            }
            break;
        }
    }

    const shotResult = { r: targetRow, c: targetCol, hit: isHit, sunkShip: sunkName };
    game.shots2.push(shotResult);

    const allSunk = game.player1.ships.every(ship => 
        ship.coords.every(([sr, sc]) => 
            game.shots2.some(s => s.r === sr && s.c === sc)
        )
    );

    if (allSunk) {
        game.status = 'won';
        game.winner = 2;
    } else {
        game.turn = 1;
    }

    gameIo.to(game.id).emit('update', game);
}

function isKingInCheck(board, color) {
    const colorChar = color[0];
    let kr = -1, kc = -1;
    const targetKing = colorChar === 'w' ? 'wk' : 'bk';
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] === targetKing) {
                kr = r;
                kc = c;
                break;
            }
        }
        if (kr !== -1) break;
    }
    
    if (kr === -1) return false;
    
    const oppColor = colorChar === 'w' ? 'b' : 'w';
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && piece.startsWith(oppColor)) {
                if (isValidMove(board, r, c, kr, kc)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function hasLegalMoves(board, color) {
    const colorChar = color[0];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && piece.startsWith(colorChar)) {
                for (let tr = 0; tr < 8; tr++) {
                    for (let tc = 0; tc < 8; tc++) {
                        if (isValidMove(board, r, c, tr, tc)) {
                            const tempBoard = board.map(row => [...row]);
                            tempBoard[tr][tc] = tempBoard[r][c];
                            tempBoard[r][c] = null;
                            if (!isKingInCheck(tempBoard, colorChar)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    return false;
}

function isValidMove(board, fr, fc, tr, tc) {
    if (fr === tr && fc === tc) return false;
    const piece = board[fr][fc];
    if (!piece) return false;

    const color = piece[0]; // 'w' or 'b'
    const type = piece[1]; // 'p', 'r', 'n', 'b', 'q', 'k'

    const target = board[tr][tc];
    if (target && target[0] === color) return false;

    const dr = tr - fr;
    const dc = tc - fc;

    switch (type) {
        case 'p': {
            if (color === 'w') {
                if (dc === 0) {
                    if (dr === -1 && !target) return true;
                    if (fr === 6 && dr === -2 && !board[5][fc] && !target) return true;
                } else if (Math.abs(dc) === 1 && dr === -1) {
                    if (target && target[0] === 'b') return true;
                }
            } else {
                if (dc === 0) {
                    if (dr === 1 && !target) return true;
                    if (fr === 1 && dr === 2 && !board[2][fc] && !target) return true;
                } else if (Math.abs(dc) === 1 && dr === 1) {
                    if (target && target[0] === 'w') return true;
                }
            }
            return false;
        }
        case 'n': {
            return (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2);
        }
        case 'r': {
            if (dr !== 0 && dc !== 0) return false;
            return isPathClear(board, fr, fc, tr, tc);
        }
        case 'b': {
            if (Math.abs(dr) !== Math.abs(dc)) return false;
            return isPathClear(board, fr, fc, tr, tc);
        }
        case 'q': {
            if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return false;
            return isPathClear(board, fr, fc, tr, tc);
        }
        case 'k': {
            return Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
        }
    }
    return false;
}

function isPathClear(board, fr, fc, tr, tc) {
    const stepR = Math.sign(tr - fr);
    const stepC = Math.sign(tc - fc);

    let r = fr + stepR;
    let c = fc + stepC;

    while (r !== tr || c !== tc) {
        if (board[r][c]) return false;
        r += stepR;
        c += stepC;
    }
    return true;
}

module.exports = { makeMove };

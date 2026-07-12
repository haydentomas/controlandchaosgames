# Game Terminal Upgrade - Handover Notes & Guidelines

Use this document to guide the next AI coding assistant in upgrading the remaining games (**Checkers, Reversi, Naval Clash, Tic Tac Toe, Dots and Boxes, and Memory Match**) to match the premium UX standard established in **Four in a Row** and **Chess**.

---

## 🎯 Goal
Upgrade the remaining games to inherit:
1. **Neon-Themed Responsive Layout**: Aspect-ratio grids, flex-aligned chat sidebars, pulsing headers, and fluid mobile bounds.
2. **WebRTC Voice Chat Integration**: Live peer-to-peer audio connection between players with mute/unmute visual toggles.
3. **Lovense Toy Connection and Badges**: Status indicators showing when a player has connected a toy, with modal QR scanning/code verification.
4. **Vibe Mode Toggles**: Toggle between `Normal` (vibrates on move/capture) and `Fun` (custom vibration patterns with chain pressures).
5. **Interactive Winner Toy Control Phase**: A 60s/120s phase at the end of the game where the winner controls the intensity and pattern of the loser's toy.
6. **Robust CPU AI Play**: Full win/lose and toy control support when playing against `CyberBot 🤖`.

---

## ⚠️ Critical Pitfalls & Lessons Learned (Read Before Coding!)

### 1. The Socket.io Serialization Loop (DO NOT STORE INTERVALS IN `game`)
* **The Pitfall**: Storing the `setInterval` handle directly inside the `game` object (e.g., `game.toyControlInterval = setInterval(...)`) attaches Node's internal `Timeout` structure. When Socket.io attempts to serialize the state payload via `socket.emit`, it encounters recursive bindings, triggering a server crash: `RangeError: Maximum call stack size exceeded`.
* **The Fix**: Always store intervals in a local module-level dictionary inside the server file:
  ```javascript
  const activeIntervals = {}; // Keyed by gameId
  
  // To set:
  activeIntervals[gameId] = setInterval(...);
  
  // To clear:
  if (activeIntervals[gameId]) {
      clearInterval(activeIntervals[gameId]);
      delete activeIntervals[gameId];
  }
  ```

### 2. Flexible Color Parameters (`color[0]`)
* **The Pitfall**: Some games pass full strings (`'white'` / `'black'`) for turn tracking, while movement validations or piece structures look for single characters (`'w'` / `'b'`).
* **The Fix**: Always parse the first character of the color variable (`color[0]`) when validating pieces or checks:
  ```javascript
  const colorChar = color[0]; // Works for both 'w'/'b' and 'white'/'black'
  ```

### 3. Crash-Safe Name Rendering
* **The Pitfall**: Attempting to render names from game player objects (e.g., `game.player2.name`) during unmatched or debugging states throws a null-reference exception and crashes the entire browser render loop.
* **The Fix**: Use safe fallback checks:
  ```javascript
  const p2Name = game.player2 ? game.player2.name : 'Opponent';
  ```

### 4. Interactive Test Buttons
* **Guidance**: Add mock buttons in your UI to test the Win/Lose overlays without playing a whole match:
  ```html
  <button id="btn-debug-test-win" class="btn-reset hidden" style="border-color: var(--neon-green) !important; color: var(--neon-green) !important;">TEST WIN</button>
  <button id="btn-debug-test-lose" class="btn-reset hidden" style="border-color: var(--neon-red) !important; color: var(--neon-red) !important;">TEST LOSE</button>
  ```
  Only reveal them in debug environments (e.g., if hosted on `localhost` or `127.0.0.1`).

---

## 🛠️ Step-by-Step Porting Instructions

For each remaining game:

### Step A: Update the Server Side
1. Mount the static path and register the module using `lovenseHelper.registerModule('game_name', games, gameIo)`.
2. Set up `/api/join-cpu` and `/api/set-difficulty` endpoints to initialize CPU status parameters (`game.isCpuMatch`, `game.difficulty`).
3. Inside the `/api/move` endpoint, check for win states:
   * **If CPU wins**: Set `game.status = 'won'`, `game.winner = 'black'` (or `2`), and initialize `game.toyControl` with CPU parameters. Trigger `gameIo.to(gameId).emit('update', game)`.
   * **If Player wins**: Initialize `game.toyControl` with player parameters (set `cpuNoToy: true` if CPU match).
4. Add the debug test endpoint `/api/debug/toy-control-test` mimicking Chess's setup.

### Step B: Update the Client HTML
1. Ensure the container has the sidebar (`match-chat`) and overlays (`toy-control-winner-overlay`, `toy-control-loser-overlay`, `toy-control-cpu-skipped-overlay`).
2. Add WebRTC voice chat signaling elements:
   * `<audio id="remote-audio" autoplay></audio>`
   * Visual voice indicator buttons (`btn-toggle-voice`).
3. Add the control status header containing:
   * `RESET MATCH`
   * `VIBE: FUN / NORMAL`
   * `🎯 GUIDES: ON / OFF` (if applicable)
   * `TEST WIN` / `TEST LOSE` (hidden by default)

### Step C: Update the Client JavaScript
1. Sync state values in the `socket.on('update')` loop. Make sure you parse `game.toyControl.active` to show the corresponding popup.
2. Bind the test buttons click handlers to hit `/api/debug/toy-control-test`.
3. Add the WebRTC signaling handlers (`voice_signal` listener) and mic checks using `navigator.mediaDevices.getUserMedia`.

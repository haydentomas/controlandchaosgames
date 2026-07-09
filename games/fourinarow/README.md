# Simple Connect 4 Game (Second Life integration)

This is a clean, simplified Connect 4 game designed to be played entirely inside Second Life (via Media-on-a-Prim). It uses Node.js for state tracking and rendering, and coordinates with an LSL script on the board prim.

## Folder Structure

* `server.js`: Lightweight Node.js server tracking board status, turn management, and game win/draw logic.
* `public/index.html`: Specator view showing player names and the neon-colored grid.
* `public/style.css`: Styles for the visual presentation and chip falling animations.
* `CC_Simple_Connect4_Terminal.lsl`: The LSL script to load onto your Connect 4 board prim.

## Local Installation & Run

1. Open PowerShell or command line.
2. Navigate to this directory:
   ```bash
   cd "e:\[C&C] Files\TheSimGame\Connect4"
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the server:
   ```bash
   npm start
   ```

The server will start on port `3000`.

## Second Life Setup

1. Copy the contents of `CC_Simple_Connect4_Terminal.lsl` into a new script inside your Connect 4 board prim.
2. Change the `SERVER_URL` variable at the top of the LSL script to your server's public URL (e.g. `http://connect4-simple.alekzane.co.uk` or your local development tunnels).
3. Save/reset the script.
4. Touch the board in SL:
   * Select **Red Player** to register.
   * Select **Yellow Player** to register.
   * Start clicking columns on the screen face in SL to drop coins and play!

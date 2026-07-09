# 🌐 Deploying the Node.js Game Terminal to xCloud

This guide outlines the exact steps and configurations required to deploy and run the Game Terminal server on **xCloud** successfully, covering the key settings, port issues, and deployment automation.

---

## 📋 Prerequisites

1. A public GitHub repository (e.g., `https://github.com/haydentomas/controlandchaosgames.git`).
2. A domain or subdomain pointed to your server (e.g., `games.controlandchaos.co.uk`).
3. An active server managed by xCloud (running OpenLiteSpeed or Nginx).

---

## 🛠️ Step-by-Step Setup Guide

### Step 1: Create the Site in xCloud
1. In your xCloud dashboard, click **Create Site** or **Add New Site**.
2. Select your server.
3. Choose the **Node.js** application type tab.
4. **⚠️ CRITICAL TOGGLE:** Turn on the **"Server-Side Rendering App" (SSR)** toggle. 
   * *Why?* If left off, xCloud configures the site as client-side static (CSR), which only serves static files and will fail to run your server script, causing routing loops. Turning SSR **on** enables process daemon management (PM2) and reverse proxy routing.
5. Select **Clone a Git Repository** and enter your repository details:
   * **Repository URL:** `https://github.com/haydentomas/controlandchaosgames.git`
   * **Branch:** `main`
6. Enter your domain name (e.g., `games.controlandchaos.co.uk`).
7. Click **Create** / **Deploy**.

---

### Step 2: Configure SSR Settings (Ports & Start Command)
Once the initial site setup is complete:
1. Go to your new site dashboard in xCloud.
2. Navigate to **Node.js** ➔ **SSR Configuration** in the left sidebar.
3. Configure the following:
   * **Port:** Choose an available port (e.g., `3005`, `3001`, or `8080`).
     * *Note:* If you see the error *"The site port number is already in use on this server"*, port `3000` is already taken by another application. Simply change it to another free number like `3005`. The application automatically binds to whatever port xCloud specifies via the `PORT` environment variable.
   * **Start Command:** Set the command to run your server entry point:
     ```bash
     $XCLOUD_NODE server.js
     ```
4. Save the configuration.

---

### Step 3: Configure the Post-Deployment Script
To automate dependency updates whenever you push code updates:
1. Navigate to **Git** or **Deployment Settings** in the xCloud site dashboard.
2. In the **Deployment Script** box, use xCloud's binary variables to install dependencies safely:
   ```bash
   # Install application dependencies
   $XCLOUD_NPM install
   ```
3. Make sure the **"Run this script after every deployment"** toggle is **enabled (ON)**.

---

## 🔄 Deploying Updates (Push-to-Deploy)

Now that git is set up, deploying updates is completely automated:

1. **Make changes** on your local machine.
2. **Commit and push** to GitHub:
   ```powershell
   git add .
   git commit -m "Describe your changes"
   git push origin main
   ```
3. xCloud will automatically receive the webhook, run the deployment script (`$XCLOUD_NPM install`), and restart your Node.js application process with zero downtime.

---

## 🧠 Server Architecture Notes (For Second Life / Multi-Room)

* **Independent Game Rooms:** The server utilizes path routing (`/games/connect4/board/:gameId`) to create isolated game rooms. 
* **Second Life Integration:** When rezzing a board in Second Life, load the Media-on-a-Prim (MOAP) URL using the board's unique Object UUID as the `:gameId`:
  ```text
  https://games.controlandchaos.co.uk/games/connect4/board/[SL_BOARD_OBJECT_UUID]
  ```
  This ensures multiple couples can play on different boards simultaneously without any overlapping matches or shared states.

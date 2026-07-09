// lovense_helper.js
const https = require('https');

// Lovense Credentials
const LOVENSE_TOKEN = "q9U33GxiMHTq0z1K3gEM3T70RJKPb_3MLlgD0ElnOLFlMN42OFJat-HTWQNIkMyL";

// Keeps track of active modules: { moduleName: { games, gameIo } }
const registeredModules = {};

/**
 * Registers a game module's state and Socket.io instance for connection updates
 */
function registerModule(name, games, gameIo) {
    registeredModules[name] = { games, gameIo };
    console.log(`[Lovense Helper] Registered module: ${name}`);
}

/**
 * Helper: Secure POST request to Lovense API
 */
function securePost(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

/**
 * Asynchronously fetch QR code and connection code from Lovense
 */
async function getQrCode(uuid, name) {
    try {
        console.log(`[Lovense Helper] Requesting QR code for ${name} (${uuid})`);
        const resJson = await securePost('https://api.lovense-api.com/api/lan/getQrCode', {
            token: LOVENSE_TOKEN,
            uid: uuid,
            v: 2,
            uname: name
        });
        
        if (resJson.code === 0 && resJson.data) {
            return {
                qrCode: resJson.data.qr,
                linkCode: resJson.data.code,
                error: null
            };
        } else {
            return {
                qrCode: null,
                linkCode: null,
                error: resJson.message || "Lovense API error"
            };
        }
    } catch (err) {
        return {
            qrCode: null,
            linkCode: null,
            error: err.message || "Failed to contact Lovense"
        };
    }
}

/**
 * Trigger vibration on toy associated with uuid
 */
async function triggerVibration(uid, type, options = {}) {
    if (!uid || uid.startsWith('cpu-') || uid.startsWith('browser_') || uid === 'cpu-bot') {
        return; // Bypassed for CPU bots or browser mocks
    }
    
    let strength = options.strength || 0;
    let duration = options.duration || 0;
    
    if (!strength) {
        switch (type) {
            case 'move':
                strength = 5;
                duration = 1;
                break;
            case 'turn_alert':
                strength = 7;
                duration = 1;
                break;
            case 'block':
                strength = 12;
                duration = 2;
                break;
            case 'threat':
                strength = 15;
                duration = 2;
                break;
            case 'hit':
                strength = 18;
                duration = 2;
                break;
            case 'miss':
                strength = 2;
                duration = 1;
                break;
            case 'win':
                strength = 12;
                duration = 3;
                break;
            case 'lose':
                strength = 20;
                duration = 4;
                break;
            default:
                return;
        }
    }
    
    if (!duration) {
        duration = 1;
    }
    
    try {
        console.log(`[Lovense Helper] Vibration Command: ${type} (strength ${strength}, duration ${duration}s) to UID ${uid}`);
        const resJson = await securePost('https://api.lovense-api.com/api/lan/v2/command', {
            token: LOVENSE_TOKEN,
            uid: uid,
            command: "Function",
            action: `Vibrate:${strength}`,
            timeSec: duration,
            apiVer: 2
        });
        console.log("[Lovense Helper] Command response:", resJson);
    } catch (err) {
        console.error("[Lovense Helper] Command failed:", err);
    }
}

/**
 * Unified callback endpoint to handle connection status changes from Lovense
 */
function handleCallback(req, res) {
    const { uid, status } = req.body;
    console.log(`[Lovense Helper] Received callback for UID: ${uid}, Status: ${status}`);
    
    if (!uid) {
        return res.status(400).send("Missing uid.");
    }
    
    const isConnected = (status === 1 || status === '1');
    
    // Look through all registered game rooms across all sub-modules
    for (const name in registeredModules) {
        const { games, gameIo } = registeredModules[name];
        for (const gameId in games) {
            const game = games[gameId];
            let updated = false;
            
            if (game.player1 && game.player1.uuid === uid) {
                game.player1.connected = isConnected;
                updated = true;
            }
            if (game.player2 && game.player2.uuid === uid) {
                game.player2.connected = isConnected;
                updated = true;
            }
            
            if (updated) {
                console.log(`[Lovense Helper] Updated connection for player ${uid} in game ${gameId} to: ${isConnected}`);
                gameIo.to(gameId).emit('update', game);
            }
        }
    }
    
    res.send("OK");
}

/**
 * Verify toy connection status directly with Lovense API
 */
async function verifyConnection(uid) {
    if (!uid || uid.startsWith('cpu-') || uid.startsWith('browser_') || uid === 'cpu-bot') {
        return { success: true }; // Treat mock players as connected
    }
    try {
        console.log(`[Lovense Helper] Verifying connection for UID: ${uid}`);
        // Send a command to check status. A vibration of 0 checks connection.
        const resJson = await securePost('https://api.lovense-api.com/api/lan/v2/command', {
            token: LOVENSE_TOKEN,
            uid: uid,
            command: "Function",
            action: "Vibrate:0",
            timeSec: 1,
            apiVer: 2
        });
        console.log("[Lovense Helper] Verification response:", resJson);
        // Lovense LAN responses vary by endpoint/version:
        // some return code 0, others return code 200/result true/message "Success".
        const message = (resJson.message || "").toString().toLowerCase();
        const isSuccessCode = (resJson.code === 0 || resJson.code === 200);
        const isSuccessMessage = (message === "success" || message.includes("success"));
        if (resJson.result === true || isSuccessCode || isSuccessMessage) {
            return { success: true };
        } else {
            return { success: false, error: resJson.message || `Code ${resJson.code}` };
        }
    } catch (err) {
        return { success: false, error: err.message || "Failed to contact Lovense" };
    }
}

module.exports = {
    registerModule,
    getQrCode,
    triggerVibration,
    handleCallback,
    verifyConnection
};

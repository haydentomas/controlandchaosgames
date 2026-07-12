const http = require('http');
const https = require('https');
const { URL } = require('url');

function createSlBridge(options = {}) {
    const cabinets = new Map();
    const logger = options.logger || console;
    const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 1000 * 60 * 30;

    function touchCabinet(cabinetId, callbackUrl) {
        cabinets.set(cabinetId, {
            callbackUrl,
            lastHeartbeat: Date.now()
        });
    }

    function pruneStaleCabinets() {
        const cutoff = Date.now() - ttlMs;
        for (const [cabinetId, record] of cabinets.entries()) {
            if (!record || record.lastHeartbeat < cutoff) {
                cabinets.delete(cabinetId);
            }
        }
    }

    function registerRoutes(app) {
        app.post('/api/sl/register', (req, res) => {
            const { cabinetId, callbackUrl } = req.body || {};

            if (!cabinetId || !callbackUrl) {
                return res.status(400).json({ error: 'Missing cabinetId or callbackUrl' });
            }

            touchCabinet(cabinetId, callbackUrl);
            logger.log(`[SL Bridge] Registered cabinet ${cabinetId}`);
            return res.json({ success: true, cabinetId });
        });

        app.post('/api/sl/heartbeat', (req, res) => {
            const { cabinetId } = req.body || {};
            const record = cabinetId ? cabinets.get(cabinetId) : null;

            if (!record) {
                return res.status(404).json({ error: 'Unknown cabinetId' });
            }

            record.lastHeartbeat = Date.now();
            cabinets.set(cabinetId, record);
            return res.json({ success: true });
        });

        app.get('/api/sl/cabinets', (req, res) => {
            const snapshot = Array.from(cabinets.entries()).map(([cabinetId, record]) => ({
                cabinetId,
                callbackUrl: record.callbackUrl,
                lastHeartbeat: record.lastHeartbeat
            }));

            return res.json(snapshot);
        });
    }

    function notifyMatchComplete(cabinetId, payload) {
        const cabinet = cabinets.get(cabinetId);
        if (!cabinet || !cabinet.callbackUrl) return false;

        const url = new URL(cabinet.callbackUrl);
        const body = JSON.stringify({
            event: 'match_complete',
            ...payload
        });

        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(requestOptions, res => {
            logger.log(`[SL Bridge] webhook status ${res.statusCode} for cabinet ${cabinetId}`);
        });

        req.on('error', err => {
            logger.error(`[SL Bridge] webhook failed for cabinet ${cabinetId}: ${err.message}`);
        });

        req.write(body);
        req.end();
        return true;
    }

    return {
        registerRoutes,
        notifyMatchComplete,
        pruneStaleCabinets,
        getCabinet(cabinetId) {
            return cabinets.get(cabinetId) || null;
        },
        touchCabinet,
        cabinets
    };
}

module.exports = { createSlBridge };


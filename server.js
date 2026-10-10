require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./src/routes/api');
const whatsappService = require('./src/services/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;
const startTime = Date.now();

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Helper to format uptime
function formatUptime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

// Health Check for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) });
});

// Root Landing & Status Dashboard
app.get('/', (req, res) => {
    const waStatus = whatsappService.getStatus();
    const uptimeMs = Date.now() - startTime;
    const memory = process.memoryUsage();
    const rssMB = (memory.rss / 1024 / 1024).toFixed(1);
    const heapMB = (memory.heapUsed / 1024 / 1024).toFixed(1);

    // If API client requests JSON
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.json({
            success: true,
            service: 'Qloudflow WhatsApp Automation API Gateway',
            status: 'operational',
            uptime: formatUptime(uptimeMs),
            whatsapp: waStatus,
            node: process.version,
            memory: { rss: `${rssMB} MB`, heap: `${heapMB} MB` }
        });
    }

    // Render high-end status landing page
    const statusColor = waStatus.status === 'connected' ? '#10b981' : (waStatus.status === 'connecting' ? '#f59e0b' : '#6366f1');
    const statusText = waStatus.status === 'connected' ? 'CONNECTED' : (waStatus.status === 'connecting' ? 'PAIRING IN PROGRESS' : 'READY FOR PAIRING');
    const statusBadgeBg = waStatus.status === 'connected' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Qloudflow WhatsApp Gateway • Service Operational</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b0f19;
            --card: rgba(17, 24, 39, 0.85);
            --border: rgba(255, 255, 255, 0.08);
            --primary: #6366f1;
            --accent: #06b6d4;
            --text: #f3f4f6;
            --muted: #9ca3af;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg);
            background-image: 
                radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(6, 182, 212, 0.12) 0px, transparent 50%);
            color: var(--text);
            font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }
        .container {
            width: 100%;
            max-width: 680px;
            background: var(--card);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 36px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 28px;
            flex-wrap: wrap;
            gap: 16px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 14px;
        }
        .logo-icon {
            width: 48px;
            height: 48px;
            border-radius: 14px;
            background: linear-gradient(135deg, #6366f1, #06b6d4);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 20px -5px rgba(99, 102, 241, 0.4);
        }
        .logo-icon svg { width: 26px; height: 26px; fill: white; }
        .title h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
        .title p { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .live-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 14px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 700;
            background: rgba(16, 185, 129, 0.12);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .pulse {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 12px #10b981;
            animation: pulse-glow 2s infinite;
        }
        @keyframes pulse-glow {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.4); opacity: 0.6; }
        }
        .status-hero {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 20px 24px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 16px;
        }
        .wa-status-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.5px;
            background: ${statusBadgeBg};
            color: ${statusColor};
            border: 1px solid ${statusColor}40;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 14px;
            margin-bottom: 28px;
        }
        .metric-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 16px;
        }
        .metric-card span { font-size: 11px; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
        .metric-card h3 { font-size: 16px; font-weight: 700; margin-top: 6px; font-family: 'JetBrains Mono', monospace; }
        .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 12px;
            color: var(--muted);
            border-top: 1px solid var(--border);
            padding-top: 20px;
            flex-wrap: wrap;
            gap: 12px;
        }
        .footer a {
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s;
        }
        .footer a:hover { color: #818cf8; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand">
                <div class="logo-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.34 5L2 22l5.18-1.34A9.955 9.955 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.05 16.5c-1.57 0-3.04-.45-4.29-1.22l-.31-.19-3.07.8.82-3-.2-.32A7.95 7.95 0 0 1 4.05 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8.5-8 8.5z"/></svg>
                </div>
                <div class="title">
                    <h1>Qloudflow WhatsApp Gateway</h1>
                    <p>Baileys v7 Multi-Device Automation Engine</p>
                </div>
            </div>
            <div class="live-badge">
                <span class="pulse"></span>
                <span>SERVICE LIVE</span>
            </div>
        </div>

        <div class="status-hero">
            <div>
                <p style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase;">WhatsApp Connection</p>
                <h2 style="font-size: 18px; font-weight: 800; margin-top: 4px;">
                    ${waStatus.phone ? '+' + waStatus.phone : 'Ready for QR Pairing'}
                </h2>
            </div>
            <div class="wa-status-pill">
                <span>●</span>
                <span>${statusText}</span>
            </div>
        </div>

        <div class="grid">
            <div class="metric-card">
                <span>Uptime</span>
                <h3>${formatUptime(uptimeMs)}</h3>
            </div>
            <div class="metric-card">
                <span>Node Runtime</span>
                <h3>${process.version}</h3>
            </div>
            <div class="metric-card">
                <span>Memory (RSS)</span>
                <h3>${rssMB} MB</h3>
            </div>
            <div class="metric-card">
                <span>Port</span>
                <h3>${PORT}</h3>
            </div>
        </div>

        <div class="footer">
            <span>&copy; ${new Date().getFullYear()} Qloudsoft Solutions &bull; Qloudflow Suite</span>
            <div>
                <a href="/health" target="_blank">Health Check JSON &rarr;</a>
            </div>
        </div>
    </div>
</body>
</html>`;

    res.send(html);
});

// Health check endpoint (always accessible for monitoring / Render pings)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Qloudflow WhatsApp Gateway',
        uptime: formatUptime(Date.now() - startTime),
        whatsapp: whatsappService.getStatus(),
        memory: process.memoryUsage()
    });
});

// API Key Middleware (applies only to protected /api routes)
app.use('/api', (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.API_KEY) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid API Key' });
    }
    next();
});

// API Routes
app.use('/api', apiRoutes);

// Process safety handlers
process.on('uncaughtException', (err) => {
    console.error('[WhatsApp API Server] Caught unhandled exception safely:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.warn('[WhatsApp API Server] Caught unhandled promise rejection safely:', reason?.message || reason);
});

// Initialize WhatsApp on startup if there is an existing session
whatsappService.connect().catch((err) => {
    console.warn('[WhatsApp API Server] Initial connection notice:', err.message);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`WhatsApp API Server running on port ${PORT} (0.0.0.0)`);
});

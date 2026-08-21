require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./src/routes/api');
const whatsappService = require('./src/services/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Key Middleware
app.use((req, res, next) => {
    // Exclude health check from API key requirement
    if (req.path === '/health') return next();

    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.API_KEY) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid API Key' });
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', memory: process.memoryUsage() });
});

// API Routes
app.use('/api', apiRoutes);

// Process safety handlers to prevent server from shutting down on Baileys disconnects/errors
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

app.listen(PORT, () => {
    console.log(`WhatsApp API Server running on port ${PORT}`);
});

const express = require('express');
const qrcode = require('qrcode');
const whatsappService = require('../services/whatsapp');

const router = express.Router();

// Get WhatsApp Status
router.get('/status', (req, res) => {
    const status = whatsappService.getStatus();
    res.json(status);
});

// Get QR Code
router.get('/qr', async (req, res) => {
    let qrText = whatsappService.getQr();

    // If no QR exists yet and not connected, trigger connect to generate one
    if (!qrText && whatsappService.status !== 'connected') {
        await whatsappService.connect(true);
        
        // Short poll for QR text (up to 3 seconds)
        for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 500));
            qrText = whatsappService.getQr();
            if (qrText) break;
        }
    }

    if (!qrText) {
        return res.status(404).json({
            success: false,
            message: 'QR code not available. Initializing connection...'
        });
    }

    try {
        const qrDataUrl = await qrcode.toDataURL(qrText, {
            margin: 2,
            scale: 8,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        });

        res.json({
            success: true,
            qr: qrDataUrl,
            expiresIn: 60
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to generate QR image.' });
    }
});

// Connect / Reconnect
router.post('/connect', async (req, res) => {
    await whatsappService.connect(true);
    res.json({
        success: true,
        message: 'Connection initiated.'
    });
});

// Logout
router.post('/logout', async (req, res) => {
    try {
        await whatsappService.logout();
        res.json({
            success: true,
            message: 'Logged out successfully.'
        });
    } catch (err) {
        res.json({
            success: true,
            message: 'Logged out.'
        });
    }
});

// Send Message
router.post('/messages/send', async (req, res) => {
    const { phone, message, clientMessageId } = req.body;
    
    if (!phone || !message) {
        return res.status(400).json({ success: false, message: 'Phone and message are required.' });
    }
    
    try {
        const result = await whatsappService.sendTextMessage(phone, message, clientMessageId);
        res.json({
            success: true,
            messageId: result?.key?.id,
            status: 'sent'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Send Media
router.post('/messages/send-media', async (req, res) => {
    const { phone, media_url, media_path, media_base64, mime_type, file_name, caption, clientMessageId } = req.body;
    
    if (!phone || (!media_url && !media_path && !media_base64)) {
        return res.status(400).json({ success: false, message: 'Phone and media_url, media_path, or media_base64 are required.' });
    }
    
    try {
        const source = media_base64 || media_path || media_url;
        const result = await whatsappService.sendMediaMessage(phone, source, caption, clientMessageId, {
            mime_type,
            file_name,
            original_url: media_url
        });
        res.json({
            success: true,
            messageId: result?.key?.id,
            status: 'sent'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get or Update Webhook Target URL
router.get('/webhook/config', (req, res) => {
    res.json({
        success: true,
        webhookUrl: whatsappService.getWebhookUrl()
    });
});

router.post('/webhook/config', (req, res) => {
    const { webhook_url } = req.body;
    if (!webhook_url) {
        return res.status(400).json({ success: false, message: 'webhook_url is required.' });
    }
    const updated = whatsappService.setWebhookUrl(webhook_url);
    res.json({
        success: updated,
        webhookUrl: whatsappService.getWebhookUrl(),
        message: updated ? 'Webhook URL configured successfully.' : 'Failed to update webhook URL.'
    });
});

// Get Unhandled Messages (for live polling fallback)
router.get('/messages/unhandled', (req, res) => {
    const sinceId = req.query.since || null;
    const messages = whatsappService.getUnhandledMessages(sinceId);
    res.json({
        success: true,
        count: messages.length,
        messages: messages
    });
});

module.exports = router;

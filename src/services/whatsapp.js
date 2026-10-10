const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

let currentWebhookUrl = process.env.WEBHOOK_URL || 'https://season4property.qloudsoft.in/api/webhooks/whatsapp/incoming';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Helper to send webhook (optional — if not set, messages are queued for polling)
async function sendWebhook(payload) {
    if (!currentWebhookUrl) {
        // Safe no-op: Messages are automatically stored in memory queue for client polling
        return;
    }
    try {
        console.log('[WhatsApp Webhook] Forwarding event to:', currentWebhookUrl);
        await axios.post(currentWebhookUrl, payload, {
            headers: {
                'X-Webhook-Signature': WEBHOOK_SECRET || 'mock-signature-for-now',
                'Accept': 'application/json',
                'Bypass-Tunnel-Reminder': 'true'
            },
            timeout: 10000
        });
        console.log('[WhatsApp Webhook] Event forwarded successfully!');
    } catch (err) {
        console.warn('[WhatsApp Webhook] Webhook notice:', err.message);
    }
}

class WhatsAppService {
    constructor() {
        this.sock = null;
        this.qr = null;
        this.status = 'disconnected';
        this.authDir = process.env.AUTH_DIR || './auth_info';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.isConnecting = false;
    }

    async connect(force = false) {
        if (this.status === 'connected' && !force) {
            return;
        }

        if (this.isConnecting && !force) {
            return;
        }

        this.isConnecting = true;
        this.status = 'connecting';

        if (force) {
            this.qr = null;
            this.reconnectAttempts = 0;
            if (this.sock) {
                try {
                    this.sock.end(undefined);
                } catch (e) {}
                this.sock = null;
            }
        }

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                logger: pino({ level: process.env.LOG_LEVEL || 'silent' }),
                browser: ['Qloudflow WhatsApp', 'Chrome', '1.0.0']
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qr = qr;
                    this.status = 'connecting';
                    console.log('New QR code received for pairing.');
                }

                if (connection === 'close') {
                    this.isConnecting = false;
                    this.status = 'disconnected';
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
                    const shouldReconnect = !isLoggedOut && statusCode !== DisconnectReason.connectionReplaced;
                    
                    console.log(`[WhatsApp API] Connection closed. StatusCode: ${statusCode} | Reason: ${lastDisconnect?.error?.message || 'Disconnected/Logged out'} | Reconnect: ${shouldReconnect}`);
                    
                    if (this.sock) {
                        try {
                            this.sock.ev.removeAllListeners();
                        } catch (e) {}
                    }

                    if (shouldReconnect) {
                        if (this.reconnectAttempts < this.maxReconnectAttempts) {
                            this.reconnectAttempts++;
                            const delay = Math.min(5000 * this.reconnectAttempts, 20000);
                            console.log(`[WhatsApp API] Reconnecting in ${delay / 1000}s (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                            setTimeout(() => {
                                this.connect(false).catch((err) => {
                                    console.warn('[WhatsApp API] Reconnect error:', err.message);
                                });
                            }, delay);
                        } else {
                            console.log('[WhatsApp API] Max reconnect attempts reached. Waiting for user action.');
                        }
                    } else {
                        console.log('[WhatsApp API] Device was unlinked / logged out from phone. Session cleared cleanly.');
                        this.sock = null;
                        this.qr = null;
                        this.reconnectAttempts = 0;
                        this.cleanAuthDir();
                    }
                } else if (connection === 'open') {
                    console.log('WhatsApp connection opened successfully!');
                    this.isConnecting = false;
                    this.status = 'connected';
                    this.qr = null;
                    this.reconnectAttempts = 0;

                    // Send connection confirmation message to the connected device
                    setTimeout(async () => {
                        try {
                            if (this.sock && this.sock.user && this.sock.user.id) {
                                const rawId = this.sock.user.id.split(':')[0].split('@')[0];
                                const selfJid = `${rawId}@s.whatsapp.net`;
                                const confirmationMessage = 
                                    `✅ *Device Connected Successfully!*\n\n` +
                                    `📱 *Phone Number:* +${rawId}\n` +
                                    `⚡ *Status:* Qloudflow WhatsApp Automation Suite Active\n` +
                                    `🤖 *Smart Auto-Responder:* Online & Ready\n` +
                                    `🕒 *Connected At:* ${new Date().toLocaleString()}\n\n` +
                                    `Your WhatsApp account is now linked. Incoming customer inquiries will be automatically handled.`;
                                
                                console.log(`Sending connection confirmation message to ${selfJid}...`);
                                await this.sock.sendMessage(selfJid, { text: confirmationMessage });
                                console.log('Connection confirmation message sent successfully!');
                            }
                        } catch (notifyErr) {
                            console.error('Failed to send connection confirmation message:', notifyErr.message);
                        }
                    }, 1500);
                }
            });

            // Listen for incoming messages
            this.sock.ev.on('messages.upsert', async (m) => {
                const msg = m.messages[0];
                if (!msg || !msg.message || msg.key.fromMe) return;

                const remoteJid = msg.key.remoteJid;
                const isGroup = remoteJid.endsWith('@g.us');
                
                // Determine real sender JID
                let senderJid = isGroup ? (msg.key.participant || msg.participant || remoteJid) : remoteJid;
                let realPhone = null;

                if (senderJid && senderJid.endsWith('@lid')) {
                    if (msg.key?.remoteJidAlt && !msg.key.remoteJidAlt.endsWith('@lid')) {
                        senderJid = msg.key.remoteJidAlt;
                    } else if (msg.key?.participantAlt && !msg.key.participantAlt.endsWith('@lid')) {
                        senderJid = msg.key.participantAlt;
                    } else if (msg.key?.participant && !msg.key.participant.endsWith('@lid')) {
                        senderJid = msg.key.participant;
                    }

                    if (!senderJid.endsWith('@s.whatsapp.net') && this.sock?.signalRepository?.lidMapping?.getPNForLID) {
                        try {
                            const resolved = await this.sock.signalRepository.lidMapping.getPNForLID(senderJid);
                            if (resolved) senderJid = resolved;
                        } catch (e) {}
                    }
                }

                if (senderJid && senderJid.includes('@s.whatsapp.net')) {
                    realPhone = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
                } else if (!isGroup) {
                    realPhone = senderJid.replace(/@s\.whatsapp\.net|@c\.us|@lid/g, '').split(':')[0].replace(/\D/g, '');
                }

                // Extract message text from any Baileys message structure
                const messageText = msg.message?.conversation 
                    || msg.message?.extendedTextMessage?.text 
                    || msg.message?.imageMessage?.caption 
                    || msg.message?.videoMessage?.caption 
                    || msg.message?.documentMessage?.caption 
                    || msg.message?.buttonsResponseMessage?.selectedButtonId 
                    || msg.message?.templateButtonReplyMessage?.selectedId 
                    || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.message?.ephemeralMessage?.message?.conversation 
                    || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text 
                    || msg.message?.viewOnceMessage?.message?.conversation 
                    || msg.message?.viewOnceMessage?.message?.extendedTextMessage?.text 
                    || msg.message?.viewOnceMessageV2?.message?.conversation 
                    || msg.message?.viewOnceMessageV2?.message?.extendedTextMessage?.text;

                if (messageText) {
                    console.log(`[WhatsApp API] Received message from ${remoteJid} (Sender: ${senderJid}, Phone: ${realPhone}): ${messageText}`);
                    const payload = {
                        event: 'message.received',
                        messageId: msg.key.id,
                        from: remoteJid,
                        whatsapp_id: remoteJid,
                        phone: realPhone,
                        real_phone: realPhone,
                        sender_jid: senderJid,
                        pushName: msg.pushName || 'WhatsApp User',
                        messageType: 'text',
                        message: messageText,
                        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString(),
                        isGroup: isGroup,
                        groupId: isGroup ? remoteJid : null,
                        mediaUrl: null
                    };

                    // Add to rolling in-memory buffer (fallback for cloud/local sync)
                    if (!this.incomingQueue) this.incomingQueue = [];
                    this.incomingQueue.push(payload);
                    if (this.incomingQueue.length > 100) {
                        this.incomingQueue.shift();
                    }

                    // Forward via Webhook
                    await sendWebhook(payload);
                }
            });

            // Message status delivery updates
            this.sock.ev.on('messages.update', async (updates) => {
                for (const update of updates) {
                    if (update.update.status) {
                        const statusMap = {
                            2: 'sent',
                            3: 'delivered',
                            4: 'read',
                            5: 'read'
                        };
                        const mappedStatus = statusMap[update.update.status];
                        if (mappedStatus) {
                            const rawPhone = update.key.remoteJid || '';
                            const cleanPhone = rawPhone.replace(/@s\.whatsapp\.net|@c\.us|@lid/g, '').replace(/\D/g, '') || rawPhone;
                            const payload = {
                                event: 'message.status',
                                messageId: update.key.id,
                                status: mappedStatus,
                                phone: cleanPhone,
                                whatsapp_id: rawPhone,
                                timestamp: new Date().toISOString()
                            };
                            await sendWebhook(payload);
                        }
                    }
                }
            });
        } catch (err) {
            this.isConnecting = false;
            this.status = 'disconnected';
            console.error('Error during WhatsApp connection initialization:', err);
            this.cleanAuthDir();
        }
    }

    async logout() {
        this.status = 'disconnected';
        this.qr = null;
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                if (this.sock.ws && this.sock.ws.readyState === 1) {
                    await this.sock.logout().catch(() => {});
                } else {
                    this.sock.end(undefined);
                }
            } catch (e) {}
            this.sock = null;
        }
        
        this.cleanAuthDir();
    }

    cleanAuthDir() {
        if (fs.existsSync(this.authDir)) {
            try {
                fs.rmSync(this.authDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
                console.log('[WhatsApp API] Auth directory cleaned successfully.');
            } catch (e) {
                console.warn('[WhatsApp API] Notice while cleaning auth directory:', e.message);
                try {
                    const files = fs.readdirSync(this.authDir);
                    for (const f of files) {
                        try { fs.unlinkSync(path.join(this.authDir, f)); } catch (_) {}
                    }
                } catch (_) {}
            }
        }
    }

    getStatus() {
        return {
            success: true,
            status: this.status,
            phone: this.sock?.user?.id ? this.sock.user.id.split(':')[0].split('@')[0] : null,
            name: this.sock?.user?.name || 'WhatsApp Account',
            qrAvailable: !!this.qr
        };
    }

    getQr() {
        return this.qr;
    }

    /**
     * Resolve incoming phone string into proper WhatsApp JID.
     * Maps LID to phone JID via Baileys Signal mapping if available.
     */
    async resolveJid(phone) {
        let jid = String(phone || '').trim();
        if (jid.endsWith('@g.us')) {
            return jid; // WhatsApp Group
        }
        if (jid.endsWith('@s.whatsapp.net')) {
            return jid;
        }
        if (jid.endsWith('@lid')) {
            const digits = jid.replace(/\D/g, '');
            if (digits.length >= 10 && digits.length <= 14) {
                return `${digits}@s.whatsapp.net`;
            }
            try {
                if (this.sock?.signalRepository?.lidMapping?.getPNForLID) {
                    const resolved = await this.sock.signalRepository.lidMapping.getPNForLID(jid);
                    if (resolved && resolved.endsWith('@s.whatsapp.net')) {
                        return resolved;
                    }
                }
            } catch (e) {}
            return jid;
        }
        const digits = jid.replace(/\D/g, '');
        return `${digits}@s.whatsapp.net`;
    }

    async sendTextMessage(phone, messageText, clientMessageId) {
        if (this.status !== 'connected' || !this.sock) {
            throw new Error('WhatsApp not connected');
        }

        const jid = await this.resolveJid(phone);
        console.log(`[WhatsApp API] Sending message to JID: ${jid} | Text: ${messageText.substring(0, 60)}...`);
        const result = await this.sock.sendMessage(jid, { text: messageText });
        console.log(`[WhatsApp API] Sent successfully to ${jid}, messageId:`, result?.key?.id);
        return result;
    }

    setWebhookUrl(url) {
        if (url && typeof url === 'string') {
            currentWebhookUrl = url.trim();
            console.log('[WhatsApp API] Webhook URL updated dynamically to:', currentWebhookUrl);
            return true;
        }
        return false;
    }

    getWebhookUrl() {
        return currentWebhookUrl;
    }

    getUnhandledMessages(sinceId = null) {
        if (!this.incomingQueue) this.incomingQueue = [];
        if (!sinceId) {
            return this.incomingQueue.slice(-30);
        }
        const index = this.incomingQueue.findIndex(m => m.messageId === sinceId);
        if (index === -1) {
            return this.incomingQueue.slice(-30);
        }
        return this.incomingQueue.slice(index + 1);
    }

    /**
     * Send Media Message (Optimized for Images, Videos, Audio, and Documents)
     * Completely decoupled from any static creative files.
     * Supports:
     * 1. Base64 strings (raw or data:URI)
     * 2. Direct Buffers
     * 3. Public HTTP/HTTPS URLs (downloaded directly via Axios into Buffer)
     * 4. Local filesystem paths
     */
    async sendMediaMessage(phone, mediaSource, caption = '', clientMessageId, options = {}) {
        if (this.status !== 'connected' || !this.sock) {
            throw new Error('WhatsApp not connected');
        }

        const jid = await this.resolveJid(phone);
        console.log(`[WhatsApp API] Sending media to JID: ${jid} | Caption: ${caption ? caption.substring(0, 60) : 'none'}...`);

        try {
            let buffer = null;
            let mimeType = options.mime_type || null;
            let fileName = options.file_name || null;
            let mediaUrl = options.original_url || null;

            if (Buffer.isBuffer(mediaSource)) {
                buffer = mediaSource;
            } else if (typeof mediaSource === 'string') {
                const cleanSource = mediaSource.trim();

                // 1. Data URI (e.g. data:image/jpeg;base64,... or data:video/mp4;base64,...)
                if (cleanSource.startsWith('data:')) {
                    const match = cleanSource.match(/^data:([^;]+);base64,(.+)$/s);
                    if (match) {
                        mimeType = match[1];
                        buffer = Buffer.from(match[2], 'base64');
                    } else {
                        const cleanBase64 = cleanSource.replace(/^data:[^;]+;base64,/, '');
                        buffer = Buffer.from(cleanBase64, 'base64');
                    }
                }
                // 2. Pure Base64 String
                else if (cleanSource.length > 300 && !cleanSource.startsWith('http') && !cleanSource.includes('/') && !cleanSource.includes('\\')) {
                    buffer = Buffer.from(cleanSource, 'base64');
                }
                // 3. Local File Path
                else if (fs.existsSync(cleanSource)) {
                    buffer = fs.readFileSync(cleanSource);
                    fileName = fileName || path.basename(cleanSource);
                }
                // 4. Remote HTTP/HTTPS URL
                else if (cleanSource.startsWith('http://') || cleanSource.startsWith('https://')) {
                    mediaUrl = cleanSource;
                    console.log(`[WhatsApp API] Fetching media buffer from URL: ${cleanSource}...`);
                    const response = await axios.get(cleanSource, {
                        responseType: 'arraybuffer',
                        timeout: 45000,
                        maxContentLength: 100 * 1024 * 1024 // Up to 100MB
                    });
                    buffer = Buffer.from(response.data);
                    if (!mimeType && response.headers['content-type']) {
                        mimeType = response.headers['content-type'].split(';')[0].trim();
                    }
                    if (!fileName) {
                        try {
                            const urlPath = new URL(cleanSource).pathname;
                            fileName = path.basename(urlPath);
                        } catch (e) {}
                    }
                } else {
                    buffer = Buffer.from(cleanSource);
                }
            }

            if (!buffer || buffer.length === 0) {
                throw new Error('Could not resolve valid media buffer.');
            }

            const lowerFileName = (fileName || mediaUrl || '').toLowerCase();

            // Detect if Video
            const isVideo = (mimeType && mimeType.startsWith('video/')) 
                || lowerFileName.endsWith('.mp4') 
                || lowerFileName.endsWith('.mov') 
                || lowerFileName.endsWith('.avi') 
                || lowerFileName.endsWith('.3gp') 
                || lowerFileName.endsWith('.mkv') 
                || lowerFileName.endsWith('.webm');

            // Detect if Audio
            const isAudio = (mimeType && mimeType.startsWith('audio/')) 
                || lowerFileName.endsWith('.mp3') 
                || lowerFileName.endsWith('.ogg') 
                || lowerFileName.endsWith('.wav') 
                || lowerFileName.endsWith('.m4a') 
                || lowerFileName.endsWith('.aac') 
                || lowerFileName.endsWith('.opus');

            // Detect if Document
            const isDocument = (mimeType && (mimeType.startsWith('application/') || mimeType.startsWith('text/'))) 
                || lowerFileName.endsWith('.pdf') 
                || lowerFileName.endsWith('.docx') 
                || lowerFileName.endsWith('.xlsx') 
                || lowerFileName.endsWith('.csv') 
                || lowerFileName.endsWith('.zip');

            let messageOptions;

            if (isVideo) {
                messageOptions = {
                    video: buffer,
                    caption: caption || undefined,
                    mimetype: mimeType || 'video/mp4',
                    ptv: false
                };
            } else if (isAudio) {
                messageOptions = {
                    audio: buffer,
                    mimetype: mimeType || 'audio/mp4',
                    ptt: true
                };
            } else if (isDocument) {
                messageOptions = {
                    document: buffer,
                    caption: caption || undefined,
                    mimetype: mimeType || 'application/pdf',
                    fileName: fileName || 'document.pdf'
                };
            } else {
                // Default: Image
                messageOptions = {
                    image: buffer,
                    caption: caption || undefined,
                    mimetype: mimeType || 'image/jpeg'
                };
            }

            const result = await this.sock.sendMessage(jid, messageOptions);
            console.log(`[WhatsApp API] Media sent successfully to ${jid}, messageId:`, result?.key?.id);
            return result;
        } catch (mediaErr) {
            console.warn(`[WhatsApp API] Media sending failed (${mediaErr.message}), falling back to text reply...`);
            if (caption) {
                return await this.sendTextMessage(phone, caption, clientMessageId);
            }
            throw mediaErr;
        }
    }
}

module.exports = new WhatsAppService();

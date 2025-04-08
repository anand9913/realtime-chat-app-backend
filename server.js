// server.js (Relevant parts updated)
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin'); // Already included

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    // Optional: Add connection state recovery
    // connectionStateRecovery: {
    //     maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    //     skipMiddlewares: true,
    // }
});

// --- Firebase Admin SDK Initialization ---
// ... (Initialization code remains the same) ...
try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) throw new Error("...");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) { // ... (Error handling remains the same) ...
     console.error("!!! Firebase Admin SDK Initialization Failed !!!");
     process.exit(1); // Exit if Firebase Admin is critical and fails to load
}

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Routes ---
app.get('/', (req, res) => res.redirect('/login.html'));

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    // Initially, the socket is unauthenticated
    socket.user = null;

    // --- Handle Authentication Attempt from Client ---
    socket.on('authenticate', async (idToken) => {
        if (socket.user) { // Prevent re-authentication
            console.log(`Socket ${socket.id} already authenticated as ${socket.user.uid}.`);
            return;
        }
        if (!idToken) {
            console.log(`Socket ${socket.id} tried to authenticate without a token.`);
             socket.emit('authenticationFailed', { message: 'No token provided.'});
            socket.disconnect();
            return;
        }
        console.log(`Socket ${socket.id} attempting authentication...`);
        try {
            // Verify the ID token using Firebase Admin SDK
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const uid = decodedToken.uid;
            const phoneNumber = decodedToken.phone_number; // Should be available

            console.log(`Socket ${socket.id} authenticated successfully as UID: ${uid}, Phone: ${phoneNumber}`);

            // Store verified user info on the socket object
            socket.user = {
                uid: uid,
                phoneNumber: phoneNumber,
                // Add other details if needed (e.g., name from token if set)
                // name: decodedToken.name
            };

            // Add socket to a room identified by their UID (for direct messages)
            socket.join(uid);
            console.log(`Socket ${socket.id} joined room: ${uid}`);

            // TODO: Update user presence status in DB (e.g., set isOnline=true)

            // Send confirmation back to the client with verified user data
            socket.emit('authenticationSuccess', { uid: uid, phoneNumber: phoneNumber });

        } catch (error) {
            console.error(`Socket ${socket.id} authentication failed:`, error.message);
            // Send specific failure message
             socket.emit('authenticationFailed', { message: 'Invalid or expired token.'});
            // Disconnect socket if authentication fails
            socket.disconnect();
        }
    });

    // --- Handle Sending Messages (Protected) ---
    socket.on('sendMessage', (messageData) => {
        // IMPORTANT: Check if the socket has been authenticated
        if (!socket.user) {
            console.log(`Unauthenticated socket ${socket.id} tried to send message.`);
            socket.emit('error', { message: 'Authentication required to send messages.' }); // Inform client
            return;
        }

        const senderUid = socket.user.uid;
        const recipientUid = messageData.recipientUid; // Assuming client sends this
        const content = messageData.content;

        if (!recipientUid || !content) {
             console.log(`Missing recipient or content from sender ${senderUid}`);
              socket.emit('error', { message: 'Message format incorrect.' });
             return;
        }

        console.log(`Message from ${senderUid} to ${recipientUid}: ${content}`);

        // 1. TODO: Save message to Database
        //    const message = { sender: senderUid, recipient: recipientUid, content: content, timestamp: new Date(), status: 'sent' };
        //    db.saveMessage(message).then(savedMsg => { ... });

        // 2. Emit message to the recipient's room (using their UID as room name)
        //    This only works if the recipient is currently connected.
        io.to(recipientUid).emit('receiveMessage', {
             // Ideally send the full message object from DB after saving
             sender: senderUid,
             content: content,
             timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), // Use server time ideally from DB
             // id: savedMsg.id // Include DB id
        });

        // 3. Optional: Send confirmation back to sender (e.g., with DB ID/status)
         socket.emit('messageSentConfirmation', { tempId: messageData.tempId || null, status: 'delivered_to_server' }); // Acknowledge receipt by server

        // 4. TODO: Handle offline message queueing / push notifications if recipient is not in the room/connected
    });


    // --- Handle Typing Indicators (Protected) ---
    socket.on('typing', (data) => {
         if (!socket.user) return; // Must be authenticated

         const recipientUid = data.recipientUid;
         const isTyping = data.isTyping;
          if (!recipientUid) return;

         // Broadcast typing status only to the specific recipient
         // Use socket.to() instead of io.to() to avoid sending to sender
         socket.to(recipientUid).emit('typingStatus', {
             senderUid: socket.user.uid,
             isTyping: isTyping
         });
    });


    // --- Handle Disconnection ---
    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        if (socket.user) {
            console.log(`User ${socket.user.uid} disconnected.`);
            // TODO: Update user presence status in DB (e.g., set isOnline=false, lastSeen=now)
            // Leave UID room (usually happens automatically on disconnect)
            // socket.leave(socket.user.uid);
        }
        // Clean up any other user-specific data associated with the socket
    });

    // Handle connection errors
    socket.on('connect_error', (err) => {
        console.error(`Socket ${socket.id} connect_error: ${err.message}`);
    });
});


// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access the app at: http://localhost:${PORT}`);
});
server.on('error', (error) => console.error('Server Error:', error));
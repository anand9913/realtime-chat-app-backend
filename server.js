// server.js - Complete Version with DB Integration for Messages/Contacts (April 16, 2025)
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');
const db = require('./db'); // Import the database query function

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Firebase Admin SDK Initialization ---
try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY env var not set.");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("!!! Firebase Admin SDK Initialization Failed !!!", error);
    process.exit(1);
}

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Routes ---
app.get('/', (req, res) => res.redirect('/login.html'));

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.user = null; // User is initially unauthenticated

    // --- Handle Authentication Attempt ---
    socket.on('authenticate', async (idToken) => {
        if (socket.user) { console.log(`[AUTH] Socket ${socket.id} already authenticated.`); return; }
        if (!idToken) {
             console.log(`[AUTH] Socket ${socket.id} auth attempt failed: No token provided.`);
             socket.emit('authenticationFailed', { message: 'No token provided.' });
             socket.disconnect(); return;
        }
        console.log(`[AUTH] Socket ${socket.id} attempting authentication...`);
        let uid;
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            uid = decodedToken.uid;
            const phoneNumber = decodedToken.phone_number;
            if (!uid || !phoneNumber) throw new Error("Token missing UID or Phone Number.");
            console.log(`[AUTH] Token verified for UID: ${uid}`);

            let userProfile = null;
            const upsertQuery = `INSERT INTO users (uid, phone_number, last_seen) VALUES ($1, $2, NOW()) ON CONFLICT (uid) DO UPDATE SET last_seen = NOW() RETURNING uid, username, profile_pic_url`;
            const selectQuery = 'SELECT uid, username, profile_pic_url FROM users WHERE uid = $1';

            try {
                console.log(`[AUTH DB] Running upsertQuery for UID: ${uid}`);
                const { rows } = await db.query(upsertQuery, [uid, phoneNumber]);
                if (rows && rows.length > 0) {
                    userProfile = rows[0];
                    console.log(`[AUTH DB] User processed via INSERT/ON CONFLICT for ${uid}.`);
                } else {
                    console.warn(`[AUTH DB] Upsert RETURNING yielded no rows for ${uid}. Attempting SELECT.`);
                    const selectResult = await db.query(selectQuery, [uid]);
                    if (selectResult.rows && selectResult.rows.length > 0) { userProfile = selectResult.rows[0]; }
                    else { throw new Error(`DB Consistency Error: User ${uid} not found after token OK.`); }
                }
                if (!userProfile) throw new Error(`DB Error: Failed to retrieve profile data for ${uid}.`);
                console.log(`[AUTH DB] Fetched/Created Profile Data for ${uid}:`, { username: userProfile.username, profile_pic_url: userProfile.profile_pic_url });
            } catch (dbError) { throw new Error(`Database error during login: ${dbError.message}`); }

            socket.user = { uid: uid, phoneNumber: phoneNumber, username: userProfile.username ?? null, profilePicUrl: userProfile.profile_pic_url ?? null };
            console.log(`[AUTH STEP] Assigned data to socket.user for ${uid}:`, socket.user);
            socket.join(uid);
            console.log(`[AUTH STEP] Socket ${socket.id} joined room ${uid}.`);

            const successPayload = { uid: socket.user.uid, phoneNumber: socket.user.phoneNumber, username: socket.user.username, profilePicUrl: socket.user.profilePicUrl };
            console.log(`[AUTH EMIT] Emitting 'authenticationSuccess' for ${uid}:`, JSON.stringify(successPayload));
            socket.emit('authenticationSuccess', successPayload);
            console.log(`[AUTH EMIT] 'authenticationSuccess' emitted successfully for ${uid}.`);

        } catch (error) {
            let clientErrorMessage = 'Authentication failed. Please try again.';
            if (error.code === 'auth/id-token-expired' || error.message.includes('expired')) {
                 console.warn(`!!! Socket ${socket.id} Auth Failed: Expired Token !!! UID: ${uid || 'unknown'}`);
                 clientErrorMessage = 'Your session has expired. Please log in again.';
            } else { console.error(`!!! Socket ${socket.id} Authentication Failed Overall !!! UID: ${uid || 'unknown'}. Error:`, error.message); }
            socket.emit('authenticationFailed', { message: clientErrorMessage });
            socket.disconnect();
        }
    }); // End 'authenticate' handler

    // --- Handle Profile Updates ---
    socket.on('updateProfile', async (data) => {
        if (!socket.user) return socket.emit('profileUpdateError', { message: 'Auth required.' });
        const uid = socket.user.uid;
        const { username, profilePicUrl } = data;
        if (typeof username !== 'string' || typeof profilePicUrl !== 'string') return socket.emit('profileUpdateError', { message: 'Invalid data.' });
        const trimmedUsername = username.trim();
        const trimmedPicUrl = profilePicUrl.trim();
        if (trimmedUsername.length === 0) return socket.emit('profileUpdateError', { message: 'Username cannot be empty.' });
        if (trimmedUsername.length > 50) return socket.emit('profileUpdateError', { message: 'Username too long.' });

        console.log(`[PROFILE UPDATE] User ${uid} updating: Username='${trimmedUsername}', PicURL='${trimmedPicUrl}'`);
        try {
            const query = 'UPDATE users SET username = $1, profile_pic_url = $2 WHERE uid = $3 RETURNING username, profile_pic_url';
            const { rows, rowCount } = await db.query(query, [trimmedUsername, trimmedPicUrl || null, uid]);
            if (rowCount > 0) {
                const updatedProfile = rows[0];
                socket.user.username = updatedProfile.username; // Update socket state
                socket.user.profilePicUrl = updatedProfile.profile_pic_url;
                socket.emit('profileUpdateSuccess', { username: updatedProfile.username, profilePicUrl: updatedProfile.profile_pic_url });
                console.log(`[PROFILE UPDATE] Success for ${uid}`);
            } else { socket.emit('profileUpdateError', { message: 'User not found?' }); }
        } catch (dbError) {
             console.error(`[PROFILE UPDATE] DB Error for ${uid}:`, dbError);
             socket.emit('profileUpdateError', { message: 'DB error saving profile.' });
        }
    }); // End 'updateProfile' handler

    // --- Handle Sending Messages ---
    // Requires 'messages' table to exist
    socket.on('sendMessage', async (messageData) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required.' });

        const senderUid = socket.user.uid;
        const recipientUid = messageData.recipientUid; // For 1-on-1 chat
        const content = messageData.content?.trim(); // Trim content
        const tempId = messageData.tempId;

        if (!recipientUid || !content) return socket.emit('error', { message: 'Missing recipient or content.' });
        if (recipientUid === senderUid) return socket.emit('error', { message: 'Cannot send to self.' });

        console.log(`[MSG SEND] From ${senderUid} to ${recipientUid}: ${content.substring(0, 30)}...`);
        try {
            // 1. Save message to Database
            const insertMsgQuery = `
                INSERT INTO messages (sender_uid, recipient_uid, content)
                VALUES ($1, $2, $3)
                RETURNING message_id, sender_uid, recipient_uid, content, "timestamp", status
            `;
            const { rows } = await db.query(insertMsgQuery, [senderUid, recipientUid, content]);
            const savedMessage = rows[0];
            if (!savedMessage) throw new Error("Message failed to save to DB.");
            console.log(`[MSG SEND] Message saved to DB with ID: ${savedMessage.message_id}`);

            // 2. Emit message to recipient's room
            const messageForRecipient = {
                 id: savedMessage.message_id,
                 sender: savedMessage.sender_uid,
                 content: savedMessage.content,
                 timestamp: savedMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            };
            io.to(recipientUid).emit('receiveMessage', messageForRecipient);
            console.log(`[MSG SEND] Emitted 'receiveMessage' to room ${recipientUid}`);

            // 3. Send confirmation back to sender
             socket.emit('messageSentConfirmation', {
                  tempId: tempId || null,
                  dbId: savedMessage.message_id,
                  timestamp: savedMessage.timestamp,
                  status: savedMessage.status
             });
        } catch (dbError) {
             console.error(`[MSG SEND] DB/Emit error sending message from ${senderUid} to ${recipientUid}:`, dbError);
             socket.emit('error', { message: 'Failed to send message due to server error.' });
        }
    }); // End 'sendMessage' handler

    // --- Handle Request for Chat History ---
    // Requires 'messages' table
    socket.on('getChatHistory', async (data) => {
         if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
         const currentUserUid = socket.user.uid;
         const otherUserUid = data?.chatId; // Expecting other user's UID
         if (!otherUserUid) return socket.emit('error', { message: 'Chat ID missing.' });

         const limit = parseInt(data?.limit, 10) || 50;
         const offset = parseInt(data?.offset, 10) || 0;
         console.log(`[HISTORY] User ${currentUserUid} requesting history with ${otherUserUid}`);

         try {
             const query = `
                 SELECT message_id as id, sender_uid as sender, content, timestamp
                 FROM messages
                 WHERE (sender_uid = $1 AND recipient_uid = $2) OR (sender_uid = $2 AND recipient_uid = $1)
                 ORDER BY timestamp DESC LIMIT $3 OFFSET $4;
             `;
             const { rows } = await db.query(query, [currentUserUid, otherUserUid, limit, offset]);
             const history = rows.map(msg => ({
                 ...msg,
                 timestamp: msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
             })).reverse(); // Show oldest first in UI

             console.log(`[HISTORY] Sending ${history.length} messages for chat between ${currentUserUid} and ${otherUserUid}`);
             socket.emit('chatHistory', { chatId: otherUserUid, messages: history });
         } catch (dbError) {
              console.error(`[HISTORY] DB error fetching history for ${currentUserUid} & ${otherUserUid}:`, dbError);
              socket.emit('error', { message: 'Failed to load chat history.' });
         }
    }); // End 'getChatHistory' handler

    // --- Handle Request for Contact List ---
    // Requires 'contacts' and 'users' tables
    socket.on('getContacts', async () => {
         if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
         const currentUserUid = socket.user.uid;
         console.log(`[CONTACTS] User ${currentUserUid} requesting contact list.`);

         try {
              const query = `
                  SELECT u.uid as id, u.username, u.profile_pic_url as profilePicUrl
                  FROM users u JOIN contacts c ON u.uid = c.contact_uid
                  WHERE c.user_uid = $1 ORDER BY u.username ASC;
              `;
               // TODO: Add last message info later
              const { rows } = await db.query(query, [currentUserUid]);
              console.log(`[CONTACTS] Sending ${rows.length} contacts for user ${currentUserUid}`);
              socket.emit('contactList', rows);
         } catch (dbError) {
              console.error(`[CONTACTS] DB error fetching contacts for ${currentUserUid}:`, dbError);
              socket.emit('error', { message: 'Failed to load contacts.' });
         }
    }); // End 'getContacts' handler

    // --- Handle Add Contact ---
    // Requires 'contacts' and 'users' tables
    socket.on('addContact', async (contactUid) => {
         if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
         if (!contactUid || typeof contactUid !== 'string') return socket.emit('error', { message: 'Invalid contact UID.' });
         const currentUserUid = socket.user.uid;
         if (contactUid === currentUserUid) return socket.emit('addContactResult', { success: false, message: 'Cannot add self.' });

         console.log(`[CONTACTS] User ${currentUserUid} attempting to add contact ${contactUid}`);
         try {
              const { rows: userExists } = await db.query('SELECT 1 FROM users WHERE uid = $1', [contactUid]);
              if (userExists.length === 0) return socket.emit('addContactResult', { success: false, message: 'User not found.' });

              // Add both relationship directions, ignore if already exists
              const insertQuery = 'INSERT INTO contacts (user_uid, contact_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING';
              await db.query(insertQuery, [currentUserUid, contactUid]);
              await db.query(insertQuery, [contactUid, currentUserUid]); // Mutual
              console.log(`[CONTACTS] Contact relationship added/exists between ${currentUserUid} and ${contactUid}`);

               const { rows: contactDetails } = await db.query('SELECT uid as id, username, profile_pic_url as profilePicUrl FROM users WHERE uid = $1', [contactUid]);
               socket.emit('addContactResult', { success: true, message: 'Contact added!', contact: contactDetails[0] });
         } catch(dbError) {
              console.error(`[CONTACTS] DB error adding contact for ${currentUserUid}:`, dbError);
              socket.emit('addContactResult', { success: false, message: 'DB error adding contact.' });
         }
    }); // End 'addContact' handler

    // --- Handle Typing Indicators ---
    socket.on('typing', (data) => {
        if (!socket.user) return;
        const recipientUid = data?.recipientUid;
        if (!recipientUid) return;
        socket.to(recipientUid).emit('typingStatus', { senderUid: socket.user.uid, isTyping: data.isTyping === true });
    }); // End 'typing' handler

    // --- Handle Disconnection ---
    socket.on('disconnect', async (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        if (socket.user) {
            const uid = socket.user.uid;
            console.log(`User ${uid} disconnected.`);
            try { // Update last_seen
                await db.query('UPDATE users SET last_seen = NOW() WHERE uid = $1', [uid]);
                console.log(`Updated last_seen for user ${uid}.`);
            } catch (dbError) { console.error(`Failed to update last_seen for ${uid}:`, dbError); }
            // TODO: Broadcast presence update ('offline')
        }
    }); // End 'disconnect' handler

    // Handle low-level connection errors
    socket.on('connect_error', (err) => { console.error(`Socket ${socket.id} connect_error: ${err.message}`); });

}); // End io.on('connection')

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access the app locally at: http://localhost:${PORT}`);
});
server.on('error', (error) => {
    console.error('!!! Server Error !!!:', error);
    process.exit(1);
});
// server.js - Complete Version for Search-and-Chat with Contact Persistence (April 16, 2025)
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');
const db = require('./db'); // Ensure db.js is correctly configured

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
             console.log(`[AUTH] Socket ${socket.id} auth failed: No token.`);
             socket.emit('authenticationFailed', { message: 'No token provided.' });
             socket.disconnect(); return;
        }
        console.log(`[AUTH] Socket ${socket.id} attempting authentication...`);
        let uid;
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            uid = decodedToken.uid; const phoneNumber = decodedToken.phone_number;
            if (!uid || !phoneNumber) throw new Error("Token missing UID/Phone.");
            console.log(`[AUTH] Token verified for UID: ${uid}`);

            let userProfile = null;
            const upsertQuery = `INSERT INTO users (uid, phone_number, last_seen) VALUES ($1, $2, NOW()) ON CONFLICT (uid) DO UPDATE SET last_seen = NOW() RETURNING uid, username, profile_pic_url`;
            const selectQuery = 'SELECT uid, username, profile_pic_url FROM users WHERE uid = $1';
            try {
                console.log(`[AUTH DB] Running upsertQuery for UID: ${uid}`);
                const { rows } = await db.query(upsertQuery, [uid, phoneNumber]);
                if (rows && rows.length > 0) { userProfile = rows[0]; console.log(`[AUTH DB] User processed via Upsert.`); }
                else { console.warn(`[AUTH DB] Upsert RETURNING no rows for ${uid}. SELECTING.`); const selectResult = await db.query(selectQuery, [uid]); if (selectResult.rows && selectResult.rows.length > 0) { userProfile = selectResult.rows[0]; } else { throw new Error(`DB Error: User ${uid} not found.`); } }
                if (!userProfile) throw new Error(`DB Error: Failed to get profile data for ${uid}.`);
                console.log(`[AUTH DB] Fetched/Created Profile:`, { u: userProfile.username, p: userProfile.profile_pic_url });
            } catch (dbError) { console.error(`!!! [AUTH DB] Error for UID ${uid} !!!`, dbError); throw new Error(`Database error during login.`); }

            socket.user = { uid: uid, phoneNumber: phoneNumber, username: userProfile.username ?? null, profilePicUrl: userProfile.profile_pic_url ?? null };
            console.log(`[AUTH STEP] Assigned data to socket.user:`, socket.user);
            socket.join(uid); console.log(`[AUTH STEP] Socket ${socket.id} joined room ${uid}.`);

            const successPayload = { uid: socket.user.uid, phoneNumber: socket.user.phoneNumber, username: socket.user.username, profilePicUrl: socket.user.profilePicUrl };
            console.log(`[AUTH EMIT] Emitting 'authenticationSuccess' for ${uid}:`, JSON.stringify(successPayload));
            socket.emit('authenticationSuccess', successPayload);
            console.log(`[AUTH EMIT] 'authenticationSuccess' emitted successfully for ${uid}.`);
        } catch (error) {
            let clientErrorMessage = 'Auth failed.'; if (error.code === 'auth/id-token-expired' || error.message.includes('expired')) { clientErrorMessage = 'Session expired. Login again.'; } console.error(`!!! Socket ${socket.id} Auth Failed !!! UID: ${uid || 'unknown'}. Error:`, error.message); socket.emit('authenticationFailed', { message: clientErrorMessage }); socket.disconnect();
        }
    }); // End 'authenticate'

    // --- Handle Profile Updates ---
    socket.on('updateProfile', async (data) => {
        if (!socket.user) return socket.emit('profileUpdateError', { message: 'Auth required.' });
        const uid = socket.user.uid; const { username, profilePicUrl } = data;
        if (typeof username !== 'string' || typeof profilePicUrl !== 'string') return socket.emit('profileUpdateError', { message: 'Invalid data.' });
        const trimmedUsername = username.trim(); const trimmedPicUrl = profilePicUrl.trim();
        if (trimmedUsername.length === 0) return socket.emit('profileUpdateError', { message: 'Username empty.' });
        if (trimmedUsername.length > 50) return socket.emit('profileUpdateError', { message: 'Username too long.' });
        console.log(`[PROFILE UPDATE] User ${uid} updating: U='${trimmedUsername}', P='${trimmedPicUrl}'`);
        try {
            const query = 'UPDATE users SET username = $1, profile_pic_url = $2 WHERE uid = $3 RETURNING username, profile_pic_url';
            const { rows, rowCount } = await db.query(query, [trimmedUsername, trimmedPicUrl || null, uid]);
            if (rowCount > 0) {
                const updatedProfile = rows[0]; socket.user.username = updatedProfile.username; socket.user.profilePicUrl = updatedProfile.profile_pic_url;
                socket.emit('profileUpdateSuccess', { username: updatedProfile.username, profilePicUrl: updatedProfile.profile_pic_url }); console.log(`[PROFILE UPDATE] Success for ${uid}`);
            } else { socket.emit('profileUpdateError', { message: 'User not found?' }); }
        } catch (dbError) { console.error(`[PROFILE UPDATE] DB Error for ${uid}:`, dbError); socket.emit('profileUpdateError', { message: 'DB error.' }); }
    }); // End 'updateProfile'

    // --- Handle Sending Messages (Adds Contact on First Message) ---
    // Requires 'messages' and 'contacts' tables
    socket.on('sendMessage', async (messageData) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
        const senderUid = socket.user.uid; const recipientUid = messageData.recipientUid; const content = messageData.content?.trim(); const tempId = messageData.tempId;
        if (!recipientUid || !content) return socket.emit('error', { message: 'Missing recipient/content.' });
        if (recipientUid === senderUid) return socket.emit('error', { message: 'Cannot send to self.' });
        console.log(`[MSG SEND] From ${senderUid} to ${recipientUid}: ${content.substring(0, 30)}...`);
        let client = null;
        try {
            client = await db.pool.connect(); await client.query('BEGIN');

            // 1. Add contact relationship if first message (check one direction is enough)
            const checkContactQuery = 'SELECT 1 FROM contacts WHERE user_uid = $1 AND contact_uid = $2';
            const { rowCount } = await client.query(checkContactQuery, [senderUid, recipientUid]);
            if (rowCount === 0) {
                console.log(`[MSG SEND] First message detected. Adding contact relationship: ${senderUid} <-> ${recipientUid}`);
                const insertContactQuery = 'INSERT INTO contacts (user_uid, contact_uid) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING'; // Insert both ways
                await client.query(insertContactQuery, [senderUid, recipientUid]);
            }

            // 2. Save message to Database
            const insertMsgQuery = `INSERT INTO messages (sender_uid, recipient_uid, content) VALUES ($1, $2, $3) RETURNING message_id, "timestamp", status`;
            const { rows } = await client.query(insertMsgQuery, [senderUid, recipientUid, content]);
            const savedMessage = rows[0]; if (!savedMessage) throw new Error("Msg save failed.");
            console.log(`[MSG SEND] Message saved ID: ${savedMessage.message_id}`);

            await client.query('COMMIT'); // Commit transaction

            // 3. Emit message to recipient (include sender profile info)
            const messageForRecipient = {
                 id: savedMessage.message_id, sender: senderUid,
                 senderName: socket.user.username || senderUid, // Use current sender info
                 senderPic: socket.user.profilePicUrl,
                 content: content,
                 timestamp: savedMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            };
            io.to(recipientUid).emit('receiveMessage', messageForRecipient);
            console.log(`[MSG SEND] Emitted 'receiveMessage' to room ${recipientUid}`);

            // 4. Send confirmation back to sender
             socket.emit('messageSentConfirmation', { tempId: tempId || null, dbId: savedMessage.message_id, timestamp: savedMessage.timestamp, status: savedMessage.status });
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error(`[MSG SEND] Error processing message from ${senderUid} to ${recipientUid}:`, error);
            socket.emit('error', { message: 'Failed to send message.' });
        } finally { if (client) client.release(); }
    }); // End 'sendMessage'

    // --- Handle Request for Chat History ---
    // Requires 'messages' table
    socket.on('getChatHistory', async (data) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
        const currentUserUid = socket.user.uid; const otherUserUid = data?.chatId;
        if (!otherUserUid) return socket.emit('error', { message: 'Chat ID missing.' });
        const limit = 50; const offset = 0;
        console.log(`[HISTORY] User ${currentUserUid} requesting history with ${otherUserUid}`);
        try {
            const query = `SELECT message_id as id, sender_uid as sender, content, timestamp FROM messages WHERE (sender_uid = $1 AND recipient_uid = $2) OR (sender_uid = $2 AND recipient_uid = $1) ORDER BY timestamp DESC LIMIT $3 OFFSET $4;`;
            const { rows } = await db.query(query, [currentUserUid, otherUserUid, limit, offset]);
            const history = rows.map(msg => ({ ...msg, timestamp: msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) })).reverse();
            console.log(`[HISTORY] Sending ${history.length} messages for chat ${currentUserUid}<->${otherUserUid}`);
            socket.emit('chatHistory', { chatId: otherUserUid, messages: history });
        } catch (dbError) { console.error(`[HISTORY] DB error for ${currentUserUid}<->${otherUserUid}:`, dbError); socket.emit('error', { message: 'Failed to load history.' }); }
    }); // End 'getChatHistory'

    // --- Handle Request for Contact List ---
    // Requires 'contacts' and 'users' tables
    socket.on('getContacts', async () => {
         if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
         const currentUserUid = socket.user.uid;
         console.log(`[CONTACTS] User ${currentUserUid} requesting contact list.`);
         try {
              // Fetch contacts JOINED with user details
              // TODO: Add last message info later
              const query = `
                  SELECT u.uid as id, u.username, u.profile_pic_url as "profilePicUrl", u.last_seen as "lastSeen"
                  FROM users u JOIN contacts c ON u.uid = c.contact_uid
                  WHERE c.user_uid = $1 ORDER BY u.username ASC;
              `;
              const { rows } = await db.query(query, [currentUserUid]);
              console.log(`[CONTACTS] Sending ${rows.length} contacts for user ${currentUserUid}`);
              // TODO: Add online status here based on a separate online user map/set
              socket.emit('contactList', rows);
         } catch (dbError) {
              console.error(`[CONTACTS] DB error fetching contacts for ${currentUserUid}:`, dbError);
              socket.emit('error', { message: 'Failed to load contacts.' });
         }
    }); // End 'getContacts'

    // --- Handle User Search ---
    socket.on('searchUsers', async (searchTerm) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
        const currentUserUid = socket.user.uid; const term = (searchTerm || '').trim().toLowerCase();
        if (!term) return socket.emit('searchResultsUsers', []);
        console.log(`[SEARCH] User ${currentUserUid} searching for: "${term}"`);
        try {
            const query = `SELECT uid as id, username, profile_pic_url as "profilePicUrl" FROM users WHERE (LOWER(username) LIKE $1 OR phone_number LIKE $2) AND uid != $3 LIMIT 15;`;
            const pattern = `%${term}%`;
            const { rows } = await db.query(query, [pattern, pattern, currentUserUid]);
            console.log(`[SEARCH] Found ${rows.length} users matching "${term}"`);
            socket.emit('searchResultsUsers', rows);
        } catch (dbError) { console.error(`[SEARCH] DB error searching users by ${currentUserUid}:`, dbError); socket.emit('error', { message: 'Error searching users.' }); }
    }); // End 'searchUsers'

    // --- REMOVED 'addContact' handler ---

    // --- Handle Typing Indicators ---
    socket.on('typing', (data) => {
        if (!socket.user) return;
        const recipientUid = data?.recipientUid; if (!recipientUid) return;
        socket.to(recipientUid).emit('typingStatus', { senderUid: socket.user.uid, isTyping: data.isTyping === true });
    }); // End 'typing'

    // --- Handle Disconnection ---
    socket.on('disconnect', async (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        if (socket.user) {
            const uid = socket.user.uid; console.log(`User ${uid} disconnected.`);
            try { await db.query('UPDATE users SET last_seen = NOW() WHERE uid = $1', [uid]); console.log(`Updated last_seen for ${uid}.`); }
            catch (dbError) { console.error(`Failed to update last_seen for ${uid}:`, dbError); }
            // TODO: Broadcast 'offline' presence update
        }
    }); // End 'disconnect'

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
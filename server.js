// server.js - Complete, Updated & Verified Version (April 17, 2025)

// --- Imports and Setup ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');
const db = require('./db'); // PostgreSQL connection module

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- In-Memory Presence Tracking ---
// Map<uid: string, Set<socketId: string>>
const onlineUsers = new Map();
// ------------------------------------

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

// --- Helper Function to Get Contacts UIDs (for broadcasting presence) ---
async function getContactsOfUser(uid) {
    if (!uid) return [];
    try {
         // Find UIDs of users who have the input UID listed as their contact
         const query = 'SELECT user_uid FROM contacts WHERE contact_uid = $1';
         const { rows } = await db.query(query, [uid]);
         return rows.map(row => row.user_uid);
    } catch (error) {
         console.error(`[Presence Helper] Error fetching contacts FOR user ${uid}:`, error);
         return [];
    }
}

// ========================================
// --- Socket.IO Event Handling ---
// ========================================
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.user = null; // Attached after successful authentication

    // --- Authentication ---
    socket.on('authenticate', async (idToken) => {
        if (socket.user) { console.log(`[AUTH] Socket ${socket.id} already authenticated.`); return; }
        if (!idToken) { socket.emit('authenticationFailed', { message: 'No token provided.' }); socket.disconnect(); return; }

        console.log(`[AUTH] Socket ${socket.id} attempting authentication...`);
        let uid;
        try {
            // 1. Verify Token
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            uid = decodedToken.uid; const phoneNumber = decodedToken.phone_number;
            if (!uid || !phoneNumber) throw new Error("Token missing UID/Phone.");
            console.log(`[AUTH] Token verified for UID: ${uid}`);

            // 2. Database Interaction & Profile Fetch
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
            } catch (dbError) { throw new Error(`Database error during login: ${dbError.message}`); }

            // *** Start Presence Logic ***
            const wasOffline = !onlineUsers.has(uid) || onlineUsers.get(uid).size === 0;
            if (!onlineUsers.has(uid)) { onlineUsers.set(uid, new Set()); }
            onlineUsers.get(uid).add(socket.id);
            console.log(`[Presence] User ${uid} connected. Sockets: ${onlineUsers.get(uid).size}`);
            // *** End Presence Logic Check ***

            // 3. Assign data to socket
            socket.user = { uid: uid, phoneNumber: phoneNumber, username: userProfile.username ?? null, profilePicUrl: userProfile.profile_pic_url ?? null };
            console.log(`[AUTH STEP] Assigned data to socket.user:`, socket.user);

            // 4. Join Room
            socket.join(uid); console.log(`[AUTH STEP] Socket ${socket.id} joined room ${uid}.`);

            // 5. Emit Success Payload
            const successPayload = { uid: socket.user.uid, phoneNumber: socket.user.phoneNumber, username: socket.user.username, profilePicUrl: socket.user.profilePicUrl };
            console.log(`[AUTH EMIT] Emitting 'authenticationSuccess' for ${uid}:`, JSON.stringify(successPayload));
            socket.emit('authenticationSuccess', successPayload);
            console.log(`[AUTH EMIT] 'authenticationSuccess' emitted successfully for ${uid}.`);

            // *** Broadcast Online Status if First Connection ***
            if (wasOffline) {
                console.log(`[Presence] User ${uid} came online. Notifying contacts.`);
                const contactUids = await getContactsOfUser(uid);
                const presencePayload = { userId: uid, status: 'online' };
                 console.log(`[Presence] Broadcasting 'online' for ${uid} to ${contactUids.length} contacts.`);
                 contactUids.forEach(contactUid => { io.to(contactUid).emit('presenceUpdate', presencePayload); });
            }
            // *** End Broadcast ***

            // *** Send Initial Presence Status of Contacts TO This Client ***
             const contactsForClient = await getContactsOfUser(uid);
             const initialPresence = {};
             const userDetailsQuery = 'SELECT uid, last_seen FROM users WHERE uid = ANY($1::varchar[])';
             if (contactsForClient.length > 0) {
                  try {
                       const { rows: userDetails } = await db.query(userDetailsQuery, [contactsForClient]);
                       userDetails.forEach(u => {
                           const isOnline = onlineUsers.has(u.uid) && onlineUsers.get(u.uid).size > 0;
                           initialPresence[u.uid] = { status: isOnline ? 'online' : 'offline', lastSeen: isOnline ? null : u.last_seen };
                       });
                  } catch (dbErr) { console.error("[Presence] Error fetching contact details for initial status:", dbErr); }
             }
             console.log(`[Presence] Sending initial status for ${Object.keys(initialPresence).length} contacts to ${uid}`);
             socket.emit('initialPresenceStatus', initialPresence);
             // *** End Initial Presence Status ***

        } catch (error) { // Catch token verify errors or rethrown DB errors
            let clientErrorMessage = 'Auth failed.'; if (error.code === 'auth/id-token-expired' || error.message.includes('expired')) { clientErrorMessage = 'Session expired. Login again.'; } console.error(`!!! Socket ${socket.id} Auth Failed !!! UID: ${uid || 'unknown'}. Error:`, error.message); socket.emit('authenticationFailed', { message: clientErrorMessage }); socket.disconnect();
        }
    }); // End 'authenticate'

    // --- Profile Update ---
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

    // --- Send Message ---
    // Requires 'messages' and 'contacts' tables
    socket.on('sendMessage', async (messageData) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
        const senderUid = socket.user.uid; const recipientUid = messageData.recipientUid; const content = messageData.content?.trim(); const tempId = messageData.tempId;
        if (!recipientUid || !content) return socket.emit('error', { message: 'Missing recipient/content.' });
        if (recipientUid === senderUid) return socket.emit('error', { message: 'Cannot send to self.' });

        console.log(`[MSG SEND] From ${senderUid} to ${recipientUid}: ${content.substring(0, 30)}...`);
        console.log('[MSG SEND] Checking db object before transaction:', db); // Debug log
        if (!db || !db.pool || typeof db.pool.connect !== 'function') {
             console.error('!!! [MSG SEND] CRITICAL: db.pool or db.pool.connect is invalid !!!', db);
             return socket.emit('error', { message: 'Internal server error: DB connection pool unavailable.' });
        }

        let client = null; // DB client for transaction
        try {
            console.log('[MSG SEND] Attempting to get DB client from pool...');
            client = await db.pool.connect();
            console.log('[MSG SEND] DB client acquired. Beginning transaction...');
            await client.query('BEGIN');

            // 1. Add contact relationship if first message
            const checkContactQuery = 'SELECT 1 FROM contacts WHERE user_uid = $1 AND contact_uid = $2 LIMIT 1';
            const { rowCount } = await client.query(checkContactQuery, [senderUid, recipientUid]);
            if (rowCount === 0) {
                console.log(`[MSG SEND] First message: Adding contact relationship ${senderUid} <-> ${recipientUid}`);
                const insertContactQuery = 'INSERT INTO contacts (user_uid, contact_uid) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING';
                await client.query(insertContactQuery, [senderUid, recipientUid]);
            }

            // 2. Save message to Database
            // Ensure 'messages' table exists!
            const insertMsgQuery = `INSERT INTO messages (sender_uid, recipient_uid, content) VALUES ($1, $2, $3) RETURNING message_id, "timestamp", status, sender_uid, recipient_uid, content`; // Return more fields for debugging
            const { rows } = await client.query(insertMsgQuery, [senderUid, recipientUid, content]);
            const savedMessage = rows[0]; if (!savedMessage) throw new Error("Msg save failed.");
            console.log(`[MSG SEND] Message saved ID: ${savedMessage.message_id}`);

            await client.query('COMMIT'); // Commit transaction

            // 3. Emit message to recipient (include sender info)
            // const messageForRecipient = {
            //      id: savedMessage.message_id, sender: senderUid,
            //      senderName: socket.user.username || senderUid, // Current sender info from authenticated socket
            //      senderPic: socket.user.profilePicUrl, // Current sender info
            //      content: content,
            //      timestamp: savedMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            // };
            const messageForRecipient = {
                 id: savedMessage.message_id, // Use BigInt converted by driver, or ensure string if needed
                 sender: savedMessage.sender_uid,
                 senderName: socket.user.username || senderUid,
                 senderPic: socket.user.profilePicUrl,
                 content: savedMessage.content, // Use content saved in DB
                 timestamp: savedMessage.timestamp // *** SEND RAW TIMESTAMP OBJECT/STRING ***
            };
            
            io.to(recipientUid).emit('receiveMessage', messageForRecipient);
            console.log(`[MSG SEND] Emitted 'receiveMessage' to room ${recipientUid}`);

            // 4. Send confirmation back to sender
             // socket.emit('messageSentConfirmation', { tempId: tempId || null, dbId: savedMessage.message_id, timestamp: savedMessage.timestamp, status: savedMessage.status });
            socket.emit('messageSentConfirmation', {
                  tempId: tempId || null,
                  dbId: savedMessage.message_id.toString(), // Send ID as string
                  timestamp: savedMessage.timestamp, // *** SEND RAW TIMESTAMP OBJECT/STRING ***
                  status: savedMessage.status // Send initial status ('sent')
             });

        } catch (error) {
            if (client) { console.error('[MSG SEND] Rolling back transaction due to error.'); await client.query('ROLLBACK'); }
            console.error(`!!! [MSG SEND] Error processing message from ${senderUid} to ${recipientUid} !!!`, error);
            console.error(`!!! Specific Error Message: ${error.message}`);
            socket.emit('error', { message: 'Failed to send message. Server error occurred.' });
        } finally {
            if (client) { console.log('[MSG SEND] Releasing DB client.'); client.release(); } // Always release client
        }
    }); // End 'sendMessage'

    // --- Get Chat History ---
    socket.on('getChatHistory', async (data) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
        const currentUserUid = socket.user.uid; const otherUserUid = data?.chatId;
        if (!otherUserUid) return socket.emit('error', { message: 'Chat ID missing.' });
        const limit = 50; const offset = 0;
        console.log(`[HISTORY] User ${currentUserUid} requesting history with ${otherUserUid}`);
        try {
            const query = `SELECT message_id as id, sender_uid as sender, content, timestamp, status
                FROM messages
                WHERE (sender_uid = $1 AND recipient_uid = $2) OR (sender_uid = $2 AND recipient_uid = $1)
                ORDER BY timestamp ASC -- Fetch oldest first for easy display order
                LIMIT $3 OFFSET $4;`;
            const { rows } = await db.query(query, [currentUserUid, otherUserUid, limit, offset]);
            // const history = rows.map(msg => ({ ...msg, timestamp: msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) })).reverse();
            // *** Send raw timestamps back ***
            const history = rows.map(msg => ({
                 id: msg.id.toString(), // Send ID as string
                 sender: msg.sender,
                 content: msg.content,
                 timestamp: msg.timestamp, // Send raw timestamp object/string
                 status: msg.status // Send status fetched from DB
             }));
            console.log(`[HISTORY] Sending ${history.length} messages for chat ${currentUserUid}<->${otherUserUid}`);
            socket.emit('chatHistory', { chatId: otherUserUid, messages: history });
        } catch (dbError) { console.error(`[HISTORY] DB error for ${currentUserUid}<->${otherUserUid}:`, dbError); socket.emit('error', { message: 'Failed to load history.' }); }
    }); // End 'getChatHistory'

    // --- Get Contact List ---
    socket.on('getContacts', async () => {
         if (!socket.user) return socket.emit('error', { message: 'Auth required.' });
         const currentUserUid = socket.user.uid;
         console.log(`[CONTACTS] User ${currentUserUid} requesting contact list.`);
         try {
              // Fetch contacts with user details AND latest message info
              const query = `
                  SELECT
                      u.uid as id,
                      u.username,
                      u.profile_pic_url as "profilePicUrl",
                      u.last_seen as "lastSeen",
                      lm.content as "lastMessage",
                      lm.sender_uid as "lastMessageSenderUid",
                      lm.timestamp as "lastMessageTimestamp"
                  FROM contacts c
                  JOIN users u ON u.uid = c.contact_uid
                  LEFT JOIN LATERAL (
                      SELECT content, sender_uid, timestamp
                      FROM messages m
                      WHERE (m.sender_uid = c.user_uid AND m.recipient_uid = c.contact_uid)
                         OR (m.sender_uid = c.contact_uid AND m.recipient_uid = c.user_uid)
                      ORDER BY m.timestamp DESC
                      LIMIT 1
                  ) lm ON true
                  WHERE c.user_uid = $1
                  ORDER BY lm.timestamp DESC NULLS LAST, u.username ASC;
              `;
              const { rows } = await db.query(query, [currentUserUid]);

              // Add online status to each contact before sending
              const contactsWithStatus = rows.map(contact => {
                  const isOnline = onlineUsers.has(contact.id) && onlineUsers.get(contact.id).size > 0;
                  // Format last message preview
                  let lastMessagePreview = contact.lastMessage || '';
                  if (lastMessagePreview && contact.lastMessageSenderUid === currentUserUid) {
                      lastMessagePreview = `You: ${lastMessagePreview}`;
                  }
                  // Format timestamp
                  let formattedTimestamp = contact.lastMessageTimestamp ? contact.lastMessageTimestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

                  return {
                      id: contact.id,
                      username: contact.username,
                      profilePicUrl: contact.profilePicUrl,
                      lastSeen: isOnline ? null : contact.lastSeen, // Only needed if offline
                      lastMessage: lastMessagePreview,
                      timestamp: formattedTimestamp,
                      status: isOnline ? 'online' : 'offline'
                      // unread count needs separate logic later
                  };
              });

              console.log(`[CONTACTS] Sending ${contactsWithStatus.length} contacts with details for ${currentUserUid}`);
              socket.emit('contactList', contactsWithStatus);
         } catch (dbError) {
              console.error(`[CONTACTS] DB error fetching contacts for ${currentUserUid}:`, dbError);
              socket.emit('error', { message: 'Failed to load contacts.' });
         }
    }); // End 'getContacts'

    // --- User Search ---
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

    // --- Typing Indicators ---
    socket.on('typing', (data) => {
        if (!socket.user) return;
        const recipientUid = data?.recipientUid; if (!recipientUid) return;
        socket.to(recipientUid).emit('typingStatus', { senderUid: socket.user.uid, isTyping: data.isTyping === true });
    }); // End 'typing'

    //new tick status

    // --- Handle Message Status Updates (Delivered/Read) ---
    socket.on('messageStatusUpdate', async (data) => {
        if (!socket.user) return socket.emit('error', { message: 'Auth required for status update.' });
        if (!data || !data.status) return console.log('[STATUS UPDATE] Invalid data received:', data);

        const recipientUid = socket.user.uid; // The user confirming status is the recipient
        const newStatus = data.status; // 'delivered' or 'read'

        console.log(`[STATUS UPDATE] Received from ${recipientUid}: Status=${newStatus}, Data=${JSON.stringify(data)}`);

        let client = null; // For potential transaction
        try {
            client = await db.pool.connect();
            await client.query('BEGIN');

            if (newStatus === 'delivered' && data.messageId) {
                // --- Handle 'delivered' status for a single message ---
                const messageId = BigInt(data.messageId); // Ensure messageId is BigInt if using BIGSERIAL
                const query = `
                    UPDATE messages SET status = 'delivered'
                    WHERE message_id = $1 AND recipient_uid = $2 AND status = 'sent'
                    RETURNING sender_uid;
                `;
                const { rows, rowCount } = await client.query(query, [messageId, recipientUid]);

                if (rowCount > 0) {
                    const senderUid = rows[0].sender_uid;
                    console.log(`[STATUS UPDATE] Message ${messageId} marked as delivered for recipient ${recipientUid}. Notifying sender ${senderUid}.`);
                    // Notify the original sender
                    io.to(senderUid).emit('updateMessageStatus', { messageId: messageId.toString(), status: 'delivered' }); // Send messageId as string
                } else {
                    console.log(`[STATUS UPDATE] Message ${messageId} not updated to delivered (already delivered/read, or not recipient?).`);
                }

            } else if (newStatus === 'read' && Array.isArray(data.messageIds) && data.messageIds.length > 0) {
                // --- Handle 'read' status for multiple messages ---
                // Ensure IDs are BigInts if needed
                const messageIds = data.messageIds.map(id => BigInt(id));
                const query = `
                    UPDATE messages SET status = 'read'
                    WHERE message_id = ANY($1::bigint[]) AND recipient_uid = $2 AND status != 'read'
                    RETURNING message_id, sender_uid;
                `;
                const { rows, rowCount } = await client.query(query, [messageIds, recipientUid]);

                if (rowCount > 0) {
                    console.log(`[STATUS UPDATE] ${rowCount} messages marked as read for recipient ${recipientUid}. Notifying senders.`);
                    // Notify each sender for their respective messages that were updated
                    const notifications = new Map(); // Map<senderUid, Array<messageId>>
                    rows.forEach(row => {
                        const senderUid = row.sender_uid;
                        const msgIdStr = row.message_id.toString(); // Send messageId as string
                        if (!notifications.has(senderUid)) {
                            notifications.set(senderUid, []);
                        }
                        notifications.get(senderUid).push(msgIdStr);
                    });

                    notifications.forEach((msgIds, senderUid) => {
                        console.log(`[STATUS UPDATE] Notifying sender ${senderUid} about ${msgIds.length} read messages.`);
                        // Send individual updates or potentially batch them
                        msgIds.forEach(msgId => {
                             io.to(senderUid).emit('updateMessageStatus', { messageId: msgId, status: 'read' });
                        });
                    });
                } else {
                     console.log(`[STATUS UPDATE] No messages updated to read for recipient ${recipientUid} (already read, or not recipient?).`);
                }

            } else {
                console.log('[STATUS UPDATE] Invalid status or missing messageId(s). Data:', data);
            }

            await client.query('COMMIT'); // Commit transaction

        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error(`!!! [STATUS UPDATE] Error processing status update for ${recipientUid} !!!`, error);
            // Don't necessarily emit error back to client for background updates like read/delivered
            // unless it's critical feedback.
            // socket.emit('error', { message: 'Failed to update message status.' });
        } finally {
            if (client) client.release();
        }
    }); // End 'messageStatusUpdate'

    // --- Disconnection ---
    socket.on('disconnect', async (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        if (socket.user) {
            const uid = socket.user.uid;
            let wasLastConnection = false; let lastSeenTimestamp = null;
            // Presence Update
            if (onlineUsers.has(uid)) {
                 const userSockets = onlineUsers.get(uid); userSockets.delete(socket.id);
                 console.log(`[Presence] Socket ${socket.id} removed for user ${uid}. Remaining: ${userSockets.size}`);
                 if (userSockets.size === 0) { onlineUsers.delete(uid); wasLastConnection = true; console.log(`[Presence] User ${uid} went offline.`); }
            } else { console.warn(`[Presence] Disconnected socket ${socket.id} for user ${uid} not in onlineUsers map.`); }
            // Update DB last_seen
            try {
                const { rows } = await db.query('UPDATE users SET last_seen = NOW() WHERE uid = $1 RETURNING last_seen', [uid]);
                lastSeenTimestamp = rows[0]?.last_seen; console.log(`Updated last_seen for ${uid}.`);
            } catch (dbError) { console.error(`Failed to update last_seen for ${uid}:`, dbError); lastSeenTimestamp = new Date(); }
            // Broadcast offline status if it was the last connection
            if (wasLastConnection) {
                const contactUids = await getContactsOfUser(uid);
                const presencePayload = { userId: uid, status: 'offline', lastSeen: lastSeenTimestamp };
                console.log(`[Presence] Notifying ${contactUids.length} contacts that ${uid} went offline.`);
                contactUids.forEach(contactUid => { io.to(contactUid).emit('presenceUpdate', presencePayload); });
            }
        }
    }); // End 'disconnect'

    // --- Low-level errors ---
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
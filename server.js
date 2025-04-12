// server.js - Updated with DB Interaction
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');
const db = require('./db'); // Import the database query function

// --- Initialization & Firebase Admin SDK ---
const app = express();
const server = http.createServer(app);
const io = new Server(server); // Add Socket.IO options if needed later

try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY env var not set.");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("!!! Firebase Admin SDK Initialization Failed !!!", error);
    process.exit(1); // Exit if Firebase Admin is critical
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
        if (socket.user) return; // Already authenticated
        if (!idToken) {
            console.log(`Socket ${socket.id} auth attempt failed: No token provided.`);
            socket.emit('authenticationFailed', { message: 'No token provided.' });
            socket.disconnect();
            return;
        }

        console.log(`Socket ${socket.id} attempting authentication...`);
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const uid = decodedToken.uid;
            const phoneNumber = decodedToken.phone_number;

            if (!uid || !phoneNumber) {
                throw new Error("Token missing UID or Phone Number");
            }

            // --- Database Interaction: Get or Create User ---
            let userProfile = null;
            const selectQuery = 'SELECT uid, username, profile_pic_url FROM users WHERE uid = $1';
            const insertQuery = 'INSERT INTO users (uid, phone_number, last_seen) VALUES ($1, $2, NOW()) ON CONFLICT (uid) DO UPDATE SET last_seen = NOW() RETURNING uid, username, profile_pic_url'; // Upsert logic
            const updateLastSeenQuery = 'UPDATE users SET last_seen = NOW() WHERE uid = $1';

            try {
                 console.log(`DB Check/Insert for UID: ${uid}`);
                 // Use ON CONFLICT to handle race conditions or existing users gracefully
                 const { rows } = await db.query(insertQuery, [uid, phoneNumber]);
                 userProfile = rows[0];

                 if (userProfile) {
                    console.log(`User ${uid} found or created in DB.`);
                 } else {
                     // This case should ideally not happen with ON CONFLICT ... RETURNING
                     // but handle defensively. Maybe try selecting again.
                     console.warn(`Insert/Update did not return user data for ${uid}. Trying SELECT.`);
                     const selectResult = await db.query(selectQuery, [uid]);
                     if (selectResult.rows.length > 0) {
                         userProfile = selectResult.rows[0];
                         // Explicitly update last_seen if insert didn't happen/return data
                         await db.query(updateLastSeenQuery, [uid]);
                     } else {
                          throw new Error(`Failed to find or create user ${uid} in database.`);
                     }
                 }

            } catch (dbError) {
                console.error(`Database error during authentication for UID ${uid}:`, dbError);
                throw new Error("Database error during login."); // Propagate error
            }
            // --- End Database Interaction ---

            // Store verified user info (including profile) on the socket
            socket.user = {
                uid: uid,
                phoneNumber: phoneNumber,
                username: userProfile.username,
                profilePicUrl: userProfile.profile_pic_url
            };

            socket.join(uid); // Join user-specific room
            console.log(`Socket ${socket.id} authenticated as ${uid} and joined room.`);

            // Send confirmation back with data from DB
            socket.emit('authenticationSuccess', {
                uid: socket.user.uid,
                phoneNumber: socket.user.phoneNumber,
                username: socket.user.username,
                profilePicUrl: socket.user.profilePicUrl
            });

        } catch (error) { // Catch errors from token verification OR DB interaction
            console.error(`Socket ${socket.id} authentication failed:`, error.message);
            socket.emit('authenticationFailed', { message: error.message || 'Authentication failed.' });
            socket.disconnect();
        }
    });

    // --- Handle Profile Updates ---
    socket.on('updateProfile', async (data) => {
        if (!socket.user) {
            console.log(`Unauthenticated socket ${socket.id} tried to update profile.`);
            socket.emit('profileUpdateError', { message: 'Authentication required.' });
            return;
        }

        const uid = socket.user.uid;
        const { username, profilePicUrl } = data;

        if (typeof username !== 'string' || typeof profilePicUrl !== 'string') {
            return socket.emit('profileUpdateError', { message: 'Invalid data format.' });
        }
        const trimmedUsername = username.trim();
        const trimmedPicUrl = profilePicUrl.trim();

        if (trimmedUsername.length > 50) {
            return socket.emit('profileUpdateError', { message: 'Username too long (max 50 chars).' });
        }
        // Basic URL validation (optional, can be more robust)
        // if (trimmedPicUrl && !trimmedPicUrl.startsWith('http')) {
        //     return socket.emit('profileUpdateError', { message: 'Invalid profile picture URL.' });
        // }

        console.log(`User ${uid} updating profile: Username='${trimmedUsername}', PicURL='${trimmedPicUrl}'`);

        try {
            const query = 'UPDATE users SET username = $1, profile_pic_url = $2 WHERE uid = $3 RETURNING username, profile_pic_url';
            const { rows, rowCount } = await db.query(query, [trimmedUsername || null, trimmedPicUrl || null, uid]);

            if (rowCount > 0) {
                console.log(`Profile updated successfully for ${uid}`);
                const updatedProfile = rows[0];
                // Update profile on the socket object too
                socket.user.username = updatedProfile.username;
                socket.user.profilePicUrl = updatedProfile.profile_pic_url;
                // Send success confirmation back to the specific client
                socket.emit('profileUpdateSuccess', {
                    username: updatedProfile.username,
                    profilePicUrl: updatedProfile.profile_pic_url
                });
            } else {
                console.warn(`Attempted profile update for UID ${uid}, but user not found or no changes needed.`);
                socket.emit('profileUpdateError', { message: 'Could not update profile. User not found?' });
            }
        } catch (dbError) {
            console.error(`Database error during profile update for UID ${uid}:`, dbError);
            socket.emit('profileUpdateError', { message: 'Database error saving profile.' });
        }
    });

    // --- Handle Sending Messages (Basic DB Save Included) ---
    socket.on('sendMessage', async (messageData) => { // Made async
        if (!socket.user) {
            console.log(`Unauthenticated socket ${socket.id} tried to send message.`);
            return socket.emit('error', { message: 'Authentication required to send messages.' });
        }

        const senderUid = socket.user.uid;
        const recipientUid = messageData.recipientUid;
        const content = messageData.content;

        if (!recipientUid || !content || typeof content !== 'string' || content.trim().length === 0) {
            console.log(`Missing recipient or invalid content from sender ${senderUid}`);
            return socket.emit('error', { message: 'Message format incorrect.' });
        }

        console.log(`Message from ${senderUid} to ${recipientUid}: ${content.substring(0, 30)}...`);

        try {
            // 1. Save message to Database
            const insertMsgQuery = `
                INSERT INTO messages (sender_uid, recipient_uid, content)
                VALUES ($1, $2, $3)
                RETURNING message_id, sender_uid, recipient_uid, content, timestamp, status
            `;
            // Create the messages table first! We haven't defined it yet.
            // For now, we just log, replace with actual query when table exists
            // const { rows } = await db.query(insertMsgQuery, [senderUid, recipientUid, content.trim()]);
            // const savedMessage = rows[0];
            // console.log(`Message saved to DB with ID: ${savedMessage.message_id}`);

            // !!! Placeholder until messages table is created !!!
            const savedMessage = {
                 message_id: 'temp_db_' + Date.now(), // Temporary placeholder
                 sender_uid: senderUid,
                 recipient_uid: recipientUid,
                 content: content.trim(),
                 timestamp: new Date(),
                 status: 'sent'
            };
            console.log("Placeholder: Message would be saved to DB.");
             // !!! End Placeholder !!!


            // 2. Emit message to the recipient's room
            io.to(recipientUid).emit('receiveMessage', {
                // Send necessary fields from the saved message
                id: savedMessage.message_id, // Use DB ID
                sender: savedMessage.sender_uid,
                content: savedMessage.content,
                timestamp: savedMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), // Format for display
                // status: savedMessage.status // Status isn't usually sent to receiver directly
            });

            // 3. Optional: Send confirmation back to sender
             socket.emit('messageSentConfirmation', {
                  tempId: messageData.tempId || null, // Echo back tempId if client sent one
                  dbId: savedMessage.message_id,
                  timestamp: savedMessage.timestamp, // Send back precise timestamp
                  status: savedMessage.status
             });

        } catch (dbError) {
             console.error(`Database error saving message from ${senderUid} to ${recipientUid}:`, dbError);
             socket.emit('error', { message: 'Failed to send message due to server error.' });
        }
    });


    // --- Handle Typing Indicators (Protected) ---
    socket.on('typing', (data) => {
        if (!socket.user) return;
        const recipientUid = data.recipientUid;
        if (!recipientUid) return;
        socket.to(recipientUid).emit('typingStatus', {
            senderUid: socket.user.uid,
            isTyping: data.isTyping
        });
    });


    // --- Handle Disconnection ---
    socket.on('disconnect', async (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        if (socket.user) {
            const uid = socket.user.uid;
            console.log(`User ${uid} disconnected.`);
            // Update last_seen status in DB
            try {
                await db.query('UPDATE users SET last_seen = NOW() WHERE uid = $1', [uid]);
                console.log(`Updated last_seen for user ${uid}.`);
            } catch (dbError) {
                console.error(`Failed to update last_seen for user ${uid} on disconnect:`, dbError);
            }
        }
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
server.on('error', (error) => {
    console.error('Server Error:', error);
    process.exit(1); // Exit on critical server error
});
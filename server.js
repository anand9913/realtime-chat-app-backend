// server.js - Complete Version (April 16, 2025)
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
const io = new Server(server); // Add Socket.IO options if needed later

// --- Firebase Admin SDK Initialization ---
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
// Serve static files (HTML, CSS, Client-side JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Allow parsing JSON request bodies (useful for potential future REST API routes)
app.use(express.json());

// --- Routes ---
// Redirect root requests to the login page
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.user = null; // User is initially unauthenticated

    // --- Handle Authentication Attempt ---
    socket.on('authenticate', async (idToken) => {
        if (socket.user) { // Prevent re-authentication on same socket
             console.log(`[AUTH] Socket ${socket.id} already authenticated as ${socket.user.uid}. Ignoring.`);
             return;
        }
        if (!idToken) { // Check if token was provided
            console.log(`[AUTH] Socket ${socket.id} auth attempt failed: No token provided.`);
            socket.emit('authenticationFailed', { message: 'No token provided.' });
            socket.disconnect();
            return;
        }

        console.log(`[AUTH] Socket ${socket.id} attempting authentication...`);
        let uid; // Define uid for use in outer catch block

        try {
            // 1. Verify Firebase ID Token
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            uid = decodedToken.uid; // Assign uid here
            const phoneNumber = decodedToken.phone_number;
            if (!uid || !phoneNumber) { // Ensure token contains expected fields
                throw new Error("Firebase token missing UID or Phone Number after verification.");
            }
            console.log(`[AUTH] Token verified for UID: ${uid}, Phone: ${phoneNumber}`);

            // 2. Database Interaction: Get or Create User, fetch profile
            let userProfile = null; // Initialize profile object
            // Upsert query: Inserts if UID doesn't exist, updates last_seen if it does. Returns profile fields.
            const upsertQuery = `
                INSERT INTO users (uid, phone_number, last_seen)
                VALUES ($1, $2, NOW())
                ON CONFLICT (uid) DO UPDATE SET last_seen = NOW()
                RETURNING uid, username, profile_pic_url
            `;
            // Fallback query if needed (should be rare with RETURNING)
            const selectQuery = 'SELECT uid, username, profile_pic_url FROM users WHERE uid = $1';

            // Specific try/catch for DB operations
            try {
                console.log(`[AUTH DB] Running upsertQuery for UID: ${uid}`);
                const { rows } = await db.query(upsertQuery, [uid, phoneNumber]);

                // --- Check results carefully ---
                if (rows && rows.length > 0) {
                    userProfile = rows[0]; // Assign result from INSERT/ON CONFLICT...RETURNING
                    console.log(`[AUTH DB] User processed via INSERT/ON CONFLICT for ${uid}.`);
                } else {
                    // Fallback SELECT if RETURNING didn't yield rows (unlikely but safe)
                    console.warn(`[AUTH DB] Upsert RETURNING yielded no rows for ${uid}. Attempting SELECT.`);
                    const selectResult = await db.query(selectQuery, [uid]);
                    if (selectResult.rows && selectResult.rows.length > 0) {
                        userProfile = selectResult.rows[0]; // Assign result from SELECT
                        console.log(`[AUTH DB] User found via SELECT for ${uid}.`);
                        // last_seen was updated by the DO UPDATE part, no need to update again here normally
                    } else {
                        // Should be impossible if token verification passed, signals DB issue
                        throw new Error(`DB Consistency Error: User ${uid} not found after token OK and failed upsert/select.`);
                    }
                }
                // --- At this point, userProfile SHOULD be a valid object or an error thrown ---
                if (!userProfile) { // Final check
                   throw new Error(`DB Error: userProfile object is null/undefined for ${uid}.`);
                }

                console.log(`[AUTH DB] Fetched/Created Profile Data for ${uid}:`, {
                     username: userProfile.username, // Log values directly
                     profile_pic_url: userProfile.profile_pic_url
                 });

            } catch (dbError) {
                console.error(`!!! [AUTH DB] Database Error during login processing for UID ${uid} !!!`, dbError);
                // Rethrow a more specific error to be caught by the outer block
                throw new Error(`Database error during login.`);
            }
            // --- End Database Interaction ---

            // 3. Assign verified data safely to socket object
            console.log(`[AUTH STEP] Preparing to assign data to socket.user for ${uid}`);
            socket.user = {
                uid: uid,
                phoneNumber: phoneNumber,
                username: userProfile.username ?? null, // Use nullish coalescing
                profilePicUrl: userProfile.profile_pic_url ?? null
            };
            console.log(`[AUTH STEP] Assigned data to socket.user:`, socket.user);

            // 4. Join User-Specific Room
            socket.join(uid);
            console.log(`[AUTH STEP] Socket ${socket.id} authenticated as ${uid} and joined room ${uid}.`);

            // 5. Prepare and Emit Success Payload to Client
            const successPayload = {
                uid: socket.user.uid,
                phoneNumber: socket.user.phoneNumber,
                username: socket.user.username,      // Use data from socket.user
                profilePicUrl: socket.user.profilePicUrl // Use data from socket.user
            };
            console.log(`[AUTH EMIT] Emitting 'authenticationSuccess' with payload for ${uid}:`, JSON.stringify(successPayload));

            socket.emit('authenticationSuccess', successPayload); // Emit the event with profile data
            console.log(`[AUTH EMIT] 'authenticationSuccess' emitted successfully for ${uid}.`); // Confirm emit call happened


        } catch (error) { // Outer catch block for token verify or rethrown DB errors
            let clientErrorMessage = 'Authentication process failed. Please try again.';
            // Check for specific expired token error
            if (error.code === 'auth/id-token-expired' || error.message.includes('expired')) {
                 console.warn(`!!! Socket ${socket.id} Auth Failed: Expired Token !!! UID: ${uid || 'unknown'}`);
                 clientErrorMessage = 'Your session has expired. Please log in again.';
            } else {
                 console.error(`!!! Socket ${socket.id} Authentication Failed Overall !!! UID: ${uid || 'unknown'}. Error:`, error.message);
            }
            socket.emit('authenticationFailed', { message: clientErrorMessage });
            socket.disconnect(); // Disconnect on any auth failure
        }
    }); // End socket.on('authenticate')

    // --- Handle Profile Updates ---
    socket.on('updateProfile', async (data) => {
        if (!socket.user) {
            console.log(`Unauthenticated socket ${socket.id} tried to update profile.`);
            return socket.emit('profileUpdateError', { message: 'Authentication required.' });
        }

        const uid = socket.user.uid;
        const { username, profilePicUrl } = data;

        if (typeof username !== 'string' || typeof profilePicUrl !== 'string') {
            return socket.emit('profileUpdateError', { message: 'Invalid data format.' });
        }
        const trimmedUsername = username.trim();
        const trimmedPicUrl = profilePicUrl.trim();

        if (trimmedUsername.length === 0) {
             return socket.emit('profileUpdateError', { message: 'Username cannot be empty.' });
        }
        if (trimmedUsername.length > 50) {
            return socket.emit('profileUpdateError', { message: 'Username too long (max 50 chars).' });
        }

        console.log(`[PROFILE UPDATE] User ${uid} updating profile: Username='${trimmedUsername}', PicURL='${trimmedPicUrl}'`);

        try {
            const query = 'UPDATE users SET username = $1, profile_pic_url = $2 WHERE uid = $3 RETURNING username, profile_pic_url';
            // Use empty string instead of null if user clears the field? DB schema allows NULL. Let's stick to null.
            const { rows, rowCount } = await db.query(query, [trimmedUsername, trimmedPicUrl || null, uid]);

            if (rowCount > 0) {
                console.log(`[PROFILE UPDATE] Success for ${uid}`);
                const updatedProfile = rows[0];
                socket.user.username = updatedProfile.username; // Update socket state
                socket.user.profilePicUrl = updatedProfile.profile_pic_url;
                socket.emit('profileUpdateSuccess', { // Send confirmation back
                    username: updatedProfile.username,
                    profilePicUrl: updatedProfile.profile_pic_url
                });
            } else {
                 console.warn(`[PROFILE UPDATE] Failed for UID ${uid}, user not found.`); // Should not happen if authenticated
                 socket.emit('profileUpdateError', { message: 'Could not update profile. User not found?' });
            }
        } catch (dbError) {
            console.error(`[PROFILE UPDATE] Database Error for UID ${uid}:`, dbError);
            socket.emit('profileUpdateError', { message: 'Database error saving profile.' });
        }
    }); // End socket.on('updateProfile')


    // --- Handle Sending Messages ---
    // !! Create the 'messages' table in your DB first !!
    // Example: CREATE TABLE messages ( message_id SERIAL PRIMARY KEY, sender_uid VARCHAR(128) REFERENCES users(uid), recipient_uid VARCHAR(128) REFERENCES users(uid), content TEXT NOT NULL, timestamp TIMESTAMPTZ DEFAULT NOW(), status VARCHAR(20) DEFAULT 'sent');
    socket.on('sendMessage', async (messageData) => { // Made async
        if (!socket.user) {
            return socket.emit('error', { message: 'Authentication required to send messages.' });
        }

        const senderUid = socket.user.uid;
        const recipientUid = messageData.recipientUid; // Assume this is the other user's UID for 1-on-1
        const content = messageData.content;
        const tempId = messageData.tempId; // Client-generated temporary ID for confirmation mapping

        if (!recipientUid || !content || typeof content !== 'string' || content.trim().length === 0) {
             return socket.emit('error', { message: 'Message format incorrect (missing recipient or content).' });
        }
         if (recipientUid === senderUid) {
              return socket.emit('error', { message: 'Cannot send message to yourself.' });
         }

        console.log(`[MSG SEND] From ${senderUid} to ${recipientUid}: ${content.substring(0, 30)}...`);

        try {
            // 1. Save message to Database (Uncomment/Implement when table exists)
            /*
            const insertMsgQuery = `
                INSERT INTO messages (sender_uid, recipient_uid, content)
                VALUES ($1, $2, $3)
                RETURNING message_id, sender_uid, recipient_uid, content, timestamp, status
            `;
            const { rows } = await db.query(insertMsgQuery, [senderUid, recipientUid, content.trim()]);
            const savedMessage = rows[0];
            if (!savedMessage) throw new Error("Message failed to save to DB.");
            console.log(`[MSG SEND] Message saved to DB with ID: ${savedMessage.message_id}`);
            */

            // Using placeholder until messages table is ready
             const savedMessage = {
                  message_id: 'temp_db_' + Date.now(), // REPLACE with actual DB ID
                  sender_uid: senderUid,
                  recipient_uid: recipientUid,
                  content: content.trim(),
                  timestamp: new Date(), // REPLACE with actual DB timestamp
                  status: 'sent' // REPLACE with actual DB status
             };
             console.log("[MSG SEND] Placeholder: Message would be saved to DB.");


            // 2. Emit message to the recipient's specific room
            // Prepare payload for receiver
            const messageForRecipient = {
                 id: savedMessage.message_id,
                 sender: savedMessage.sender_uid,
                 content: savedMessage.content,
                 timestamp: savedMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), // Format time for display
                 // Optionally include sender's current profile info if needed directly
                 // senderUsername: socket.user.username,
                 // senderProfilePic: socket.user.profilePicUrl
            };
            io.to(recipientUid).emit('receiveMessage', messageForRecipient);
            console.log(`[MSG SEND] Emitted 'receiveMessage' to room ${recipientUid}`);

            // 3. Send confirmation back to sender with DB details
             socket.emit('messageSentConfirmation', {
                  tempId: tempId || null, // Echo back tempId client sent
                  dbId: savedMessage.message_id, // Send the real DB ID
                  timestamp: savedMessage.timestamp, // Send precise timestamp
                  status: savedMessage.status // Send status from DB
             });

        } catch (dbError) {
             console.error(`[MSG SEND] Database error saving message from ${senderUid} to ${recipientUid}:`, dbError);
             socket.emit('error', { message: 'Failed to send message due to server error.' });
        }
    }); // End socket.on('sendMessage')


    // --- Handle Typing Indicators ---
    socket.on('typing', (data) => {
        if (!socket.user) return;
        const recipientUid = data.recipientUid;
        if (!recipientUid) return;
        // Forward typing status only to the specific recipient room, excluding sender
        socket.to(recipientUid).emit('typingStatus', {
            senderUid: socket.user.uid,
            isTyping: data.isTyping === true // Ensure boolean
        });
    }); // End socket.on('typing')


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
            // TODO: Broadcast presence update ('offline') if needed
        }
    }); // End socket.on('disconnect')

    // Handle low-level connection errors
    socket.on('connect_error', (err) => {
        console.error(`Socket ${socket.id} connect_error: ${err.message}`);
    });

}); // End io.on('connection')


// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access the app locally at: http://localhost:${PORT}`);
});
server.on('error', (error) => {
    console.error('!!! Server Error !!!:', error);
    process.exit(1); // Exit on critical server startup errors
});
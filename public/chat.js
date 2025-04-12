// public/chat.js - Updated for Auth Success Data & Socket Exposure
document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');
    if (!isAuthenticated || !storedToken) {
        window.location.href = 'login.html'; return;
    }

    // --- Load Profile Data (from Cache initially) ---
    const savedUsername = localStorage.getItem('chatUsername');
    const savedPicUrl = localStorage.getItem('chatProfilePicUrl');
    const defaultPic = 'https://via.placeholder.com/40?text=Me';
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'My Username';

    // --- DOM Elements ---
    const contactList = document.getElementById('contact-list');
    const messageList = document.getElementById('message-list');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const chatHeaderProfile = document.getElementById('chat-header-profile');
    const typingIndicator = document.getElementById('typing-indicator');
    const searchContactsInput = document.getElementById('search-contacts');
    const logoutButton = document.getElementById('logout-button');
    const currentUsernameSpan = document.getElementById('current-user-name');
    const sidebarProfilePic = document.getElementById('sidebar-profile-pic');

    // --- Update UI with Initial Cached Profile Data ---
    currentUsernameSpan.textContent = savedUsername || defaultUsername;
    sidebarProfilePic.src = savedPicUrl || defaultPic;
     sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };

    // --- State ---
    let currentChatId = null;
    let currentUser = { // Will be updated upon successful backend auth
        id: null, // Set by backend after token verification
        name: savedUsername || defaultUsername, // Use cache initially
        profilePic: savedPicUrl || defaultPic // Use cache initially
    };
    let socket; // Define socket variable
    window.socketInstance = null; // Initialize global reference (HACK)

    // --- Socket.IO Connection ---
    function connectWebSocket() {
        console.log("Attempting to connect WebSocket...");
        socket = io({
             // Optional: Add reconnection attempts
             // reconnectionAttempts: 5,
             // reconnectionDelay: 1000,
        });
        window.socketInstance = socket; // HACK: Expose socket globally for profile.js

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("Attempting to authenticate socket with backend...");
                socket.emit('authenticate', idToken);
            } else {
                console.error("Firebase ID token missing on connect. Logging out.");
                logout();
            }
        });

        socket.on('authenticationSuccess', (userData) => {
            console.log("Socket authenticated successfully by backend:", userData);
            // --- Use profile data FROM BACKEND ---
            currentUser.id = userData.uid;
            currentUser.name = userData.username || defaultUsername; // Use DB username or default
            currentUser.profilePic = userData.profilePicUrl || defaultPic; // Use DB pic or default

            // Update UI with data confirmed by backend
            currentUsernameSpan.textContent = currentUser.name;
            sidebarProfilePic.src = currentUser.profilePic;
             sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };

            // Update localStorage cache with verified data
            localStorage.setItem('chatUsername', currentUser.name);
            localStorage.setItem('chatProfilePicUrl', currentUser.profilePic);

            console.log("Updated Current User Info from DB:", currentUser);
            // Initialize or refresh UI elements that depend on auth state
            initializeChatApp(); // Safe to initialize now
        });

        socket.on('authenticationFailed', (error) => {
            console.error("Backend socket authentication failed:", error?.message || 'Unknown error');
            alert("Authentication session error. Please log in again.");
            logout();
        });

         socket.on('receiveMessage', (message) => {
            if (!currentUser.id) return; // Ignore if not authenticated yet
            console.log('Message received:', message);
             // Check if message is for the currently active chat
             // Add logic here if needed (e.g., update unread count if not active)
            displayMessage(message); // Display message in UI
            scrollToBottom(); // Scroll down
         });

         socket.on('typingStatus', (data) => { // { senderUid, isTyping }
             if (!currentUser.id || data.senderUid === currentUser.id) return; // Ignore self typing
              // Only show if it's for the currently open chat
             if (data.senderUid === currentChatId) {
                  if (data.isTyping) {
                      showTypingIndicator();
                  } else {
                      hideTypingIndicator();
                  }
             }
              // TODO: Update contact list preview later if needed (e.g., show 'typing...' there)
         });

         // Optional: Listen for confirmation from server after sending message
         socket.on('messageSentConfirmation', (data) => {
             console.log("Server confirmed message:", data);
              // Find the message in the UI (using tempId or dbId) and update its status tick/timestamp
              // updateMessageStatusInUI(data.dbId || data.tempId, data.status, data.timestamp);
         });

        socket.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason);
            // Optionally show disconnected UI state
             if (reason === 'io server disconnect') { // Explicit disconnect from server
                  console.error("Disconnected by server.");
                  // Logout might have already happened if due to auth failure
             }
        });

        socket.on('connect_error', (err) => {
            console.error(`Socket connection error: ${err.message}`);
            // Optionally show error UI state
        });

        // Listen for general errors from server
        socket.on('error', (error) => {
            console.error("Error message from server:", error);
            alert(`Server Error: ${error.message || 'Unknown error'}`);
        });
    }

    // --- Functions --- (Assume these are defined below as before)
    function initializeChatApp() {
         console.log("Initializing Chat App UI...");
        displayContacts(sampleContacts); // Replace sampleContacts with fetched data later
        // ... Any other UI setup needed after authentication ...
         // Set up mobile view if needed
         setupMobileView();
    }

    function displayContacts(contacts) { /* ... same as before ... */ }
    function filterContacts() { /* ... same as before ... */ }
    function loadChat(contactId) { /* ... same as before ... */ }
    function displayMessage(message) { /* ... same as before (uses currentUser.id) ... */ }
    function sendMessage() { /* ... same as before (uses currentUser.id and socket.emit) ... */ }
    function updateContactPreview(contactId, message, timestamp) { /* ... same as before ... */ }
    function escapeHtml(unsafe) { /* ... same as before ... */ }
    function scrollToBottom() { /* ... same as before ... */ }
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() { /* ... same as before (emits socket event) ... */ }
    function showTypingIndicator() { /* ... same as before ... */ }
    function hideTypingIndicator() { /* ... same as before ... */ }

    // --- Logout Function ---
    function logout() {
        console.log("Logging out...");
        if (socket) socket.disconnect();
        window.socketInstance = null; // Clear HACK reference
        localStorage.clear(); // Clear all local storage for clean logout
        window.location.href = 'login.html';
    }

     // --- Mobile View Toggling (Include from previous version) ---
     function setupMobileView() {
         if (window.innerWidth <= 768) {
             showSidebarMobile(); // Start by showing sidebar
         }
         // Potentially add resize listener if needed
     }
     function showChatAreaMobile() { /* ... same as before ... */ }
     function showSidebarMobile() { /* ... same as before ... */ }
     function addMobileBackButton() { /* ... same as before ... */ }
     function removeMobileBackButton() { /* ... same as before ... */ }


    // --- Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        else { handleTyping(); }
    });
    searchContactsInput.addEventListener('input', filterContacts);
    logoutButton.addEventListener('click', logout);

    // --- Initial Connection ---
    connectWebSocket(); // Start the connection process

}); // End of DOMContentLoaded listener

// --- PASTE ALL REQUIRED HELPER FUNCTION DEFINITIONS HERE ---
// function displayContacts(contacts) { ... Paste full function ... }
// function filterContacts() { ... Paste full function ... }
// function loadChat(contactId) { ... Paste full function ... }
// function displayMessage(message) { ... Paste full function ... }
// function sendMessage() { ... Paste full function ... } // Ensure the already defined one is here
// function updateContactPreview(contactId, message, timestamp) { ... Paste full function ... }
// function escapeHtml(unsafe) { ... Paste full function ... }
// function scrollToBottom() { ... Paste full function ... }
// function handleTyping() { ... Paste full function ... }
// function showTypingIndicator() { ... Paste full function ... }
// function hideTypingIndicator() { ... Paste full function ... }
// function setupMobileView() { ... Paste full function ... }
// function showChatAreaMobile() { ... Paste full function ... }
// function showSidebarMobile() { ... Paste full function ... }
// function addMobileBackButton() { ... Paste full function ... }
// function removeMobileBackButton() { ... Paste full function ... }
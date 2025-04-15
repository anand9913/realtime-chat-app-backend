// public/chat.js - Updated with Detailed Logging for Auth Success

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check ---
    const isAuthenticatedFlag = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');
    if (!isAuthenticatedFlag || !storedToken) {
        // If not authenticated OR token is missing, redirect to login
        console.warn("User not authenticated or token missing. Redirecting to login.");
        // Clear potentially stale data
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('firebaseIdToken');
        localStorage.removeItem('userPhoneNumber');
        localStorage.removeItem('chatUsername');
        localStorage.removeItem('chatProfilePicUrl');
        window.location.href = 'login.html';
        return; // Stop execution
    }

    // --- Load Profile Data (from Cache initially) ---
    const savedUsername = localStorage.getItem('chatUsername');
    const savedPicUrl = localStorage.getItem('chatProfilePicUrl');
    const defaultPic = 'https://via.placeholder.com/40?text=Me'; // Default for sidebar
    // Use stored phone number as fallback name if username not set
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'My Username';

    // --- DOM Elements ---
    const chatAppContainer = document.getElementById('chat-app-container'); // Used for mobile view toggling potentially
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
    // This provides immediate feedback while waiting for backend auth confirmation
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
    window.socketInstance = null; // Initialize global reference (HACK for profile.js)
    let isAuthenticatedOnServer = false; // Track if backend confirmed auth


    // --- Sample Data (Keep for UI structure, replace with fetch later) ---
    const sampleContacts = [
        { id: 'user_jane', name: 'Jane Doe', profilePic: 'https://via.placeholder.com/40?text=J', lastMessage: 'Okay, see you then!', timestamp: '10:30 AM', unread: 3, status: 'online' },
        { id: 'user_john', name: 'John Smith', profilePic: 'https://via.placeholder.com/40?text=S', lastMessage: 'Sounds good!', timestamp: 'Yesterday', unread: 0, status: 'offline' },
        { id: 'user_group', name: 'Project Alpha Team', profilePic: 'https://via.placeholder.com/40?text=G', lastMessage: 'Alice: Don\'t forget the meeting.', timestamp: '9:15 AM', unread: 1 },
        { id: 'user_alex', name: 'Alex Green', profilePic: 'https://via.placeholder.com/40?text=A', lastMessage: 'Photo', timestamp: 'Monday', unread: 0, status: 'offline' },
        { id: 'user_maria', name: 'Maria Garcia', profilePic: 'https://via.placeholder.com/40?text=M', lastMessage: 'Typing...', timestamp: '10:35 AM', unread: 0, status: 'online' },
    ];

    const sampleMessages = {
         'user_jane': [
            { id: 'msg1', sender: 'user_me', content: 'Hey Jane, how are you?', timestamp: '10:28 AM', status: 'read' },
            { id: 'msg2', sender: 'user_jane', content: 'Hi! I\'m doing well, thanks for asking. How about you?', timestamp: '10:29 AM' },
            { id: 'msg3', sender: 'user_me', content: 'Doing great! Just working on that chat app.', timestamp: '10:29 AM', status: 'delivered' },
            { id: 'msg4', sender: 'user_jane', content: 'Oh nice! Let me know if you need help testing.', timestamp: '10:30 AM' },
            { id: 'msg5', sender: 'user_me', content: 'Will do, thanks!', timestamp: '10:30 AM', status: 'sent' },
            { id: 'msg6', sender: 'user_jane', content: 'Okay, see you then!', timestamp: '10:30 AM' },
        ],
        'user_john': [ /* ... */ ],
        'user_group': [ /* ... */ ]
    };


    // --- Socket.IO Connection ---
    function connectWebSocket() {
        console.log("Attempting to connect WebSocket...");
        socket = io({
             // reconnectionAttempts: 5, // Example options
             // reconnectionDelay: 2000,
        });
        window.socketInstance = socket; // HACK: Expose socket globally

        // --- Handle Connection ---
        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            isAuthenticatedOnServer = false; // Reset server auth status on new connection
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("Attempting to authenticate socket with backend...");
                socket.emit('authenticate', idToken);
            } else {
                console.error("Firebase ID token missing on connect. Logging out.");
                logout(); // Token missing, force logout
            }
        });

        // --- Handle Successful Backend Authentication ---
        socket.on('authenticationSuccess', (userData) => {
            // *** DETAILED LOGGING ***
            console.log(">>> [AUTH SUCCESS] Received payload from backend:", JSON.stringify(userData));

            // Use data from backend payload
            currentUser.id = userData.uid;
            // Use DB value if it exists (not null/undefined), otherwise fallback to default
            currentUser.name = userData.username ?? defaultUsername; // Use nullish coalescing
            currentUser.profilePic = userData.profilePicUrl || defaultPic; // Use DB value or default

            // *** DETAILED LOGGING ***
            console.log(">>> [AUTH SUCCESS] Updated currentUser object:", currentUser);

            // Update UI elements with confirmed data
            currentUsernameSpan.textContent = currentUser.name;
            sidebarProfilePic.src = currentUser.profilePic;
            sidebarProfilePic.onerror = () => {
                console.warn(">>> [AUTH SUCCESS] Error loading profile pic from server data, reverting to default.");
                sidebarProfilePic.src = defaultPic;
             };
             // *** DETAILED LOGGING ***
             console.log(`>>> [AUTH SUCCESS] Set sidebar UI: Name='${currentUser.name}', PicSrc='${currentUser.profilePic}'`);

            // Update localStorage cache AFTER using the data and updating UI
            localStorage.setItem('chatUsername', currentUser.name);
            localStorage.setItem('chatProfilePicUrl', currentUser.profilePic);
             // *** DETAILED LOGGING ***
             console.log(">>> [AUTH SUCCESS] Updated localStorage cache.");

            isAuthenticatedOnServer = true; // Mark as authenticated *after* processing
            initializeChatApp(); // Initialize or refresh UI now that user data is confirmed
        });

         // --- Handle Authentication Failure from Backend ---
         socket.on('authenticationFailed', (error) => {
             console.error("Backend socket authentication failed:", error?.message || 'Unknown error');
             alert("Authentication session error. Please log in again."); // Inform user
             logout(); // Force logout
         });

         // --- Handle Receiving Messages ---
         socket.on('receiveMessage', (message) => {
            if (!isAuthenticatedOnServer) return; // Ignore if not authenticated on server yet
            console.log('Message received:', message);
             // TODO: Check if message is for the currently active chat
             // Add logic here if needed (e.g., update unread count if not active)
            displayMessage(message); // Display message in UI
            scrollToBottom(); // Scroll down
         });

         // --- Handle Typing Status Updates ---
         socket.on('typingStatus', (data) => { // { senderUid, isTyping }
             if (!isAuthenticatedOnServer || data.senderUid === currentUser.id) return; // Ignore self typing

             // Only show if it's for the currently open chat
             if (data.senderUid === currentChatId) {
                  console.log(`Typing status received: ${data.senderUid} is ${data.isTyping ? 'typing' : 'stopped typing'}`);
                  if (data.isTyping) {
                      showTypingIndicator();
                  } else {
                      hideTypingIndicator();
                  }
             }
              // TODO: Update contact list preview later if needed (e.g., show 'typing...' there)
         });

         // --- Handle Confirmation After Sending a Message ---
         socket.on('messageSentConfirmation', (data) => {
             if (!isAuthenticatedOnServer) return;
             console.log("Server confirmed message:", data);
              // TODO: Find the message in the UI (using tempId or dbId) and update its status tick/timestamp
              // updateMessageStatusInUI(data.dbId || data.tempId, data.status, data.timestamp);
         });

         // --- Handle Disconnection ---
        socket.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason);
            isAuthenticatedOnServer = false; // Mark as not authenticated
            // TODO: Show disconnected UI state to user
             if (reason === 'io server disconnect') { // Explicit disconnect from server
                  console.error("Disconnected by server (check server logs for reason).");
                  // Consider logging out if disconnected by server unexpectedly
                  // logout();
             }
        });

        // --- Handle Connection Errors ---
        socket.on('connect_error', (err) => {
            console.error(`Socket connection error: ${err.message}`);
            isAuthenticatedOnServer = false;
            // TODO: Show error UI state
        });

        // Listen for general errors from server
        socket.on('error', (error) => {
            console.error("Error message from server:", error);
            alert(`Server Error: ${error.message || 'Unknown error'}`);
        });
    }


    // --- Functions ---

    // Initialize the chat application interface (called after successful auth)
    function initializeChatApp() {
         console.log("Initializing Chat App UI elements...");
         // Only display contacts etc. once authentication is confirmed
         if (!isAuthenticatedOnServer) {
             console.warn("Attempted to initialize UI before server authentication completed.");
             return;
         }
        displayContacts(sampleContacts); // TODO: Replace sampleContacts with fetched data later
        setupMobileView(); // Setup mobile view toggling if needed
         console.log("Chat App UI Initialized.");
    }

    // Display the list of contacts in the sidebar
    function displayContacts(contacts) {
        contactList.innerHTML = ''; // Clear existing list
        contacts.forEach(contact => {
            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id;

            let displayStatus = contact.lastMessage || '';
            if (contact.status === 'typing') displayStatus = '<i>Typing...</i>';

            contactEl.innerHTML = `
                <img src="${contact.profilePic || 'https://via.placeholder.com/40?text=?'}" alt="${contact.name}" class="profile-pic">
                <div class="contact-info">
                    <span class="contact-name">${contact.name}</span>
                    <span class="last-message">${displayStatus}</span>
                </div>
                <div class="contact-meta">
                    <span class="timestamp">${contact.timestamp || ''}</span>
                    ${contact.unread > 0 ? `<span class="unread-count">${contact.unread}</span>` : ''}
                </div>
            `;
            contactEl.addEventListener('click', () => loadChat(contact.id));
            contactList.appendChild(contactEl);
        });
    }

     // Filter contacts based on search input
     function filterContacts() {
         // TODO: Fetch filtered contacts from backend instead of filtering sample data
        const searchTerm = searchContactsInput.value.toLowerCase();
        const filteredContacts = sampleContacts.filter(contact =>
            contact.name.toLowerCase().includes(searchTerm)
        );
        displayContacts(filteredContacts);
    }

    // Load a specific chat into the main chat area
    function loadChat(contactId) {
        if (!isAuthenticatedOnServer) return; // Ensure authenticated before loading chat
        console.log("Loading chat for:", contactId);
        currentChatId = contactId; // Set the currently active chat ID

        // Update highlighted contact in the list
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.contactId === contactId) {
                item.classList.add('active');
                const unreadEl = item.querySelector('.unread-count');
                if (unreadEl) unreadEl.remove(); // Mark as read visually
            }
        });

        // Find contact details (from sample data for now)
        const contact = sampleContacts.find(c => c.id === contactId);
        if (!contact) { /* ... error handling ... */ return; }

        // Update chat header
        chatHeaderProfile.innerHTML = `
            <img src="${contact.profilePic || 'https://via.placeholder.com/40?text=?'}" alt="${contact.name}" class="profile-pic">
            <div class="contact-details">
                <span class="contact-name">${contact.name}</span>
                <span class="contact-status">${contact.status === 'online' ? 'Online' : (contact.status === 'typing' ? 'Typing...' : 'Offline')}</span>
            </div>`;

        // Load and display messages (from sample data for now)
        messageList.innerHTML = ''; // Clear previous messages
        // TODO: Fetch message history from backend using socket.emit('getChatHistory', { otherUserId: contactId })
        const messages = sampleMessages[contactId] || [];
        messages.forEach(displayMessage);

        scrollToBottom();
        messageInput.focus();
        hideTypingIndicator();

         // Mobile view handling
         if (window.innerWidth <= 768) {
             showChatAreaMobile();
         }
    }

    // Append a single message to the message list UI
    function displayMessage(message) {
        if (!currentUser.id) {
             console.warn("Cannot display message, currentUser ID not set.");
             return; // Don't display if user isn't fully identified yet
        }
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.dataset.messageId = message.id || ('temp_' + Date.now()); // Use DB id or temp

        const isSent = message.sender === currentUser.id;
        messageEl.classList.add(isSent ? 'sent' : 'received');

        let ticksHtml = ''; // Status ticks logic (example)
        if (isSent && message.status) { /* ... */ }
        let senderNameHtml = ''; // Group chat sender name
        if (!isSent && message.senderName) { /* ... */ }
        let profilePicHtml = ''; // Received message profile pic logic
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.dataset.senderId;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) { /* ... fetch/set picUrl ... */ profilePicHtml = `<img src="${picUrl}" ...>`; }
        messageEl.dataset.senderId = message.sender;

        messageEl.innerHTML = `
            ${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>'}
            <div class="bubble">
                ${senderNameHtml}
                <p>${escapeHtml(message.content)}</p>
                <div class="message-meta">
                    <span class="timestamp">${message.timestamp}</span>
                    ${ticksHtml}
                </div>
            </div>
        `;
        messageList.appendChild(messageEl);
    }

    // Handle sending a message
    function sendMessage() {
        const messageText = messageInput.value.trim();
        if (messageText === '' || !currentChatId || !isAuthenticatedOnServer) {
            console.warn("Cannot send message: Not authenticated, no chat selected, or message empty.");
            return;
        }

        const tempId = 'temp_' + Date.now(); // Generate temporary ID for UI tracking
        const newMessage = { // Message object for optimistic UI update
            id: tempId,
            sender: currentUser.id,
            content: messageText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            status: 'sending' // Show as 'sending' initially maybe?
        };

        displayMessage(newMessage); // Add to UI optimistically
        scrollToBottom();
        messageInput.value = '';
        messageInput.focus();

        // Send message via Socket.IO to backend
         console.log("Sending message via socket:", { recipientUid: currentChatId, content: messageText, tempId: tempId });
         socket.emit('sendMessage', {
             recipientUid: currentChatId,
             content: messageText,
             tempId: tempId // Send tempId so backend can echo it back in confirmation
         });

        // Update contact list preview
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp);
        hideTypingIndicator();
    }

    // Update the last message preview in the contact list
    function updateContactPreview(contactId, message, timestamp) {
        const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
            contactItem.querySelector('.last-message').textContent = message;
            contactItem.querySelector('.timestamp').textContent = timestamp;
            // contactList.prepend(contactItem); // Move to top
        }
    }

    // Utility to escape HTML special characters
    function escapeHtml(unsafe) {
         if (!unsafe) return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Scroll the message list to the bottom
    function scrollToBottom() {
        setTimeout(() => { messageList.scrollTop = messageList.scrollHeight; }, 50); // Small delay helps ensure render complete
    }

    // --- Typing Indicator Logic ---
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() {
        if (!currentChatId || !isAuthenticatedOnServer || !socket || !socket.connected) return;
        // console.log("Typing detected..."); // Can be noisy
        // Send typing=true immediately
        socket.emit('typing', { recipientUid: currentChatId, isTyping: true });
        // Clear previous timeout
        clearTimeout(typingTimer);
        // Set timeout to send typing=false
        typingTimer = setTimeout(() => {
            socket.emit('typing', { recipientUid: currentChatId, isTyping: false });
        }, typingTimeout);
    }
    function showTypingIndicator() {
        typingIndicator.classList.remove('hidden');
        scrollToBottom();
    }
    function hideTypingIndicator() {
        typingIndicator.classList.add('hidden');
    }

    // --- Logout Function ---
    function logout() {
        console.log("Logging out...");
        if (socket) socket.disconnect();
        window.socketInstance = null;
        localStorage.clear(); // Clear all local storage
        window.location.href = 'login.html';
    }

     // --- Mobile View Toggling ---
     function setupMobileView() { /* ... same as before ... */ }
     function showChatAreaMobile() { /* ... same as before ... */ }
     function showSidebarMobile() { /* ... same as before ... */ }
     function addMobileBackButton() { /* ... same as before ... */ }
     function removeMobileBackButton() { /* ... same as before ... */ }


    // --- Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        else { handleTyping(); } // Trigger typing on other keypresses
    });
     messageInput.addEventListener('blur', () => { // Stop typing if input loses focus
         clearTimeout(typingTimer);
         if (currentChatId && isAuthenticatedOnServer && socket && socket.connected) {
             socket.emit('typing', { recipientUid: currentChatId, isTyping: false });
         }
     });
    searchContactsInput.addEventListener('input', filterContacts);
    logoutButton.addEventListener('click', logout);


    // --- Initial Connection ---
    connectWebSocket(); // Start the connection process

}); // End of DOMContentLoaded listener

// --- Make sure helper function definitions are below or included ---
// function displayContacts(contacts) { ... } defined above
// function filterContacts() { ... } defined above
// function loadChat(contactId) { ... } defined above
// function displayMessage(message) { ... } defined above
// function updateContactPreview(contactId, message, timestamp) { ... } defined above
// function escapeHtml(unsafe) { ... } defined above
// function scrollToBottom() { ... } defined above
// function handleTyping() { ... } defined above
// function showTypingIndicator() { ... } defined above
// function hideTypingIndicator() { ... } defined above
function setupMobileView() { if (window.innerWidth <= 768) { showSidebarMobile(); } }
function showChatAreaMobile() { const s = document.querySelector('.sidebar'); const c = document.querySelector('.chat-area'); s?.classList.add('mobile-hidden'); c?.classList.remove('mobile-hidden'); addMobileBackButton(); }
function showSidebarMobile() { const s = document.querySelector('.sidebar'); const c = document.querySelector('.chat-area'); s?.classList.remove('mobile-hidden'); c?.classList.add('mobile-hidden'); removeMobileBackButton(); }
function addMobileBackButton() { if (document.getElementById('mobile-back-button')) return; const btn = document.createElement('button'); btn.innerHTML = '<i class="fas fa-arrow-left"></i>'; btn.id = 'mobile-back-button'; btn.title="Back"; btn.style.cssText = 'margin-right:10px; border:none; background:none; color:var(--text-secondary); font-size:1.2em; cursor:pointer; padding:8px; order:-1;'; btn.onclick = showSidebarMobile; document.querySelector('.chat-header')?.prepend(btn); }
function removeMobileBackButton() { document.getElementById('mobile-back-button')?.remove(); }
// public/chat.js - Complete Version with DB Fetching Logic (April 16, 2025)

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check (Uses localStorage for token/flag only) ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');
    if (!isAuthenticated || !storedToken) {
        console.warn("User not authenticated or token missing. Redirecting to login.");
        localStorage.clear();
        window.location.href = 'login.html';
        return; // Stop execution
    }

    // --- Define Defaults ---
    const defaultPic = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik0yMCAyNUMxNy4zMSAyNSAxNSAyNy4zMSAxNSAzMEMxNSA2LjIgNCAzIDM3LjYyIDMwIDM3LjYyIDM0LjM0IDM3LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDI1LjYyIDI1LjYyIDM0LjM0IDE1LjYyIDMwIDMwIDM3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDI1IDI1IDIwIDI1IiBmaWxsPSIjYWFhIi8+PC9zdmc+';
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'My Username';

    // --- DOM Elements ---
    const sidebarElement = document.querySelector('.sidebar');
    const chatAreaElement = document.querySelector('.chat-area');
    const contactList = document.getElementById('contact-list');
    const messageList = document.getElementById('message-list');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const chatHeaderProfile = document.getElementById('chat-header-profile');
    const typingIndicator = document.getElementById('typing-indicator');
    const searchContactsInput = document.getElementById('search-contacts');
    const logoutButton = document.getElementById('logout-button');
    console.log("[Logout Debug] Found logout button element:", logoutButton);
    const currentUsernameSpan = document.getElementById('current-user-name');
    const sidebarProfilePic = document.getElementById('sidebar-profile-pic');

    // --- Update UI with Defaults Initially ---
    console.log("[Initial Load] Setting UI to defaults.");
    if (currentUsernameSpan) currentUsernameSpan.textContent = defaultUsername;
    if (sidebarProfilePic) sidebarProfilePic.src = defaultPic;
    if (sidebarProfilePic) sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };

    // --- State ---
    let currentChatId = null; // Stores the UID of the currently open chat partner/group ID
    let currentUser = { id: null, name: defaultUsername, profilePic: defaultPic }; // Holds logged-in user's info
    let currentContacts = []; // Holds the fetched list of contacts {id, name, profilePicUrl, ...}
    let currentMessages = {}; // Holds fetched messages, keyed by chatId { chatId: [messages] }
    let socket = null; // Holds the Socket.IO connection instance
    let isSocketAuthenticated = false; // Tracks if the current socket connection is authenticated

    // --- REMOVE SAMPLE DATA ---

    // --- Socket.IO Connection & Handlers ---
    function connectWebSocket() {
        if (typeof io === 'undefined') {
            console.error("Socket.IO client (io) not found.");
            alert("Chat initialization error."); return;
        }
        console.log("Attempting to connect WebSocket...");
        if (socket && socket.connected) { console.log("WebSocket already connected."); return; }

        socket = io({ /* options */ });

        // --- Socket Event Handlers ---
        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            isSocketAuthenticated = false;
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                 console.log("Emitting authenticate event...");
                 socket.emit('authenticate', idToken);
            } else { console.error("Token missing on connect. Logging out."); logout(); }
        });

        socket.on('authenticationSuccess', (userData) => {
            isSocketAuthenticated = true;
            console.log(">>> CHAT PAGE: 'authenticationSuccess' received!");
            console.log(">>> Payload received from backend:", JSON.stringify(userData, null, 2));

            // Update current user state and UI with data from backend DB
            currentUser.id = userData.uid;
            currentUser.name = userData.username || defaultUsername;
            currentUser.profilePic = userData.profilePicUrl || defaultPic;
            console.log(">>> CHAT PAGE: Updated internal 'currentUser' object:", currentUser);

            if (currentUsernameSpan) currentUsernameSpan.textContent = currentUser.name;
            if (sidebarProfilePic) {
                sidebarProfilePic.src = currentUser.profilePic;
                sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };
            }
            console.log(`>>> CHAT PAGE: Set sidebar UI: Name='${currentUser.name}', PicSrc='${currentUser.profilePic}'`);

            // Request initial data needed after successful authentication
            if (socket) {
                 console.log("[Initialize] Requesting contact list from server...");
                 socket.emit('getContacts');
            }
            initializeChatApp(); // Basic UI setup (like mobile view)
        });

        socket.on('authenticationFailed', (error) => {
             isSocketAuthenticated = false;
             console.error(">>> CHAT PAGE: Backend socket authentication failed:", error?.message || 'Unknown error');
             const message = error?.message || 'Authentication failed.';
             if (message.includes('expired')) { alert("Your login session has expired. Please log in again."); }
             else { alert(`Authentication error: ${message}`); }
             logout();
         });

        // --- Handle Contact List Received from Server ---
        socket.on('contactList', (contacts) => {
            console.log("[Initialize] Received contact list:", contacts);
            currentContacts = contacts || []; // Update state variable
            displayContacts(currentContacts); // Render the fetched contacts
        });

        // --- Handle Chat History Received from Server ---
        socket.on('chatHistory', (data) => {
            if (!data || !data.chatId || !Array.isArray(data.messages)) {
                console.error("Invalid chat history data received:", data);
                 if (data.chatId === currentChatId && messageList) {
                     messageList.innerHTML = '<div class="error-history">Error loading messages.</div>';
                 }
                return;
            }
            console.log(`[History] Received ${data.messages.length} messages for chat ${data.chatId}`);
            currentMessages[data.chatId] = data.messages; // Store history in state

            // If this history is for the currently open chat, display it
            if (data.chatId === currentChatId) {
                 if (messageList) messageList.innerHTML = ''; // Clear loading/old messages
                 data.messages.forEach(displayMessage); // Display new history
                 scrollToBottom();
            }
        });

         // --- Handle Added Contact Result ---
         socket.on('addContactResult', (result) => {
             console.log("Add contact result:", result);
             if (result.success) {
                 alert(result.message || "Contact added!");
                  // Refresh contact list to show the new contact
                  if (socket && isSocketAuthenticated) socket.emit('getContacts');
                  // Optionally add the contact directly to currentContacts state and call displayContacts
                  // if (result.contact) {
                  //      currentContacts.push(result.contact);
                  //      displayContacts(currentContacts);
                  // }
             } else {
                  alert(`Failed to add contact: ${result.message || 'Unknown error'}`);
             }
         });

        socket.on('receiveMessage', (message) => {
            if (!isSocketAuthenticated || !message || !message.sender) return;
            console.log('Message received:', message);

            // Determine the chat ID this message belongs to (the other person in 1-on-1)
            const chatId = (message.sender === currentUser.id) ? message.recipientUid : message.sender; // Assuming recipientUid is sent for sent messages, adjust if needed
            if (!chatId) { console.error("Received message without clear chat ID context", message); return; }

            // Add message to internal state
            if (!currentMessages[chatId]) {
                currentMessages[chatId] = [];
            }
            currentMessages[chatId].push(message); // Add new message to the history cache

            if (chatId === currentChatId) { // If this chat is currently open
                displayMessage(message); // Display it
                scrollToBottom();
                // TODO: Emit 'markAsRead' event to backend?
            } else {
                 // TODO: Increment unread count for the contact list item
                 console.log(`Unread message from ${message.sender} for chat ${chatId}`);
                 // updateUnreadCount(chatId, 1); // Function to update UI count
            }
            // TODO: Update contact list preview (last message/timestamp)
             updateContactPreview(chatId, message.content, message.timestamp);
        });

        socket.on('typingStatus', (data) => {
            if (!isSocketAuthenticated || !currentUser.id || !data || data.senderUid === currentUser.id) return;
            if (data.senderUid === currentChatId) {
                if (data.isTyping) { showTypingIndicator(); } else { hideTypingIndicator(); }
            }
             // TODO: Update contact list preview (optional)
        });

        socket.on('messageSentConfirmation', (data) => {
            if (!isSocketAuthenticated) return;
            console.log("Server confirmed message:", data);
            // Find message by tempId or dbId and update its status tick/timestamp in UI
             // updateMessageStatusInUI(data.dbId || data.tempId, data.status, data.timestamp);
        });

        socket.on('disconnect', (reason) => { isSocketAuthenticated = false; console.warn('Socket disconnected:', reason); /* TODO: Show UI state */ });
        socket.on('connect_error', (err) => { isSocketAuthenticated = false; console.error(`Socket connection error: ${err.message}`); /* TODO: Show UI state */ });
        socket.on('error', (error) => { console.error("Server Error:", error); alert(`Server Error: ${error.message || 'Unknown error'}`); });

    } // End connectWebSocket


    // --- Main Application Functions ---

    /**
     * Initializes the chat UI after authentication. Requests contacts.
     */
    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // Contact list is now populated by the 'contactList' event handler
        // Requesting contacts is done after 'authenticationSuccess'
        setupMobileView(); // Setup mobile/desktop view based on screen size
    }

    /**
     * Renders the contact list in the sidebar.
     * @param {Array} contacts - Array of contact objects from backend { id, name, profilePicUrl, ... }
     */
    function displayContacts(contacts) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = ''; // Clear existing list
        console.log(`[Display Contacts] Rendering ${contacts?.length || 0} contacts.`);
        (contacts || []).forEach(contact => {
            if (!contact || !contact.id || !contact.name) return; // Skip invalid contacts

            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id; // Use 'id' field from backend data

            // TODO: Add lastMessage, timestamp, unread fields based on backend data later
            let displayStatus = contact.lastMessage || ''; // Placeholder
            // if (contact.status === 'typing') displayStatus = '<i>Typing...</i>';
            let contactPic = contact.profilePicUrl || defaultPic; // Use specific pic or default SVG

            contactEl.innerHTML = `
                <img src="${contactPic}" alt="${escapeHtml(contact.name)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                <div class="contact-info">
                    <span class="contact-name">${escapeHtml(contact.name)}</span>
                    <span class="last-message">${escapeHtml(displayStatus)}</span>
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

     /**
      * Filters the displayed contact list based on search input.
      * Uses the currentContacts state variable.
      */
     function filterContacts() {
        if (!searchContactsInput) return;
        const searchTerm = searchContactsInput.value.toLowerCase();
        const filteredContacts = currentContacts.filter(contact =>
            contact.name && contact.name.toLowerCase().includes(searchTerm)
        );
        displayContacts(filteredContacts);
    }

    /**
     * Loads a specific chat into the main chat area, fetching its history.
     * @param {string} contactId - The UID of the other user in the chat.
     */
    function loadChat(contactId) {
        console.log("Loading chat for contact ID:", contactId);
        if (!isSocketAuthenticated || !contactId) {
             console.warn("Cannot load chat, socket not authenticated or contactId missing.");
             return;
        }
        currentChatId = contactId;

        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === contactId);
            if (item.dataset.contactId === contactId) item.querySelector('.unread-count')?.remove();
        });

        // Find contact details from the state populated by 'contactList' event
        const contact = currentContacts.find(c => c.id === contactId);
        if (!contact) {
             console.error("Contact details not found in current list for ID:", contactId);
             if(chatHeaderProfile) chatHeaderProfile.innerHTML = `<div class="placeholder">Contact not found</div>`;
             if(messageList) messageList.innerHTML = '';
             return;
        }

        // Update chat header
        let contactPic = contact.profilePicUrl || defaultPic;
        if (chatHeaderProfile) {
            chatHeaderProfile.innerHTML = `
                <img src="${contactPic}" alt="${escapeHtml(contact.name)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                <div class="contact-details">
                    <span class="contact-name">${escapeHtml(contact.name)}</span>
                    <span class="contact-status">${contact.status === 'online' ? 'Online' : 'Offline'}</span> </div>`;
        }

        // Request Chat History from backend
        if (messageList) messageList.innerHTML = '<div class="loading-history" style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading messages...</div>';
        if (socket && socket.connected) {
             console.log(`[History] Requesting history for chat ${contactId}`);
             socket.emit('getChatHistory', { chatId: contactId, limit: 50 }); // Request history
        } else {
             console.error("Cannot get history, socket not available.");
             if(messageList) messageList.innerHTML = '<div class="error-history" style="text-align: center; padding: 20px; color: var(--error-color);">Could not load messages.</div>';
        }
        // History will be displayed by the 'chatHistory' event handler

        if (messageInput) messageInput.focus();
        hideTypingIndicator();
        if (window.innerWidth <= 768) { showChatAreaMobile(); }
    }

    /**
     * Appends a single message object to the message list UI.
     * @param {object} message - Message object { id, sender, content, timestamp, status?, senderName? }
     */
    function displayMessage(message) {
        if (!messageList || !message || !message.sender || !currentUser.id) {
             console.warn("displayMessage: Cannot display message - missing data or context.", message, currentUser);
             return;
        }
        const isSent = message.sender === currentUser.id;
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id; // Use ID from backend (dbId or tempId)
        messageEl.dataset.senderId = message.sender;

        let ticksHtml = ''; // TODO: Implement based on 'messageSentConfirmation' or message status field
        let senderNameHtml = ''; // TODO: Use for group chats
        if (!isSent && message.senderName) senderNameHtml = `<div class="sender-name">${escapeHtml(message.senderName)}</div>`;

        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            // Get sender's pic from currently loaded contacts state
            const senderContact = currentContacts.find(c => c.id === message.sender);
            const picUrl = senderContact?.profilePicUrl || defaultPic;
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small" onerror="this.onerror=null; this.src='${defaultPic}';">`;
        }

        // Ensure timestamp is a string before displaying
        const displayTimestamp = typeof message.timestamp === 'string' ? message.timestamp :
                                 (message.timestamp instanceof Date ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : ' ');

        messageEl.innerHTML = `
            ${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>'}
            <div class="bubble">
                ${senderNameHtml}
                <p>${escapeHtml(message.content)}</p>
                <div class="message-meta">
                    <span class="timestamp">${displayTimestamp}</span>
                    ${ticksHtml}
                </div>
            </div>
        `;
        messageList.appendChild(messageEl);
    }

    /**
     * Handles sending a message typed by the user.
     */
    function sendMessage() {
        if (!messageInput) return;
        const messageText = messageInput.value.trim();
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser.id) { return; }

        const tempId = 'temp_' + Date.now();
        const newMessage = { id: tempId, sender: currentUser.id, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };

        displayMessage(newMessage); // Optimistic UI update
        scrollToBottom();
        messageInput.value = ''; messageInput.focus();

        if (socket && socket.connected) {
            socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId });
        } else { console.error("Cannot send message, socket not connected."); /* TODO: Show UI error */ }

        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp);
        hideTypingIndicator();
    }

    /**
     * Updates the last message preview in the contact list sidebar.
     */
    function updateContactPreview(contactId, message, timestamp) {
        if (!contactList) return;
        const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
            const msgElement = contactItem.querySelector('.last-message');
            const timeElement = contactItem.querySelector('.timestamp');
            if(msgElement) msgElement.textContent = message;
            if(timeElement) timeElement.textContent = timestamp;
             contactList.prepend(contactItem); // Move contact to top
        }
    }

    /**
     * Escapes HTML special characters in a string.
     */
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        const element = document.createElement('div');
        element.textContent = unsafe;
        return element.innerHTML;
    }

    /**
     * Scrolls the message list element to the bottom.
     */
    function scrollToBottom() {
        setTimeout(() => { if (messageList) messageList.scrollTop = messageList.scrollHeight; }, 50);
    }

    // --- Typing Indicator Logic ---
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() {
        if (!currentChatId || !isSocketAuthenticated || !socket) return;
        socket.emit('typing', { recipientUid: currentChatId, isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if(socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false }); }, typingTimeout);
    }
    function showTypingIndicator() { if (typingIndicator) typingIndicator.classList.remove('hidden'); scrollToBottom(); }
    function hideTypingIndicator() { if (typingIndicator) typingIndicator.classList.add('hidden'); }

    // --- Logout Function ---
    function logout() {
        console.log("[Logout Debug] Logout function CALLED!");
        console.log("Logging out...");
        if (socket) { socket.disconnect(); socket = null; }
        isSocketAuthenticated = false;
        localStorage.clear();
        console.log("[Logout Debug] Local storage cleared. Redirecting to login...");
        window.location.href = 'login.html';
    }

    // --- Mobile View Toggling Functions ---
    function setupMobileView() {
        if (!sidebarElement || !chatAreaElement) { return; }
        if (window.innerWidth <= 768) { showSidebarMobile(); }
        else {
            sidebarElement.classList.remove('mobile-hidden');
            chatAreaElement.classList.remove('mobile-hidden');
            removeMobileBackButton();
        }
    }
    function showChatAreaMobile() {
        if(sidebarElement) sidebarElement.classList.add('mobile-hidden');
        if(chatAreaElement) chatAreaElement.classList.remove('mobile-hidden');
        addMobileBackButton();
    }
    function showSidebarMobile() {
        if(sidebarElement) sidebarElement.classList.remove('mobile-hidden');
        if(chatAreaElement) chatAreaElement.classList.add('mobile-hidden');
        removeMobileBackButton();
    }
    function addMobileBackButton() {
        const chatHeader = document.querySelector('.chat-header');
        if (!chatHeader || document.getElementById('mobile-back-button')) return;
        const backButton = document.createElement('button');
        backButton.innerHTML = '<i class="fas fa-arrow-left"></i>';
        backButton.id = 'mobile-back-button';
        backButton.title = "Back to Chats";
        backButton.style.cssText = `margin-right: 10px; border: none; background: none; color: var(--text-secondary); font-size: 1.2em; cursor: pointer; padding: 8px; flex-shrink: 0; order: -1;`;
        backButton.onclick = showSidebarMobile;
        chatHeader.prepend(backButton);
    }
    function removeMobileBackButton() {
        const backButton = document.getElementById('mobile-back-button');
        if (backButton) backButton.remove();
    }

    // --- Event Listeners ---
    if (sendButton) sendButton.addEventListener('click', sendMessage);
    if (messageInput) messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } else { handleTyping(); } });
    if (searchContactsInput) searchContactsInput.addEventListener('input', filterContacts);
    if (logoutButton) { console.log("[Logout Debug] Attaching click listener to logout button..."); logoutButton.addEventListener('click', logout); }
    else { console.error("[Logout Debug] Logout button element NOT found! Listener not attached."); }

    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

}); // End of DOMContentLoaded listener
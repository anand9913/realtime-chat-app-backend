// public/chat.js - Complete Version (April 16, 2025 - With Listener Registration Logs)

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check (Uses localStorage for token/flag only) ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken'); // Needed to auth socket
    if (!isAuthenticated || !storedToken) {
        console.warn("User not authenticated or token missing. Redirecting to login.");
        localStorage.clear(); // Clear everything on auth failure
        window.location.href = 'login.html';
        return; // Stop execution
    }

    // --- Define Defaults ---
    // Use a self-contained SVG Data URI for the default picture
    const defaultPic = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik0yMCAyNUMxNy4zMSAyNSAxNSAyNy4zMSAxNSAzMEMxNSA2LjIgNCAzIDM3LjYyIDMwIDM3LjYyIDM0LjM0IDM3LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDI1LjYyIDI1LjYyIDM0LjM0IDE1LjYyIDMwIDMwIDM3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDI1IDI1IDIwIDI1IiBmaWxsPSIjYWFhIi8+PC9zdmc+';
    // Use phone number from login as default name, or a generic fallback
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'My Username';

    // --- DOM Elements ---
    const sidebarElement = document.querySelector('.sidebar'); // Get parent elements too
    const chatAreaElement = document.querySelector('.chat-area');
    const contactList = document.getElementById('contact-list');
    const messageList = document.getElementById('message-list');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const chatHeaderProfile = document.getElementById('chat-header-profile');
    const typingIndicator = document.getElementById('typing-indicator');
    const searchContactsInput = document.getElementById('search-contacts');
    const logoutButton = document.getElementById('logout-button');
    // *** Logout Debug Log ***
    console.log("[Logout Debug] Found logout button element:", logoutButton);
    const currentUsernameSpan = document.getElementById('current-user-name');
    const sidebarProfilePic = document.getElementById('sidebar-profile-pic');

    // --- Update UI with Defaults Initially ---
    console.log("[Initial Load] Setting UI to defaults.");
    if (currentUsernameSpan) currentUsernameSpan.textContent = defaultUsername;
    if (sidebarProfilePic) sidebarProfilePic.src = defaultPic;
    if (sidebarProfilePic) sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };

    // --- State ---
    let currentChatId = null;
    let currentUser = { // User profile data, populated after successful auth
        id: null,
        name: defaultUsername,
        profilePic: defaultPic
    };
    let socket = null; // Socket instance for this page
    let isSocketAuthenticated = false; // Track socket auth state

    // --- Sample Data (Remove/Replace when backend provides real data) ---
    const sampleContacts = [ { id: 'user_jane', name: 'Jane Doe', profilePicUrl: null, lastMessage: 'Okay', timestamp: '10:30 AM', unread: 1, status: 'online' }, { id: 'user_john', name: 'John Smith', profilePicUrl: null, lastMessage: 'Sounds good!', timestamp: 'Yesterday', unread: 0, status: 'offline' }, ];
    const sampleMessages = { 'user_jane': [ { id: 'msg1', sender: 'user_me', content: 'Hey', timestamp: '10:28 AM', status: 'read' }, { id: 'msg2', sender: 'user_jane', content: 'Hi!', timestamp: '10:29 AM' }, ], 'user_john': [ { id: 'msg7', sender: 'user_john', content: '?', timestamp: 'Yesterday' }, ], };
    // --- End Sample Data ---

    // --- Socket.IO Connection ---
    function connectWebSocket() {
        if (typeof io === 'undefined') {
            console.error("! chat.js: Socket.IO client library (io) not found. Ensure '/socket.io/socket.io.js' is included correctly in chat.html BEFORE chat.js");
            alert("Chat initialization error. Cannot connect to server.");
            return;
        }
        console.log("chat.js: Attempting to connect WebSocket...");
        if (socket && socket.connected) {
            console.log("chat.js: WebSocket already connected.");
            return;
        }
        socket = io({ /* options */ });

        // --- Socket Event Handlers ---
        console.log("chat.js: Setting up socket event listeners..."); // Log setup start

        socket.on('connect', () => {
            console.log('chat.js: Event listener fired: connect. Socket ID:', socket.id); // Log event fired
            isSocketAuthenticated = false;
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("chat.js: connect handler - Emitting authenticate event...");
                socket.emit('authenticate', idToken);
            } else { console.error("chat.js: connect handler - Token missing! Logging out."); logout(); }
        });
        console.log("chat.js: Listener attached for 'connect'"); // Log listener attached

        socket.on('authenticationSuccess', (userData) => {
            // This is the handler we expect to run
            isSocketAuthenticated = true; // Mark socket as authenticated *now*
            console.log("-----------------------------------------");
            console.log(">>> CHAT PAGE: Event listener fired: authenticationSuccess!"); // Log event fired
            console.log(">>> Payload received from backend:", JSON.stringify(userData, null, 2));

            // --- Use profile data STRICTLY FROM BACKEND ---
            currentUser.id = userData.uid;
            currentUser.name = userData.username || defaultUsername;
            currentUser.profilePic = userData.profilePicUrl || defaultPic;
            console.log(">>> CHAT PAGE: Updated internal 'currentUser' object:", currentUser);

            // --- Attempt to Update UI ---
            console.log(">>> CHAT PAGE: Attempting to find UI elements...");
            const nameSpan = document.getElementById('current-user-name');
            const picImg = document.getElementById('sidebar-profile-pic');
            console.log(">>> CHAT PAGE: Found nameSpan element:", nameSpan ? 'Yes' : 'No');
            console.log(">>> CHAT PAGE: Found picImg element:", picImg ? 'Yes' : 'No');

            if (nameSpan) {
                console.log(`>>> CHAT PAGE: BEFORE setting textContent: Current text is "${nameSpan.textContent}"`);
                try {
                    nameSpan.textContent = currentUser.name;
                    console.log(`>>> CHAT PAGE: SUCCESSFULLY set nameSpan.textContent to: "${currentUser.name}"`);
                    console.log(`>>> CHAT PAGE: VERIFY nameSpan.textContent is now: "${nameSpan.textContent}"`);
                } catch (e) { console.error(">>> CHAT PAGE: ERROR setting nameSpan.textContent:", e); }
            } else { console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'current-user-name'"); }

            if (picImg) {
                console.log(`>>> CHAT PAGE: BEFORE setting src: Current src is "${picImg.src}"`);
                picImg.onerror = null; // Clear previous handler
                try {
                    let newSrc = currentUser.profilePic;
                    picImg.src = newSrc; // Set the source
                    console.log(`>>> CHAT PAGE: SUCCESSFULLY set picImg.src to: "${newSrc}"`);
                    console.log(`>>> CHAT PAGE: VERIFY picImg.src is now: "${picImg.src}"`);
                    // Re-attach onerror AFTER setting src
                    picImg.onerror = () => {
                        console.warn(">>> CHAT PAGE: onerror triggered! Error loading profile pic src:", newSrc, ". Reverting to default.");
                        picImg.src = defaultPic; // Fallback to default SVG on error
                    };
                } catch (e) { console.error(">>> CHAT PAGE: ERROR setting picImg.src:", e); }
            } else { console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'sidebar-profile-pic'"); }
            console.log(">>> CHAT PAGE: UI update attempts finished.");
            console.log("-----------------------------------------");

            // Initialize contacts etc. AFTER auth is successful and UI updated
            initializeChatApp();
        });
        console.log("chat.js: Listener attached for 'authenticationSuccess'"); // Log listener attached

        socket.on('authenticationFailed', (error) => {
            console.log("chat.js: Event listener fired: authenticationFailed"); // Log event fired
            isSocketAuthenticated = false;
            console.error(">>> CHAT PAGE: Backend socket authentication failed:", error?.message || 'Unknown error');
            const message = error?.message || 'Authentication failed.';
            if (message.includes('expired')) { alert("Your login session has expired. Please log in again."); }
            else { alert(`Authentication error: ${message}`); }
            logout();
        });
        console.log("chat.js: Listener attached for 'authenticationFailed'"); // Log listener attached

        socket.on('receiveMessage', (message) => {
            console.log("chat.js: Event listener fired: receiveMessage"); // Log event fired
            if (!isSocketAuthenticated) return;
            displayMessage(message);
            scrollToBottom();
        });
        console.log("chat.js: Listener attached for 'receiveMessage'"); // Log listener attached

        socket.on('typingStatus', (data) => {
            console.log("chat.js: Event listener fired: typingStatus"); // Log event fired
            if (!isSocketAuthenticated || !currentUser.id || data.senderUid === currentUser.id) return;
            if (data.senderUid === currentChatId) {
                if (data.isTyping) { showTypingIndicator(); } else { hideTypingIndicator(); }
            }
        });
        console.log("chat.js: Listener attached for 'typingStatus'"); // Log listener attached

        socket.on('messageSentConfirmation', (data) => {
             console.log("chat.js: Event listener fired: messageSentConfirmation"); // Log event fired
            if (!isSocketAuthenticated) return;
            console.log("Server confirmed message:", data);
             // TODO: Update UI tick status
        });
        console.log("chat.js: Listener attached for 'messageSentConfirmation'"); // Log listener attached

        socket.on('disconnect', (reason) => {
             console.log("chat.js: Event listener fired: disconnect"); // Log event fired
            isSocketAuthenticated = false;
            console.warn('Socket disconnected:', reason);
             // TODO: Show UI disconnected state
        });
        console.log("chat.js: Listener attached for 'disconnect'"); // Log listener attached

        socket.on('connect_error', (err) => {
             console.log("chat.js: Event listener fired: connect_error"); // Log event fired
            isSocketAuthenticated = false;
            console.error(`Socket connection error: ${err.message}`);
             // TODO: Show UI error state
        });
        console.log("chat.js: Listener attached for 'connect_error'"); // Log listener attached

        socket.on('error', (error) => {
             console.log("chat.js: Event listener fired: error"); // Log event fired
            console.error("Error message from server:", error);
            alert(`Server Error: ${error.message || 'Unknown error'}`);
        });
        console.log("chat.js: Listener attached for 'error'"); // Log listener attached

        console.log("chat.js: Finished setting up socket event listeners."); // Log setup end

    } // End connectWebSocket

    // --- Main Application Functions ---

    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // TODO: Fetch real contacts from backend
        displayContacts(sampleContacts); // Using sample data for now
        setupMobileView();
    }

    function displayContacts(contacts) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = '';
        contacts.forEach(contact => {
            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id;
            let displayStatus = contact.lastMessage || '';
            if (contact.status === 'typing') displayStatus = '<i>Typing...</i>';
            let contactPic = contact.profilePicUrl || contact.profilePic || defaultPic;

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

     function filterContacts() {
        if (!searchContactsInput) return;
        const searchTerm = searchContactsInput.value.toLowerCase();
        const filteredContacts = sampleContacts.filter(contact => contact.name.toLowerCase().includes(searchTerm));
        displayContacts(filteredContacts);
    }

    function loadChat(contactId) {
        console.log("Loading chat for:", contactId);
        if (!isSocketAuthenticated) { console.warn("Cannot load chat, socket not authenticated."); return; }
        currentChatId = contactId;

        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === contactId);
            if (item.dataset.contactId === contactId) item.querySelector('.unread-count')?.remove();
        });

        const contact = sampleContacts.find(c => c.id === contactId); // TODO: Use real contact data
        if (!contact) {
             console.error("Contact not found for ID:", contactId);
             if(chatHeaderProfile) chatHeaderProfile.innerHTML = `<div class="placeholder">Contact not found</div>`;
             if(messageList) messageList.innerHTML = '';
             return;
        }

        let contactPic = contact.profilePicUrl || contact.profilePic || defaultPic;
        if (chatHeaderProfile) {
            chatHeaderProfile.innerHTML = `
                <img src="${contactPic}" alt="${escapeHtml(contact.name)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                <div class="contact-details">
                    <span class="contact-name">${escapeHtml(contact.name)}</span>
                    <span class="contact-status">${contact.status === 'online' ? 'Online' : 'Offline'}</span>
                </div>`;
        }

        if (messageList) messageList.innerHTML = '';
        const messages = sampleMessages[contactId] || []; // TODO: Fetch real messages
        messages.forEach(displayMessage);
        scrollToBottom();
        if (messageInput) messageInput.focus();
        hideTypingIndicator();
        if (window.innerWidth <= 768) { showChatAreaMobile(); }
    }

    function displayMessage(message) {
        if (!messageList || !message || !message.sender) return;
        const isSent = currentUser.id && message.sender === currentUser.id;
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id;
        messageEl.dataset.senderId = message.sender;

        let ticksHtml = ''; // TODO: Ticks based on actual status
        let senderNameHtml = '';
        if (!isSent && message.senderName) senderNameHtml = `<div class="sender-name">${escapeHtml(message.senderName)}</div>`;

        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            const senderContact = sampleContacts.find(c => c.id === message.sender); // TODO: Use real data
            const picUrl = senderContact?.profilePicUrl || senderContact?.profilePic || defaultPic;
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small" onerror="this.onerror=null; this.src='${defaultPic}';">`;
        }

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

    function sendMessage() {
        if (!messageInput) return;
        const messageText = messageInput.value.trim();
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser.id) return;
        const tempId = 'temp_' + Date.now();
        const newMessage = { id: tempId, sender: currentUser.id, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };
        displayMessage(newMessage); // Optimistic UI update
        scrollToBottom();
        messageInput.value = ''; messageInput.focus();

        if (socket && socket.connected) {
            console.log(`Emitting 'sendMessage': Recipient=${currentChatId}, Content=${messageText.substring(0,30)}...`);
            socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId });
        } else { console.error("Cannot send message, socket not connected."); /* TODO: Show UI error */ }
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp);
        hideTypingIndicator();
    }

    function updateContactPreview(contactId, message, timestamp) {
         if (!contactList) return;
         const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
            const msgElement = contactItem.querySelector('.last-message');
            const timeElement = contactItem.querySelector('.timestamp');
            if(msgElement) msgElement.textContent = message;
            if(timeElement) timeElement.textContent = timestamp;
            // contactList.prepend(contactItem); // Move to top
        }
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        const element = document.createElement('div');
        element.textContent = unsafe;
        return element.innerHTML;
    }

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
        if (socket) {
            console.log("[Logout Debug] Disconnecting socket...");
            socket.disconnect();
            socket = null;
        }
        isSocketAuthenticated = false;
        localStorage.clear(); // Clear all local storage
        console.log("[Logout Debug] Local storage cleared. Redirecting to login...");
        window.location.href = 'login.html';
    }

    // --- Mobile View Toggling Functions ---
    function setupMobileView() {
        if (!sidebarElement || !chatAreaElement) return; // Ensure elements exist
        if (window.innerWidth <= 768) {
            showSidebarMobile(); // Start by showing sidebar on mobile load
        } else {
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
        const contactProfileDiv = chatHeader.querySelector('.contact-profile');
         if (contactProfileDiv) { chatHeader.insertBefore(backButton, contactProfileDiv); }
         else { chatHeader.prepend(backButton); }
    }
    function removeMobileBackButton() {
        const backButton = document.getElementById('mobile-back-button');
        if (backButton) backButton.remove();
    }

    // --- Event Listeners ---
    if (sendButton) sendButton.addEventListener('click', sendMessage);
    if (messageInput) messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        else { handleTyping(); }
    });
    if (searchContactsInput) searchContactsInput.addEventListener('input', filterContacts);
    if (logoutButton) {
         console.log("[Logout Debug] Attaching click listener to logout button...");
         logoutButton.addEventListener('click', logout);
    } else {
         console.error("[Logout Debug] Logout button element NOT found! Listener not attached.");
    }

    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

}); // End of DOMContentLoaded listener
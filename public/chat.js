// public/chat.js - Complete Version (April 16, 2025)

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

    // --- Sample Data (Keep for UI structure until backend provides real data) ---
    const sampleContacts = [
        { id: 'user_jane', name: 'Jane Doe', profilePic: '', lastMessage: 'Okay, see you then!', timestamp: '10:30 AM', unread: 3, status: 'online' },
        { id: 'user_john', name: 'John Smith', profilePic: '', lastMessage: 'Sounds good!', timestamp: 'Yesterday', unread: 0, status: 'offline' },
        { id: 'user_group', name: 'Project Alpha Team', profilePic: '', lastMessage: 'Alice: Don\'t forget the meeting.', timestamp: '9:15 AM', unread: 1 },
    ];
    const sampleMessages = {
         'user_jane': [
            { id: 'msg1', sender: 'user_me', content: 'Hey Jane', timestamp: '10:28 AM', status: 'read' },
            { id: 'msg2', sender: 'user_jane', content: 'Hi!', timestamp: '10:29 AM' },
        ],
        'user_john': [
            { id: 'msg7', sender: 'user_john', content: '?', timestamp: 'Yesterday' },
        ],
        'user_group': [
             { id: 'msg11', sender: 'user_alice', senderName: 'Alice', content: 'Meeting reminder', timestamp: '9:10 AM' },
        ]
    };
    // --- End Sample Data ---

    // --- Socket.IO Connection ---
    function connectWebSocket() {
        // Check if io function exists (loaded from /socket.io/socket.io.js)
        if (typeof io === 'undefined') {
            console.error("Socket.IO client library (io) not found. Ensure '/socket.io/socket.io.js' is included correctly in chat.html BEFORE chat.js");
            alert("Chat initialization error. Cannot connect to server.");
            return;
        }

        console.log("Attempting to connect WebSocket...");
        if (socket && socket.connected) {
            console.log("WebSocket already connected.");
            return;
        }

        socket = io({
            // Optional: Add reconnection attempts etc.
            // reconnectionAttempts: 5,
        });

        // --- Socket Event Handlers ---

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            isSocketAuthenticated = false; // Reset auth status on new connection
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("Attempting to authenticate socket with backend...");
                socket.emit('authenticate', idToken);
            } else {
                console.error("Firebase ID token missing on connect event. Logging out.");
                logout(); // Force logout if token disappears somehow
            }
        });

        socket.on('authenticationSuccess', (userData) => {
            isSocketAuthenticated = true; // Mark socket as authenticated
            console.log("-----------------------------------------");
            console.log(">>> CHAT PAGE: 'authenticationSuccess' received!");
            console.log(">>> Payload received from backend:", JSON.stringify(userData, null, 2));

            // --- Use profile data STRICTLY FROM BACKEND ---
            currentUser.id = userData.uid;
            currentUser.name = userData.username || defaultUsername; // Use DB value or default
            currentUser.profilePic = userData.profilePicUrl || defaultPic; // Use DB value or default

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
                    let newSrc = currentUser.profilePic; // Already defaults if needed
                    picImg.src = newSrc;
                    console.log(`>>> CHAT PAGE: SUCCESSFULLY set picImg.src to: "${newSrc}"`);
                    console.log(`>>> CHAT PAGE: VERIFY picImg.src is now: "${picImg.src}"`);
                    // Re-attach onerror AFTER setting src
                    picImg.onerror = () => {
                        console.warn(">>> CHAT PAGE: onerror triggered! Error loading profile pic src:", newSrc, ". Reverting to default.");
                        picImg.src = defaultPic;
                    };
                } catch (e) { console.error(">>> CHAT PAGE: ERROR setting picImg.src:", e); }
            } else { console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'sidebar-profile-pic'"); }
            console.log(">>> CHAT PAGE: UI update attempts finished.");
            console.log("-----------------------------------------");

            // Initialize chat list etc. AFTER auth is successful and UI updated
            initializeChatApp();
        });

        socket.on('authenticationFailed', (error) => {
            isSocketAuthenticated = false; // Ensure state is updated
            console.error(">>> CHAT PAGE: Backend socket authentication failed:", error?.message || 'Unknown error');
            const message = error?.message || 'Authentication failed.';
            // Check if the error message indicates expiry
            if (message.includes('expired')) {
                 alert("Your login session has expired. Please log in again.");
            } else {
                 alert(`Authentication error: ${message}`);
            }
            logout(); // Force logout on any auth failure
        });

        socket.on('receiveMessage', (message) => {
            if (!isSocketAuthenticated) return;
            console.log('Message received:', message);
            displayMessage(message);
            scrollToBottom();
            // TODO: Add notification logic if window not focused
            // TODO: Update contact list preview
        });

        socket.on('typingStatus', (data) => {
            if (!isSocketAuthenticated || data.senderUid === currentUser.id) return;
            if (data.senderUid === currentChatId) {
                if (data.isTyping) { showTypingIndicator(); }
                else { hideTypingIndicator(); }
            }
            // TODO: Update contact list preview (optional)
        });

        socket.on('messageSentConfirmation', (data) => {
            if (!isSocketAuthenticated) return;
            console.log("Server confirmed message:", data);
            // TODO: Update message status tick in UI
            // updateMessageStatusInUI(data.dbId || data.tempId, data.status, data.timestamp);
        });

        socket.on('disconnect', (reason) => {
            isSocketAuthenticated = false;
            console.warn('Socket disconnected:', reason);
            // TODO: Show disconnected UI state, maybe attempt reconnection
            if (reason === 'io server disconnect') {
                 console.error("Disconnected by server (check server logs for reason).");
                 // If not already handled by authFailed, maybe logout?
                 // alert("Disconnected by server. Please log in again.");
                 // logout();
            }
        });

        socket.on('connect_error', (err) => {
            isSocketAuthenticated = false;
            console.error(`Socket connection error: ${err.message}`);
            // TODO: Show connection error UI state
        });

        socket.on('error', (error) => { // General errors from server
            console.error("Error message from server:", error);
            alert(`Server Error: ${error.message || 'Unknown error'}`);
        });
    }

    // --- Main Application Functions ---

    function initializeChatApp() {
         console.log("Initializing Chat App UI (Contacts, etc)...");
         // TODO: Replace sampleContacts with data fetched from backend
         // socket.emit('getContacts'); // Example event
        displayContacts(sampleContacts);
         setupMobileView();
    }

    function displayContacts(contacts) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = ''; // Clear existing list
        contacts.forEach(contact => {
            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id;

            let displayStatus = contact.lastMessage || '';
            if (contact.status === 'typing') displayStatus = '<i>Typing...</i>';
            // Use default SVG for contacts without a picture
            let contactPic = contact.profilePicUrl || contact.profilePic || defaultPic;

            contactEl.innerHTML = `
                <img src="${contactPic}" alt="${contact.name}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';"> <div class="contact-info">
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
        // TODO: Replace sampleContacts with actual contact list state
        const filteredContacts = sampleContacts.filter(contact =>
            contact.name.toLowerCase().includes(searchTerm)
        );
        displayContacts(filteredContacts);
    }

    function loadChat(contactId) {
        console.log("Loading chat for:", contactId);
        if (!isSocketAuthenticated) {
             console.warn("Cannot load chat, socket not authenticated.");
             return;
        }
        currentChatId = contactId; // Set the currently active chat ID

        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.contactId === contactId) {
                item.classList.add('active');
                const unreadEl = item.querySelector('.unread-count');
                if (unreadEl) unreadEl.remove(); // Clear unread count visually
            }
        });

        // TODO: Replace sampleContacts with actual contact list state
        const contact = sampleContacts.find(c => c.id === contactId);
        if (!contact) {
             console.error("Contact not found for ID:", contactId);
             // Clear chat area or show error
             chatHeaderProfile.innerHTML = `<div class="placeholder">Contact not found</div>`;
             messageList.innerHTML = '';
             return;
        }

        // Update chat header
        let contactPic = contact.profilePicUrl || contact.profilePic || defaultPic;
        chatHeaderProfile.innerHTML = `
            <img src="${contactPic}" alt="${contact.name}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
            <div class="contact-details">
                <span class="contact-name">${escapeHtml(contact.name)}</span>
                <span class="contact-status">${contact.status === 'online' ? 'Online' : (contact.status === 'typing' ? 'Typing...' : 'Offline')}</span> </div>`;

        // Load and display messages
        messageList.innerHTML = ''; // Clear previous messages
        // TODO: Fetch real messages from backend instead of sampleMessages
        // socket.emit('getChatHistory', { chatId: contactId }); // Example
        const messages = sampleMessages[contactId] || [];
        messages.forEach(displayMessage);

        scrollToBottom();
        if (messageInput) messageInput.focus();
        hideTypingIndicator();

         // Mobile view handling
         if (window.innerWidth <= 768) {
             showChatAreaMobile();
         }
    }

    function displayMessage(message) {
        if (!messageList) return;
        // Ensure currentUser.id is set before comparing
        const isSent = currentUser.id && message.sender === currentUser.id;
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id;
        messageEl.dataset.senderId = message.sender;

        let ticksHtml = '';
        // Simplified ticks logic for now
        if (isSent && message.status) {
             ticksHtml = `<span class="status-ticks"><i class="fas fa-check ${message.status}"></i></span>`; // Simple check for now
        }
        let senderNameHtml = '';
        if (!isSent && message.senderName) { // For group chats
             senderNameHtml = `<div class="sender-name">${escapeHtml(message.senderName)}</div>`;
        }

        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            // TODO: Get sender's actual profile picture from contact data
            const senderContact = sampleContacts.find(c => c.id === message.sender); // Using sample data
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
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser.id) {
            console.warn("Cannot send message: Not authenticated, no chat selected, message empty, or user ID missing.");
            return;
        }

        const tempId = 'temp_' + Date.now();
        const newMessage = {
            id: tempId,
            sender: currentUser.id,
            content: messageText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            status: 'sending' // Visually indicate sending
        };

        displayMessage(newMessage);
        scrollToBottom();
        messageInput.value = '';
        messageInput.focus();

        console.log(`Emitting 'sendMessage': Recipient=${currentChatId}, Content=${messageText.substring(0,30)}...`);
        if (socket) {
            socket.emit('sendMessage', {
                recipientUid: currentChatId, // Adjust for groups later
                content: messageText,
                tempId: tempId // Send tempId for confirmation mapping
            });
        } else {
            console.error("Cannot send message, socket not connected.");
            // TODO: Handle error, maybe show message failed status
        }

        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp);
        hideTypingIndicator();
    }

    function updateContactPreview(contactId, message, timestamp) {
         if (!contactList) return;
         const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
            const msgElement = contactItem.querySelector('.last-message');
            const timeElement = contactItem.querySelector('.timestamp');
            if(msgElement) msgElement.textContent = message; // Use textContent for safety
            if(timeElement) timeElement.textContent = timestamp;
            // TODO: Move contact to top
            // contactList.prepend(contactItem);
        }
    }

    function escapeHtml(unsafe) {
         if (typeof unsafe !== 'string') return '';
        const element = document.createElement('div'); // Use browser's own escaping
        element.textContent = unsafe;
        return element.innerHTML;
        // Manual escaping (alternative):
        // return unsafe
        //      .replace(/&/g, "&amp;")
        //      .replace(/</g, "&lt;")
        //      .replace(/>/g, "&gt;")
        //      .replace(/"/g, "&quot;")
        //      .replace(/'/g, "&#039;");
    }

    function scrollToBottom() {
        setTimeout(() => {
            if (messageList) messageList.scrollTop = messageList.scrollHeight;
        }, 50);
    }

    // --- Typing Indicator Logic ---
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() {
        if (!currentChatId || !isSocketAuthenticated || !socket) return;
        socket.emit('typing', { recipientUid: currentChatId, isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
             if(socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false });
        }, typingTimeout);
    }
    function showTypingIndicator() {
        if (typingIndicator) typingIndicator.classList.remove('hidden');
        scrollToBottom();
    }
    function hideTypingIndicator() {
        if (typingIndicator) typingIndicator.classList.add('hidden');
    }

    // --- Logout Function ---
    function logout() {
        console.log("Logging out...");
        if (socket) {
            socket.disconnect();
            socket = null; // Clear reference
        }
        isSocketAuthenticated = false;
        localStorage.clear(); // Clear all local storage
        window.location.href = 'login.html';
    }

    // --- Mobile View Toggling Functions ---
     function setupMobileView() {
        if (window.innerWidth <= 768) {
            showSidebarMobile();
        } else {
             document.querySelector('.sidebar')?.classList.remove('mobile-hidden');
             document.querySelector('.chat-area')?.classList.remove('mobile-hidden');
             removeMobileBackButton();
        }
    }
    function showChatAreaMobile() {
        document.querySelector('.sidebar')?.classList.add('mobile-hidden');
        document.querySelector('.chat-area')?.classList.remove('mobile-hidden');
        addMobileBackButton();
    }
    function showSidebarMobile() {
        document.querySelector('.sidebar')?.classList.remove('mobile-hidden');
        document.querySelector('.chat-area')?.classList.add('mobile-hidden');
        removeMobileBackButton();
    }
    function addMobileBackButton() {
        const chatHeader = document.querySelector('.chat-header');
        if (!chatHeader || document.getElementById('mobile-back-button')) return;
        const backButton = document.createElement('button');
        backButton.innerHTML = '<i class="fas fa-arrow-left"></i>';
        backButton.id = 'mobile-back-button';
        backButton.title = "Back to Chats";
        backButton.style.cssText = `margin-right: 10px; border: none; background: none; color: var(--text-secondary); font-size: 1.2em; cursor: pointer; padding: 8px; flex-shrink: 0;`; // Added flex-shrink
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
    if (logoutButton) logoutButton.addEventListener('click', logout);

    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

}); // End of DOMContentLoaded listener
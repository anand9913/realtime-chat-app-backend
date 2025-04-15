// public/chat.js - Updated to remove localStorage for profile data

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check (Kept) ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');
    if (!isAuthenticated || !storedToken) {
        // If not authenticated OR token is missing, redirect to login
        console.warn("User not authenticated or token missing. Redirecting to login.");
        localStorage.clear(); // Clear any potentially inconsistent state
        window.location.href = 'login.html';
        return; // Stop execution
    }

    // --- Define Defaults ---
    const defaultPic = 'https://via.placeholder.com/40?text=Me'; // Default profile pic
    // Use phone number from login if available in localStorage, else a generic default
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
    // Add references for mobile view if needed
    const sidebarElement = document.querySelector('.sidebar');
    const chatAreaElement = document.querySelector('.chat-area');


    // --- Update UI with Defaults Initially ---
    console.log("[Initial Load] Setting UI to defaults.");
    currentUsernameSpan.textContent = defaultUsername; // Show phone/default initially
    sidebarProfilePic.src = defaultPic;                // Show default pic initially
    sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; }; // Fallback for image load error


    // --- State ---
    let currentChatId = null;
    let currentUser = { // Reset profile fields, wait for server data
        id: null,              // Will be set by server upon auth success
        name: defaultUsername, // Start with default, updated by server
        profilePic: defaultPic   // Start with default, updated by server
    };
    let socket = null; // Define socket variable
    let isChatAreaVisibleMobile = false; // Track mobile view state


    // --- Socket.IO Connection ---
    function connectWebSocket() {
        console.log("Attempting to connect WebSocket...");
        // Connect to the server that served the page
        socket = io({
            // Optional: Add reconnection attempts etc. if needed
            // reconnectionAttempts: 5,
        });

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("Attempting to authenticate socket with backend...");
                socket.emit('authenticate', idToken);
            } else {
                // This should ideally not happen if initial check passed, but handle defensively
                console.error("Firebase ID token missing on connect despite initial check. Logging out.");
                logout();
            }
        });

        socket.on('authenticationSuccess', (userData) => {
            console.log(">>> [AUTH SUCCESS] Received payload from backend:", JSON.stringify(userData));

            // --- Use profile data STRICTLY FROM BACKEND ---
            currentUser.id = userData.uid;
            // Use DB value if present (not null/undefined), otherwise keep defaultUsername
            currentUser.name = userData.username || defaultUsername;
            // Use DB value if present (not null/undefined/empty string), otherwise keep defaultPic
            currentUser.profilePic = userData.profilePicUrl || defaultPic;

            console.log(">>> [AUTH SUCCESS] Updated currentUser object:", currentUser);

            // --- Update UI elements directly from received/processed data ---
            currentUsernameSpan.textContent = currentUser.name;
            sidebarProfilePic.src = currentUser.profilePic;
            sidebarProfilePic.onerror = () => {
                console.warn(">>> [AUTH SUCCESS] Error loading profile pic from server data, reverting to default.");
                sidebarProfilePic.src = defaultPic;
            };
            console.log(`>>> [AUTH SUCCESS] Set sidebar UI: Name='${currentUser.name}', PicSrc='${currentUser.profilePic}'`);

            // --- REMOVED saving profile data back to localStorage ---
            console.log(">>> [AUTH SUCCESS] Skipped updating localStorage cache for profile.");

            isAuthenticated = true; // Mark client-side as authenticated
            initializeChatApp(); // Initialize UI elements dependent on auth
        });

        socket.on('authenticationFailed', (error) => {
            console.error("Backend socket authentication failed:", error?.message || 'Unknown error');
            alert(`Authentication session error: ${error?.message || 'Please log in again.'}`);
            logout(); // Force logout on auth failure
        });

        socket.on('receiveMessage', (message) => {
            if (!currentUser.id) return; // Ignore if not authenticated yet
            console.log('Message received:', message);
            // Check if message is for the currently active chat
            if (message.sender === currentChatId || message.sender === currentUser.id) { // Show if it's current chat OR own message reflected back
                 displayMessage(message);
                 scrollToBottom();
            } else {
                 // TODO: Handle notification / unread count for inactive chats
                  console.log(`Received message for inactive chat from ${message.sender}`);
                  // updateUnreadCount(message.sender, true); // Example
            }
            // Update contact list preview for the sender
            updateContactPreview(message.sender, message.content, message.timestamp);
        });

        socket.on('typingStatus', (data) => { // { senderUid, isTyping }
            if (!currentUser.id || data.senderUid === currentUser.id) return; // Ignore self

            // Only show if it's for the currently open chat
            if (data.senderUid === currentChatId) {
                 if (data.isTyping) {
                     showTypingIndicator();
                 } else {
                     hideTypingIndicator();
                 }
            }
             // Update contact list preview with typing status
             const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${data.senderUid}"]`);
             if (contactItem) {
                  const lastMsgEl = contactItem.querySelector('.last-message');
                  if (data.isTyping) {
                      // Store original message to restore later
                      if (!lastMsgEl.dataset.originalText) {
                           lastMsgEl.dataset.originalText = lastMsgEl.innerHTML;
                      }
                      lastMsgEl.innerHTML = '<i style="color: var(--primary-accent);">Typing...</i>';
                  } else {
                      // Restore original message if it exists
                      if (lastMsgEl.dataset.originalText) {
                          lastMsgEl.innerHTML = lastMsgEl.dataset.originalText;
                          delete lastMsgEl.dataset.originalText; // Clean up
                      }
                      // If no original text stored (e.g., page refresh), logic to fetch actual last msg needed
                  }
             }
        });

        socket.on('messageSentConfirmation', (data) => {
            console.log("Server confirmed message:", data);
            // TODO: Find the message in the UI (using tempId or dbId) and update its status tick/timestamp
            // updateMessageStatusInUI(data.dbId || data.tempId, data.status, data.timestamp);
        });

        socket.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason);
            // TODO: Show disconnected UI state, maybe attempt reconnection based on reason
            if (reason === 'io server disconnect') {
                 console.error("Disconnected by server (likely auth failure/kick).");
                 // Alert user and force logout if not already done
                 // alert("You have been disconnected by the server. Please log in again.");
                 // logout();
            }
        });

        socket.on('connect_error', (err) => {
            console.error(`Socket connection error: ${err.message}`);
            // TODO: Show connection error UI state
        });

        socket.on('error', (error) => { // General errors from server
            console.error("Error message from server:", error);
            alert(`Server Error: ${error.message || 'Unknown error'}`);
        });
    }

    // --- Functions ---

    // Initialize the chat application interface
    function initializeChatApp() {
        console.log("Initializing Chat App UI...");
        // TODO: Replace sampleContacts with a call to fetch contacts from backend
        displayContacts(sampleContacts);
        setupMobileView();
        // Add other init logic...
    }

    // Display the list of contacts in the sidebar
    function displayContacts(contacts) {
        contactList.innerHTML = ''; // Clear existing list
        contacts.forEach(contact => {
            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id;

            let displayStatus = contact.lastMessage || '';
            // TODO: Add logic for dynamic typing status if available

            contactEl.innerHTML = `
                <img src="${contact.profilePic || 'https://via.placeholder.com/40?text=?'}" alt="${contact.name}" class="profile-pic">
                <div class="contact-info">
                    <span class="contact-name">${contact.name}</span>
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

     // Filter contacts based on search input
     function filterContacts() {
        const searchTerm = searchContactsInput.value.toLowerCase();
        // TODO: Replace sampleContacts with actual contact list state
        const filteredContacts = sampleContacts.filter(contact =>
            contact.name.toLowerCase().includes(searchTerm)
        );
        displayContacts(filteredContacts);
    }

    // Load a specific chat into the main chat area
    function loadChat(contactId) {
        console.log("Loading chat for:", contactId);
        // Prevent loading if not authenticated
        if (!currentUser.id) {
            console.warn("Attempted to load chat before user authentication complete.");
            return;
        }

        currentChatId = contactId;
        hideTypingIndicator(); // Hide indicator when switching chats

        // Update highlighted contact in the list
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.contactId === contactId) {
                item.classList.add('active');
                const unreadEl = item.querySelector('.unread-count');
                if (unreadEl) unreadEl.remove(); // Mark as read visually
            }
        });

        // TODO: Replace sampleContacts with actual contact list state
        const contact = sampleContacts.find(c => c.id === contactId);
        if (!contact) {
            console.error("Contact not found:", contactId);
             chatHeaderProfile.innerHTML = '<div class="placeholder">Select a chat</div>';
             messageList.innerHTML = ''; // Clear messages
            return;
        }

        // Update chat header
        chatHeaderProfile.innerHTML = `
            <img src="${contact.profilePic || 'https://via.placeholder.com/40?text=?'}" alt="${contact.name}" class="profile-pic">
            <div class="contact-details">
                <span class="contact-name">${contact.name}</span>
                <span class="contact-status">${contact.status === 'online' ? 'Online' : 'Offline'}</span> </div>`;

        // --- Load Chat History ---
        messageList.innerHTML = ''; // Clear previous messages
        // TODO: Replace sampleMessages with request to backend for history
        console.log(`TODO: Fetch message history for chat with ${contactId}`);
        const messages = sampleMessages[contactId] || []; // Use sample for now
        messages.forEach(displayMessage);
        scrollToBottom();
        // --- End Load History ---

        messageInput.focus(); // Focus input field

         // Mobile view handling
         if (window.innerWidth <= 768) {
             showChatAreaMobile();
         }
    }

    // Append a single message to the message list UI
    function displayMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        if (message.id) messageEl.dataset.messageId = message.id; // Use DB ID if available

        // Use currentUser.id (set after backend auth) to check if message is sent by this user
        const isSent = message.sender === currentUser.id;
        messageEl.classList.add(isSent ? 'sent' : 'received');

        // Ticks logic (only for sent messages, use status from DB if available)
        let ticksHtml = '';
        if (isSent && message.status) {
            ticksHtml = '<span class="status-ticks">';
            switch (message.status) { // Use status from message object
                case 'read': ticksHtml += '<i class="fas fa-check-double read"></i>'; break;
                case 'delivered': ticksHtml += '<i class="fas fa-check-double delivered"></i>'; break;
                case 'sent': default: ticksHtml += '<i class="fas fa-check sent"></i>'; break;
            }
            ticksHtml += '</span>';
        }

        // Sender name (for group chats)
        let senderNameHtml = '';
        if (!isSent && message.senderName) {
             senderNameHtml = `<div class="sender-name">${escapeHtml(message.senderName)}</div>`;
        }

         // Profile picture (for received messages, grouped)
        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.dataset.senderId;
        const showPic = !isSent && message.sender !== previousSender;

        if (showPic) {
            // TODO: Get sender pic URL from actual contact data, not just sampleContacts
            const senderContact = sampleContacts.find(c => c.id === message.sender);
            const picUrl = senderContact?.profilePic || 'https://via.placeholder.com/30?text=?';
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small">`;
        }
        messageEl.dataset.senderId = message.sender; // Store sender ID for grouping logic

        messageEl.innerHTML = `
            ${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>' /* Placeholder */}
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
        if (messageText === '' || !currentChatId || !currentUser.id) {
            console.warn("Cannot send message: Missing text, chat selection, or user auth.");
            return;
        }

        const tempId = 'temp_' + Date.now(); // Create temporary ID for optimistic UI update

        // Optimistic UI Update: Display message immediately
        const optimisticMessage = {
            id: tempId, // Use temp ID initially
            sender: currentUser.id,
            content: messageText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            status: 'sending' // Show as 'sending' (e.g., single grey tick)
        };
        displayMessage(optimisticMessage);
        scrollToBottom();

        messageInput.value = '';
        messageInput.focus();

        // Send message via Socket.IO
        console.log("Sending message via socket:", { recipientUid: currentChatId, content: messageText, tempId: tempId });
        if (socket && socket.connected) {
            socket.emit('sendMessage', {
                recipientUid: currentChatId, // TODO: Adjust for groups
                content: messageText,
                tempId: tempId // Send tempId for confirmation matching
            });
        } else {
             console.error("Socket not connected. Cannot send message.");
             // TODO: Handle message send failure UI (e.g., show red '!' on message)
             // updateMessageStatusInUI(tempId, 'failed');
             alert("Connection error. Message not sent.");
        }

        // Update contact list preview
        updateContactPreview(currentChatId, `You: ${messageText}`, optimisticMessage.timestamp);
        hideTypingIndicator();
    }

    // Update the last message preview in the contact list
    function updateContactPreview(contactId, message, timestamp) {
         // TODO: Use actual contact list state, not sampleContacts
        const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
             const msgPreview = message.length > 30 ? message.substring(0, 30) + '...' : message;
             // Use textContent to prevent XSS issues in preview
             contactItem.querySelector('.last-message').textContent = msgPreview;
             // Clear any potential 'typing...' indicator stored in data attribute
              const lastMsgEl = contactItem.querySelector('.last-message');
              if (lastMsgEl.dataset.originalText) delete lastMsgEl.dataset.originalText;

             contactItem.querySelector('.timestamp').textContent = timestamp;
             // Optional: Move contact to top
             // contactList.prepend(contactItem);
        }
    }

    // Utility to escape HTML special characters
    function escapeHtml(unsafe) {
         if (typeof unsafe !== 'string') return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Scroll the message list to the bottom
    function scrollToBottom() {
        setTimeout(() => {
            messageList.scrollTop = messageList.scrollHeight;
        }, 50); // Small delay allows DOM to update fully
    }

    // --- Typing Indicator Logic ---
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() {
        if (!currentChatId || !currentUser.id || !socket || !socket.connected) return;

        // Indicate locally immediately? Or only when others type? Let's only emit.
        console.log("Typing event triggered..."); // Log typing

        // Clear previous timer
        clearTimeout(typingTimer);

        // Emit 'typing' event (true)
        socket.emit('typing', { recipientUid: currentChatId, isTyping: true });

        // Set a timer to emit 'stopped typing'
        typingTimer = setTimeout(() => {
            socket.emit('typing', { recipientUid: currentChatId, isTyping: false });
        }, typingTimeout);
    }
    function showTypingIndicator() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
    function hideTypingIndicator() { typingIndicator.classList.add('hidden'); }

    // --- Logout Function ---
    function logout() {
        console.log("Logging out...");
        if (socket) socket.disconnect();
        localStorage.clear(); // Clear all local storage
        window.location.href = 'login.html';
    }

    // --- Mobile View Toggling ---
    function setupMobileView() {
        if (window.innerWidth <= 768) {
            showSidebarMobile(); // Start by showing sidebar
        } else {
            // Ensure both are visible on desktop
             sidebarElement.style.display = 'flex';
             chatAreaElement.style.display = 'flex';
        }
    }
    function showChatAreaMobile() {
        sidebarElement.style.display = 'none';
        chatAreaElement.style.display = 'flex';
        isChatAreaVisibleMobile = true;
        addMobileBackButton();
    }
    function showSidebarMobile() {
        sidebarElement.style.display = 'flex';
        chatAreaElement.style.display = 'none';
        isChatAreaVisibleMobile = false;
        removeMobileBackButton();
    }
    function addMobileBackButton() {
        if (document.getElementById('mobile-back-button')) return;
        const backButton = document.createElement('button');
        backButton.innerHTML = '<i class="fas fa-arrow-left"></i>';
        backButton.id = 'mobile-back-button';
        backButton.title = "Back to Chats";
         backButton.style.cssText = `
            margin-right: 10px; border: none; background: none;
            color: var(--text-secondary); font-size: 1.2em; cursor: pointer;
            padding: 8px; flex-shrink: 0; /* Prevent shrinking */
        `; // Basic styles
        backButton.onclick = showSidebarMobile;
        chatHeaderProfile.parentNode.insertBefore(backButton, chatHeaderProfile);
    }
     function removeMobileBackButton() {
        const backButton = document.getElementById('mobile-back-button');
        if (backButton) backButton.remove();
    }

    // --- Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        else { handleTyping(); }
    });
    searchContactsInput.addEventListener('input', filterContacts);
    logoutButton.addEventListener('click', logout);
    // Add listener for window resize to handle view changes (optional)
    // window.addEventListener('resize', setupMobileView);

    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

}); // End of DOMContentLoaded listener
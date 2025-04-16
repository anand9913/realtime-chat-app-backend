// public/chat.js - Complete Version for Search-and-Chat (April 16, 2025)

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');
    if (!isAuthenticated || !storedToken) {
        console.warn("User not authenticated or token missing. Redirecting to login.");
        localStorage.clear(); window.location.href = 'login.html'; return;
    }

    // --- Define Defaults ---
    const defaultPic = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik0yMCAyNUMxNy4zMSAyNSAxNSAyNy4zMSAxNSAzMEMxNSA2LjIgNCAzIDM3LjYyIDMwIDM3LjYyIDM0LjM0IDM3LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDI1LjYyIDI1LjYyIDM0LjM0IDE1LjYyIDMwIDMwIDM3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDI1IDI1IDIwIDI1IiBmaWxsPSIjYWFhIi8+PC9zdmc+';
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'My Username';

    // --- DOM Elements ---
    const sidebarElement = document.querySelector('.sidebar');
    const chatAreaElement = document.querySelector('.chat-area');
    const contactList = document.getElementById('contact-list'); // Shows active/recent chats
    const messageList = document.getElementById('message-list');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const chatHeaderProfile = document.getElementById('chat-header-profile');
    const typingIndicator = document.getElementById('typing-indicator');
    const searchContactsInput = document.getElementById('search-contacts'); // User search input
    const logoutButton = document.getElementById('logout-button');
    console.log("[Logout Debug] Found logout button element:", logoutButton);
    const currentUsernameSpan = document.getElementById('current-user-name');
    const sidebarProfilePic = document.getElementById('sidebar-profile-pic');
    // Search Results Container (Dynamically Created)
    const searchResultsContainer = document.createElement('div');
    searchResultsContainer.id = 'search-results';
    searchResultsContainer.classList.add('contact-list'); // Reuse styles
    searchResultsContainer.style.position = 'absolute'; // Example positioning
    searchResultsContainer.style.top = '160px'; // Adjust based on your header height
    searchResultsContainer.style.left = '0';
    searchResultsContainer.style.right = '0';
    searchResultsContainer.style.bottom = '0';
    searchResultsContainer.style.backgroundColor = 'var(--secondary-bg)';
    searchResultsContainer.style.zIndex = '10'; // Above contact list
    searchResultsContainer.style.display = 'none'; // Hidden by default
    sidebarElement?.appendChild(searchResultsContainer); // Append to sidebar

    // --- Update UI with Defaults Initially ---
    console.log("[Initial Load] Setting UI to defaults.");
    if (currentUsernameSpan) currentUsernameSpan.textContent = defaultUsername;
    if (sidebarProfilePic) sidebarProfilePic.src = defaultPic;
    if (sidebarProfilePic) sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };

    // --- State ---
    let currentChatId = null; // UID of the person being chatted with
    let currentUser = { id: null, name: defaultUsername, profilePic: defaultPic };
    // Store info about users we are actively chatting with (key: user UID)
    let activeChats = {}; // { uid: {id, name, profilePicUrl, lastMessage?, timestamp?} }
    let currentMessages = {}; // { chatId: [messages] }
    let socket = null;
    let isSocketAuthenticated = false;
    let searchDebounceTimer; // Timer for debouncing search input

    // --- Socket.IO Connection & Handlers ---
    function connectWebSocket() {
        if (typeof io === 'undefined') { console.error("Socket.IO client (io) not found."); alert("Chat error."); return; }
        console.log("Attempting to connect WebSocket...");
        if (socket && socket.connected) { console.log("WebSocket already connected."); return; }
        socket = io();

        // --- Socket Event Handlers ---
        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            isSocketAuthenticated = false;
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) { socket.emit('authenticate', idToken); }
            else { console.error("Token missing on connect. Logging out."); logout(); }
        });

        socket.on('authenticationSuccess', (userData) => {
            isSocketAuthenticated = true;
            console.log(">>> CHAT PAGE: 'authenticationSuccess' received!");
            console.log(">>> Payload received from backend:", JSON.stringify(userData, null, 2));

            // Update current user state and UI
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

            initializeChatApp(); // Initialize UI (display active chats, mobile view)
            // TODO: Fetch recent chats list from backend to populate initial sidebar?
        });

        socket.on('authenticationFailed', (error) => {
             isSocketAuthenticated = false;
             console.error(">>> CHAT PAGE: Backend socket authentication failed:", error?.message || 'Unknown error');
             const message = error?.message || 'Authentication failed.';
             if (message.includes('expired')) { alert("Your login session has expired. Please log in again."); }
             else { alert(`Authentication error: ${message}`); }
             logout();
         });

        // --- Handle Search Results ---
        socket.on('searchResultsUsers', (users) => {
            console.log("Received user search results:", users);
            displaySearchResults(users); // Display results in the dedicated container
        });

        // --- Handle Chat History ---
        socket.on('chatHistory', (data) => {
             if (!data || !data.chatId || !Array.isArray(data.messages)) return;
             console.log(`[History] Received ${data.messages.length} messages for chat ${data.chatId}`);
             currentMessages[data.chatId] = data.messages;
             if (data.chatId === currentChatId) { // If currently open chat
                 if (messageList) messageList.innerHTML = ''; // Clear loading/old
                 data.messages.forEach(displayMessage);
                 scrollToBottom();
             }
        });

        socket.on('receiveMessage', (message) => {
            if (!isSocketAuthenticated || !message || !message.sender) return;
            console.log('Message received:', message);

            const chatId = (message.sender === currentUser.id) ? message.recipientUid : message.sender;
            if (!chatId) { console.error("Received message without clear chat ID context", message); return; }

            // Add message to internal state
            if (!currentMessages[chatId]) currentMessages[chatId] = [];
            currentMessages[chatId].push(message);

            // Add sender/recipient to activeChats if not already there to make them appear in sidebar
            const otherUserId = message.sender === currentUser.id ? message.recipientUid : message.sender;
            if (!activeChats[otherUserId]) {
                 console.log(`Adding user ${otherUserId} to active chats from received message.`);
                 // TODO: Ideally, backend should send profile info with message or have a way to fetch it
                 activeChats[otherUserId] = { id: otherUserId, name: otherUserId, profilePicUrl: null }; // Placeholder name/pic
            }

            if (chatId === currentChatId) { // If chat is open
                 displayMessage(message);
                 scrollToBottom();
                 // TODO: Emit 'markAsRead'
            } else { /* TODO: Increment unread count */ }
            // Update contact list preview & re-render sidebar
            updateContactPreview(chatId, message.content, message.timestamp);
        });

        // ... (Other handlers: typingStatus, messageSentConfirmation, disconnect, etc.) ...
        socket.on('typingStatus', (data) => { /* ... */ });
        socket.on('messageSentConfirmation', (data) => { /* ... */ });
        socket.on('disconnect', (reason) => { /* ... */ });
        socket.on('connect_error', (err) => { /* ... */ });
        socket.on('error', (error) => { /* ... */ });

    } // End connectWebSocket

    // --- Main Application Functions ---

    /** Initializes the chat UI - displays active chats and sets mobile view */
    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // TODO: Fetch recent/active chats from backend instead of relying on state being built up
        displayActiveChats(); // Display initially empty or loaded recent chats
        setupMobileView();
    }

    /** Displays search results in the dedicated container */
    function displaySearchResults(users) {
        searchResultsContainer.innerHTML = ''; // Clear previous results
        if (!users || users.length === 0) {
             searchResultsContainer.innerHTML = '<div class="no-results" style="padding: 20px; text-align: center; color: var(--text-secondary);">No users found.</div>';
             searchResultsContainer.style.display = 'block'; // Show "no results" message
             return;
        }
        users.forEach(user => {
            if (!user || !user.id || !user.name) return; // Basic validation
            const userEl = document.createElement('div');
            userEl.classList.add('contact-item', 'search-result-item');
            userEl.dataset.userId = user.id;

            let userPic = user.profilePicUrl || defaultPic;
            let displayName = user.username || user.id; // Show username or fallback to ID

            userEl.innerHTML = `
                <img src="${userPic}" alt="${escapeHtml(displayName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                <div class="contact-info">
                    <span class="contact-name">${escapeHtml(displayName)}</span>
                    </div>
                <div class="contact-meta">
                     <button class="start-chat-btn" title="Start Chat"><i class="fas fa-comment-dots"></i></button>
                </div>
            `;
             // Add click listener to the whole item to start chat
             userEl.addEventListener('click', () => {
                 handleSearchResultClick(user); // Pass the full user object
             });
            searchResultsContainer.appendChild(userEl);
        });
        searchResultsContainer.style.display = 'block'; // Show results container
    }

    /** Handles clicking on a user from search results */
    function handleSearchResultClick(userDetails) {
        if (!userDetails || !userDetails.id) return;
        const userId = userDetails.id;
        console.log(`Starting chat with user from search: ${userId}`);

        // 1. Add/Update user in the active chat list state
        activeChats[userId] = {
             id: userId,
             name: userDetails.username || userId, // Use name from search result
             profilePicUrl: userDetails.profilePicUrl || null,
             lastMessage: activeChats[userId]?.lastMessage || '', // Keep existing preview if any
             timestamp: activeChats[userId]?.timestamp || ''
        };
        displayActiveChats(); // Re-render sidebar to show user (might move to top later)

        // 2. Load the chat window for this user
        loadChat(userId);

        // 3. Clear search results and input
        searchResultsContainer.innerHTML = '';
        searchResultsContainer.style.display = 'none';
        if (searchContactsInput) searchContactsInput.value = '';
    }

    /** Displays the list of active chats in the sidebar */
    function displayActiveChats() {
         if (!contactList) return;
         contactList.innerHTML = ''; // Clear list
         const chatsToDisplay = Object.values(activeChats);
         // TODO: Sort chats by last message timestamp later
         console.log(`[Display Chats] Rendering ${chatsToDisplay.length} active chats.`);
         chatsToDisplay.forEach(chat => {
              const chatEl = document.createElement('div');
              chatEl.classList.add('contact-item');
              chatEl.dataset.contactId = chat.id;
              let chatPic = chat.profilePicUrl || defaultPic;

              chatEl.innerHTML = `
                  <img src="${chatPic}" alt="${escapeHtml(chat.name)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                  <div class="contact-info">
                      <span class="contact-name">${escapeHtml(chat.name)}</span>
                      <span class="last-message">${escapeHtml(chat.lastMessage || '')}</span>
                  </div>
                  <div class="contact-meta">
                      <span class="timestamp">${chat.timestamp || ''}</span>
                       ${chat.unread > 0 ? `<span class="unread-count">${chat.unread}</span>` : ''}
                  </div>
              `;
              chatEl.addEventListener('click', () => loadChat(chat.id));
              contactList.appendChild(chatEl);
         });
    }

    /** Loads a chat, requests history */
    function loadChat(chatPartnerUid) {
        console.log("Loading chat for:", chatPartnerUid);
        if (!isSocketAuthenticated || !chatPartnerUid) return;
        currentChatId = chatPartnerUid;

        // Highlight item in sidebar
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === chatPartnerUid);
             // Clear unread count visually when chat is opened
            if (item.dataset.contactId === chatPartnerUid) item.querySelector('.unread-count')?.remove();
        });

        // Get contact details from the activeChats state
        const chatPartner = activeChats[chatPartnerUid];
        if (!chatPartner) {
             console.error("Chat partner details not found for ID:", chatPartnerUid);
             if(chatHeaderProfile) chatHeaderProfile.innerHTML = `<div class="placeholder">User details not found</div>`;
             if(messageList) messageList.innerHTML = ''; return;
        }

        // Update chat header
        let contactPic = chatPartner.profilePicUrl || defaultPic;
        if (chatHeaderProfile) { /* ... update header ... */ }

        // Request Chat History
        if (messageList) messageList.innerHTML = '<div class="loading-history">Loading messages...</div>';
        if (socket && socket.connected) {
             console.log(`[History] Requesting history for chat ${chatPartnerUid}`);
             socket.emit('getChatHistory', { chatId: chatPartnerUid, limit: 50 });
        } else { /* ... handle socket error ... */ }

        if (messageInput) messageInput.focus();
        hideTypingIndicator();
        if (window.innerWidth <= 768) { showChatAreaMobile(); }
    }

    /** Appends a single message object to the message list UI */
    function displayMessage(message) {
        if (!messageList || !message || !message.sender || !currentUser.id) return;
        const isSent = message.sender === currentUser.id;
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id; messageEl.dataset.senderId = message.sender;

        let ticksHtml = ''; /* TODO */ let senderNameHtml = ''; /* TODO Group */
        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            const senderContact = activeChats[message.sender]; // Use activeChats state
            const picUrl = senderContact?.profilePicUrl || defaultPic;
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small" onerror="this.onerror=null; this.src='${defaultPic}';">`;
        }
        const displayTimestamp = typeof message.timestamp === 'string' ? message.timestamp : ' ';
        messageEl.innerHTML = `${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>'}<div class="bubble">${senderNameHtml}<p>${escapeHtml(message.content)}</p><div class="message-meta"><span class="timestamp">${displayTimestamp}</span>${ticksHtml}</div></div>`;
        messageList.appendChild(messageEl);
    }

    /** Handles sending a message */
    function sendMessage() {
        if (!messageInput) return; const messageText = messageInput.value.trim();
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser.id) return;
        const tempId = 'temp_' + Date.now(); const newMessage = { id: tempId, sender: currentUser.id, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };
        displayMessage(newMessage); scrollToBottom(); messageInput.value = ''; messageInput.focus();
        if (socket && socket.connected) { socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId }); } else { console.error("Cannot send message, socket not connected."); }
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp); hideTypingIndicator();
    }

    /** Updates the sidebar preview for a chat */
    function updateContactPreview(chatId, message, timestamp) {
        // Update the state first
        if (!activeChats[chatId]) return;
        activeChats[chatId].lastMessage = message;
        activeChats[chatId].timestamp = timestamp;
        // activeChats[chatId].lastMessageTimestamp = Date.now(); // For sorting
        // Re-render the list which will automatically move the updated chat
        displayActiveChats(); // This will redraw the list, potentially reordering if sort logic is added
    }

    // --- Helper & UI Functions ---
    function escapeHtml(unsafe) { if (typeof unsafe !== 'string') return ''; const e = document.createElement('div'); e.textContent = unsafe; return e.innerHTML; }
    function scrollToBottom() { setTimeout(() => { if (messageList) messageList.scrollTop = messageList.scrollHeight; }, 50); }
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() { if (!currentChatId || !isSocketAuthenticated || !socket) return; socket.emit('typing', { recipientUid: currentChatId, isTyping: true }); clearTimeout(typingTimer); typingTimer = setTimeout(() => { if(socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false }); }, typingTimeout); }
    function showTypingIndicator() { if (typingIndicator) typingIndicator.classList.remove('hidden'); scrollToBottom(); }
    function hideTypingIndicator() { if (typingIndicator) typingIndicator.classList.add('hidden'); }
    function logout() { console.log("[Logout Debug] Logout function CALLED!"); console.log("Logging out..."); if (socket) { socket.disconnect(); socket = null; } isSocketAuthenticated = false; localStorage.clear(); console.log("[Logout Debug] Local storage cleared. Redirecting to login..."); window.location.href = 'login.html'; }
    function setupMobileView() { if (!sidebarElement || !chatAreaElement) return; if (window.innerWidth <= 768) { showSidebarMobile(); } else { sidebarElement.classList.remove('mobile-hidden'); chatAreaElement.classList.remove('mobile-hidden'); removeMobileBackButton(); } }
    function showChatAreaMobile() { if(sidebarElement) sidebarElement.classList.add('mobile-hidden'); if(chatAreaElement) chatAreaElement.classList.remove('mobile-hidden'); addMobileBackButton(); }
    function showSidebarMobile() { if(sidebarElement) sidebarElement.classList.remove('mobile-hidden'); if(chatAreaElement) chatAreaElement.classList.add('mobile-hidden'); removeMobileBackButton(); }
    function addMobileBackButton() { const h=document.querySelector('.chat-header'); if(!h || document.getElementById('mobile-back-button')) return; const b=document.createElement('button'); b.innerHTML='<i class="fas fa-arrow-left"></i>'; b.id='mobile-back-button'; b.title="Back"; b.style.cssText=`margin-right:10px;border:none;background:none;color:var(--text-secondary);font-size:1.2em;cursor:pointer;padding:8px;flex-shrink:0;order:-1;`; b.onclick=showSidebarMobile; h.prepend(b); }
    function removeMobileBackButton() { const b=document.getElementById('mobile-back-button'); if(b) b.remove(); }


    // --- Event Listeners ---
    if (sendButton) sendButton.addEventListener('click', sendMessage);
    if (messageInput) messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } else { handleTyping(); } });
    if (logoutButton) { console.log("[Logout Debug] Attaching click listener to logout button..."); logoutButton.addEventListener('click', logout); }
    else { console.error("[Logout Debug] Logout button element NOT found!"); }

    // Search Listener with Debounce
    if (searchContactsInput) {
        searchContactsInput.addEventListener('input', () => {
             clearTimeout(searchDebounceTimer); // Clear previous timer
             const searchTerm = searchContactsInput.value.trim();
             if (searchTerm.length > 1) { // Only search if term is useful
                 searchDebounceTimer = setTimeout(() => { // Set new timer
                     if (socket && isSocketAuthenticated) {
                         console.log(`[Search] Emitting 'searchUsers' for: "${searchTerm}"`);
                         socket.emit('searchUsers', searchTerm);
                     }
                 }, 300); // 300ms delay
             } else {
                  searchResultsContainer.innerHTML = ''; // Clear results if term is short
                  searchResultsContainer.style.display = 'none'; // Hide results container
             }
         });
        // Hide search results if input loses focus? (Optional)
        searchContactsInput.addEventListener('blur', () => {
             // Use a small delay to allow clicking on results
             setTimeout(() => {
                 // Check if focus moved TO a result item before hiding
                 if (!searchResultsContainer.contains(document.activeElement)) {
                      searchResultsContainer.style.display = 'none';
                 }
             }, 200);
        });
         searchContactsInput.addEventListener('focus', () => {
              // Show results container if there's text (e.g., user clicks back in)
              if (searchContactsInput.value.trim().length > 1 && searchResultsContainer.innerHTML !== '') {
                   searchResultsContainer.style.display = 'block';
              }
         });
    }


    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

}); // End of DOMContentLoaded listener
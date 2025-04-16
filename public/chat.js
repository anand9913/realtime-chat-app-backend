// public/chat.js - Complete Version for Search-and-Chat (April 16, 2025)

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check (Uses localStorage for token/flag only) ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');
    if (!isAuthenticated || !storedToken) {
        console.warn("User not authenticated or token missing. Redirecting to login.");
        localStorage.clear(); // Clear potentially stale data
        window.location.href = 'login.html';
        return; // Stop execution
    }

    // --- Define Defaults ---
    const defaultPic = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik0yMCAyNUMxNy4zMSAyNSAxNSAyNy4zMSAxNSAzMEMxNSA2LjIgNCAzIDM3LjYyIDMwIDM3LjYyIDM0LjM0IDM3LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDI1LjYyIDI1LjYyIDM0LjM0IDE1LjYyIDMwIDMwIDM3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDI1IDI1IDIwIDI1IiBmaWxsPSIjYWFhIi8+PC9zdmc+';
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'My Username';

    // --- DOM Elements ---
    const sidebarElement = document.querySelector('.sidebar');
    const chatAreaElement = document.querySelector('.chat-area');
    const contactList = document.getElementById('contact-list'); // Main list for chats OR search results
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
    // NOTE: Separate searchResultsContainer is REMOVED - results use contactList

    // --- Update UI with Defaults Initially ---
    console.log("[Initial Load] Setting UI to defaults.");
    if (currentUsernameSpan) currentUsernameSpan.textContent = defaultUsername;
    if (sidebarProfilePic) sidebarProfilePic.src = defaultPic;
    if (sidebarProfilePic) sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };

    // --- State ---
    let currentChatId = null; // UID of the person being chatted with
    let currentUser = { id: null, name: defaultUsername, profilePic: defaultPic };
    // activeChats stores users you HAVE interacted with (key: user UID)
    let activeChats = {}; // { uid: {id, name, profilePicUrl, lastMessage?, timestamp?, unread?} }
    let currentMessages = {}; // { chatId: [messages] }
    let socket = null;
    let isSocketAuthenticated = false;
    let searchDebounceTimer; // Timer for debouncing search input
    let currentSearchTerm = ''; // Track current search state

    // --- Socket.IO Connection & Handlers ---
    function connectWebSocket() {
        if (typeof io === 'undefined') { console.error("Socket.IO client (io) not found."); alert("Chat error."); return; }
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

            initializeChatApp(); // Initialize UI (display active chats, mobile view)
            // TODO: Fetch recent chats from backend to populate 'activeChats' initially
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
            // IMPORTANT: Only display search results IF the search bar still has text
            if (currentSearchTerm) {
                 displayContactsOrSearchResults(users, true); // Display results in the main contactList
            }
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

        // --- Handle Receiving Messages ---
        socket.on('receiveMessage', (message) => {
            if (!isSocketAuthenticated || !message || !message.sender) return;
            console.log('Message received:', message);

            // Determine the chat ID (the other person involved)
            const chatId = (message.sender === currentUser.id) ? message.recipientUid : message.sender;
            if (!chatId) { console.error("Received message without clear chat ID context", message); return; }

            // Add message to internal message cache
            if (!currentMessages[chatId]) currentMessages[chatId] = [];
            currentMessages[chatId].push(message);

            // Add sender/recipient to activeChats if they aren't there already
            const otherUserId = (message.sender === currentUser.id) ? message.recipientUid : message.sender;
            if (!activeChats[otherUserId]) {
                 console.log(`Adding user ${otherUserId} to active chats from received message.`);
                 // TODO: Backend should ideally send profile info with message, or provide an endpoint
                 activeChats[otherUserId] = {
                     id: otherUserId,
                     name: otherUserId, // Placeholder - display UID until profile info is fetched/available
                     profilePicUrl: null
                 };
                 // Update sidebar immediately only if not currently searching
                 if (!currentSearchTerm) displayActiveChats();
            }

            // Update last message preview whether chat is open or not
            updateContactPreview(chatId, message.content, message.timestamp);

            if (chatId === currentChatId) { // If this chat is currently open
                 displayMessage(message); // Add message to UI
                 scrollToBottom();
                 // TODO: Emit 'markAsRead' event to backend?
            } else {
                 // TODO: Increment unread count in activeChats[chatId].unread and update UI
                 console.log(`Unread message from ${message.sender} for chat ${chatId}`);
                 // activeChats[chatId].unread = (activeChats[chatId].unread || 0) + 1;
                 // displayActiveChats(); // Re-render to show unread count
            }
        });

        // --- Other Handlers ---
        socket.on('typingStatus', (data) => {
            if (!isSocketAuthenticated || !currentUser.id || !data || data.senderUid === currentUser.id) return;
            if (data.senderUid === currentChatId) { // Only show for current chat
                if (data.isTyping) { showTypingIndicator(); } else { hideTypingIndicator(); }
            }
            // TODO: Update contact list preview (optional)
        });
        socket.on('messageSentConfirmation', (data) => {
            if (!isSocketAuthenticated) return;
            console.log("Server confirmed message:", data);
            // TODO: Update message status tick in UI using data.dbId or data.tempId
        });
        socket.on('disconnect', (reason) => { isSocketAuthenticated = false; console.warn('Socket disconnected:', reason); /* TODO: Show UI state */ });
        socket.on('connect_error', (err) => { isSocketAuthenticated = false; console.error(`Socket connection error: ${err.message}`); /* TODO: Show UI state */ });
        socket.on('error', (error) => { console.error("Server Error:", error); alert(`Server Error: ${error.message || 'Unknown error'}`); });

    } // End connectWebSocket


    // --- Main Application Functions ---

    /** Initializes the chat UI - displays active chats and sets mobile view */
    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // TODO: Fetch recent chats from backend to populate 'activeChats' instead of starting empty
        displayActiveChats(); // Display initially empty or loaded recent chats
        setupMobileView();
    }

    /**
     * Renders EITHER the list of active chats OR search results in the main sidebar list.
     * @param {Array} items - Array of user/chat objects to display.
     * @param {boolean} isSearchResult - True if items are search results, false if active chats.
     */
    function displayContactsOrSearchResults(items, isSearchResult = false) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = ''; // Clear current list content
        console.log(`[Display List] Rendering ${items?.length || 0} items. Is Search Result: ${isSearchResult}`);

        if (!items || items.length === 0) {
            contactList.innerHTML = `<div class="no-results" style="padding: 20px; text-align: center; color: var(--text-secondary);">${isSearchResult ? 'No users found.' : 'Search users or start a chat.'}</div>`;
            return;
        }

        // TODO: Add sorting logic here (e.g., by last message timestamp for active chats)
        // if (!isSearchResult) { items.sort((a,b) => (b.lastMessageTimestamp||0) - (a.lastMessageTimestamp||0)); }

        items.forEach(item => {
            if (!item || !item.id) return; // Need at least an ID

            const itemEl = document.createElement('div');
            itemEl.classList.add('contact-item');
            itemEl.dataset.contactId = item.id; // Store UID

            let itemPic = item.profilePicUrl || defaultPic;
            let itemName = item.username || item.name || item.id; // Use best available name
            let itemPreviewHtml = '';
            let metaHtml = ''; // Meta section (timestamp, unread) only for active chats

            if (isSearchResult) {
                itemEl.classList.add('search-result-item');
                if (activeChats[item.id]) { // If already in active chats
                    itemPreviewHtml = `<span class="last-message">Already in chat list</span>`;
                } else {
                     itemPreviewHtml = `<span class="last-message">Click to start chat</span>`;
                }
                // Add click listener for search result
                 itemEl.addEventListener('click', () => handleSearchResultClick(item));
            } else { // It's an active chat from the activeChats state
                let displayStatus = item.lastMessage || '';
                let timestamp = item.timestamp || '';
                let unread = item.unread || 0;
                // TODO: Check typing status here if available in activeChats state
                // if (item.status === 'typing') displayStatus = '<i>Typing...</i>';

                itemPreviewHtml = `<span class="last-message">${escapeHtml(displayStatus)}</span>`;
                metaHtml = `
                     <div class="contact-meta">
                         <span class="timestamp">${timestamp}</span>
                         ${unread > 0 ? `<span class="unread-count">${unread}</span>` : ''}
                     </div>`;
                 // Add click listener for active chat
                 itemEl.addEventListener('click', () => loadChat(item.id));
            }

            // Build final element HTML
            itemEl.innerHTML = `
                <img src="${itemPic}" alt="${escapeHtml(itemName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                <div class="contact-info">
                    <span class="contact-name">${escapeHtml(itemName)}</span>
                    ${itemPreviewHtml}
                </div>
                ${metaHtml} `;
            contactList.appendChild(itemEl);
        });
    }

    /** Handles clicking on a user from search results */
    function handleSearchResultClick(userDetails) {
        if (!userDetails || !userDetails.id || !currentUser.id) return;
        const userId = userDetails.id;
        console.log(`Starting chat with searched user: ${userId}`);

        // 1. Add/Update user in the active chat list state if not present
        if (!activeChats[userId]) {
             activeChats[userId] = {
                 id: userId,
                 name: userDetails.username || userId,
                 profilePicUrl: userDetails.profilePicUrl || null
                 // lastMessage, timestamp will be updated when messages arrive/are sent
             };
        }
        // 2. Load the chat window for this user
        loadChat(userId);
        // 3. Clear search input and restore active chats view in sidebar
        if (searchContactsInput) searchContactsInput.value = '';
        currentSearchTerm = ''; // Clear search state
        displayActiveChats(); // Show active chats
    }

    /** Displays the list of active chats in the sidebar (helper for displayContactsOrSearchResults) */
    function displayActiveChats() {
         // Pass the values from the activeChats object
         displayContactsOrSearchResults(Object.values(activeChats), false);
    }

    /** Loads a chat, requests history */
    function loadChat(chatPartnerUid) {
        console.log("Loading chat for:", chatPartnerUid);
        if (!isSocketAuthenticated || !chatPartnerUid || !currentUser.id) return;
        currentChatId = chatPartnerUid;

        // Highlight item in sidebar
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === chatPartnerUid);
            if (item.dataset.contactId === chatPartnerUid) item.querySelector('.unread-count')?.remove(); // Clear visual unread count
        });

        // Get contact details from the activeChats state
        const chatPartner = activeChats[chatPartnerUid];
        if (!chatPartner) {
             console.error("Chat partner details not found for ID:", chatPartnerUid);
             if(chatHeaderProfile) chatHeaderProfile.innerHTML = `<div class="placeholder">User details error</div>`;
             if(messageList) messageList.innerHTML = ''; return;
        }

        // Update chat header
        let contactPic = chatPartner.profilePicUrl || defaultPic;
        if (chatHeaderProfile) {
             chatHeaderProfile.innerHTML = `
                 <img src="${contactPic}" alt="${escapeHtml(chatPartner.name)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                 <div class="contact-details">
                     <span class="contact-name">${escapeHtml(chatPartner.name)}</span>
                     <span class="contact-status">Offline</span> </div>`;
        }

        // Request Chat History
        if (messageList) messageList.innerHTML = '<div class="loading-history">Loading messages...</div>';
        if (socket && socket.connected) {
             console.log(`[History] Requesting history for chat ${chatPartnerUid}`);
             socket.emit('getChatHistory', { chatId: chatPartnerUid, limit: 50 });
        } else {
             console.error("Cannot get history, socket not available.");
             if(messageList) messageList.innerHTML = '<div class="error-history">Could not load messages.</div>';
        }

        if (messageInput) messageInput.focus();
        hideTypingIndicator();
        if (window.innerWidth <= 768) { showChatAreaMobile(); }
    }

    /** Appends a single message object to the message list UI */
    function displayMessage(message) {
        if (!messageList || !message || !message.sender || !currentUser.id) { return; }
        const isSent = message.sender === currentUser.id;
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id; messageEl.dataset.senderId = message.sender;
        let ticksHtml = ''; // TODO: Implement based on message.status or confirmation event
        let senderNameHtml = ''; // TODO: Group chats
        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            const senderContact = activeChats[message.sender]; // Use activeChats state for sender pic
            const picUrl = senderContact?.profilePicUrl || defaultPic;
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small" onerror="this.onerror=null; this.src='${defaultPic}';">`;
        }
        const displayTimestamp = typeof message.timestamp === 'string' ? message.timestamp : (message.timestamp instanceof Date ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : ' ');
        messageEl.innerHTML = `${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>'}<div class="bubble">${senderNameHtml}<p>${escapeHtml(message.content)}</p><div class="message-meta"><span class="timestamp">${displayTimestamp}</span>${ticksHtml}</div></div>`;
        messageList.appendChild(messageEl);
    }

    /** Handles sending a message */
    function sendMessage() {
        if (!messageInput) return; const messageText = messageInput.value.trim();
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser.id) return;
        const tempId = 'temp_' + Date.now(); const newMessage = { id: tempId, sender: currentUser.id, recipientUid: currentChatId, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };
        // Add to local message cache
        if (!currentMessages[currentChatId]) currentMessages[currentChatId] = [];
        currentMessages[currentChatId].push(newMessage);
        displayMessage(newMessage); scrollToBottom(); messageInput.value = ''; messageInput.focus();
        if (socket && socket.connected) { socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId }); } else { console.error("Cannot send message, socket disconnected."); }
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp); hideTypingIndicator();
    }

    /** Updates the sidebar preview for a chat */
    function updateContactPreview(chatId, message, timestamp) {
        // Update the state first
        const chat = activeChats[chatId];
        if (!chat) return; // Don't update if chat isn't 'active'
        chat.lastMessage = message;
        chat.timestamp = timestamp;
        // chat.lastMessageTimestamp = Date.now(); // For sorting later
        // Re-render the list which will automatically move the updated chat if sorted
        if (!currentSearchTerm) { // Only update active list if not searching
             displayActiveChats();
        }
    }

    // --- Helper & UI Functions ---
    function escapeHtml(unsafe) { if (typeof unsafe !== 'string') return ''; const e = document.createElement('div'); e.textContent = unsafe; return e.innerHTML; }
    function scrollToBottom() { setTimeout(() => { if (messageList) messageList.scrollTop = messageList.scrollHeight; }, 50); }
    let typingTimer; const typingTimeout = 1500;
    function handleTyping() { if (!currentChatId || !isSocketAuthenticated || !socket) return; socket.emit('typing', { recipientUid: currentChatId, isTyping: true }); clearTimeout(typingTimer); typingTimer = setTimeout(() => { if(socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false }); }, typingTimeout); }
    function showTypingIndicator() { if (typingIndicator) typingIndicator.classList.remove('hidden'); scrollToBottom(); }
    function hideTypingIndicator() { if (typingIndicator) typingIndicator.classList.add('hidden'); }
    function logout() { console.log("[Logout Debug] Logout function CALLED!"); console.log("Logging out..."); if (socket) { socket.disconnect(); socket = null; } isSocketAuthenticated = false; localStorage.clear(); console.log("[Logout Debug] Local storage cleared. Redirecting..."); window.location.href = 'login.html'; }
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

    // Search Listener with Debounce & Clear Handling
    if (searchContactsInput) {
        searchContactsInput.addEventListener('input', () => {
             clearTimeout(searchDebounceTimer);
             const searchTerm = searchContactsInput.value.trim();
             currentSearchTerm = searchTerm; // Update search state

             if (searchTerm.length > 1) {
                 searchDebounceTimer = setTimeout(() => {
                     if (socket && isSocketAuthenticated) {
                         console.log(`[Search] Emitting 'searchUsers' for: "${searchTerm}"`);
                         socket.emit('searchUsers', searchTerm);
                         contactList.innerHTML = '<div class="loading-history">Searching...</div>'; // Show loading in main list
                     }
                 }, 300);
             } else {
                  // Search term is short/empty, clear search results and show active chats
                  console.log("[Search] Term cleared or too short. Displaying active chats.");
                  displayActiveChats(); // Restore active chats view
             }
         });
         // Clear search on focus loss if results aren't clicked
         searchContactsInput.addEventListener('blur', () => {
             setTimeout(() => {
                 // If focus didn't move to a result item (which are now also .contact-item)
                 // We only clear if they blur *and* the search term is empty
                  if (!contactList.contains(document.activeElement) && !searchContactsInput.value.trim()) {
                      console.log("[Search] Input blur and empty, ensuring active chats shown.");
                      currentSearchTerm = '';
                      displayActiveChats();
                  } else if (!contactList.contains(document.activeElement)) {
                       console.log("[Search] Input blur, results remain visible."); // Keep results if term still present
                  }
             }, 200);
        });
    }

    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

}); // End of DOMContentLoaded listener
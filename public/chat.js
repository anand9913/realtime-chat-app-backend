// public/chat.js - Complete Version with Typing & Presence (April 17, 2025)

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
    let currentChatId = null;
    let currentUser = { id: null, name: defaultUsername, profilePic: defaultPic };
    // Contact object now includes status & lastSeen: { id, username, profilePicUrl, status?, lastSeen?, lastMessage?, timestamp?, unread? }
    let currentContacts = [];
    let currentMessages = {}; // { chatId: [messages] }
    let socket = null;
    let isSocketAuthenticated = false;
    let searchDebounceTimer;
    let currentSearchTerm = '';
    let typingTimers = {}; // Store timers to hide typing indicator { chatId: timeoutId }

    // --- Socket.IO Connection & Handlers ---
    function connectWebSocket() {
        if (typeof io === 'undefined') { console.error("Socket.IO client (io) not found."); alert("Chat error."); return; }
        console.log("Attempting to connect WebSocket...");
        if (socket && socket.connected) { console.log("WebSocket already connected."); return; }

        socket = io({ /* options */ });

        // --- Socket Event Handlers ---
        console.log("chat.js: Setting up socket event listeners...");

        socket.on('connect', () => {
            console.log('chat.js: Event listener fired: connect. Socket ID:', socket.id);
            isSocketAuthenticated = false;
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) { socket.emit('authenticate', idToken); }
            else { console.error("chat.js: connect handler - Token missing! Logging out."); logout(); }
        });
        console.log("chat.js: Listener attached for 'connect'");

        socket.on('authenticationSuccess', (userData) => {
            isSocketAuthenticated = true;
            console.log(">>> CHAT PAGE: 'authenticationSuccess' received!");
            console.log(">>> Payload received from backend:", JSON.stringify(userData, null, 2));
            currentUser.id = userData.uid; currentUser.name = userData.username || defaultUsername; currentUser.profilePic = userData.profilePicUrl || defaultPic;
            console.log(">>> CHAT PAGE: Updated internal 'currentUser' object:", currentUser);
            if (currentUsernameSpan) currentUsernameSpan.textContent = currentUser.name;
            if (sidebarProfilePic) { sidebarProfilePic.src = currentUser.profilePic; sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; }; }
            console.log(`>>> CHAT PAGE: Set sidebar UI: Name='${currentUser.name}', PicSrc='${currentUser.profilePic}'`);
            if (socket) { console.log("[Initialize] Requesting contact list from server..."); socket.emit('getContacts'); }
            initializeChatApp();
        });
        console.log("chat.js: Listener attached for 'authenticationSuccess'");

        socket.on('authenticationFailed', (error) => {
            console.log("chat.js: Event listener fired: authenticationFailed");
            isSocketAuthenticated = false; console.error(">>> CHAT PAGE: Backend socket authentication failed:", error?.message || 'Unknown error');
            const message = error?.message || 'Authentication failed.';
            if (message.includes('expired')) { alert("Your login session has expired. Please log in again."); }
            else { alert(`Authentication error: ${message}`); }
            logout();
        });
        console.log("chat.js: Listener attached for 'authenticationFailed'");

        // --- Handle Contact List Received ---
        socket.on('contactList', (contacts) => {
            console.log("[Contacts] Received contact list with status:", contacts);
            currentContacts = contacts || []; // Update main contact state
            if (!currentSearchTerm) { displayContactsOrSearchResults(currentContacts, false); } // Display contacts if not searching
        });
        console.log("chat.js: Listener attached for 'contactList'");

        // --- Handle Initial Presence Status ---
        socket.on('initialPresenceStatus', (presenceMap) => {
             console.log("[Presence] Received initial status for contacts:", presenceMap);
             let contactsUpdated = false;
             currentContacts.forEach(contact => {
                  if (presenceMap[contact.id]) {
                       if (contact.status !== presenceMap[contact.id].status || contact.lastSeen !== presenceMap[contact.id].lastSeen) {
                            contact.status = presenceMap[contact.id].status;
                            contact.lastSeen = presenceMap[contact.id].lastSeen; // Will be null if online
                            contactsUpdated = true;
                       }
                  } else { contact.status = contact.status || 'offline'; } // Default to offline if not specified
             });
             // Re-render if any status changed and not currently searching
             if (contactsUpdated && !currentSearchTerm) {
                 console.log("[Presence] Re-rendering contact list after receiving initial statuses.");
                 displayContactsOrSearchResults(currentContacts, false);
             }
        });
        console.log("chat.js: Listener attached for 'initialPresenceStatus'");

        // --- Handle Live Presence Updates ---
        socket.on('presenceUpdate', (data) => { // data = { userId, status, lastSeen? }
             if (!isSocketAuthenticated || !data || !data.userId) return;
             console.log(`[Presence] Update received: User ${data.userId} is ${data.status}`);
             const contactIndex = currentContacts.findIndex(c => c.id === data.userId);
             let contactUpdated = false;
             if (contactIndex !== -1) {
                 // Update contact state only if status actually changed
                 if (currentContacts[contactIndex].status !== data.status) {
                      currentContacts[contactIndex].status = data.status;
                      currentContacts[contactIndex].lastSeen = data.lastSeen || null;
                      console.log(`[Presence] Updated state for ${data.userId}: ${data.status}`);
                      contactUpdated = true;
                      // Re-render contact list if not searching
                      if (!currentSearchTerm) { displayContactsOrSearchResults(currentContacts, false); }
                 }
             }
              // Update chat header if this user's chat is open
              if (data.userId === currentChatId) {
                   updateChatHeaderStatus(data.status, data.lastSeen);
              }
        });
        console.log("chat.js: Listener attached for 'presenceUpdate'");


        // --- Handle Search Results ---
        socket.on('searchResultsUsers', (users) => {
            console.log("Received user search results:", users);
            if (currentSearchTerm) { displayContactsOrSearchResults(users, true); }
        });
        console.log("chat.js: Listener attached for 'searchResultsUsers'");

        // --- Handle Chat History ---
        socket.on('chatHistory', (data) => {
            console.log("chat.js: Event listener fired: chatHistory");
             if (!data || !data.chatId || !Array.isArray(data.messages)) return;
             console.log(`[History] Received ${data.messages.length} messages for chat ${data.chatId}`);
             currentMessages[data.chatId] = data.messages;
             if (data.chatId === currentChatId) {
                 if (messageList) messageList.innerHTML = '';
                 data.messages.forEach(displayMessage);
                 scrollToBottom();
             }
        });
        console.log("chat.js: Listener attached for 'chatHistory'");

        // --- Handle Receiving Messages ---
        socket.on('receiveMessage', (message) => {
            console.log("chat.js: Event listener fired: receiveMessage");
             if (!isSocketAuthenticated || !message || !message.sender) return;
             console.log('Message received:', message);
             const chatId = message.sender; // Assuming 1-on-1 for now
             if (!chatId) return;
             if (!currentMessages[chatId]) currentMessages[chatId] = [];
             currentMessages[chatId].push(message);
             const senderContact = currentContacts.find(c => c.id === message.sender);
             if (!senderContact) {
                  console.log(`Adding sender ${message.sender} to contact list.`);
                  currentContacts.push({ id: message.sender, username: message.senderName || message.sender, profilePicUrl: message.senderPic || null });
             }
             updateContactPreview(chatId, message.content, message.timestamp); // Will re-render list if needed
             if (chatId === currentChatId) { displayMessage(message); scrollToBottom(); /* TODO: Emit markAsRead */ }
             else { /* TODO: Increment unread count */ }
        });
        console.log("chat.js: Listener attached for 'receiveMessage'");

        // --- Handle Typing Status ---
        socket.on('typingStatus', (data) => { // data = { senderUid, isTyping }
             console.log("chat.js: Event listener fired: typingStatus");
             if (!isSocketAuthenticated || !currentUser.id || data.senderUid === currentUser.id) return;
             if (data.senderUid === currentChatId) { // Only show for current chat
                const indicator = document.getElementById('typing-indicator');
                if (indicator) {
                    if (data.isTyping) {
                        indicator.classList.remove('hidden'); scrollToBottom();
                        if (typingTimers[currentChatId]) clearTimeout(typingTimers[currentChatId]);
                        typingTimers[currentChatId] = setTimeout(() => { if(typingIndicator) typingIndicator.classList.add('hidden'); }, 5000);
                    } else {
                        indicator.classList.add('hidden');
                        if (typingTimers[currentChatId]) { clearTimeout(typingTimers[currentChatId]); delete typingTimers[currentChatId]; }
                    }
                }
             }
             // TODO: Update contact list preview (optional)
        });
        console.log("chat.js: Listener attached for 'typingStatus'");

        // --- Other Handlers ---
        socket.on('messageSentConfirmation', (data) => { console.log("chat.js: Event listener fired: messageSentConfirmation"); /* ... */ });
        console.log("chat.js: Listener attached for 'messageSentConfirmation'");
        socket.on('disconnect', (reason) => { console.log("chat.js: Event listener fired: disconnect"); isSocketAuthenticated = false; /* ... */ });
        console.log("chat.js: Listener attached for 'disconnect'");
        socket.on('connect_error', (err) => { console.log("chat.js: Event listener fired: connect_error"); isSocketAuthenticated = false; /* ... */ });
        console.log("chat.js: Listener attached for 'connect_error'");
        socket.on('error', (error) => { console.log("chat.js: Event listener fired: error"); /* ... */ });
        console.log("chat.js: Listener attached for 'error'");

        console.log("chat.js: Finished setting up socket event listeners.");
    } // End connectWebSocket


    // --- Main Application Functions ---

    /** Initializes the chat UI - waits for contacts */
    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // Contact list display is triggered by 'contactList' event
        setupMobileView();
    }

    /**
     * Renders contacts OR search results, including online status.
     * @param {Array} items - Array of user/chat objects.
     * @param {boolean} isSearchResult - True if rendering search results.
     */
    function displayContactsOrSearchResults(items, isSearchResult = false) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = '';
        console.log(`[Display List] Rendering ${items?.length || 0} items. Is Search Result: ${isSearchResult}`);
        const itemsToDisplay = items || [];
        if (itemsToDisplay.length === 0) { contactList.innerHTML = `<div class="no-results">${isSearchResult ? 'No users found.' : 'Search users to start chatting!'}</div>`; return; }

        // Sort contacts: online first, then alphabetically (only if not search results)
        if (!isSearchResult) {
             itemsToDisplay.sort((a, b) => {
                  const statusA = a.status === 'online' ? 0 : 1;
                  const statusB = b.status === 'online' ? 0 : 1;
                  if (statusA !== statusB) return statusA - statusB; // Online first
                  return (a.username || a.name || a.id).localeCompare(b.username || b.name || b.id); // Then alphabetical
             });
        }

        itemsToDisplay.forEach(item => {
            if (!item || !item.id) return;
            const itemEl = document.createElement('div');
            itemEl.classList.add('contact-item');
            if (!isSearchResult && item.status === 'online') itemEl.classList.add('online');
            else if (!isSearchResult) itemEl.classList.add('offline');
            itemEl.dataset.contactId = item.id;

            let itemPic = item.profilePicUrl || defaultPic;
            let itemName = item.username || item.name || item.id;
            let itemPreviewHtml = ''; let metaHtml = '';

            // Status indicator dot (only for actual contacts, not search results)
             const statusIndicatorHtml = isSearchResult ? '' : `<div class="status-dot ${item.status === 'online' ? 'online' : 'offline'}"></div>`;

            if (isSearchResult) {
                itemEl.classList.add('search-result-item');
                const isExistingContact = currentContacts.some(c => c.id === item.id);
                itemPreviewHtml = `<span class="last-message">${isExistingContact ? 'Already in contacts' : 'Click to start chat'}</span>`;
                itemEl.addEventListener('click', () => handleSearchResultClick(item));
            } else { // Active contact
                let displayStatus = item.lastMessage || 'No messages yet';
                let timestamp = item.timestamp || ''; let unread = item.unread || 0;
                itemPreviewHtml = `<span class="last-message">${escapeHtml(displayStatus)}</span>`;
                metaHtml = `<div class="contact-meta"><span class="timestamp">${timestamp}</span>${unread > 0 ? `<span class="unread-count">${unread}</span>` : ''}</div>`;
                itemEl.addEventListener('click', () => loadChat(item.id));
            }

            // Modified innerHTML to include status dot container
            itemEl.innerHTML = `
                <div class="profile-pic-container">
                    <img src="${itemPic}" alt="${escapeHtml(itemName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                    ${statusIndicatorHtml}
                </div>
                <div class="contact-info">
                    <span class="contact-name">${escapeHtml(itemName)}</span>
                    ${itemPreviewHtml}
                </div>
                ${metaHtml}
            `;
            contactList.appendChild(itemEl);
        });
    }

    /** Handles clicking on a user from search results */
    function handleSearchResultClick(userDetails) {
        if (!userDetails || !userDetails.id || !currentUser.id) return;
        const userId = userDetails.id;
        console.log(`Search result clicked, loading chat for user: ${userId}`);
        // Add/Update contact in local state immediately for better UX
        const existingContactIndex = currentContacts.findIndex(c => c.id === userId);
        if (existingContactIndex === -1) { currentContacts.push({ id: userId, username: userDetails.username || userId, profilePicUrl: userDetails.profilePicUrl || null }); }
        else { currentContacts[existingContactIndex].username = userDetails.username || userId; currentContacts[existingContactIndex].profilePicUrl = userDetails.profilePicUrl || null; }
        loadChat(userId); // Load chat
        if (searchContactsInput) searchContactsInput.value = ''; // Clear search bar
        currentSearchTerm = '';
        displayContactsOrSearchResults(currentContacts, false); // Show contacts list
    }

    /** Loads a chat, requests history, updates header status */
    function loadChat(chatPartnerUid) {
        console.log("Loading chat for:", chatPartnerUid);
        if (!isSocketAuthenticated || !chatPartnerUid || !currentUser.id) return;

        // Hide and clear previous typing indicator/timer
        hideTypingIndicator();
        if (currentChatId && typingTimers[currentChatId]) { clearTimeout(typingTimers[currentChatId]); delete typingTimers[currentChatId]; }

        currentChatId = chatPartnerUid; // Set new active chat

        document.querySelectorAll('.contact-item').forEach(item => { /* ... highlight logic ... */ });

        const chatPartner = currentContacts.find(c => c.id === chatPartnerUid);
        const chatPartnerName = chatPartner?.username || chatPartnerUid;
        const chatPartnerPic = chatPartner?.profilePicUrl || defaultPic;
        const initialStatus = chatPartner?.status; // Get status from contact state
        const initialLastSeen = chatPartner?.lastSeen;

        // Update chat header including status
        if (chatHeaderProfile) {
             chatHeaderProfile.innerHTML = `<img src="${chatPartnerPic}" alt="${escapeHtml(chatPartnerName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';"><div class="contact-details"><span class="contact-name">${escapeHtml(chatPartnerName)}</span><span class="contact-status"></span></div>`;
             updateChatHeaderStatus(initialStatus, initialLastSeen); // Update status text
        }

        // Request Chat History
        if (messageList) messageList.innerHTML = '<div class="loading-history">Loading messages...</div>';
        if (socket && socket.connected) { socket.emit('getChatHistory', { chatId: chatPartnerUid, limit: 50 }); }
        else { if(messageList) messageList.innerHTML = '<div class="error-history">Connection error</div>'; }

        if (messageInput) messageInput.focus();
        if (window.innerWidth <= 768) { showChatAreaMobile(); }
    }

     /** Helper to update the status text in the chat header */
     function updateChatHeaderStatus(status, lastSeen) {
         const statusElement = chatHeaderProfile?.querySelector('.contact-status');
         if (!statusElement) return;
         statusElement.classList.remove('online', 'offline'); // Remove previous classes

         if (status === 'online') {
             statusElement.textContent = 'Online';
             statusElement.classList.add('online');
         } else {
             statusElement.classList.add('offline');
             if (lastSeen) {
                 try {
                     const now = new Date();
                     const lastSeenDate = new Date(lastSeen);
                     const diffSeconds = Math.round((now - lastSeenDate) / 1000);
                     const diffDays = Math.floor(diffSeconds / 86400);

                     let formattedTime = lastSeenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                     if (diffDays === 0 && diffSeconds < 86400) { // Today
                          // Show time if recent, otherwise just "today" maybe?
                          statusElement.textContent = `Last seen today at ${formattedTime}`;
                     } else if (diffDays === 1) { // Yesterday
                          statusElement.textContent = `Last seen yesterday at ${formattedTime}`;
                     } else { // Older than yesterday
                          let formattedDate = lastSeenDate.toLocaleDateString([], { month: 'short', day: 'numeric'});
                          statusElement.textContent = `Last seen ${formattedDate}`;
                     }
                 } catch (e) { statusElement.textContent = 'Offline'; } // Fallback on date parsing error
             } else { statusElement.textContent = 'Offline'; } // Default if no lastSeen provided
         }
     }


    /** Appends a single message object to the message list UI */
    function displayMessage(message) {
        if (!messageList || !message || !message.sender || !currentUser.id) { return; }
        const isSent = message.sender === currentUser.id; const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id; messageEl.dataset.senderId = message.sender;
        let ticksHtml = ''; /* TODO */ let senderNameHtml = ''; /* TODO Group */ let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild; const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) { const senderContact = currentContacts.find(c => c.id === message.sender); const picUrl = senderContact?.profilePicUrl || defaultPic; profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small" onerror="this.onerror=null; this.src='${defaultPic}';">`; }
        const displayTimestamp = typeof message.timestamp === 'string' ? message.timestamp : ' ';
        messageEl.innerHTML = `${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>'}<div class="bubble">${senderNameHtml}<p>${escapeHtml(message.content)}</p><div class="message-meta"><span class="timestamp">${displayTimestamp}</span>${ticksHtml}</div></div>`;
        messageList.appendChild(messageEl);
    }

    /** Handles sending a message */
    function sendMessage() {
        if (!messageInput) return; const messageText = messageInput.value.trim();
        let canSend = true; let failReason = [];
        if (messageText === '') { canSend = false; failReason.push("Message empty"); } if (!currentChatId) { canSend = false; failReason.push("No active chat"); } if (!isSocketAuthenticated) { canSend = false; failReason.push("Not authed"); } if (!currentUser.id) { canSend = false; failReason.push("User ID missing"); } if (!socket || !socket.connected) { canSend = false; failReason.push("Socket disconnected"); }
        if (!canSend) { console.warn("Cannot send message:", failReason.join(', ')); return; }
        const tempId = 'temp_' + Date.now(); const newMessage = { id: tempId, sender: currentUser.id, recipientUid: currentChatId, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };
        if (!currentMessages[currentChatId]) currentMessages[currentChatId] = []; currentMessages[currentChatId].push(newMessage);
        displayMessage(newMessage); scrollToBottom(); messageInput.value = ''; messageInput.focus();
        console.log(`Emitting 'sendMessage': Recipient=${currentChatId}, Content=${messageText.substring(0,30)}...`);
        socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId });
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp); hideTypingIndicator();
    }

    /** Updates the sidebar preview for a chat contact */
    function updateContactPreview(contactId, message, timestamp) {
        const contactIndex = currentContacts.findIndex(c => c.id === contactId);
        if (contactIndex === -1) return;
        currentContacts[contactIndex].lastMessage = message;
        currentContacts[contactIndex].timestamp = timestamp;
        // currentContacts[contactIndex].lastMessageTimestamp = Date.now(); // For sorting
        if (!currentSearchTerm) { displayContactsOrSearchResults(currentContacts, false); } // Re-render list
    }

    // --- Helper & UI Functions ---
    function escapeHtml(unsafe) { if (typeof unsafe !== 'string') return ''; const e = document.createElement('div'); e.textContent = unsafe; return e.innerHTML; }
    function scrollToBottom() { setTimeout(() => { if (messageList) messageList.scrollTop = messageList.scrollHeight; }, 50); }
    function handleTyping() { if (!currentChatId || !isSocketAuthenticated || !socket) return; socket.emit('typing', { recipientUid: currentChatId, isTyping: true }); clearTimeout(typingTimer); typingTimer = setTimeout(() => { if(socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false }); }, typingTimeout); }
    function showTypingIndicator() { if (typingIndicator) typingIndicator.classList.remove('hidden'); scrollToBottom(); }
    function hideTypingIndicator() { if (typingIndicator) typingIndicator.classList.add('hidden'); if (currentChatId && typingTimers[currentChatId]) { clearTimeout(typingTimers[currentChatId]); delete typingTimers[currentChatId]; } } // Also clear timer
    function logout() { console.log("[Logout Debug] Logout function CALLED!"); console.log("Logging out..."); if (socket) { socket.disconnect(); socket = null; } isSocketAuthenticated = false; localStorage.clear(); console.log("[Logout Debug] Local storage cleared. Redirecting..."); window.location.href = 'login.html'; }
    function setupMobileView() { if (!sidebarElement || !chatAreaElement) return; if (window.innerWidth <= 768) { showSidebarMobile(); } else { sidebarElement.classList.remove('mobile-hidden'); chatAreaElement.classList.remove('mobile-hidden'); removeMobileBackButton(); } }
    function showChatAreaMobile() { if(sidebarElement) sidebarElement.classList.add('mobile-hidden'); if(chatAreaElement) chatAreaElement.classList.remove('mobile-hidden'); addMobileBackButton(); }
    function showSidebarMobile() { if(sidebarElement) sidebarElement.classList.remove('mobile-hidden'); if(chatAreaElement) chatAreaElement.classList.add('mobile-hidden'); removeMobileBackButton(); }
    function addMobileBackButton() { const h=document.querySelector('.chat-header'); if(!h || document.getElementById('mobile-back-button')) return; const b=document.createElement('button'); b.innerHTML='<i class="fas fa-arrow-left"></i>'; b.id='mobile-back-button'; b.title="Back"; b.style.cssText=`margin-right:10px;border:none;background:none;color:var(--text-secondary);font-size:1.2em;cursor:pointer;padding:8px;flex-shrink:0;order:-1;`; b.onclick=showSidebarMobile; h.prepend(b); }
    function removeMobileBackButton() { const b=document.getElementById('mobile-back-button'); if(b) b.remove(); }

    // --- Event Listeners ---
    if (sendButton) sendButton.addEventListener('click', sendMessage);
    if (messageInput) messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } else { handleTyping(); } });
    if (logoutButton) { console.log("[Logout Debug] Attaching click listener to logout button..."); logoutButton.addEventListener('click', logout); } else { console.error("[Logout Debug] Logout button element NOT found!"); }
    if (searchContactsInput) {
        searchContactsInput.addEventListener('input', () => {
             clearTimeout(searchDebounceTimer); const searchTerm = searchContactsInput.value.trim(); currentSearchTerm = searchTerm;
             if (searchTerm.length > 1) { searchDebounceTimer = setTimeout(() => { if (socket && isSocketAuthenticated) { console.log(`[Search] Emitting 'searchUsers' for: "${searchTerm}"`); socket.emit('searchUsers', searchTerm); if(contactList) contactList.innerHTML = '<div class="loading-history">Searching...</div>'; } }, 300); }
             else { console.log("[Search] Term cleared. Displaying contacts."); displayContactsOrSearchResults(currentContacts, false); }
         });
         searchContactsInput.addEventListener('blur', () => { setTimeout(() => { if (!contactList.contains(document.activeElement) && !searchContactsInput.value.trim()) { console.log("[Search] Input blur and empty, ensuring contacts shown."); currentSearchTerm = ''; displayContactsOrSearchResults(currentContacts, false); } }, 200); });
    }

    // --- Initial Connection ---
    connectWebSocket(); // Start connection -> auth -> getContacts

}); // End of DOMContentLoaded listener
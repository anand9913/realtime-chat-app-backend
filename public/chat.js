// public/chat.js - Complete Version with sendMessage Debugging (April 17, 2025)

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
    const searchContactsInput = document.getElementById('search-contacts'); // User search input
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
    let currentChatId = null; // UID of the person being chatted with
    let currentUser = { id: null, name: defaultUsername, profilePic: defaultPic };
    // currentContacts stores users fetched from backend contact list {id, username, profilePicUrl, lastMessage?, timestamp?, unread?}
    let currentContacts = [];
    let currentMessages = {}; // Holds fetched messages, keyed by chatId { chatId: [messages] }
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
        console.log("chat.js: Setting up socket event listeners...");

        socket.on('connect', () => {
            console.log('chat.js: Event listener fired: connect. Socket ID:', socket.id);
            isSocketAuthenticated = false;
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("chat.js: connect handler - Emitting authenticate event...");
                socket.emit('authenticate', idToken);
            } else { console.error("chat.js: connect handler - Token missing! Logging out."); logout(); }
        });
        console.log("chat.js: Listener attached for 'connect'");

        socket.on('authenticationSuccess', (userData) => {
            isSocketAuthenticated = true; // Mark socket as authenticated
            console.log("-----------------------------------------");
            console.log(">>> CHAT PAGE: Event listener fired: authenticationSuccess!");
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
                try { nameSpan.textContent = currentUser.name; console.log(`>>> CHAT PAGE: SUCCESSFULLY set nameSpan.textContent to: "${currentUser.name}"`); console.log(`>>> CHAT PAGE: VERIFY nameSpan.textContent is now: "${nameSpan.textContent}"`); } catch (e) { console.error(">>> CHAT PAGE: ERROR setting nameSpan.textContent:", e); }
            } else { console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'current-user-name'"); }
            if (picImg) {
                console.log(`>>> CHAT PAGE: BEFORE setting src: Current src is "${picImg.src}"`);
                picImg.onerror = null;
                try { let newSrc = currentUser.profilePic; picImg.src = newSrc; console.log(`>>> CHAT PAGE: SUCCESSFULLY set picImg.src to: "${newSrc}"`); console.log(`>>> CHAT PAGE: VERIFY picImg.src is now: "${picImg.src}"`); picImg.onerror = () => { console.warn(">>> CHAT PAGE: onerror triggered! Error loading profile pic src:", newSrc, ". Reverting to default."); picImg.src = defaultPic; }; } catch (e) { console.error(">>> CHAT PAGE: ERROR setting picImg.src:", e); }
            } else { console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'sidebar-profile-pic'"); }
            console.log(">>> CHAT PAGE: UI update attempts finished.");
            console.log("-----------------------------------------");

            // Request Contact List AFTER successful authentication
            if (socket) {
                 console.log("[Initialize] Requesting contact list from server...");
                 socket.emit('getContacts');
            }
            initializeChatApp(); // Basic UI setup (like mobile view)
        });
        console.log("chat.js: Listener attached for 'authenticationSuccess'");

        socket.on('authenticationFailed', (error) => {
            console.log("chat.js: Event listener fired: authenticationFailed");
            isSocketAuthenticated = false;
            console.error(">>> CHAT PAGE: Backend socket authentication failed:", error?.message || 'Unknown error');
            const message = error?.message || 'Authentication failed.';
            if (message.includes('expired')) { alert("Your login session has expired. Please log in again."); }
            else { alert(`Authentication error: ${message}`); }
            logout();
        });
        console.log("chat.js: Listener attached for 'authenticationFailed'");

        // --- Handle Contact List Received from Server ---
        socket.on('contactList', (contacts) => {
            console.log("[Contacts] Received contact list:", contacts);
            currentContacts = contacts || []; // Update main contact state
            // If not currently searching, display the received contacts
            if (!currentSearchTerm) {
                 displayContactsOrSearchResults(currentContacts, false); // Display contacts
            }
        });
        console.log("chat.js: Listener attached for 'contactList'");

        // --- Handle Search Results ---
        socket.on('searchResultsUsers', (users) => {
            console.log("Received user search results:", users);
            // IMPORTANT: Only display search results IF the search bar still has text
            if (currentSearchTerm) {
                 displayContactsOrSearchResults(users, true); // Display results in the main list
            }
        });
         console.log("chat.js: Listener attached for 'searchResultsUsers'");

        // --- Handle Chat History ---
        socket.on('chatHistory', (data) => {
            console.log("chat.js: Event listener fired: chatHistory");
             if (!data || !data.chatId || !Array.isArray(data.messages)) return;
             console.log(`[History] Received ${data.messages.length} messages for chat ${data.chatId}`);
             currentMessages[data.chatId] = data.messages;
             if (data.chatId === currentChatId) { // If currently open chat
                 if (messageList) messageList.innerHTML = ''; // Clear loading/old
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
             const chatId = (message.sender === currentUser.id) ? message.recipientUid : message.sender;
             if (!chatId) return;
             if (!currentMessages[chatId]) currentMessages[chatId] = [];
             currentMessages[chatId].push(message);
             const otherUserId = message.sender === currentUser.id ? message.recipientUid : message.sender;
             const senderContact = currentContacts.find(c => c.id === otherUserId);
             if (!senderContact) {
                  console.log(`Adding sender ${otherUserId} to contact list state.`);
                  currentContacts.push({ id: otherUserId, username: message.senderName || otherUserId, profilePicUrl: message.senderPic || null });
                  // updateContactPreview will re-render if not searching
             }
             updateContactPreview(chatId, message.content, message.timestamp);
             if (chatId === currentChatId) { displayMessage(message); scrollToBottom(); }
             else { /* TODO: Increment unread count */ }
        });
        console.log("chat.js: Listener attached for 'receiveMessage'");

        // --- Other Handlers ---
        socket.on('typingStatus', (data) => { console.log("chat.js: Event listener fired: typingStatus"); /* ... */ });
        console.log("chat.js: Listener attached for 'typingStatus'");
        socket.on('messageSentConfirmation', (data) => { console.log("chat.js: Event listener fired: messageSentConfirmation"); /* ... */ });
        console.log("chat.js: Listener attached for 'messageSentConfirmation'");
        socket.on('disconnect', (reason) => { console.log("chat.js: Event listener fired: disconnect"); /* ... */ });
        console.log("chat.js: Listener attached for 'disconnect'");
        socket.on('connect_error', (err) => { console.log("chat.js: Event listener fired: connect_error"); /* ... */ });
        console.log("chat.js: Listener attached for 'connect_error'");
        socket.on('error', (error) => { console.log("chat.js: Event listener fired: error"); /* ... */ });
        console.log("chat.js: Listener attached for 'error'");

        console.log("chat.js: Finished setting up socket event listeners.");

    } // End connectWebSocket


    // --- Main Application Functions ---

    /** Initializes the chat UI - displays active chats and sets mobile view */
    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // Display empty initially, wait for 'contactList' event to populate
        displayContactsOrSearchResults([], false);
        setupMobileView();
    }

    /**
     * Renders EITHER the list of contacts OR search results in the main sidebar list.
     * @param {Array} items - Array of user/chat objects {id, username, profilePicUrl, ...}
     * @param {boolean} isSearchResult - True if items are search results, false if contacts.
     */
    function displayContactsOrSearchResults(items, isSearchResult = false) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = ''; // Clear current list content
        console.log(`[Display List] Rendering ${items?.length || 0} items. Is Search Result: ${isSearchResult}`);
        const itemsToDisplay = items || [];
        if (itemsToDisplay.length === 0) {
            contactList.innerHTML = `<div class="no-results" style="padding: 20px; text-align: center; color: var(--text-secondary);">${isSearchResult ? 'No users found.' : 'Search users to start chatting!'}</div>`;
            return;
        }
        // TODO: Sort contacts by last message time if !isSearchResult
        itemsToDisplay.forEach(item => {
            if (!item || !item.id) return;
            const itemEl = document.createElement('div');
            itemEl.classList.add('contact-item');
            itemEl.dataset.contactId = item.id;
            let itemPic = item.profilePicUrl || defaultPic;
            let itemName = item.username || item.name || item.id; // Use username from DB
            let itemPreviewHtml = '';
            let metaHtml = '';
            if (isSearchResult) {
                itemEl.classList.add('search-result-item');
                const isExistingContact = currentContacts.some(c => c.id === item.id);
                if (isExistingContact) { itemPreviewHtml = `<span class="last-message">Already in contacts</span>`; }
                else { itemPreviewHtml = `<span class="last-message">Click to start chat</span>`; }
                itemEl.addEventListener('click', () => handleSearchResultClick(item));
            } else { // It's a contact from the currentContacts state
                let displayStatus = item.lastMessage || 'No messages yet';
                let timestamp = item.timestamp || '';
                let unread = item.unread || 0;
                // TODO: Check typing status
                itemPreviewHtml = `<span class="last-message">${escapeHtml(displayStatus)}</span>`;
                metaHtml = `<div class="contact-meta"><span class="timestamp">${timestamp}</span>${unread > 0 ? `<span class="unread-count">${unread}</span>` : ''}</div>`;
                itemEl.addEventListener('click', () => loadChat(item.id));
            }
            itemEl.innerHTML = `<img src="${itemPic}" alt="${escapeHtml(itemName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';"><div class="contact-info"><span class="contact-name">${escapeHtml(itemName)}</span>${itemPreviewHtml}</div>${metaHtml}`;
            contactList.appendChild(itemEl);
        });
    }

    /** Handles clicking on a user from search results */
    function handleSearchResultClick(userDetails) {
        if (!userDetails || !userDetails.id || !currentUser.id) return;
        const userId = userDetails.id;
        console.log(`Search result clicked, loading chat for user: ${userId}`);
        // Add/update contact in local state for immediate display
        const existingContactIndex = currentContacts.findIndex(c => c.id === userId);
        if (existingContactIndex === -1) { // Add if new
             currentContacts.push({ id: userId, username: userDetails.username || userId, profilePicUrl: userDetails.profilePicUrl || null });
        } else { // Update if existing (e.g., profile pic might have updated)
             currentContacts[existingContactIndex].username = userDetails.username || userId;
             currentContacts[existingContactIndex].profilePicUrl = userDetails.profilePicUrl || null;
        }
        loadChat(userId); // Load chat (backend will establish contact on first message)
        if (searchContactsInput) searchContactsInput.value = ''; // Clear search bar
        currentSearchTerm = '';
        displayContactsOrSearchResults(currentContacts, false); // Display contact list
    }

    /** Loads a chat, requests history */
    function loadChat(chatPartnerUid) {
        console.log("Loading chat for:", chatPartnerUid);
        if (!isSocketAuthenticated || !chatPartnerUid || !currentUser.id) return;
        currentChatId = chatPartnerUid; // Set active chat

        // Highlight item in sidebar
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === chatPartnerUid);
            if (item.dataset.contactId === chatPartnerUid) {
                item.querySelector('.unread-count')?.remove();
                // TODO: Update unread count in currentContacts state
            }
        });

        // Get contact details from the currentContacts state
        const chatPartner = currentContacts.find(c => c.id === chatPartnerUid);
        const chatPartnerName = chatPartner?.username || chatPartnerUid; // Use UID if contact not fully loaded yet
        const chatPartnerPic = chatPartner?.profilePicUrl || defaultPic;

        // Update chat header
        if (chatHeaderProfile) {
             chatHeaderProfile.innerHTML = `<img src="${chatPartnerPic}" alt="${escapeHtml(chatPartnerName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';"><div class="contact-details"><span class="contact-name">${escapeHtml(chatPartnerName)}</span><span class="contact-status">Offline</span> </div>`;
        }

        // Request Chat History
        if (messageList) messageList.innerHTML = '<div class="loading-history">Loading messages...</div>';
        if (socket && socket.connected) {
             console.log(`[History] Requesting history for chat ${chatPartnerUid}`);
             socket.emit('getChatHistory', { chatId: chatPartnerUid, limit: 50 });
        } else { if(messageList) messageList.innerHTML = '<div class="error-history">Connection error</div>'; }

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
        let ticksHtml = ''; // TODO
        let senderNameHtml = ''; // TODO Group
        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            const senderContact = currentContacts.find(c => c.id === message.sender); // Use currentContacts
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
        // Use the detailed check from Response #55
        let canSend = true; let failReason = [];
        if (messageText === '') { canSend = false; failReason.push("Message empty"); }
        if (!currentChatId) { canSend = false; failReason.push("No active chat"); }
        if (!isSocketAuthenticated) { canSend = false; failReason.push("Not authed"); }
        if (!currentUser.id) { canSend = false; failReason.push("User ID missing"); }
        if (!socket || !socket.connected) { canSend = false; failReason.push("Socket disconnected"); }
        if (!canSend) { console.warn("Cannot send message:", failReason.join(', ')); return; }

        const tempId = 'temp_' + Date.now(); const newMessage = { id: tempId, sender: currentUser.id, recipientUid: currentChatId, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };
        if (!currentMessages[currentChatId]) currentMessages[currentChatId] = [];
        currentMessages[currentChatId].push(newMessage);
        displayMessage(newMessage); scrollToBottom(); messageInput.value = ''; messageInput.focus();
        console.log(`Emitting 'sendMessage': Recipient=${currentChatId}, Content=${messageText.substring(0,30)}...`);
        socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId });
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp); hideTypingIndicator();
    }

    /** Updates the sidebar preview for a chat contact */
    function updateContactPreview(contactId, message, timestamp) {
        const contactIndex = currentContacts.findIndex(c => c.id === contactId); // Find index in array
        if (contactIndex === -1) return; // Contact not in list
        currentContacts[contactIndex].lastMessage = message;
        currentContacts[contactIndex].timestamp = timestamp;
        // currentContacts[contactIndex].lastMessageTimestamp = Date.now(); // For sorting
        // Re-render the list if not currently searching
        if (!currentSearchTerm) {
             displayContactsOrSearchResults(currentContacts, false);
        }
    }

    // --- Helper & UI Functions ---
    function escapeHtml(unsafe) { if (typeof unsafe !== 'string') return ''; const e = document.createElement('div'); e.textContent = unsafe; return e.innerHTML; }
    function scrollToBottom() { setTimeout(() => { if (messageList) messageList.scrollTop = messageList.scrollHeight; }, 50); }
    let typingTimer; const typingTimeout = 1500; function handleTyping() { if (!currentChatId || !isSocketAuthenticated || !socket) return; socket.emit('typing', { recipientUid: currentChatId, isTyping: true }); clearTimeout(typingTimer); typingTimer = setTimeout(() => { if(socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false }); }, typingTimeout); }
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
    if (logoutButton) { console.log("[Logout Debug] Attaching click listener to logout button..."); logoutButton.addEventListener('click', logout); } else { console.error("[Logout Debug] Logout button element NOT found!"); }
    // Search Listener
    if (searchContactsInput) {
        searchContactsInput.addEventListener('input', () => {
             clearTimeout(searchDebounceTimer); const searchTerm = searchContactsInput.value.trim(); currentSearchTerm = searchTerm;
             if (searchTerm.length > 1) {
                 searchDebounceTimer = setTimeout(() => { if (socket && isSocketAuthenticated) { console.log(`[Search] Emitting 'searchUsers' for: "${searchTerm}"`); socket.emit('searchUsers', searchTerm); if(contactList) contactList.innerHTML = '<div class="loading-history">Searching...</div>'; } }, 300);
             } else { console.log("[Search] Term cleared. Displaying contacts."); displayContactsOrSearchResults(currentContacts, false); } // Show contacts if search cleared
         });
         searchContactsInput.addEventListener('blur', () => { setTimeout(() => { if (!contactList.contains(document.activeElement) && !searchContactsInput.value.trim()) { console.log("[Search] Input blur and empty, ensuring contacts shown."); currentSearchTerm = ''; displayContactsOrSearchResults(currentContacts, false); } }, 200); });
    }

    // --- Initial Connection ---
    connectWebSocket(); // Start connection, auth, and request contacts

}); // End of DOMContentLoaded listener
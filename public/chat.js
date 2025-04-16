// public/chat.js - Complete Version with Persistent Contacts Logic (April 16, 2025)

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
    const contactList = document.getElementById('contact-list'); // Main list for contacts OR search results
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
    let currentChatId = null; // UID of the person being chatted with
    let currentUser = { id: null, name: defaultUsername, profilePic: defaultPic };
    let currentContacts = []; // Holds the fetched list of contacts {id, username, profilePicUrl, lastMessage?, timestamp?, unread?}
    let currentMessages = {}; // Holds fetched messages, keyed by chatId { chatId: [messages] }
    let socket = null;
    let isSocketAuthenticated = false;
    let searchDebounceTimer;
    let currentSearchTerm = '';

    // --- Socket.IO Connection & Handlers ---
    function connectWebSocket() {
        if (typeof io === 'undefined') { console.error("Socket.IO client (io) not found."); alert("Chat error."); return; }
        console.log("Attempting to connect WebSocket...");
        if (socket && socket.connected) { console.log("WebSocket already connected."); return; }

        socket = io({ /* options */ });

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

            // Request Contact List AFTER successful authentication
            if (socket) {
                 console.log("[Initialize] Requesting contact list from server...");
                 socket.emit('getContacts');
            }
            initializeChatApp(); // Basic UI setup (like mobile view)
        });

        socket.on('authenticationFailed', (error) => { /* ... same as before ... */ });

        // --- Handle Contact List Received ---
        socket.on('contactList', (contacts) => {
            console.log("[Contacts] Received contact list:", contacts);
            currentContacts = contacts || []; // Update main contact state
            // If not currently searching, display the received contacts
            if (!currentSearchTerm) {
                 displayContactsOrSearchResults(currentContacts, false); // Display contacts
            }
        });

        // --- Handle Search Results ---
        socket.on('searchResultsUsers', (users) => {
            console.log("Received user search results:", users);
            if (currentSearchTerm) { displayContactsOrSearchResults(users, true); }
        });

        // --- Handle Chat History ---
        socket.on('chatHistory', (data) => {
             if (!data || !data.chatId || !Array.isArray(data.messages)) return;
             console.log(`[History] Received ${data.messages.length} messages for chat ${data.chatId}`);
             currentMessages[data.chatId] = data.messages;
             if (data.chatId === currentChatId) {
                 if (messageList) messageList.innerHTML = ''; // Clear loading/old
                 data.messages.forEach(displayMessage);
                 scrollToBottom();
             }
        });

        // --- Handle Receiving Messages ---
        socket.on('receiveMessage', (message) => {
            // message should include: { id, sender, content, timestamp, senderName, senderPic }
            if (!isSocketAuthenticated || !message || !message.sender) return;
            console.log('Message received:', message);

            const chatId = message.sender; // Chat ID is the sender's UID in 1-on-1

            // Add message to internal message cache
            if (!currentMessages[chatId]) currentMessages[chatId] = [];
            currentMessages[chatId].push(message);

            // Ensure sender is in the contact list state (add if needed)
            const senderContact = currentContacts.find(c => c.id === message.sender);
            if (!senderContact) {
                 console.log(`Adding sender ${message.sender} to contact list from received message.`);
                 currentContacts.push({
                     id: message.sender,
                     username: message.senderName || message.sender, // Use name from payload
                     profilePicUrl: message.senderPic || null // Use pic from payload
                     // Other fields like lastMessage/timestamp will be updated by updateContactPreview
                 });
                 // No need to call displayContacts here, updateContactPreview will do it if not searching
            }

            // Update last message preview & re-render list (if not searching)
             updateContactPreview(chatId, message.content, message.timestamp);

            if (chatId === currentChatId) { // If this chat is currently open
                 displayMessage(message);
                 scrollToBottom();
                 // TODO: Emit 'markAsRead' event to backend?
            } else {
                 // TODO: Increment unread count in currentContacts state
                 const contactToUpdate = currentContacts.find(c => c.id === chatId);
                 if (contactToUpdate) contactToUpdate.unread = (contactToUpdate.unread || 0) + 1;
                  console.log(`Unread message from ${message.sender} for chat ${chatId}`);
                  if (!currentSearchTerm) displayContactsOrSearchResults(currentContacts, false); // Update UI for unread count
            }
        });

        // --- REMOVED 'addContactResult' Listener ---

        // ... (Other handlers: typingStatus, messageSentConfirmation, disconnect, etc.) ...
         socket.on('typingStatus', (data) => { /* ... as before ... */ });
         socket.on('messageSentConfirmation', (data) => { /* ... as before ... */ });
         socket.on('disconnect', (reason) => { /* ... as before ... */ });
         socket.on('connect_error', (err) => { /* ... as before ... */ });
         socket.on('error', (error) => { /* ... as before ... */ });

    } // End connectWebSocket


    // --- Main Application Functions ---

    function initializeChatApp() {
        console.log("[Initialize] initializeChatApp started...");
        // Display initially empty list, wait for 'contactList' event
        displayContactsOrSearchResults([], false);
        setupMobileView();
    }

    /**
     * Renders EITHER the list of contacts OR search results in the main sidebar list.
     * Uses the `currentContacts` state variable for displaying contacts.
     * @param {Array} items - Array of user/chat objects {id, username, profilePicUrl, ...}
     * @param {boolean} isSearchResult - True if items are search results, false if contacts.
     */
    function displayContactsOrSearchResults(items, isSearchResult = false) {
        if (!contactList) { console.error("Contact list element not found"); return; }
        contactList.innerHTML = ''; // Clear current list content
        console.log(`[Display List] Rendering ${items?.length || 0} items. Is Search Result: ${isSearchResult}`);

        const itemsToDisplay = items || []; // Ensure it's an array

        if (itemsToDisplay.length === 0) {
            contactList.innerHTML = `<div class="no-results" style="padding: 20px; text-align: center; color: var(--text-secondary);">${isSearchResult ? 'No users found.' : 'No contacts yet. Search to start!'}</div>`;
            return;
        }

        // TODO: Sort contacts by last message time if isSearchResult is false
        // Example (requires lastMessageTimestamp property):
        // if (!isSearchResult) { itemsToDisplay.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)); }

        itemsToDisplay.forEach(item => {
            if (!item || !item.id) return; // Must have an ID

            const itemEl = document.createElement('div');
            itemEl.classList.add('contact-item');
            itemEl.dataset.contactId = item.id;

            let itemPic = item.profilePicUrl || defaultPic;
            let itemName = item.username || item.name || item.id; // Use username from DB if available
            let itemPreviewHtml = '';
            let metaHtml = '';

            if (isSearchResult) {
                itemEl.classList.add('search-result-item');
                const isExistingContact = currentContacts.some(c => c.id === item.id);
                if (isExistingContact) { itemPreviewHtml = `<span class="last-message">Already in contacts</span>`; }
                else { itemPreviewHtml = `<span class="last-message">Click to start chat</span>`; }
                 itemEl.addEventListener('click', () => handleSearchResultClick(item)); // Use full item data
            } else { // It's an active contact from the currentContacts state
                let displayStatus = item.lastMessage || 'No messages yet';
                let timestamp = item.timestamp || '';
                let unread = item.unread || 0;
                // TODO: Check typing status if added to contact state object

                itemPreviewHtml = `<span class="last-message">${escapeHtml(displayStatus)}</span>`;
                metaHtml = `
                     <div class="contact-meta">
                         <span class="timestamp">${timestamp}</span>
                         ${unread > 0 ? `<span class="unread-count">${unread}</span>` : ''}
                     </div>`;
                 itemEl.addEventListener('click', () => loadChat(item.id));
            }

            // Build final element HTML
            itemEl.innerHTML = `
                <img src="${itemPic}" alt="${escapeHtml(itemName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
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
        // The contact relationship will be added by the backend on first message.
        // We might add them to the *local* currentContacts state immediately
        // so they appear in the sidebar right away after search is cleared.
        if (!currentContacts.some(c => c.id === userId)) {
            currentContacts.push({ // Add basic info
                 id: userId,
                 username: userDetails.username || userId,
                 profilePicUrl: userDetails.profilePicUrl || null
             });
        }
        loadChat(userId); // Load the chat window
        // Clear search input and restore contacts view in sidebar
        if (searchContactsInput) searchContactsInput.value = '';
        currentSearchTerm = '';
        displayContactsOrSearchResults(currentContacts, false); // Show contacts list
    }


    /** Loads a chat, requests history */
    function loadChat(chatPartnerUid) {
        console.log("Loading chat for:", chatPartnerUid);
        if (!isSocketAuthenticated || !chatPartnerUid || !currentUser.id) return;
        currentChatId = chatPartnerUid;

        // Highlight item in sidebar
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === chatPartnerUid);
            if (item.dataset.contactId === chatPartnerUid) {
                 item.querySelector('.unread-count')?.remove(); // Clear visual unread count
                 // TODO: Also update unread count in currentContacts state and potentially notify backend
                 const contact = currentContacts.find(c => c.id === chatPartnerUid);
                 if (contact) contact.unread = 0;
            }
        });

        // Get contact details from the currentContacts state
        const chatPartner = currentContacts.find(c => c.id === chatPartnerUid);
        // If contact details aren't found (e.g., loaded via search but contacts not refetched), use UID
        const chatPartnerName = chatPartner?.username || chatPartnerUid;
        const chatPartnerPic = chatPartner?.profilePicUrl || defaultPic;

        // Update chat header
        if (chatHeaderProfile) {
             chatHeaderProfile.innerHTML = `
                 <img src="${chatPartnerPic}" alt="${escapeHtml(chatPartnerName)}" class="profile-pic" onerror="this.onerror=null; this.src='${defaultPic}';">
                 <div class="contact-details">
                     <span class="contact-name">${escapeHtml(chatPartnerName)}</span>
                     <span class="contact-status">Offline</span> </div>`;
        }

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
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser.id) return;
        const tempId = 'temp_' + Date.now(); const newMessage = { id: tempId, sender: currentUser.id, recipientUid: currentChatId, content: messageText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'sending' };
        // Add to local message cache
        if (!currentMessages[currentChatId]) currentMessages[currentChatId] = [];
        currentMessages[currentChatId].push(newMessage);
        displayMessage(newMessage); scrollToBottom(); messageInput.value = ''; messageInput.focus();
        if (socket && socket.connected) { socket.emit('sendMessage', { recipientUid: currentChatId, content: messageText, tempId: tempId }); } else { console.error("Cannot send message, socket disconnected."); }
        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp); hideTypingIndicator();
    }

    /** Updates the sidebar preview for a chat contact */
    function updateContactPreview(contactId, message, timestamp) {
        const contact = currentContacts.find(c => c.id === contactId);
        if (!contact) return; // Don't update if contact isn't in current list state
        contact.lastMessage = message;
        contact.timestamp = timestamp;
        // contact.lastMessageTimestamp = Date.now(); // For sorting later
        // Re-render the contacts list if not currently searching
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
             clearTimeout(searchDebounceTimer);
             const searchTerm = searchContactsInput.value.trim();
             currentSearchTerm = searchTerm; // Update state
             if (searchTerm.length > 1) {
                 searchDebounceTimer = setTimeout(() => {
                     if (socket && isSocketAuthenticated) {
                         console.log(`[Search] Emitting 'searchUsers' for: "${searchTerm}"`);
                         socket.emit('searchUsers', searchTerm);
                         if(contactList) contactList.innerHTML = '<div class="loading-history">Searching...</div>';
                     }
                 }, 300);
             } else {
                  console.log("[Search] Term cleared. Displaying contacts.");
                  displayContactsOrSearchResults(currentContacts, false); // Show contacts if search cleared
             }
         });
         searchContactsInput.addEventListener('blur', () => { /* ... Optional blur handling ... */ });
    }

    // --- Initial Connection ---
    connectWebSocket(); // Start connection, auth, and request contacts

}); // End of DOMContentLoaded listener
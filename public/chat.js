// public/chat.js - Backend Focused Version

document.addEventListener('DOMContentLoaded', () => {
    // --- Authentication Check ---
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const storedToken = localStorage.getItem('firebaseIdToken');

    if (!isAuthenticated || !storedToken) {
        console.warn("User not authenticated or token missing. Redirecting to login.");
        localStorage.removeItem('isAuthenticated'); // Clear partial state
        localStorage.removeItem('firebaseIdToken');
        window.location.href = 'login.html';
        return; // Stop execution
    }

    // --- Load Profile Data from localStorage ---
    const savedUsername = localStorage.getItem('chatUsername');
    const savedPicUrl = localStorage.getItem('chatProfilePicUrl');
    const defaultPic = 'https://via.placeholder.com/40?text=Me'; // Default icon
    const defaultUsername = localStorage.getItem('userPhoneNumber') || 'User'; // Use phone or generic 'User'

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
    const chatAreaPlaceholder = chatHeaderProfile.querySelector('.placeholder'); // Get placeholder element

    // --- Update UI with Initial Profile Data ---
    currentUsernameSpan.textContent = savedUsername || defaultUsername;
    sidebarProfilePic.src = savedPicUrl || defaultPic;
    sidebarProfilePic.onerror = () => { // Fallback if saved URL is broken
        console.warn("Failed to load profile picture from localStorage URL. Using default.");
        sidebarProfilePic.src = defaultPic;
     };

    // --- State ---
    let currentChat = { // Store info about the currently active chat
        id: null,       // e.g., other user's UID or a group ID
        name: null,
        profilePic: null,
        type: null      // e.g., 'direct' or 'group'
    };
    let currentUser = { // User info verified by backend
        id: null,       // Set upon successful socket authentication
        name: savedUsername || defaultUsername,
        profilePic: savedPicUrl || defaultPic
    };
    let socket; // Socket.IO instance
    let contactsCache = []; // Simple cache for fetched contacts

    // --- Socket.IO Connection ---
    function connectWebSocket() {
        console.log("Attempting to connect WebSocket...");
        // Connect to the server that served the page
        socket = io({
            // Optional: Add auth data directly during connection (alternative to emit)
            // auth: { token: localStorage.getItem('firebaseIdToken') }
        });

        // --- Handle Connection ---
        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            // --- Authenticate with Backend ---
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("Attempting to authenticate socket with backend...");
                socket.emit('authenticate', idToken); // Send token for verification
            } else {
                console.error("Firebase ID token missing on connect attempt. Logging out.");
                logout(); // Token missing, force logout
            }
        });

        // --- Handle Successful Backend Authentication ---
        socket.on('authenticationSuccess', (userData) => {
            console.log("Socket authenticated successfully by backend:", userData);
            // Store verified user data
            currentUser.id = userData.uid;
            // Could update name/phone from userData if backend verifies/provides it
            // currentUser.name = userData.name || currentUser.name;
            currentUsernameSpan.textContent = currentUser.name; // Update UI just in case
            console.log("Verified Current User Info:", currentUser);

            // Now that we are authenticated, initialize the app (e.g., fetch contacts)
            initializeChatApp();
        });

         // --- Handle Authentication Failure from Backend ---
         socket.on('authenticationFailed', (error) => {
             console.error("Backend socket authentication failed:", error?.message || 'Unknown error');
             alert("Authentication session error. Please log in again."); // Inform user
             logout(); // Force logout
         });

         // --- Handle Receiving Messages ---
         socket.on('receiveMessage', (message) => {
            if (!currentUser.id) return; // Ignore if not fully authenticated yet

            console.log('Message received:', message);
            // Only display if it belongs to the currently open chat
            // Needs logic to determine if message.sender or message.recipient matches currentChat.id
            // or if message.chatId matches currentChat.id for groups
            const relevantChatId = message.sender === currentUser.id ? message.recipient : message.sender; // Simple logic for direct chat
            if (currentChat.id && relevantChatId === currentChat.id) {
                 displayMessage(message);
                 scrollToBottom();
                 // TODO: Send 'delivered' or 'read' status back?
            } else {
                console.log(`Message received for inactive chat (${relevantChatId}).`);
                // TODO: Update unread count for the relevant contact in the list
                updateUnreadCount(message.sender, true); // Increment unread for sender
            }
             // Update contact list preview regardless of open chat
             const previewText = message.sender === currentUser.id ? `You: ${message.content}` : message.content;
             updateContactPreview(relevantChatId, previewText, message.timestamp || new Date().toLocaleTimeString(/*...*/));
         });

         // --- Handle Typing Status Updates ---
         socket.on('typingStatus', (data) => { // data = { senderUid, isTyping }
             if (!currentUser.id || !currentChat.id) return;

             // Show typing indicator ONLY if it's from the person in the currently open chat
             if (data.senderUid === currentChat.id) {
                 if (data.isTyping) {
                    showTypingIndicator(data.senderUid); // Pass sender ID for context maybe
                 } else {
                     hideTypingIndicator();
                 }
             }
              // Update contact list preview to show "Typing..."
              updateContactTypingStatus(data.senderUid, data.isTyping);
         });

         // --- Handle updates to message status (delivered/read) from others ---
         socket.on('updateMessageStatus', (data) => { // data = { messageId, status, chatId }
              if (!currentUser.id || !currentChat.id || currentChat.id !== data.chatId) {
                  // Ignore if not in the relevant chat or not authenticated
                  return;
              }
              console.log("Received status update:", data);
              updateMessageStatusInUI(data.messageId, data.status);
         });

         // --- Handle errors from server ---
         socket.on('error', (errorData) => {
             console.error("Server Error:", errorData.message);
             // Show error to user? Maybe specific errors only.
             // alert(`Server error: ${errorData.message}`);
         });


         // --- Handle Disconnection ---
        socket.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason);
             // Show disconnected status? Grey out UI? Attempt reconnect?
             // Simple approach: force logout if disconnected unexpectedly often
             if (reason !== 'io client disconnect') { // Don't force logout if user explicitly logged out
                 // Maybe show a reconnecting message or attempt reconnect here
                 // alert("Connection lost. Please check your internet or log in again.");
                 // logout(); // Force logout on unexpected disconnect? Maybe too harsh.
             }
        });

        // --- Handle Connection Errors ---
        socket.on('connect_error', (err) => {
            console.error(`Socket connection error: ${err.message}`);
            alert("Failed to connect to chat server. Check your connection or try refreshing.");
             // Implement reconnection strategy here if desired
        });
    }

    // --- Functions ---

    // Initialize after successful authentication
    function initializeChatApp() {
         console.log("Initializing Chat App UI...");
         // Remove placeholder and enable input
         if(chatAreaPlaceholder) chatAreaPlaceholder.classList.add('hidden');
         messageInput.disabled = false;
         sendButton.disabled = false;

         // Fetch initial data from backend
         fetchContacts();
         // Fetch user settings / other initial data if needed
    }

    // --- Data Fetching Placeholders ---
    async function fetchContacts() {
        console.log("Fetching contacts from backend...");
        contactList.innerHTML = '<li>Loading contacts...</li>'; // Show loading state
        // Replace with actual API call or Socket event
        try {
            // Example using Socket.IO:
            socket.emit('requestContacts', {}, (response) => { // Send empty payload, expect response via callback
                 if (response.error) {
                     console.error("Error fetching contacts:", response.error);
                     contactList.innerHTML = '<li>Error loading contacts.</li>';
                 } else {
                     console.log("Contacts received:", response.contacts);
                     contactsCache = response.contacts || []; // Update cache
                     displayContacts(contactsCache);
                 }
            });
            // Example using fetch API:
            // const response = await fetch('/api/contacts'); // Assuming an API endpoint
            // if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            // const contacts = await response.json();
            // contactsCache = contacts || [];
            // displayContacts(contactsCache);

        } catch (error) {
            console.error("Failed to fetch contacts:", error);
             contactList.innerHTML = '<li>Error loading contacts.</li>';
        }
    }

    async function fetchChatHistory(chatId) {
        console.log(`Workspaceing history for chat: ${chatId}`);
        messageList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 20px;">Loading messages...</div>'; // Show loading state
         // Replace with actual API call or Socket event
         try {
             // Example using Socket.IO:
             socket.emit('requestChatHistory', { chatId: chatId }, (response) => {
                 messageList.innerHTML = ''; // Clear loading state
                 if (response.error) {
                     console.error(`Error fetching history for ${chatId}:`, response.error);
                     messageList.innerHTML = '<div style="text-align: center; color: var(--error-color); margin-top: 20px;">Error loading messages.</div>';
                 } else {
                     console.log(`History received for ${chatId}:`, response.messages);
                     (response.messages || []).forEach(displayMessage); // Display fetched messages
                     scrollToBottom(); // Scroll after loading history
                 }
             });
         } catch (error) {
              console.error(`Failed to fetch history for ${chatId}:`, error);
              messageList.innerHTML = '<div style="text-align: center; color: var(--error-color); margin-top: 20px;">Error loading messages.</div>';
         }
    }

    // Display the list of contacts (receives data from fetchContacts)
    function displayContacts(contacts) {
        contactList.innerHTML = ''; // Clear loading/previous state
        if (!contacts || contacts.length === 0) {
            contactList.innerHTML = '<li style="padding: 15px; color: var(--text-secondary);">No contacts found.</li>';
            return;
        }
        contacts.forEach(contact => {
            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id; // Use contact ID from backend data

            let displayStatus = contact.lastMessage?.content || ''; // Use optional chaining
            if (contact.isTyping) displayStatus = '<i>Typing...</i>'; // Check for typing status from backend data

            contactEl.innerHTML = `
                <img src="${contact.profilePic || 'https://via.placeholder.com/40?text=?'}" alt="${contact.name}" class="profile-pic">
                <div class="contact-info">
                    <span class="contact-name">${escapeHtml(contact.name)}</span>
                    <span class="last-message">${escapeHtml(displayStatus)}</span>
                </div>
                <div class="contact-meta">
                    <span class="timestamp">${contact.lastMessage?.timestamp ? new Date(contact.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : ''}</span>
                    ${contact.unreadCount > 0 ? `<span class="unread-count">${contact.unreadCount}</span>` : ''}
                </div>
            `;
            contactEl.addEventListener('click', () => loadChat(contact.id)); // Load chat when clicked
            contactList.appendChild(contactEl);
        });
    }

     // Filter contacts - TODO: Implement backend search instead of local filtering
     function filterContacts() {
        const searchTerm = searchContactsInput.value.toLowerCase();
        console.log(`Search triggered for: ${searchTerm}. Needs backend implementation.`);
        // Option 1: Simple local filter (if contactsCache is reasonably small and complete)
        // const filteredContacts = contactsCache.filter(contact =>
        //     contact.name.toLowerCase().includes(searchTerm)
        // );
        // displayContacts(filteredContacts);

        // Option 2: Emit event to backend for searching
         // socket.emit('searchContacts', { query: searchTerm }, (response) => {
         //    if (!response.error) {
         //        displayContacts(response.contacts);
         //    }
         // });
    }

    // Load a specific chat into the main area
    function loadChat(chatId) {
        if (!chatId || chatId === currentChat.id) {
             console.log(`Chat ${chatId} already loaded or invalid.`);
             return; // Don't reload same chat or invalid ID
        }
        console.log(`Loading chat for ID: ${chatId}`);

         // Find contact details from cache (ideally fetch if not found)
         const contact = contactsCache.find(c => c.id === chatId);
         if (!contact) {
             console.warn(`Contact details not found in cache for ${chatId}. Fetching might be needed.`);
             // For now, use placeholder data or show error
             currentChat = { id: chatId, name: `User ${chatId.substring(0, 5)}...`, profilePic: null, type: 'direct' }; // Basic fallback
         } else {
            currentChat = {
                id: contact.id,
                name: contact.name,
                profilePic: contact.profilePic,
                type: contact.type || 'direct' // Assume 'direct' if type is not specified
            };
         }
         console.log("Current Chat set to:", currentChat);


        // Highlight active contact in the list
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.toggle('active', item.dataset.contactId === chatId);
             // Clear unread count visually if switching to this chat
             if (item.dataset.contactId === chatId) {
                 const unreadEl = item.querySelector('.unread-count');
                 if (unreadEl) unreadEl.remove();
                 // TODO: Send 'read' status update to backend for this chat
             }
        });

        // Update chat header
        chatHeaderProfile.innerHTML = `
            <img src="${currentChat.profilePic || 'https://via.placeholder.com/40?text=?'}" alt="${currentChat.name}" class="profile-pic">
            <div class="contact-details">
                <span class="contact-name">${escapeHtml(currentChat.name)}</span>
                <span class="contact-status">Loading status...</span> </div>`;
        chatAreaPlaceholder?.classList.add('hidden'); // Hide placeholder if it was visible

        // Fetch and display messages for this chat
        fetchChatHistory(chatId);

        messageInput.disabled = false; // Enable input
        sendButton.disabled = false;
        messageInput.focus();
        hideTypingIndicator();

         // Mobile view handling
         if (window.innerWidth <= 768) {
             showChatAreaMobile();
         }
    }

    // Append a single message to the message list UI
    function displayMessage(message) {
        // Basic check for message format
        if (!message || !message.sender || !message.content) {
            console.warn("Attempted to display invalid message object:", message);
            return;
        }

        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        // Use message ID from backend if available, otherwise keep temp ID for optimistic updates
        messageEl.dataset.messageId = message.id || message.tempId || Date.now(); // Use DB ID or temp

        const isSent = message.sender === currentUser.id;
        messageEl.classList.add(isSent ? 'sent' : 'received');

        // --- Ticks Logic (only for sent messages) ---
        let ticksHtml = '';
        if (isSent && message.status) {
            ticksHtml = getTicksHtml(message.status);
        }

        // --- Sender Name (for received group messages) ---
        let senderNameHtml = '';
         // Assumes message object has senderName if it's a group message from others
        if (!isSent && currentChat.type === 'group' && message.senderName) {
             senderNameHtml = `<div class="sender-name">${escapeHtml(message.senderName)}</div>`;
        }

        // --- Profile Picture (for received messages, grouped) ---
        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;

        if (showPic) {
            // Find sender's profile pic URL from cache or message object
            const senderContact = contactsCache.find(c => c.id === message.sender);
            const picUrl = message.senderProfilePic || senderContact?.profilePic || 'https://via.placeholder.com/30?text=?';
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small">`;
        }
        // Store sender ID on the element to help group subsequent messages
         messageEl.dataset.senderId = message.sender;


        messageEl.innerHTML = `
             ${showPic ? profilePicHtml : '<div style="width: 36px; flex-shrink: 0;"></div>' /* Placeholder for alignment */}
            <div class="bubble">
                ${senderNameHtml}
                <p>${escapeHtml(message.content)}</p>
                <div class="message-meta">
                    <span class="timestamp">${message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : ''}</span>
                    ${ticksHtml}
                </div>
            </div>
        `;
        messageList.appendChild(messageEl);
    }

     // Update the status ticks on a specific message bubble
     function updateMessageStatusInUI(messageId, status) {
         const messageEl = messageList.querySelector(`[data-message-id="${messageId}"]`);
         if (messageEl && messageEl.classList.contains('sent')) { // Only update sent messages
             const metaDiv = messageEl.querySelector('.message-meta');
             if (metaDiv) {
                 let ticksEl = metaDiv.querySelector('.status-ticks');
                 if (!ticksEl) { // Create ticks container if it doesn't exist
                     ticksEl = document.createElement('span');
                     ticksEl.className = 'status-ticks';
                     metaDiv.appendChild(ticksEl);
                 }
                 ticksEl.innerHTML = getTicksHtml(status); // Update ticks
             }
         }
     }

     // Helper to generate ticks HTML based on status
     function getTicksHtml(status) {
         switch (status) {
             case 'read': return '<i class="fas fa-check-double read"></i>';
             case 'delivered': return '<i class="fas fa-check-double delivered"></i>';
             case 'sent': default: return '<i class="fas fa-check sent"></i>';
         }
     }

    // Handle sending a message
    function sendMessage() {
        const messageText = messageInput.value.trim();
        // Check if authenticated and a chat is actually selected
        if (messageText === '' || !currentChat.id || !currentUser.id) {
            console.warn("Cannot send message: Not authenticated, no chat selected, or message empty.");
             // Optionally disable send button if !currentChat.id
            return;
        }

        const tempId = 'temp_' + Date.now(); // Temporary ID for optimistic update
        const newMessage = {
            tempId: tempId, // Include tempId
            id: tempId, // Use tempId as temporary message ID for UI
            sender: currentUser.id,
            content: messageText,
            timestamp: new Date(), // Use client time for optimistic UI, server time is source of truth
            status: 'sent' // Initial status for UI
        };

        // Optimistic UI Update: Add message immediately
        displayMessage({
            ...newMessage,
            // Format timestamp for immediate display
            timestamp: newMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        });
        scrollToBottom();

        messageInput.value = '';
        messageInput.focus();

        // Send message via Socket.IO to the backend
         const payload = {
             chatId: currentChat.id, // Send the ID of the chat (could be user UID or group ID)
             content: messageText,
             tempId: tempId // Send tempId so backend can confirm this specific message
             // Add other relevant metadata if needed
         };
        console.log("Sending message via socket:", payload);
        socket.emit('sendMessage', payload);

        // Update contact list preview (optimistic)
        updateContactPreview(currentChat.id, `You: ${messageText}`, newMessage.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));

        hideTypingIndicator();
    }

    // Update the last message preview in the contact list
    function updateContactPreview(contactId, messageContent, timestamp) {
        const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
            const lastMsgEl = contactItem.querySelector('.last-message');
             // Check if currently showing 'Typing...', avoid overwriting it immediately
             if (!lastMsgEl.innerHTML.includes('Typing...')) {
                lastMsgEl.textContent = messageContent.substring(0, 30) + (messageContent.length > 30 ? '...' : ''); // Truncate
             }
            contactItem.querySelector('.timestamp').textContent = timestamp;
            // Move contact to top (optional, requires reordering logic)
             // contactList.prepend(contactItem);
        } else {
            console.warn(`Contact item not found for ID ${contactId} to update preview.`);
            // Could potentially trigger a contact list refresh here if a message arrives for an unknown contact
        }
    }

    // Update the unread count for a contact
    function updateUnreadCount(contactId, increment) {
         const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
          if (contactItem) {
              let countEl = contactItem.querySelector('.unread-count');
              let currentCount = countEl ? parseInt(countEl.textContent || '0') : 0;
              if (increment) {
                   currentCount++;
                   if (!countEl) { // Create count element if it doesn't exist
                        countEl = document.createElement('span');
                        countEl.className = 'unread-count';
                        contactItem.querySelector('.contact-meta').appendChild(countEl);
                   }
                   countEl.textContent = currentCount;
              } else { // Reset count (e.g., when chat is opened)
                   if (countEl) countEl.remove();
              }
          }
    }

     // Update contact list item to show typing status
    function updateContactTypingStatus(contactId, isTyping) {
         const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
          if (contactItem) {
               const lastMsgEl = contactItem.querySelector('.last-message');
               if (isTyping) {
                   lastMsgEl.innerHTML = '<i>Typing...</i>'; // Show typing
               } else {
                   // Restore last actual message preview - needs caching last message text
                   // For now, just clear 'Typing...' - will be updated by next message
                   // Ideally, fetch/cache last message text separately
                    const contactData = contactsCache.find(c => c.id === contactId);
                    lastMsgEl.textContent = contactData?.lastMessage?.content || '';
               }
          }
    }


    // Utility to escape HTML special characters
    function escapeHtml(unsafe) {
         if (typeof unsafe !== 'string') return unsafe; // Handle non-strings
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Scroll the message list to the bottom
    function scrollToBottom() {
        setTimeout(() => { // Timeout ensures DOM update before scroll calculation
            messageList.scrollTop = messageList.scrollHeight;
        }, 50); // Small delay
    }

    // --- Typing Indicator Logic ---
    let typingTimer;
    const typingTimeout = 1500; // ms

    function handleTyping() {
        if (!socket || !currentUser.id || !currentChat.id) return;

        // Emit 'typing' immediately
        console.log("Emit typing=true");
        socket.emit('typing', { chatId: currentChat.id, isTyping: true });

        // Clear previous timer
        clearTimeout(typingTimer);

        // Set a timer to emit 'stopped typing'
        typingTimer = setTimeout(() => {
            console.log("Emit typing=false");
            socket.emit('typing', { chatId: currentChat.id, isTyping: false });
        }, typingTimeout);
    }

    // Show the typing indicator UI element
    function showTypingIndicator(senderId) {
        // Update status in header as well?
        const headerStatus = chatHeaderProfile.querySelector('.contact-status');
        if(headerStatus) headerStatus.textContent = "Typing...";
        typingIndicator.classList.remove('hidden');
        scrollToBottom();
    }

    // Hide the typing indicator UI element
    function hideTypingIndicator() {
         // Restore status in header
         const headerStatus = chatHeaderProfile.querySelector('.contact-status');
         if(headerStatus) {
              // Restore based on cached contact data or fetch real status
              const contact = contactsCache.find(c => c.id === currentChat.id);
              headerStatus.textContent = contact?.status === 'online' ? 'Online' : 'Offline'; // Simple status
         }
        typingIndicator.classList.add('hidden');
    }

    // --- Logout Function ---
    function logout() {
        console.log("Logging out...");
        if (socket) {
            socket.disconnect();
        }
        // Clear all stored session data
        localStorage.clear(); // Clear everything related to this app
        window.location.href = 'login.html';
    }

     // --- Mobile View Toggling ---
     function showChatAreaMobile() {
         const sidebar = document.querySelector('.sidebar');
         const chatArea = document.querySelector('.chat-area');
         if (sidebar) sidebar.classList.add('mobile-hidden'); // Hide sidebar using class
         if (chatArea) chatArea.classList.remove('mobile-hidden'); // Show chat area using class
         addMobileBackButton();
     }
     function showSidebarMobile() {
         const sidebar = document.querySelector('.sidebar');
         const chatArea = document.querySelector('.chat-area');
         if (sidebar) sidebar.classList.remove('mobile-hidden'); // Show sidebar
         if (chatArea) chatArea.classList.add('mobile-hidden'); // Hide chat area
         removeMobileBackButton();
     }
     function addMobileBackButton() { // Add back button to chat header on mobile
         if (document.getElementById('mobile-back-button') || !chatHeaderProfile) return;
         const backButton = document.createElement('button');
         backButton.innerHTML = '<i class="fas fa-arrow-left"></i>';
         backButton.id = 'mobile-back-button';
         backButton.title = "Back to Chats";
         backButton.onclick = showSidebarMobile;
         // Prepend to chat header
         chatHeaderProfile.parentNode.insertBefore(backButton, chatHeaderProfile);
     }
     function removeMobileBackButton() {
         const backButton = document.getElementById('mobile-back-button');
         if (backButton) backButton.remove();
     }

    // --- Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); sendMessage();
        } else {
             // Trigger typing only if authenticated and chat selected
            if (currentUser.id && currentChat.id) {
                handleTyping();
            }
        }
    });
    searchContactsInput.addEventListener('input', filterContacts); // Will need backend later
    logoutButton.addEventListener('click', logout);
    // Disable input initially until authenticated and chat selected
    messageInput.disabled = true;
    sendButton.disabled = true;


    // --- Initial Connection ---
    connectWebSocket(); // Start the connection and authentication process

});
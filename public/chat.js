// public/chat.js - Full Version with SVG Default Pic & Debug Logging

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
    // Use a self-contained SVG Data URI for the default picture to avoid external DNS errors
    const defaultPic = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik0yMCAyNUMxNy4zMSAyNSAxNSAyNy4zMSAxNSAzMEMxNSA2LjIgNCAzIDM3LjYyIDMwIDM3LjYyIDM0LjM0IDM3LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDI1LjYyIDI1LjYyIDM0LjM0IDE1LjYyIDMwIDMwIDM3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDI1IDI1IDIwIDI1IiBmaWxsPSIjYWFhIi8+PC9zdmc+'; // Simple grey circle SVG placeholder
    // Use phone number from login if available, else a generic default
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
    if (sidebarProfilePic) sidebarProfilePic.src = defaultPic; // Use the new SVG default
    if (sidebarProfilePic) sidebarProfilePic.onerror = () => { sidebarProfilePic.src = defaultPic; };


    // --- State ---
    let currentChatId = null;
    let currentUser = { // Will be updated by server after auth
        id: null,
        name: defaultUsername, // Start with default
        profilePic: defaultPic   // Start with default
    };
    let socket = null; // Socket instance for this page
    let isSocketAuthenticated = false; // Track socket auth state

    // --- Socket.IO Connection ---
    function connectWebSocket() {
        console.log("Attempting to connect WebSocket...");
        if (socket && socket.connected) {
            console.log("WebSocket already connected.");
            return;
        }

        socket = io({
            // reconnectionAttempts: 5, // Optional: Configure reconnection
        });

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            const idToken = localStorage.getItem('firebaseIdToken');
            if (idToken) {
                console.log("Attempting to authenticate socket with backend...");
                socket.emit('authenticate', idToken);
            } else {
                console.error("Firebase ID token missing on connect event. Logging out.");
                logout();
            }
        });

        socket.on('authenticationSuccess', (userData) => {
            isSocketAuthenticated = true; // Mark socket as authenticated
            console.log("-----------------------------------------");
            console.log(">>> CHAT PAGE: 'authenticationSuccess' received!");
            console.log(">>> Payload received from backend:", JSON.stringify(userData, null, 2)); // Pretty print

            // --- Use profile data STRICTLY FROM BACKEND ---
            currentUser.id = userData.uid;
            currentUser.name = userData.username || defaultUsername; // Use DB value or default
            currentUser.profilePic = userData.profilePicUrl || defaultPic; // Use DB value or SVG default

            console.log(">>> CHAT PAGE: Updated internal 'currentUser' object:", currentUser);

            // --- Attempt to Update UI ---
            console.log(">>> CHAT PAGE: Attempting to find UI elements...");
            // Re-fetch elements within the handler to be sure they exist now
            const nameSpan = document.getElementById('current-user-name');
            const picImg = document.getElementById('sidebar-profile-pic');
            console.log(">>> CHAT PAGE: Found nameSpan element:", nameSpan ? 'Yes' : 'No');
            console.log(">>> CHAT PAGE: Found picImg element:", picImg ? 'Yes' : 'No');

            if (nameSpan) {
                console.log(`>>> CHAT PAGE: BEFORE setting textContent: Current text is "${nameSpan.textContent}"`);
                try {
                    nameSpan.textContent = currentUser.name;
                    console.log(`>>> CHAT PAGE: SUCCESSFULLY set nameSpan.textContent to: "${currentUser.name}"`);
                    // Verify immediately after setting
                     console.log(`>>> CHAT PAGE: VERIFY nameSpan.textContent is now: "${nameSpan.textContent}"`);
                } catch (e) {
                    console.error(">>> CHAT PAGE: ERROR setting nameSpan.textContent:", e);
                }
            } else {
                console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'current-user-name'");
            }

            if (picImg) {
                 console.log(`>>> CHAT PAGE: BEFORE setting src: Current src is "${picImg.src}"`);
                // Clear previous onerror handler before setting new src
                picImg.onerror = null;
                try {
                    let newSrc = currentUser.profilePic; // Contains DB URL or SVG default
                    picImg.src = newSrc;
                     console.log(`>>> CHAT PAGE: SUCCESSFULLY set picImg.src to: "${newSrc}"`);
                     // Verify immediately after setting
                     console.log(`>>> CHAT PAGE: VERIFY picImg.src is now: "${picImg.src}"`);

                     // Re-attach onerror AFTER setting src
                     picImg.onerror = () => {
                         console.warn(">>> CHAT PAGE: onerror triggered! Error loading profile pic src:", newSrc, ". Reverting to SVG default.");
                         picImg.src = defaultPic; // Use SVG default on error
                     };
                 } catch (e) {
                      console.error(">>> CHAT PAGE: ERROR setting picImg.src:", e);
                 }

            } else {
                 console.error(">>> CHAT PAGE: FATAL! Cannot find element with ID 'sidebar-profile-pic'");
            }
            console.log(">>> CHAT PAGE: UI update attempts finished.");
            console.log("-----------------------------------------");

            // Initialize chat list etc. AFTER auth is successful and UI updated
            initializeChatApp();
        });

        socket.on('authenticationFailed', (error) => {
            isSocketAuthenticated = false;
            console.error("Backend socket authentication failed:", error?.message || 'Unknown error');
            alert("Authentication session error. Please log in again.");
            logout();
        });

        socket.on('receiveMessage', (message) => {
            if (!isSocketAuthenticated) return; // Ignore if socket isn't authed
            console.log('Message received:', message);
            displayMessage(message);
            scrollToBottom();
        });

        socket.on('typingStatus', (data) => {
            if (!isSocketAuthenticated || !currentUser.id || data.senderUid === currentUser.id) return;
            if (data.senderUid === currentChatId) {
                if (data.isTyping) { showTypingIndicator(); }
                else { hideTypingIndicator(); }
            }
        });

        socket.on('messageSentConfirmation', (data) => {
            if (!isSocketAuthenticated) return;
            console.log("Server confirmed message:", data);
            // TODO: Update message status tick in UI
        });

        socket.on('disconnect', (reason) => {
            isSocketAuthenticated = false;
            console.warn('Socket disconnected:', reason);
            // TODO: Show disconnected UI state
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
        // Display contacts (replace sampleContacts with fetched data later)
        displayContacts(sampleContacts);
         setupMobileView();
    }

    function displayContacts(contacts) {
        if (!contactList) return; // Guard against element not found
        contactList.innerHTML = ''; // Clear existing list
        contacts.forEach(contact => {
            const contactEl = document.createElement('div');
            contactEl.classList.add('contact-item');
            contactEl.dataset.contactId = contact.id;

            let displayStatus = contact.lastMessage || '';
            if (contact.status === 'typing') displayStatus = '<i>Typing...</i>';

            contactEl.innerHTML = `
                <img src="${contact.profilePic || defaultPic}" alt="${escapeHtml(contact.name)}" class="profile-pic">
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
        const searchTerm = searchContactsInput.value.toLowerCase();
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
        currentChatId = contactId;

        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.contactId === contactId) {
                item.classList.add('active');
                const unreadEl = item.querySelector('.unread-count');
                if (unreadEl) unreadEl.remove();
            }
        });

        const contact = sampleContacts.find(c => c.id === contactId);
        if (!contact || !chatHeaderProfile) return; // Guard clause

        // Update chat header
        chatHeaderProfile.innerHTML = `
            <img src="${contact.profilePic || defaultPic}" alt="${escapeHtml(contact.name)}" class="profile-pic">
            <div class="contact-details">
                <span class="contact-name">${escapeHtml(contact.name)}</span>
                <span class="contact-status">${contact.status === 'online' ? 'Online' : (contact.status === 'typing' ? 'Typing...' : 'Offline')}</span>
            </div>`;

        // Load and display messages (Replace sampleMessages with fetched data later)
        messageList.innerHTML = '';
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
        const isSent = currentUser?.id && message.sender === currentUser.id;
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', isSent ? 'sent' : 'received');
        messageEl.dataset.messageId = message.id;
        messageEl.dataset.senderId = message.sender;

        let ticksHtml = '';
        if (isSent && message.status) {
            ticksHtml = '<span class="status-ticks">';
            switch (message.status) {
                case 'read': ticksHtml += '<i class="fas fa-check-double read"></i>'; break;
                case 'delivered': ticksHtml += '<i class="fas fa-check-double delivered"></i>'; break;
                case 'sent': default: ticksHtml += '<i class="fas fa-check sent"></i>'; break;
            }
            ticksHtml += '</span>';
        }

        let senderNameHtml = '';
        if (!isSent && message.senderName) {
             senderNameHtml = `<div class="sender-name">${escapeHtml(message.senderName)}</div>`;
        }

        let profilePicHtml = '';
        const previousMsgEl = messageList.lastElementChild;
        const previousSender = previousMsgEl?.classList.contains('received') ? previousMsgEl.dataset.senderId : null;
        const showPic = !isSent && message.sender !== previousSender;
        if (showPic) {
            const senderContact = sampleContacts.find(c => c.id === message.sender);
            const picUrl = senderContact?.profilePic || defaultPic; // Use SVG default here too
            profilePicHtml = `<img src="${picUrl}" alt="" class="profile-pic-small">`;
        }
        // Use an empty div for alignment if pic isn't shown for received, or if sent
        const alignmentDiv = '<div style="width: 36px; height: 1px; flex-shrink: 0;"></div>';


        messageEl.innerHTML = `
            ${showPic ? profilePicHtml : (!isSent ? alignmentDiv : '')}
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
        if (!messageInput || !sendButton) return; // Guard clauses
        const messageText = messageInput.value.trim();
        if (messageText === '' || !currentChatId || !isSocketAuthenticated || !currentUser?.id) {
            console.warn("Cannot send message: Check auth, chat selection, message content, user ID.");
            return;
        }

        const tempId = 'temp_' + Date.now();
        const newMessage = {
            id: tempId,
            sender: currentUser.id,
            content: messageText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            status: 'sending'
        };

        displayMessage(newMessage); // Optimistic UI update
        scrollToBottom();
        messageInput.value = '';
        messageInput.focus();

        console.log(`Emitting 'sendMessage': Recipient=${currentChatId}, Content=${messageText.substring(0,30)}...`);
        if (socket) {
            socket.emit('sendMessage', {
                recipientUid: currentChatId,
                content: messageText,
                tempId: tempId
            });
        } else {
             console.error("Socket not available to send message.");
             // TODO: Indicate message sending failure in UI?
        }


        updateContactPreview(currentChatId, `You: ${messageText}`, newMessage.timestamp);
        hideTypingIndicator();
    }

    function updateContactPreview(contactId, message, timestamp) {
         if (!contactList) return;
         const contactItem = contactList.querySelector(`.contact-item[data-contact-id="${contactId}"]`);
        if (contactItem) {
            const msgElement = contactItem.querySelector('.last-message');
            const tsElement = contactItem.querySelector('.timestamp');
            if (msgElement) msgElement.textContent = message;
            if (tsElement) tsElement.textContent = timestamp;
        }
    }

    function escapeHtml(unsafe) {
         if (typeof unsafe !== 'string') return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
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
            if (socket) socket.emit('typing', { recipientUid: currentChatId, isTyping: false });
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
        if (socket) socket.disconnect();
        localStorage.clear(); // Clear all local storage for clean logout
        window.location.href = 'login.html';
    }

    // --- Mobile View Toggling Functions ---
    function setupMobileView() {
        // Only run if elements exist
        const sidebar = document.querySelector('.sidebar');
        const chatArea = document.querySelector('.chat-area');
        if (!sidebar || !chatArea) return;

        if (window.innerWidth <= 768) {
            showSidebarMobile();
        } else {
             sidebar.classList.remove('mobile-hidden');
             chatArea.classList.remove('mobile-hidden');
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
        backButton.className = 'mobile-back-button'; // Add class for styling if needed
        backButton.title = "Back to Chats";
        backButton.onclick = showSidebarMobile;
        const contactProfileDiv = chatHeader.querySelector('.contact-profile');
         if (contactProfileDiv) chatHeader.insertBefore(backButton, contactProfileDiv);
         else chatHeader.prepend(backButton);
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
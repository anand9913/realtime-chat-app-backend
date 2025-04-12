// public/profile.js - Establishes own Socket connection
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const profileForm = document.getElementById('profile-form');
    const usernameInput = document.getElementById('username');
    const profilePicUrlInput = document.getElementById('profile-pic-url');
    const profilePicPreview = document.getElementById('profile-pic-preview');
    const saveButton = document.getElementById('save-profile-button');
    const saveConfirmation = document.getElementById('save-confirmation');
    const profilePicError = document.getElementById('profile-pic-error');
    const connectionStatus = document.getElementById('connection-status'); // Get status element

    const defaultProfilePic = 'https://via.placeholder.com/150?text=?';

    // --- State ---
    let socket = null; // Socket instance for THIS page
    let isAuthenticated = false; // Track if this page's socket is authenticated

    // --- Show Connection/Auth Status ---
    function showStatus(message, isError = false) {
        if (connectionStatus) {
             connectionStatus.textContent = message;
             connectionStatus.style.color = isError ? 'var(--error-color)' : 'var(--text-secondary)';
             connectionStatus.classList.remove('hidden');
        }
        saveButton.disabled = !isAuthenticated; // Disable save if not authenticated
    }
    function hideStatus() {
        if (connectionStatus) connectionStatus.classList.add('hidden');
         saveButton.disabled = !isAuthenticated; // Re-evaluate save button state
    }

    // --- Connect and Authenticate Socket ---
    function connectAndAuthenticate() {
        const idToken = localStorage.getItem('firebaseIdToken');
        if (!idToken) {
            console.error("No Firebase ID Token found. Cannot authenticate profile page connection.");
            showStatus("Authentication error. Please go back and log in again.", true);
            // Maybe redirect? window.location.href = 'login.html';
            return;
        }

        showStatus("Connecting to server...");

        // Establish new connection for this page
        socket = io();

        socket.on('connect', () => {
            console.log('Profile page socket connected:', socket.id);
            showStatus("Authenticating...");
            // Authenticate this new connection
            socket.emit('authenticate', idToken);
        });

        socket.on('authenticationSuccess', (userData) => {
            console.log("Profile page socket authenticated successfully:", userData);
            isAuthenticated = true;
            hideStatus(); // Hide status message, enable save button
             // Optionally update form fields if backend sends fresh data
             // usernameInput.value = userData.username || '';
             // profilePicUrlInput.value = userData.profilePicUrl || '';
             // updatePreview();
        });

        socket.on('authenticationFailed', (error) => {
            console.error("Profile page socket authentication failed:", error?.message);
            isAuthenticated = false;
            showStatus(`Authentication failed: ${error?.message || 'Unknown error'}. Please login again.`, true);
            socket?.disconnect(); // Disconnect on failure
        });

        socket.on('disconnect', (reason) => {
            console.warn("Profile page socket disconnected:", reason);
            isAuthenticated = false;
            showStatus("Disconnected from server. Cannot save.", true);
        });

        socket.on('connect_error', (err) => {
            console.error(`Profile page socket connection error: ${err.message}`);
            isAuthenticated = false;
            showStatus("Connection error. Cannot save.", true);
        });

         // Listen for profile update results specific to THIS socket connection
         socket.on('profileUpdateSuccess', handleUpdateSuccess);
         socket.on('profileUpdateError', handleUpdateError);
    }


    // --- Load existing profile data (from localStorage as initial state) ---
    function loadProfileData() {
        const savedUsername = localStorage.getItem('chatUsername');
        const savedPicUrl = localStorage.getItem('chatProfilePicUrl');
        if (savedUsername) usernameInput.value = savedUsername;
        if (savedPicUrl) profilePicUrlInput.value = savedPicUrl;
        profilePicPreview.src = savedPicUrl || defaultProfilePic;
         profilePicError.classList.add('hidden');
    }

    // --- Update image preview on URL input ---
    function updatePreview() {
        const newUrl = profilePicUrlInput.value.trim();
        profilePicError.classList.add('hidden');
        if (newUrl) {
            profilePicPreview.src = newUrl;
        } else {
            profilePicPreview.src = defaultProfilePic;
        }
    }

    // --- Handle image loading errors ---
    profilePicPreview.onerror = function() {
        console.warn("Failed to load image from URL:", profilePicUrlInput.value);
        profilePicError.classList.remove('hidden');
        profilePicPreview.src = defaultProfilePic;
    };

    // --- Save profile data (Send to Backend via this page's socket) ---
    function saveProfile(event) {
        event.preventDefault();
        // Check if socket exists for this page and is connected & authenticated
        if (!socket || !socket.connected || !isAuthenticated) {
             showStatus("Not connected or authenticated. Cannot save.", true);
             return;
        }

        const newUsername = usernameInput.value.trim();
        const newPicUrl = profilePicUrlInput.value.trim();

        if (!newUsername) {
            alert("Username cannot be empty.");
            usernameInput.focus();
            return;
        }

        console.log("Emitting 'updateProfile' via profile page socket:", { username: newUsername, profilePicUrl: newPicUrl });
        showLoading(saveButton, "Saving...");
        saveConfirmation.classList.add('hidden');
        hideStatus(); // Hide connection status while saving

        // Emit the event using the locally established socket
        socket.emit('updateProfile', {
            username: newUsername,
            profilePicUrl: newPicUrl
        });

         // Optional timeout for server response
         const timeoutId = setTimeout(() => {
             if (saveButton.disabled && saveButton.textContent === 'Saving...') {
                 handleUpdateError({ message: "Request timed out. Server might be busy."});
             }
         }, 10000); // 10 second timeout

         // Clear timeout if response received
         socket.once('profileUpdateSuccess', () => clearTimeout(timeoutId));
         socket.once('profileUpdateError', () => clearTimeout(timeoutId));
    }

    // --- Handlers for server response ---
    function handleUpdateSuccess(updatedData) {
        console.log("Profile update confirmed by server:", updatedData);
        hideLoading(saveButton, "Save Profile");
        saveConfirmation.textContent = "Profile saved successfully!";
        saveConfirmation.style.color = 'var(--success-color)';
        saveConfirmation.classList.remove('hidden');
        profilePicError.classList.add('hidden');

        // Update localStorage cache AFTER successful save
        localStorage.setItem('chatUsername', updatedData.username || '');
        localStorage.setItem('chatProfilePicUrl', updatedData.profilePicUrl || '');

        // Update preview/form with confirmed data
        usernameInput.value = updatedData.username || '';
        profilePicUrlInput.value = updatedData.profilePicUrl || '';
        profilePicPreview.src = updatedData.profilePicUrl || defaultProfilePic;


        setTimeout(() => saveConfirmation.classList.add('hidden'), 3000);
    }

    function handleUpdateError(error) {
        console.error("Server reported profile update error:", error);
        hideLoading(saveButton, "Save Profile");
        showStatus(`Error saving: ${error.message || 'Unknown server error'}`, true); // Show error in status area
    }

    // --- UI Helper Functions ---
     function showLoading(buttonElement, loadingText) {
        buttonElement.disabled = true;
        if (!buttonElement.dataset.originalText) {
             buttonElement.dataset.originalText = buttonElement.textContent;
        }
        buttonElement.textContent = loadingText;
    }
    function hideLoading(buttonElement, defaultText) {
        // Only re-enable if authenticated
        buttonElement.disabled = !isAuthenticated;
        buttonElement.textContent = buttonElement.dataset.originalText || defaultText;
    }

    // --- Event Listeners ---
    profilePicUrlInput.addEventListener('input', updatePreview);
    profileForm.addEventListener('submit', saveProfile);

    // --- Initial Load ---
    loadProfileData(); // Load cached data into form
    connectAndAuthenticate(); // Establish connection and authenticate this page

    // Clean up socket connection when user navigates away
    window.addEventListener('beforeunload', () => {
        if (socket) {
             console.log("Disconnecting profile page socket on unload.");
              // Remove specific listeners to avoid memory leaks if socket persists somehow
              socket.off('profileUpdateSuccess', handleUpdateSuccess);
              socket.off('profileUpdateError', handleUpdateError);
              socket.disconnect();
        }
    });

}); // End of DOMContentLoaded listener
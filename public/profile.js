// public/profile.js - Complete version without localStorage for profile data

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const profileForm = document.getElementById('profile-form');
    const usernameInput = document.getElementById('username');
    const profilePicUrlInput = document.getElementById('profile-pic-url');
    const profilePicPreview = document.getElementById('profile-pic-preview');
    const saveButton = document.getElementById('save-profile-button');
    const saveConfirmation = document.getElementById('save-confirmation');
    const profilePicError = document.getElementById('profile-pic-error');
    const connectionStatus = document.getElementById('connection-status'); // For showing connection status

    const defaultProfilePic = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik0yMCAyNUMxNy4zMSAyNSAxNSAyNy4zMSAxNSAzMEMxNSA2LjIgNCAzIDM3LjYyIDMwIDM3LjYyIDM0LjM0IDM3LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDI1LjYyIDI1LjYyIDM0LjM0IDE1LjYyIDMwIDMwIDM3LjYyIDM0LjM0IDE1LjYyIDM0LjM0IDE3LjYyIDM0LjM0IDE1LjYyIDI1IDI1IDIwIDI1IiBmaWxsPSIjYWFhIi8+PC9zdmc+'; // Default preview pic

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
        // Keep save button disabled until authenticated successfully
        saveButton.disabled = !isAuthenticated;
    }

    function hideStatus() {
        if (connectionStatus) connectionStatus.classList.add('hidden');
         // Re-evaluate save button state based on authentication
         saveButton.disabled = !isAuthenticated;
    }

    // --- Connect and Authenticate Socket ---
    function connectAndAuthenticate() {
        // Requires Firebase ID token from login page persistence
        const idToken = localStorage.getItem('firebaseIdToken');
        if (!idToken) {
            console.error("No Firebase ID Token found. Cannot authenticate profile page connection.");
            showStatus("Authentication error. Please go back and log in again.", true);
            // Consider redirecting if token is absolutely required and missing
            // window.location.href = 'login.html';
            return;
        }

        showStatus("Connecting to server...");

        // Establish new Socket.IO connection for this page
        // Assumes Socket.IO client library is loaded in profile.html
        try {
             socket = io();
        } catch (err) {
             console.error("Socket.IO connection failed:", err);
             showStatus("Failed to connect to server.", true);
             return;
        }


        socket.on('connect', () => {
            console.log('Profile page socket connected:', socket.id);
            showStatus("Authenticating...");
            // Authenticate this new connection using the stored token
            socket.emit('authenticate', idToken);
        });

        socket.on('authenticationSuccess', (userData) => {
            console.log("Profile page socket authenticated successfully:", userData);
            isAuthenticated = true;
            hideStatus(); // Hide status message, enable save button

            // --- Load initial form values FROM SERVER DATA ---
            console.log("Loading profile data received from server:", userData);
            usernameInput.value = userData.username || ''; // Use data from server payload
            profilePicUrlInput.value = userData.profilePicUrl || ''; // Use data from server payload
            updatePreview(); // Update preview based on server data
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
            // Show persistent disconnected status
            showStatus("Disconnected from server. Cannot save.", true);
            // Disable save button explicitly on disconnect
            saveButton.disabled = true;
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


    // --- Load Initial Form Data (Sets Defaults) ---
    function loadProfileData() {
        // Set default/empty values initially.
        // Actual profile data will be populated by 'authenticationSuccess' event.
        profilePicPreview.src = defaultProfilePic; // Show default pic initially
        profilePicError.classList.add('hidden'); // Hide error initially
        usernameInput.value = ''; // Start empty
        profilePicUrlInput.value = ''; // Start empty
        saveButton.disabled = true; // Start disabled until authenticated
    }

    // --- Update image preview on URL input ---
    function updatePreview() {
        const newUrl = profilePicUrlInput.value.trim();
        profilePicError.classList.add('hidden'); // Hide error initially
        if (newUrl) {
            profilePicPreview.src = newUrl; // Attempt to load the new URL
        } else {
            profilePicPreview.src = defaultProfilePic; // Revert to default if URL is cleared
        }
    }

    // --- Handle image loading errors ---
    profilePicPreview.onerror = function() {
        // This function is called by the browser if the <img> src fails to load
        console.warn("Failed to load image from URL:", profilePicUrlInput.value);
        profilePicError.classList.remove('hidden'); // Show the error message
        profilePicPreview.src = defaultProfilePic; // Revert display to the default image
    };

    // --- Save profile data (Send to Backend via Socket) ---
    function saveProfile(event) {
        event.preventDefault(); // Prevent default form submission

        // Check if socket exists for this page and is connected & authenticated
        if (!socket || !socket.connected || !isAuthenticated) {
             showStatus("Not connected or authenticated. Cannot save.", true);
             return;
        }

        const newUsername = usernameInput.value.trim();
        const newPicUrl = profilePicUrlInput.value.trim();

        // Basic client-side validation
        if (!newUsername) {
            alert("Username cannot be empty.");
            usernameInput.focus();
            return;
        }
        // Optional: More robust URL validation if needed
        // if (newPicUrl && !isValidHttpUrl(newPicUrl)) { // Assuming isValidHttpUrl function exists
        //     alert("Please enter a valid URL for the profile picture (starting with http:// or https://).");
        //     profilePicUrlInput.focus();
        //     return;
        // }

        console.log("Emitting 'updateProfile' to server:", { username: newUsername, profilePicUrl: newPicUrl });
        showLoading(saveButton, "Saving...");
        saveConfirmation.classList.add('hidden'); // Hide previous success/error message
        hideStatus(); // Hide connection status while saving

        // Remove previous listeners to avoid duplicates if user clicks save multiple times quickly
        socket.off('profileUpdateSuccess', handleUpdateSuccess);
        socket.off('profileUpdateError', handleUpdateError);

        // Add listeners for the response to *this specific* save attempt
        socket.once('profileUpdateSuccess', handleUpdateSuccess);
        socket.once('profileUpdateError', handleUpdateError);

        // Emit the event to the server using the locally established socket
        socket.emit('updateProfile', {
            username: newUsername,
            profilePicUrl: newPicUrl
        });

        // Optional: Add a timeout in case server doesn't respond
        const timeoutId = setTimeout(() => {
            // If still in loading state after, e.g., 10 seconds
            if (saveButton.disabled && saveButton.textContent === 'Saving...') {
                handleUpdateError({ message: "Request timed out. Please try again."});
                // Re-attach listeners in case the event arrives late? Maybe not needed.
                // socket.once('profileUpdateSuccess', handleUpdateSuccess);
                // socket.once('profileUpdateError', handleUpdateError);
            }
        }, 10000); // 10 second timeout

        // Clear timeout if response received (handled within success/error handlers now)
        socket.once('profileUpdateSuccess', () => clearTimeout(timeoutId));
        socket.once('profileUpdateError', () => clearTimeout(timeoutId));
    }

    // --- Handlers for server response ---
    function handleUpdateSuccess(updatedData) {
        console.log("Profile update confirmed by server:", updatedData);
        hideLoading(saveButton, "Save Profile"); // Re-enables button if authenticated
        saveConfirmation.textContent = "Profile saved successfully!";
        saveConfirmation.style.color = 'var(--success-color)';
        saveConfirmation.classList.remove('hidden');
        profilePicError.classList.add('hidden'); // Hide pic error on successful save

        // Update form fields and preview with the confirmed data from server
        usernameInput.value = updatedData.username || '';
        profilePicUrlInput.value = updatedData.profilePicUrl || '';
        profilePicPreview.src = updatedData.profilePicUrl || defaultProfilePic;

        // --- REMOVED saving back to localStorage ---

        setTimeout(() => saveConfirmation.classList.add('hidden'), 3000); // Hide success msg after 3s
    }

    function handleUpdateError(error) {
        console.error("Server reported profile update error:", error);
        hideLoading(saveButton, "Save Profile"); // Re-enables button if authenticated
        // Display error message near save button or use alert
        showProfileError(`Error saving: ${error.message || 'Unknown server error'}`);
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
        // Only re-enable the button if the socket is authenticated
        buttonElement.disabled = !isAuthenticated;
        buttonElement.textContent = buttonElement.dataset.originalText || defaultText;
    }

    function showProfileError(message) { // Could display near button
         saveConfirmation.textContent = message;
         saveConfirmation.style.color = 'var(--error-color)'; // Use error color
         saveConfirmation.classList.remove('hidden');
          // Hide error after some time
          setTimeout(() => {
             saveConfirmation.classList.add('hidden');
             // Reset color just in case success message uses same element
             // saveConfirmation.style.color = 'var(--success-color)';
          }, 5000); // Hide after 5 seconds
     }

    // --- Event Listeners ---
    profilePicUrlInput.addEventListener('input', updatePreview);
    profileForm.addEventListener('submit', saveProfile);

    // --- Initial Load ---
    loadProfileData(); // Sets defaults, waits for server auth to populate form
    connectAndAuthenticate(); // Establish connection and authenticate this page

    // --- Cleanup Socket on Page Unload ---
    window.addEventListener('beforeunload', () => {
        if (socket) {
             console.log("Disconnecting profile page socket on unload.");
              // Remove specific listeners to prevent memory leaks if page is cached
              socket.off('profileUpdateSuccess', handleUpdateSuccess);
              socket.off('profileUpdateError', handleUpdateError);
              socket.off('connect');
              socket.off('disconnect');
              socket.off('connect_error');
              socket.off('authenticationSuccess');
              socket.off('authenticationFailed');
              socket.disconnect();
              socket = null; // Help garbage collection
              isAuthenticated = false;
        }
    });

}); // End of DOMContentLoaded listener
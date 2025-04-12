// public/profile.js - Updated to Emit Socket Event
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const profileForm = document.getElementById('profile-form');
    const usernameInput = document.getElementById('username');
    const profilePicUrlInput = document.getElementById('profile-pic-url');
    const profilePicPreview = document.getElementById('profile-pic-preview');
    const saveButton = document.getElementById('save-profile-button');
    const saveConfirmation = document.getElementById('save-confirmation');
    const profilePicError = document.getElementById('profile-pic-error');

    const defaultProfilePic = 'https://via.placeholder.com/150?text=?';

    // --- Access Socket Instance (HACK - Needs Proper State Management) ---
    // This assumes chat.js has exposed the socket instance globally
    const socket = window.socketInstance;
    if (!socket) {
         console.error("Socket instance not found on profile page. Profile saving disabled.");
         // Disable save button maybe?
         // saveButton.disabled = true;
         // saveButton.title = "Cannot connect to server";
         // Or redirect? alert("Connection error. Please go back to chat.");
    } else {
         console.log("Socket instance found on profile page:", socket.id);
          // --- Listen for Server Responses to Profile Update ---
          // Listen *once* per save attempt might be safer, or manage listeners carefully
          socket.on('profileUpdateSuccess', handleUpdateSuccess);
          socket.on('profileUpdateError', handleUpdateError);
          // Clean up listeners when page unloads?
          // window.addEventListener('beforeunload', () => {
          //    socket?.off('profileUpdateSuccess', handleUpdateSuccess);
          //    socket?.off('profileUpdateError', handleUpdateError);
          // });
    }


    // --- Load existing profile data (from localStorage as initial state) ---
    function loadProfileData() {
        const savedUsername = localStorage.getItem('chatUsername'); // Use the cache
        const savedPicUrl = localStorage.getItem('chatProfilePicUrl');
        if (savedUsername) usernameInput.value = savedUsername;
        if (savedPicUrl) profilePicUrlInput.value = savedPicUrl;
        profilePicPreview.src = savedPicUrl || defaultProfilePic;
         profilePicError.classList.add('hidden'); // Hide error on load
    }

    // --- Update image preview on URL input ---
    function updatePreview() {
        const newUrl = profilePicUrlInput.value.trim();
        profilePicError.classList.add('hidden'); // Hide error initially
        if (newUrl) {
            profilePicPreview.src = newUrl; // Attempt to load
        } else {
            profilePicPreview.src = defaultProfilePic; // Revert to default if empty
        }
    }

    // --- Handle image loading errors ---
    profilePicPreview.onerror = function() {
        console.warn("Failed to load image from URL:", profilePicUrlInput.value);
        profilePicError.classList.remove('hidden'); // Show error message
        profilePicPreview.src = defaultProfilePic; // Revert to default image
    };

    // --- Save profile data (Send to Backend) ---
    function saveProfile(event) {
        event.preventDefault();
        if (!socket || !socket.connected) { // Check if socket exists and is connected
             alert("Not connected to server. Cannot save profile.");
             return;
        }

        const newUsername = usernameInput.value.trim();
        const newPicUrl = profilePicUrlInput.value.trim();

        if (!newUsername) {
            alert("Username cannot be empty.");
            usernameInput.focus();
            return;
        }
         // Optional: Basic URL validation on client side
         // try { if(newPicUrl) new URL(newPicUrl); } catch { alert("Invalid Profile Picture URL format."); return; }


        console.log("Emitting 'updateProfile' to server:", { username: newUsername, profilePicUrl: newPicUrl });
        showLoading(saveButton, "Saving...");
        saveConfirmation.classList.add('hidden'); // Hide previous message

        // Emit the event to the server
        socket.emit('updateProfile', {
            username: newUsername,
            profilePicUrl: newPicUrl
        });

         // Remove previous listeners before adding new ones (safer)
         socket.off('profileUpdateSuccess', handleUpdateSuccess);
         socket.off('profileUpdateError', handleUpdateError);
         // Add listeners for the response to *this specific* save attempt
         socket.once('profileUpdateSuccess', handleUpdateSuccess);
         socket.once('profileUpdateError', handleUpdateError);

         // Optional: Add a timeout in case server doesn't respond
         setTimeout(() => {
             // If still in loading state after, e.g., 10 seconds
             if (saveButton.disabled && saveButton.textContent === 'Saving...') {
                 handleUpdateError({ message: "Request timed out. Please try again."});
             }
         }, 10000); // 10 second timeout
    }

    // Handlers for server response (called by socket listeners)
    function handleUpdateSuccess(updatedData) {
        console.log("Profile update confirmed by server:", updatedData);
        hideLoading(saveButton, "Save Profile");
        saveConfirmation.textContent = "Profile saved successfully!";
        saveConfirmation.classList.remove('hidden');
        profilePicError.classList.add('hidden'); // Hide error on success

        // Update localStorage cache AFTER successful save
        localStorage.setItem('chatUsername', updatedData.username || '');
        localStorage.setItem('chatProfilePicUrl', updatedData.profilePicUrl || '');

        // Optionally update preview src again from confirmed data
        profilePicPreview.src = updatedData.profilePicUrl || defaultProfilePic;


        setTimeout(() => saveConfirmation.classList.add('hidden'), 3000);
         // Maybe navigate back automatically?
         // setTimeout(() => { window.location.href = 'chat.html'; }, 1000);
    }

    function handleUpdateError(error) {
        console.error("Server reported profile update error:", error);
        hideLoading(saveButton, "Save Profile");
        // Display error message near save button or use alert
        showProfileError(`Error saving profile: ${error.message || 'Unknown server error'}`);
    }

     // --- UI Helper Functions (Specific to Profile Page) ---
     function showLoading(buttonElement, loadingText) {
        buttonElement.disabled = true;
        if (!buttonElement.dataset.originalText) {
             buttonElement.dataset.originalText = buttonElement.textContent;
        }
        buttonElement.textContent = loadingText;
    }
    function hideLoading(buttonElement, defaultText) {
        buttonElement.disabled = false;
        buttonElement.textContent = buttonElement.dataset.originalText || defaultText;
    }
     function showProfileError(message) { // Could display near button
         saveConfirmation.textContent = message;
         saveConfirmation.style.color = 'var(--error-color)'; // Use error color
         saveConfirmation.classList.remove('hidden');
          // Hide error after some time
          setTimeout(() => {
             saveConfirmation.classList.add('hidden');
             saveConfirmation.style.color = 'var(--success-color)'; // Reset color
          }, 5000);
     }


    // --- Event Listeners ---
    profilePicUrlInput.addEventListener('input', updatePreview);
    profileForm.addEventListener('submit', saveProfile);

    // --- Initial Load ---
    loadProfileData(); // Load from cache initially
});
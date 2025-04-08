document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const profileForm = document.getElementById('profile-form');
    const usernameInput = document.getElementById('username');
    const profilePicUrlInput = document.getElementById('profile-pic-url');
    const profilePicPreview = document.getElementById('profile-pic-preview');
    const saveButton = document.getElementById('save-profile-button');
    const saveConfirmation = document.getElementById('save-confirmation');
    const profilePicError = document.getElementById('profile-pic-error');

    const defaultProfilePic = 'https://via.placeholder.com/150?text=?'; // Default/fallback image

    // --- Load existing profile data ---
    function loadProfileData() {
        const savedUsername = localStorage.getItem('chatUsername');
        const savedPicUrl = localStorage.getItem('chatProfilePicUrl');

        if (savedUsername) {
            usernameInput.value = savedUsername;
        }
        if (savedPicUrl) {
            profilePicUrlInput.value = savedPicUrl;
            profilePicPreview.src = savedPicUrl;
        } else {
            profilePicPreview.src = defaultProfilePic;
        }
    }

    // --- Update image preview on URL input ---
    function updatePreview() {
        const newUrl = profilePicUrlInput.value.trim();
        if (newUrl) {
            profilePicPreview.src = newUrl;
             // Hide potential previous error on new input
            profilePicError.classList.add('hidden');
        } else {
            // If URL is cleared, show default
            profilePicPreview.src = defaultProfilePic;
             profilePicError.classList.add('hidden');
        }
    }

    // --- Handle image loading errors ---
    profilePicPreview.onerror = function() {
        // If the image fails to load (invalid URL, network issue)
        profilePicError.classList.remove('hidden'); // Show error message
        profilePicPreview.src = defaultProfilePic; // Revert to default image
    };

    // --- Save profile data ---
    function saveProfile(event) {
        event.preventDefault(); // Prevent actual form submission

        const newUsername = usernameInput.value.trim();
        const newPicUrl = profilePicUrlInput.value.trim();

        // Basic validation (more can be added)
        if (!newUsername) {
            alert("Username cannot be empty.");
            return;
        }

        // Save to localStorage
        localStorage.setItem('chatUsername', newUsername);
        localStorage.setItem('chatProfilePicUrl', newPicUrl); // Save even if empty or potentially invalid

        console.log("Profile Saved:", { username: newUsername, picUrl: newPicUrl });

        // Show confirmation message
        saveConfirmation.classList.remove('hidden');
        setTimeout(() => {
            saveConfirmation.classList.add('hidden');
            // Optional: Redirect back automatically
            // window.location.href = 'chat.html';
        }, 2000); // Hide after 2 seconds
    }

    // --- Event Listeners ---
    profilePicUrlInput.addEventListener('input', updatePreview);
    profileForm.addEventListener('submit', saveProfile);

    // --- Initial Load ---
    loadProfileData();

});
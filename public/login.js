// public/login.js - Complete & Corrected Version

document.addEventListener('DOMContentLoaded', () => {
    // --- Check if already logged in ---
    // If user is already authenticated, redirect them directly to the chat page
    if (localStorage.getItem('isAuthenticated') === 'true') {
        console.log("User already authenticated, redirecting to chat.");
        window.location.href = 'chat.html';
        return; // Stop further execution of login script
    }

    // --- DOM Elements ---
    const authContainer = document.getElementById('auth-container'); // Used? Maybe not directly needed
    const phoneInputSection = document.getElementById('phone-input-section');
    const otpInputSection = document.getElementById('otp-input-section');
    const phoneNumberInput = document.getElementById('phone-number');
    const phoneDisplay = document.getElementById('phone-display');
    const sendOtpButton = document.getElementById('send-otp-button');
    const otpCodeInput = document.getElementById('otp-code');
    const verifyOtpButton = document.getElementById('verify-otp-button');
    const resendOtpButton = document.getElementById('resend-otp-button');
    const changeNumberButton = document.getElementById('change-number-button');
    const authError = document.getElementById('auth-error');
    const recaptchaContainer = document.getElementById('recaptcha-container');

    // --- State Variables ---
    let confirmationResult = null; // Store confirmation result from Firebase
    let recaptchaVerifier = null; // Store reCAPTCHA verifier instance
    let resendToken = null; // Store token for resending OTP (may not always work)
    let recaptchaWidgetId = null; // Store reCAPTCHA widget ID for reset

    // --- Firebase Auth Functions ---

    // Initialize and render reCAPTCHA
    function initializeRecaptcha() {
        console.log("Initializing reCAPTCHA...");
        // Ensure Firebase auth is available (loaded from firebase-config.js)
        if (typeof auth === 'undefined') {
             console.error("Firebase auth is not defined. Check firebase-config.js and SDK loading order.");
             showAuthError("Initialization error. Cannot set up verification.");
             return;
        }

        // Clear previous instance visually and potentially internally
        recaptchaContainer.innerHTML = ''; // Clear the container
        hideAuthError(); // Hide errors when initializing

        try {
            // Use invisible reCAPTCHA
            recaptchaVerifier = new firebase.auth.RecaptchaVerifier(recaptchaContainer, {
                'size': 'invisible',
                'callback': (response) => {
                    // reCAPTCHA solved. This callback might not be essential for invisible reCAPTCHA
                    // as the verification happens automatically upon signInWithPhoneNumber call.
                    console.log("reCAPTCHA verified (invisible callback)");
                },
                'expired-callback': () => {
                    console.warn("reCAPTCHA expired. User may need to verify again.");
                    showAuthError("Verification expired. Please try sending OTP again.");
                    resetUI(); // Reset to phone input stage might be needed
                }
            });

            // Render the reCAPTCHA verifier. It resolves with the widget ID.
            recaptchaVerifier.render().then((widgetId) => {
                console.log("reCAPTCHA rendered successfully. Widget ID:", widgetId);
                recaptchaWidgetId = widgetId; // Store the widget ID
                sendOtpButton.disabled = false; // Ensure button is enabled after render
            }).catch(error => {
                 console.error("reCAPTCHA render error:", error);
                 showAuthError("Could not display verification check. Please refresh or check connection.");
                 sendOtpButton.disabled = true; // Disable button if reCAPTCHA fails to render
            });
        } catch (error) {
             console.error("Error creating RecaptchaVerifier:", error);
             showAuthError("Failed to set up phone sign-in verification. Check console.");
             sendOtpButton.disabled = true; // Disable button on error
        }
    }

    // Send OTP to the phone number
    async function sendOtp() {
        const phoneNumberString = phoneNumberInput.value.trim();
        console.log(`Attempting to send OTP to: ${phoneNumberString}`);

        // Validate phone number format (E.164 standard recommended)
        // Example: +911234567890 (India) or +14155552671 (US)
        if (!/^\+[1-9]\d{1,14}$/.test(phoneNumberString)) {
            showAuthError("Please enter a valid phone number in E.164 format (e.g., +911234567890).");
            phoneNumberInput.focus(); // Focus input for correction
            return;
        }

        showLoading(sendOtpButton, 'Sending...');
        hideAuthError();

        // Ensure reCAPTCHA is initialized
        if (!recaptchaVerifier) {
            console.error("reCAPTCHA verifier not ready.");
            showAuthError("Verification setup not complete. Please wait or refresh.");
            hideLoading(sendOtpButton, 'Send OTP');
            return;
        }

        try {
            // Start phone number sign-in process
            confirmationResult = await auth.signInWithPhoneNumber(phoneNumberString, recaptchaVerifier);
            console.log("OTP sent successfully. Confirmation result received.");
            window.confirmationResult = confirmationResult; // Store globally or in higher scope if needed

            // Store verification ID for potential credential creation (used in verifyOtpCode)
            // resendToken might also be derived from this if needed, but direct resend is tricky

            phoneDisplay.textContent = phoneNumberString; // Show number being verified
            phoneInputSection.classList.add('hidden');
            otpInputSection.classList.remove('hidden');
            startResendTimer(); // Start cooldown timer for resend button
            otpCodeInput.focus(); // Focus the OTP input field

        } catch (error) {
            console.error("Error sending OTP:", error.code, error.message);
            // Handle specific Firebase errors
            let errorMessage = "Failed to send OTP. Please check the number or try again.";
            if (error.code === 'auth/invalid-phone-number') {
                errorMessage = "The phone number format is invalid.";
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = "We have blocked all requests from this device due to unusual activity. Try again later.";
            } else if (error.code === 'auth/missing-phone-number') {
                 errorMessage = "Phone number is missing.";
             } else if (error.code === 'auth/captcha-check-failed' || error.code === 'auth/network-request-failed') {
                 errorMessage = "Could not verify you are human. Please try sending OTP again.";
                 // Reset reCAPTCHA on failure
                 if (recaptchaWidgetId !== null && typeof grecaptcha !== 'undefined') {
                    grecaptcha.reset(recaptchaWidgetId);
                    console.log("reCAPTCHA reset due to verification error.");
                 } else {
                     initializeRecaptcha(); // Fallback: re-initialize
                 }
            } else if (error.message.includes("TOO_SHORT")) {
                // Example of catching specific backend message if API returns details
                 errorMessage = "The phone number is too short.";
            }
            showAuthError(errorMessage);
        } finally {
            // Ensure button is re-enabled and text is reset
            hideLoading(sendOtpButton, 'Send OTP');
        }
    }

    // Verify the entered OTP code
    async function verifyOtpCode() {
        const otpCode = otpCodeInput.value.trim();
        console.log(`Verifying OTP code: ${otpCode}`);

        // Basic validation for 6 digits
        if (!/^\d{6}$/.test(otpCode)) {
            showAuthError("Please enter the 6-digit OTP code sent to your phone.");
            otpCodeInput.focus();
            return;
        }

        // Check if confirmationResult is available
        if (!confirmationResult) {
            showAuthError("Verification session error. Please try sending OTP again.");
            resetUI(); // Go back to phone input stage
            return;
        }

        showLoading(verifyOtpButton, 'Verifying...');
        hideAuthError();

        try {
            // Confirm the OTP code using the confirmationResult
            const result = await confirmationResult.confirm(otpCode);

            // User signed in successfully.
            const user = result.user;
            console.log("User signed in successfully via OTP:", user.uid, user.phoneNumber);

            // --- Get Firebase ID Token ---
            // Force refresh recommended after sign-in/sign-up for fresh token
            const idToken = await user.getIdToken(true);
            console.log("Firebase ID Token obtained successfully.");

            // --- Store Auth State & Token ---
            // Use localStorage for persistence across browser sessions
            localStorage.setItem('isAuthenticated', 'true'); // Simple flag
            localStorage.setItem('firebaseIdToken', idToken); // Token for backend verification
            localStorage.setItem('userPhoneNumber', user.phoneNumber || phoneNumberInput.value.trim()); // Store phone number

            // --- Redirect to Chat Page ---
            console.log("Redirecting to chat page...");
            window.location.href = 'chat.html';

        } catch (error) {
            console.error("Error verifying OTP:", error.code, error.message);
            // Handle specific errors
            let errorMessage = "Failed to verify OTP. Please try again.";
            if (error.code === 'auth/invalid-verification-code') {
                errorMessage = "Invalid OTP code. Please check the code and try again.";
                otpCodeInput.focus(); // Focus input for correction
                otpCodeInput.select();
            } else if (error.code === 'auth/code-expired') {
                errorMessage = "The OTP code has expired. Please request a new one.";
                // No need to reset UI immediately, user might click resend
            } else if (error.code === 'auth/session-expired') {
                 errorMessage = "Verification session has expired. Please send the OTP again.";
                 resetUI(); // Force user back to phone input stage
            } else if (error.code === 'auth/credential-already-in-use') {
                 errorMessage = "This phone number is associated with another account.";
                 // This shouldn't happen often with phone auth unless merging accounts
                 resetUI();
             }
            showAuthError(errorMessage);
            hideLoading(verifyOtpButton, 'Verify & Login');
        }
    }

    // Resend OTP function
    async function resendOtp() {
        // Firebase often requires re-verification for resends,
        // so re-triggering the original sendOtp flow is usually more reliable.
        console.log("Resend OTP requested. Retrying the send OTP process...");
        // Ensure phone number is still available if needed for re-verification
        const phoneNumberString = phoneDisplay.textContent || phoneNumberInput.value.trim();
        if (!/^\+[1-9]\d{1,14}$/.test(phoneNumberString)) {
            showAuthError("Cannot resend OTP without a valid phone number.");
            resetUI(); // Go back if number is lost/invalid
            return;
        }

        showLoading(resendOtpButton, 'Resending...');
        hideAuthError();

        try {
            // We need a reCAPTCHA verifier instance. The existing one might have expired
            // or been used. Re-rendering/re-initializing it is safer.
             console.log("Re-initializing reCAPTCHA for resend...");
             await recaptchaVerifier.render(); // Attempt to re-render the existing instance
             console.log("reCAPTCHA re-rendered for resend.");

            // Now, try signInWithPhoneNumber again
            confirmationResult = await auth.signInWithPhoneNumber(phoneNumberString, recaptchaVerifier);
            console.log("Resend OTP request successful. New confirmation result received.");
            window.confirmationResult = confirmationResult; // Update global reference

            startResendTimer(); // Restart the cooldown timer
            otpCodeInput.focus(); // Focus OTP input again

        } catch (error) {
            console.error("Error resending OTP:", error.code, error.message);
            let errorMessage = "Failed to resend OTP. Please try again shortly.";
             if (error.code === 'auth/too-many-requests') {
                 errorMessage = "Too many requests. Please try again later.";
             } else if (error.code === 'auth/captcha-check-failed') {
                 errorMessage = "reCAPTCHA check failed. Please try again.";
                 if (recaptchaWidgetId !== null && typeof grecaptcha !== 'undefined') {
                    grecaptcha.reset(recaptchaWidgetId);
                 } else {
                     initializeRecaptcha(); // Fallback
                 }
             }
             showAuthError(errorMessage);
              // Do not start timer if resend failed
             stopResendTimer(); // Ensure button becomes active again after failure
             resendOtpButton.textContent = 'Resend OTP';
             resendOtpButton.disabled = false;
        } finally {
             hideLoading(resendOtpButton, 'Resend OTP'); // Ensure loading state is removed
        }
    }


    // --- UI Helper Functions ---
    let resendInterval;
    function startResendTimer() {
        stopResendTimer(); // Clear existing timer first
        let seconds = 60;
        resendOtpButton.disabled = true;
        resendOtpButton.textContent = `Resend OTP (${seconds})`;
        resendInterval = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                stopResendTimer();
            } else {
                resendOtpButton.textContent = `Resend OTP (${seconds})`;
            }
        }, 1000);
    }
    function stopResendTimer() {
        clearInterval(resendInterval);
        resendOtpButton.textContent = 'Resend OTP';
        resendOtpButton.disabled = false;
    }
    function changeNumber() {
        stopResendTimer();
        otpInputSection.classList.add('hidden');
        phoneInputSection.classList.remove('hidden');
        hideAuthError();
        otpCodeInput.value = '';
        // Re-initialize reCAPTCHA for the phone number stage
        initializeRecaptcha();
        phoneNumberInput.focus();
    }
    function resetUI() {
         stopResendTimer();
         confirmationResult = null; // Clear confirmation result
         otpInputSection.classList.add('hidden');
         phoneInputSection.classList.remove('hidden');
         otpCodeInput.value = '';
         // Re-initialize reCAPTCHA
         initializeRecaptcha();
         phoneNumberInput.focus();
    }
    function showAuthError(message) {
        console.error("Auth Error:", message); // Log error to console too
        authError.textContent = message;
        authError.classList.remove('hidden');
    }
    function hideAuthError() {
        authError.classList.add('hidden');
    }
    function showLoading(buttonElement, loadingText) {
        buttonElement.disabled = true;
        // Store original text if not already stored
        if (!buttonElement.dataset.originalText) {
             buttonElement.dataset.originalText = buttonElement.textContent;
        }
        buttonElement.textContent = loadingText;
    }
    function hideLoading(buttonElement, defaultText) {
        buttonElement.disabled = false;
        // Restore original text, or use provided default
        buttonElement.textContent = buttonElement.dataset.originalText || defaultText;
         // Clear stored text once restored
         // delete buttonElement.dataset.originalText;
    }

    // --- Event Listeners --- corrected section
    sendOtpButton.addEventListener('click', sendOtp);
    verifyOtpButton.addEventListener('click', verifyOtpCode);
    changeNumberButton.addEventListener('click', changeNumber);
    resendOtpButton.addEventListener('click', () => {
         if (!resendOtpButton.disabled) {
             resendOtp();
         }
     });
     // Handle 'Enter' key ONLY in the phone number input
    phoneNumberInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!sendOtpButton.disabled) {
                console.log("Enter pressed in phone input, triggering Send OTP button click...");
                sendOtpButton.click();
            }
        }
    });
     // Handle 'Enter' key ONLY in the OTP code input
    otpCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!verifyOtpButton.disabled) {
                 console.log("Enter pressed in OTP input, triggering Verify OTP button click...");
                 verifyOtpButton.click();
            }
        }
    });

    // --- Initial Setup ---
    // Ensure the UI starts at the phone input stage
    otpInputSection.classList.add('hidden');
    phoneInputSection.classList.remove('hidden');
    // Initialize reCAPTCHA when the page loads
    initializeRecaptcha();
    phoneNumberInput.focus(); // Focus phone input on load

}); // End of DOMContentLoaded listener
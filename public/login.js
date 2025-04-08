// public/login.js
document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in (using simple flag)
    if (localStorage.getItem('isAuthenticated') === 'true') {
        // Maybe add a check here to see if token is still valid? More advanced.
        window.location.href = 'chat.html';
        return;
    }

    // --- DOM Elements ---
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

    let confirmationResult = null; // Store confirmation result
    let recaptchaVerifier = null; // Store reCAPTCHA verifier instance
    let resendToken = null; // Store token for resending OTP

    // --- Firebase Auth Functions ---

    // Initialize and render reCAPTCHA
    function initializeRecaptcha() {
        // Clear previous instance if any
        if (recaptchaVerifier) {
            // recaptchaVerifier.clear(); // Method might vary slightly based on usage
            recaptchaContainer.innerHTML = ''; // Clear the container
        }
        hideAuthError(); // Hide errors when initializing

        try {
            // Use invisible reCAPTCHA - it shows only when needed (like traffic challenges)
            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(recaptchaContainer, {
                'size': 'invisible',
                'callback': (response) => {
                    // reCAPTCHA solved, allow signInWithPhoneNumber.
                    // In invisible mode, this usually happens implicitly upon button click.
                    console.log("reCAPTCHA verified (invisible)");
                },
                'expired-callback': () => {
                    // Response expired. Ask user to solve reCAPTCHA again.
                    console.log("reCAPTCHA expired");
                    showAuthError("reCAPTCHA verification expired. Please try sending OTP again.");
                    resetUI(); // Reset to phone input stage
                }
            });
            window.recaptchaVerifier.render().then((widgetId) => {
                window.recaptchaWidgetId = widgetId;
                console.log("reCAPTCHA rendered, widget ID:", widgetId);
                // Enable send OTP button maybe? Or assume it's enabled.
            }).catch(error => {
                 console.error("reCAPTCHA render error:", error);
                 showAuthError("Could not initialize reCAPTCHA. Check console/network or try refreshing.");
            });
        } catch (error) {
             console.error("Error creating RecaptchaVerifier:", error);
             showAuthError("Failed to set up phone sign-in verification.");
        }
    }

    // Send OTP to the phone number
    async function sendOtp() {
        const phoneNumberString = phoneNumberInput.value.trim();
        // Basic validation - IMPROVE THIS SIGNIFICANTLY for production
        // Requires E.164 format (e.g., +911234567890)
        if (!/^\+[1-9]\d{1,14}$/.test(phoneNumberString)) {
            showAuthError("Please enter a valid phone number in E.164 format (e.g., +911234567890).");
            return;
        }

        showLoading(sendOtpButton, 'Sending...');
        hideAuthError();

        if (!window.recaptchaVerifier) {
            console.error("reCAPTCHA verifier not initialized.");
            showAuthError("Verification setup failed. Please refresh.");
            hideLoading(sendOtpButton, 'Send OTP');
            return;
        }

        try {
            confirmationResult = await auth.signInWithPhoneNumber(phoneNumberString, window.recaptchaVerifier);
            // OTP sent successfully
            console.log("OTP sent successfully. Confirmation result:", confirmationResult);
            window.confirmationResult = confirmationResult; // Store globally for verifyOtp
            resendToken = confirmationResult.verificationId; // Store verification ID for potential resend (though resend usually needs full flow again)

            phoneDisplay.textContent = phoneNumberString;
            phoneInputSection.classList.add('hidden');
            otpInputSection.classList.remove('hidden');
            startResendTimer(); // Start cooldown timer
            otpCodeInput.focus();

        } catch (error) {
            console.error("Error sending OTP:", error);
            // Handle specific errors
            let errorMessage = "Failed to send OTP. Please try again.";
            if (error.code === 'auth/invalid-phone-number') {
                errorMessage = "Invalid phone number format.";
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = "Too many requests. Please try again later.";
            } else if (error.code === 'auth/captcha-check-failed') {
                 errorMessage = "reCAPTCHA verification failed. Please try again.";
                 // Optionally reset reCAPTCHA here if needed
                 window.recaptchaVerifier.render();
            }
            showAuthError(errorMessage);
            // Reset reCAPTCHA if needed (especially on errors like invalid format)
            // This might require re-rendering or using grecaptcha.reset(widgetId) if you stored the ID
            grecaptcha.reset(window.recaptchaWidgetId); // Use the stored widget ID

        } finally {
            hideLoading(sendOtpButton, 'Send OTP');
        }
    }

    // Verify the entered OTP code
    async function verifyOtpCode() {
        const otpCode = otpCodeInput.value.trim();
        if (!/^\d{6}$/.test(otpCode)) {
            showAuthError("Please enter the 6-digit OTP code.");
            return;
        }

        if (!window.confirmationResult) {
            showAuthError("Verification process error. Please try sending OTP again.");
            resetUI();
            return;
        }

        showLoading(verifyOtpButton, 'Verifying...');
        hideAuthError();

        try {
            const credential = firebase.auth.PhoneAuthProvider.credential(window.confirmationResult.verificationId, otpCode);
            // Sign in with credential (alternative to confirmationResult.confirm)
            const result = await auth.signInWithCredential(credential);
            // Or use confirmationResult.confirm:
            // const result = await window.confirmationResult.confirm(otpCode);

            // User signed in successfully.
            const user = result.user;
            console.log("User signed in successfully:", user.uid, user.phoneNumber);

            // Get the Firebase ID token
            const idToken = await user.getIdToken(/* forceRefresh */ true); // Force refresh recommended after login
            console.log("Firebase ID Token obtained.");

            // Store authentication state and token
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('firebaseIdToken', idToken); // Store token for backend verification
            localStorage.setItem('userPhoneNumber', user.phoneNumber); // Store phone number

            // Redirect to chat page
            window.location.href = 'chat.html';

        } catch (error) {
            console.error("Error verifying OTP:", error);
            let errorMessage = "Failed to verify OTP.";
            if (error.code === 'auth/invalid-verification-code') {
                errorMessage = "Invalid OTP code entered.";
            } else if (error.code === 'auth/code-expired') {
                errorMessage = "OTP code has expired. Please request a new one.";
                // Optionally reset UI to request again
            } else if (error.code === 'auth/session-expired') {
                 errorMessage = "Verification session expired. Please send OTP again.";
                 resetUI();
            }
            showAuthError(errorMessage);
            hideLoading(verifyOtpButton, 'Verify & Login');
        }
    }

    // Resend OTP function (Note: Often requires re-verification with reCAPTCHA)
    async function resendOtp() {
        // Firebase typically requires re-verification for resends.
        // The simplest robust approach is often to just guide the user
        // back to the phone number input stage or trigger the sendOtp flow again.
        console.warn("Resend OTP clicked. Triggering sendOtp flow again for robustness.");
         showLoading(resendOtpButton, 'Resending...');
        // Instead of using resendToken, re-run the full flow for safety
        // This requires the user might have to resolve reCAPTCHA again
         try {
             await sendOtp(); // Re-trigger the send OTP process
         } finally {
              hideLoading(resendOtpButton, 'Resend OTP'); // Reset button text regardless
               // Timer will be restarted inside sendOtp if successful
         }

        // --- Less common/robust direct resend attempt (might fail captcha): ---
        /*
        const phoneNumberString = phoneNumberInput.value.trim(); // Need phone number again
        if (!resendToken || !phoneNumberString) {
             showAuthError("Could not resend OTP. Please try again from the beginning.");
             resetUI();
             return;
        }
         showLoading(resendOtpButton, 'Resending...');
         hideAuthError();
        try {
             // Re-send requires the verifier again
             // NOTE: This might fail if the original verifier instance expired or is invalid
             confirmationResult = await auth.signInWithPhoneNumber(phoneNumberString, window.recaptchaVerifier, resendToken);
             window.confirmationResult = confirmationResult;
             resendToken = confirmationResult.verificationId; // Update token
             console.log("Resend OTP request successful.");
             startResendTimer(); // Restart timer
        } catch(error) {
             console.error("Error resending OTP:", error);
              showAuthError("Failed to resend OTP. Please try sending again.");
               // Consider resetting reCAPTCHA
                grecaptcha.reset(window.recaptchaWidgetId);
        } finally {
            hideLoading(resendOtpButton, 'Resend OTP');
        }
        */
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
         otpInputSection.classList.add('hidden');
         phoneInputSection.classList.remove('hidden');
         otpCodeInput.value = '';
         // Re-initialize reCAPTCHA
         initializeRecaptcha();
    }
    function showAuthError(message) {
        authError.textContent = message;
        authError.classList.remove('hidden');
    }
    function hideAuthError() {
        authError.classList.add('hidden');
    }
    function showLoading(buttonElement, loadingText) {
        buttonElement.disabled = true;
        buttonElement.dataset.originalText = buttonElement.textContent; // Store original text
        buttonElement.textContent = loadingText;
    }
    function hideLoading(buttonElement, defaultText) {
        buttonElement.disabled = false;
        buttonElement.textContent = buttonElement.dataset.originalText || defaultText;
    }

    // --- Event Listeners ---
    sendOtpButton.addEventListener('click', sendOtp);
    verifyOtpButton.addEventListener('click', verifyOtpCode);
    changeNumberButton.addEventListener('click', changeNumber);
    resendOtpButton.addEventListener('click', () => {
         if (!resendOtpButton.disabled) {
             resendOtp();
         }
     });
    // Allow Enter key press for inputs
    phoneNumberInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') e.preventDefault(); sendOtpButton.click();
    });
    otpCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') e.preventDefault(); verifyOtpButton.click();
    });

    // --- Initial Setup ---
    // Initialize reCAPTCHA when the page loads
    initializeRecaptcha();
});
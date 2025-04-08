// public/firebase-config.js

// Configuration values from your Firebase project console
// Using the v9 modular syntax format provided, but applied using v8 compat initialization
// because login.js currently uses the compat SDKs (firebase.*) loaded via <script> tags.
const firebaseConfig = {
    apiKey: "AIzaSyCg0pvN7Z58ztMNS-fWykoPsCEK1yNPFNA", // From your snippet
    authDomain: "chat-7201f.firebaseapp.com",         // From your snippet
    projectId: "chat-7201f",                         // From your snippet
    storageBucket: "chat-7201f.appspot.com",         // Adjusted - ensure this is correct in your Firebase Console
    messagingSenderId: "131817747153",               // From your snippet
    appId: "1:131817747153:web:c969ddec01a67f790c0bf0", // From your snippet
    measurementId: "G-SM18DKMMR1"                    // From your snippet (Optional for Analytics)
};

// Initialize Firebase using the Compat library (loaded in login.html)
try {
    // Check if Firebase is already initialized (optional safeguard)
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log("Firebase Initialized.");
    } else {
        firebase.app(); // if already initialized, use that app
        console.log("Firebase already initialized.");
    }

    // Initialize Analytics (optional, but included in your snippet) using Compat version
    try {
        const analytics = firebase.analytics();
        console.log("Firebase Analytics Initialized.");
    } catch(analyticsError) {
        console.warn("Firebase Analytics could not be initialized (might be disabled or blocked):", analyticsError.message);
    }

} catch (e) {
    console.error("Error initializing Firebase:", e);
    // Provide more user-friendly feedback if possible
    alert("Could not configure Firebase connection. The application might not work correctly. Please check the console for technical details.");
}

// Make auth easily accessible globally using the Compat version
// This is used by login.js
const auth = firebase.auth();

// Optional: Set persistence (default is 'local' - remembers login across sessions)
/*
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION) // SESSION: forget login when tab/browser closes
  .then(() => {
    console.log("Firebase Auth persistence set.");
  })
  .catch((error) => {
    console.error("Error setting Firebase Auth persistence:", error);
  });
*/
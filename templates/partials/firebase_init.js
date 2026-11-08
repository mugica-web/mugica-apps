    // ---- FIREBASE INITIALIZATION (shared by every page that signs in) ----
    //
    // firebase.initializeApp() connects the page to the site's Firebase
    // project, which handles Google sign-in and the Firestore database.
    // The config object contains public keys that identify the project —
    // they're safe to include in client-side code (security comes from
    // Firestore rules, not from hiding these keys).
    //
    // The project ID says "cook-timer" because Firebase project IDs are
    // permanent and can't be renamed. It's the whole site's project.
    firebase.initializeApp({
        apiKey: "{{ firebase_api_key }}",
        authDomain: "cook-timer-69256.firebaseapp.com",
        projectId: "cook-timer-69256",
        storageBucket: "cook-timer-69256.firebasestorage.app",
        messagingSenderId: "207322185688",
        appId: "1:207322185688:web:92edf8b87f61abee85bcad"
    });

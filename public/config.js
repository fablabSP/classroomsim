// ClassroomSim settings.
//
// Paste your Firebase web app settings below. In the Firebase console:
//   Project settings (gear) → Your apps → your Web app → "SDK setup and configuration" → Config
// You can paste the whole "const firebaseConfig = { ... };" block over the example block below.
// (If the import lines get pasted too, that's fine: ClassroomSim still finds the settings.)
// These values are not secret. Access is controlled by firestore.rules.

const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

window.CLASSROOMSIM_CONFIG = {
  firebase: firebaseConfig,
  // Optional: the address people use to join, if it differs from where this page is served.
  publicUrl: ''
};

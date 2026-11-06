// ClassroomSim settings.
//
// Paste your Firebase web app settings below. In the Firebase console:
//   Project settings (gear) → Your apps → your Web app → "SDK setup and configuration" → Config
// You can paste the whole "const firebaseConfig = { ... };" block over the example block below.
// (If the import lines get pasted too, that's fine: ClassroomSim still finds the settings.)
// These values are not secret. Access is controlled by firestore.rules.

const firebaseConfig = {
  apiKey: "AIzaSyB3d1PJyyLqdIBlexVs3K97tVCrlwOGdow",
  authDomain: "classroomsim-5292e.firebaseapp.com",
  projectId: "classroomsim-5292e",
  storageBucket: "classroomsim-5292e.firebasestorage.app",
  messagingSenderId: "748483367457",
  appId: "1:748483367457:web:017f6d513ea521abe00960"
};

window.CLASSROOMSIM_CONFIG = {
  firebase: firebaseConfig,
  // Optional: the address people use to join, if it differs from where this page is served.
  publicUrl: ''
};

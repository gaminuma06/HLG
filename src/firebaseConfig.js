import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCEBkdiWwdLIor3842LdLLR9C8VOpwu3lk",
  authDomain: "balance-hidrico-ghlg.firebaseapp.com",
  databaseURL: "https://balance-hidrico-ghlg-default-rtdb.firebaseio.com",
  projectId: "balance-hidrico-ghlg",
  storageBucket: "balance-hidrico-ghlg.firebasestorage.app",
  messagingSenderId: "920431004387",
  appId: "1:920431004387:web:2b6b692e7cb27f855213d6",
  measurementId: "G-0XYZTV4GXH"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

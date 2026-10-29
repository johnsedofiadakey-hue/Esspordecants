import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  EmailAuthProvider,
  getAuth,
  onIdTokenChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  type Auth,
  type User as FirebaseUser,
} from "firebase/auth";

// In production the web config comes from Firebase Hosting's reserved
// /__/firebase/init.json, so nothing project-specific is baked into the bundle.
// In development the admin talks to the Auth emulator under the offline demo project.
async function loadAuth(): Promise<Auth> {
  if (import.meta.env.DEV) {
    const app = initializeApp({ apiKey: "demo-key", projectId: "demo-esspor", authDomain: "demo-esspor.firebaseapp.com" });
    const auth = getAuth(app);
    connectAuthEmulator(auth, import.meta.env.VITE_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9099", { disableWarnings: true });
    return auth;
  }
  const response = await fetch("/__/firebase/init.json");
  if (!response.ok) throw new Error("Could not load the Firebase configuration.");
  return getAuth(initializeApp(await response.json()));
}

const authReady = loadAuth();

export function watchUser(callback: (user: FirebaseUser | null) => void): () => void {
  let unsubscribe = () => {};
  let cancelled = false;
  authReady
    .then((auth) => {
      if (!cancelled) unsubscribe = onIdTokenChanged(auth, callback);
    })
    .catch(() => callback(null));
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function idToken(): Promise<string | null> {
  const auth = await authReady;
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

const messages: Record<string, string> = {
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "Email or password is incorrect.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Network error. Check your connection.",
  "auth/weak-password": "Choose a stronger password.",
  "auth/requires-recent-login": "Sign in again before changing your password.",
};

export function authErrorText(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  return messages[code] ?? (error instanceof Error ? error.message : "Something went wrong.");
}

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(await authReady, email, password);
}

export async function signOut() {
  await firebaseSignOut(await authReady);
}

// Firebase requires a recent sign-in to change a password, so the current one is checked first.
export async function changePassword(currentPassword: string, newPassword: string) {
  const auth = await authReady;
  const user = auth.currentUser;
  if (!user?.email) throw new Error("Sign in again to change your password.");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, newPassword);
}

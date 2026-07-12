# FCM Push Notifications — React Native Frontend Integration Guide

This document describes how to integrate Firebase Cloud Messaging (FCM) push notifications in the Family Talk React Native app. The **backend is already fully implemented** — this guide covers only the frontend work and the exact API contract.

---

## 1. Backend Contract (already live)

Backend runs on **port 4000** (same base URL as the rest of the API).

### Register device token

```
POST /users/fcm-token
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "fcmToken": "<device FCM token>" }
```

Response: `{ "success": true }`

- One token per user (last device wins — logging in on a new phone replaces the old token).
- Call this **after login** and **whenever the token refreshes**.
- On `POST /auth/logout`, the backend automatically clears the stored token — the logged-out device stops receiving pushes. No extra frontend call needed.

### When the backend sends pushes

| Event | Condition | Notification |
|-------|-----------|--------------|
| New message | Recipient is **offline** (socket disconnected). Online users get the message via Socket.IO `new_message` event instead — never both. | title = sender name, body = `New message 💬` — **message content is never included in the push** (privacy: content never passes through Google's servers). The app fetches the real message via API/socket when opened. |
| Contact joined | A phone number saved in the user's synced contacts registers on the app | title = `Family Talk`, body = `<contactName> joined Family Talk! Say hi 👋` |

### Data payload (for navigation on tap)

Every push includes a `data` object (all values are **strings**):

```jsonc
// New message push
{
  "type": "new_message",
  "conversationId": "<uuid>",
  "messageId": "<uuid>"
}

// Contact joined push
{
  "type": "contact_joined",
  "userId": "<uuid of the new user>"
}
```

**Tap behavior expected:**
- `new_message` → navigate to the chat screen for `conversationId`
- `contact_joined` → navigate to that user's profile or open a new chat with `userId`

### ⚠️ Android notification channel (REQUIRED)

The backend sends Android notifications with `channelId: "family_talk_messages"`. On Android 8+, **notifications will NOT show unless the app creates this exact channel**. Create it once at app startup (see §4).

---

## 2. Firebase Project Setup

The Firebase project already exists (same one the backend service account came from). You need to register the mobile apps in it:

1. Firebase Console → Project Overview → **Add app**
2. **Android**: package name must match `android/app/build.gradle` → `applicationId`. Download `google-services.json` → place at `android/app/google-services.json`
3. **iOS**: bundle ID must match Xcode project. Download `GoogleService-Info.plist` → add to the Xcode project (via Xcode, not just the filesystem)
4. **iOS only**: push needs an Apple Developer account:
   - Xcode → Signing & Capabilities → add **Push Notifications** + **Background Modes** (check *Remote notifications*)
   - Firebase Console → Project Settings → Cloud Messaging → upload the **APNs Auth Key** (.p8 from developer.apple.com → Keys)
   - Note: iOS push does **not work on simulator** — test on a real device

---

## 3. Install Libraries (bare React Native)

```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
npm install @notifee/react-native   # for foreground/local notifications + channel creation
cd ios && pod install
```

Android — `android/build.gradle`:
```gradle
buildscript {
  dependencies {
    classpath 'com.google.gms:google-services:4.4.2'
  }
}
```

`android/app/build.gradle` (bottom of file):
```gradle
apply plugin: 'com.google.gms.google-services'
```

Android 13+ needs the runtime permission — `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

> **If the app is Expo (managed):** you cannot use `@react-native-firebase` in Expo Go. Either use a **custom dev client / EAS Build** with the `@react-native-firebase/app` config plugin, or switch to `expo-notifications` (which also returns an FCM device token via `getDevicePushTokenAsync()` — that raw token is what the backend expects, NOT the Expo push token).

---

## 4. Implementation

### 4.1 Notification service (`src/services/notifications.ts`)

```typescript
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import api from './api'; // your existing axios/fetch wrapper with JWT header

// REQUIRED: must match the channelId the backend sends
export async function createNotificationChannel() {
  await notifee.createChannel({
    id: 'family_talk_messages',
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  const authStatus = await messaging().requestPermission();
  return (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  );
}

// Call after successful login (and on every app start while logged in)
export async function registerFcmToken() {
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const token = await messaging().getToken();
  await api.post('/users/fcm-token', { fcmToken: token });
}

// Keep backend in sync when Firebase rotates the token
export function listenForTokenRefresh() {
  return messaging().onTokenRefresh(async (token) => {
    await api.post('/users/fcm-token', { fcmToken: token });
  });
}
```

### 4.2 Foreground messages

When the app is **open**, FCM does not display anything — show it manually with notifee. But **skip it if the user is already inside that conversation** (they can see the message arriving via socket):

```typescript
import { navigationRef, getCurrentConversationId } from '../navigation';

export function listenForForegroundMessages() {
  return messaging().onMessage(async (remoteMessage) => {
    const data = remoteMessage.data ?? {};

    // Already viewing this chat? Don't notify.
    if (
      data.type === 'new_message' &&
      data.conversationId === getCurrentConversationId()
    ) {
      return;
    }

    await notifee.displayNotification({
      title: remoteMessage.notification?.title,
      body: remoteMessage.notification?.body,
      data,
      android: {
        channelId: 'family_talk_messages',
        pressAction: { id: 'default' },
        smallIcon: 'ic_launcher', // replace with a proper notification icon
      },
    });
  });
}
```

> Note: in practice foreground pushes should be rare — the backend only pushes to *offline* users, and a foregrounded app has an active socket. This handler is a safety net for race conditions (e.g. socket just dropped).

### 4.3 Background / quit-state handler

`index.js` (must be **outside** any component, before `AppRegistry.registerComponent`):

```javascript
import messaging from '@react-native-firebase/messaging';

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  // Notification is displayed automatically by the OS (backend sends a
  // `notification` payload). Nothing required here; hook for badge counts etc.
});
```

### 4.4 Notification tap → navigation

```typescript
function handleNotificationNavigation(data: Record<string, string> | undefined) {
  if (!data) return;
  if (data.type === 'new_message' && data.conversationId) {
    navigationRef.navigate('Chat', { conversationId: data.conversationId });
  } else if (data.type === 'contact_joined' && data.userId) {
    navigationRef.navigate('UserProfile', { userId: data.userId });
  }
}

export function setupNotificationTapHandlers() {
  // App was in BACKGROUND, opened by tapping the notification
  messaging().onNotificationOpenedApp((remoteMessage) => {
    handleNotificationNavigation(remoteMessage.data as any);
  });

  // App was QUIT (killed), launched by tapping the notification
  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage) handleNotificationNavigation(remoteMessage.data as any);
    });

  // Foreground notifee notification tapped
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      handleNotificationNavigation(detail.notification?.data as any);
    }
  });
}
```

### 4.5 Wiring it together (`App.tsx`)

```typescript
useEffect(() => {
  createNotificationChannel();
  setupNotificationTapHandlers();

  if (isLoggedIn) {
    registerFcmToken();
    const unsubRefresh = listenForTokenRefresh();
    const unsubForeground = listenForForegroundMessages();
    return () => {
      unsubRefresh();
      unsubForeground();
    };
  }
}, [isLoggedIn]);
```

Also call `registerFcmToken()` right after a successful OTP verification (login flow), not just on app start.

### 4.6 Logout

Just call the existing `POST /auth/logout` — the backend clears the FCM token server-side. Optionally also call `messaging().deleteToken()` locally for extra safety.

---

## 5. Testing Checklist

1. Login on device A and device B (two different accounts, saved in each other's contacts).
2. **Kill the app on device B** (swipe away). Send a message from A → B should get a system push with A's name + message text.
3. Tap the push → app should open directly in that chat.
4. Open the app on B (socket connects) → send from A again → **no push**, message arrives via socket only.
5. Register a brand-new account with a phone number saved in A's contacts → A gets "X joined Family Talk! Say hi 👋".
6. Logout on B → send from A → B gets **nothing**.
7. Check backend logs: `Firebase Admin initialized — push notifications enabled` must appear at startup. If it says `push notifications disabled`, the `FIREBASE_SERVICE_ACCOUNT_PATH` in the backend `.env` is missing/wrong.

## 6. Common Pitfalls

- **No notification on Android 8+** → channel `family_talk_messages` was not created before the first push arrived. Create it at app startup (§4.1).
- **`messaging().getToken()` fails on iOS** → APNs key not uploaded in Firebase Console, or Push Notifications capability missing in Xcode.
- **Push works in dev but not release (Android)** → check `google-services.json` matches the release `applicationId`, and that SHA keys are added in Firebase settings if needed.
- **Duplicate notifications while app is open** → the foreground `onMessage` handler is showing a notifee notification while the user is inside the chat; keep the `getCurrentConversationId()` guard.
- **Backend never pushes** → backend only pushes to users with `is_online = false`. If the socket didn't disconnect cleanly the user may still be marked online; verify `user_offline` handling.

# Message Status (Ticks) — React Native Frontend Integration Guide

This document describes the complete message status system (sent ✓ / delivered ✓✓ / read 🔵) as implemented in the Family Talk backend, and exactly what the frontend must do. The **backend is fully implemented** — use this to verify/complete the frontend side.

---

## 1. Status Model

Every message has one `message_status` row **per recipient** (the sender has no row for their own message):

```typescript
{
  id: string;
  messageId: string;
  userId: string;              // the recipient this status belongs to
  status: 'sent' | 'delivered' | 'read';
  timestamp: string;           // when the status row was created (≈ message sent time)
  deliveredAt: string | null;  // when it reached the recipient's device
  readAt: string | null;       // when the recipient read it
}
```

Lifecycle (only moves forward, never downgrades):

```
sent ──→ delivered ──→ read
  └──────────────────────┘   (read implies delivered — deliveredAt is backfilled)
```

Messages returned by `GET /messages/conversation/:id` and the `new_message` socket event include the full `statuses` array (relation is always loaded).

### Computing the tick for the sender's UI

```typescript
type Tick = 'sent' | 'delivered' | 'read';

function computeTick(message: Message, myUserId: string): Tick | null {
  if (message.senderId !== myUserId) return null; // ticks only on own messages

  const statuses = message.statuses ?? [];
  if (statuses.length === 0) return 'sent';

  // WhatsApp rule: the tick reflects the SLOWEST recipient (matters for groups)
  if (statuses.every(s => s.status === 'read')) return 'read';
  if (statuses.every(s => s.status === 'read' || s.status === 'delivered')) return 'delivered';
  return 'sent';
}
```

Render: `sent` = ✓, `delivered` = ✓✓, `read` = ✓✓ (blue).

---

## 2. Socket Events — What the Frontend LISTENS For

Register these listeners **once, globally** (not per-screen) — status events arrive even when the user is on the chat list, and must update both the open chat and the conversation list cache.

### `new_message`
```typescript
socket.on('new_message', (message: Message) => { ... });
```
Full message object incl. `sender` and `statuses`. Emitted to the conversation room for both socket-sent AND REST-sent messages.

### `message_delivered`
```typescript
socket.on('message_delivered', (data: {
  messageId: string;
  conversationId: string;
  userId: string;        // the recipient whose copy got delivered
}) => { ... });
```
Update that message's status entry for `data.userId` to `delivered`, then recompute the tick.

### `message_read`
```typescript
socket.on('message_read', (data: {
  messageId: string;
  conversationId: string;
  userId: string;        // the recipient who read it
}) => { ... });
```
Same as above but → `read`. When the other user opens the chat, you'll receive one `message_read` **per message** they had unread — handle each individually.

> **Delivery guarantee:** the backend sends these events to the conversation room **and** directly to the sender's socket (deduplicated server-side — you never get the same event twice). So ticks update live even when the sender is on the chat-list screen. You do NOT need to be joined to the conversation room to receive receipts for your own messages.

> **Idempotency:** all status updates are idempotent — applying `delivered` to an already-`read` status must be ignored client-side (check: never downgrade `read` → `delivered`).

---

## 3. Socket Events — What the Frontend MUST EMIT

### On receiving a message while the chat is NOT open → `message_delivered`
```typescript
socket.emit('message_delivered', { messageId, conversationId });
```
Emit when a `new_message` arrives and the user is **not currently viewing that conversation**. (If they ARE viewing it, emit `mark_conversation_read` instead — read implies delivered.)

⚠️ You do NOT need to emit this for messages received while offline — the backend automatically marks everything pending as `delivered` the moment your socket connects (see §5).

### On opening a conversation (and on new messages arriving while it's open) → `mark_conversation_read`
```typescript
socket.emit('mark_conversation_read', { conversationId });
```
Bulk-marks every unread message in that conversation as read, updates `lastReadAt` (clears the unread badge), and notifies each sender. Call it:
1. When the chat screen mounts / gains focus
2. When a `new_message` arrives while the chat screen is focused

### Single-message read (optional) → `mark_read`
```typescript
socket.emit('mark_read', { messageId, conversationId });
```
Rarely needed if you use `mark_conversation_read`; kept for granular cases.

---

## 4. REST Fallbacks (same behavior as socket)

| Endpoint | Effect |
|----------|--------|
| `POST /messages` | Creates message **and** emits `new_message` to the conversation room — online recipients still get it in real-time |
| `POST /messages/:id/read` | Marks read **and** emits `message_read` to the sender — blue tick still updates live |

So whichever transport you use, real-time behavior is identical. Prefer the socket path when connected.

---

## 5. Automatic Backend Behaviors (no frontend work needed)

1. **Connect-time delivery sweep**: when a user's socket connects, ALL their pending (`sent`) statuses across every conversation flip to `delivered`, and every affected sender receives `message_delivered` events immediately. This is what makes ✓ → ✓✓ work for messages sent while the recipient was offline. *Consequence for frontend: expect a possible burst of `message_delivered` events right after anyone comes online.*
2. **Read implies delivered**: marking read backfills `deliveredAt` if it was never set — `statuses` data is always consistent.
3. **No downgrades**: the backend never moves `read` back to `delivered`/`sent`; duplicate emits are safely ignored server-side.
4. **Sender-direct receipts**: receipts reach the sender's socket even outside the room (deduped).

---

## 6. Recommended Frontend Flow (putting it together)

```typescript
// ── Global socket listeners (register once after connect) ──────────────
socket.on('new_message', (message) => {
  addMessageToCache(message);
  bumpConversationInList(message.conversationId, message);

  if (isViewingConversation(message.conversationId)) {
    socket.emit('mark_conversation_read', { conversationId: message.conversationId });
  } else {
    socket.emit('message_delivered', {
      messageId: message.id,
      conversationId: message.conversationId,
    });
    incrementUnreadBadge(message.conversationId);
  }
});

socket.on('message_delivered', ({ messageId, conversationId, userId }) => {
  updateMessageStatus(conversationId, messageId, userId, 'delivered');
});

socket.on('message_read', ({ messageId, conversationId, userId }) => {
  updateMessageStatus(conversationId, messageId, userId, 'read');
});

// ── Chat screen ─────────────────────────────────────────────────────────
useFocusEffect(() => {
  socket.emit('join_conversation', { conversationId });
  socket.emit('mark_conversation_read', { conversationId });
  clearUnreadBadge(conversationId);

  return () => socket.emit('leave_conversation', { conversationId });
});
```

```typescript
// updateMessageStatus — never downgrade
function updateMessageStatus(conversationId, messageId, userId, next: 'delivered' | 'read') {
  const rank = { sent: 0, delivered: 1, read: 2 };
  // find message in cache → find status entry for userId →
  // apply only if rank[next] > rank[current]
}
```

---

## 7. Edge Cases the Frontend Should Handle

- **Optimistic send**: show ✓ (sent) as soon as the socket `send_message` ack (`{ success: true, message }`) returns; replace your temp message with the acked one (it contains real `id` + `statuses`).
- **Burst of receipts**: after a recipient comes online or opens a chat, many `message_delivered`/`message_read` events can arrive in quick succession — batch UI updates if needed.
- **Group conversations**: `statuses` has one entry per recipient. The tick shows the slowest recipient (§1). Per-recipient info (`deliveredAt`/`readAt`) is available for a WhatsApp-style "Message info" screen.
- **Reconnection**: after a socket reconnect, refetch the open conversation (`GET /messages/conversation/:id`) to resync statuses you may have missed while disconnected — receipts emitted while you were offline are NOT replayed.
- **Own messages have no self-status**: never look for `userId === myUserId` in `statuses` of your own message — sender is excluded by design.

---

## 8. Testing Checklist

1. **Live delivered**: A and B both online, B on chat-list screen (chat closed). A sends → B's device: `message_delivered` auto-emitted → A sees ✓✓ within a second, *without* B opening the chat.
2. **Offline → delivered on connect**: kill B's app. A sends 3 messages (A sees ✓). B opens app (socket connects) → A's three ticks flip to ✓✓ instantly — B still hasn't opened the chat.
3. **Read on open**: B opens the chat → A's ticks turn blue (one `message_read` per message).
4. **Sender outside room**: A sends from the chat, then goes back to the chat list. B reads → A's list-preview tick still turns blue (sender-direct emit).
5. **REST parity**: send via `POST /messages` → online B still receives `new_message` via socket. Read via `POST /messages/:id/read` → A still gets `message_read`.
6. **No downgrade**: after blue tick, reconnect B → tick must stay blue (backend won't re-send delivered for read messages; client must also never downgrade).
7. **Group**: 3 members; tick goes ✓✓ only when BOTH recipients have it delivered, blue only when BOTH read.

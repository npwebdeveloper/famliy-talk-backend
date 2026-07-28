const { io } = require('socket.io-client');
const fs = require('fs');

const login = JSON.parse(fs.readFileSync('/tmp/loginA2.json', 'utf8'));
const token = login.accessToken;
const BOB_ID = 'abbfd3c5-630c-44c1-bbb4-808aa4c5bbc0';
const CONVERSATION_ID = 'adefe95d-4a12-4da1-8fdb-3af520064eaf';
const callType = process.argv[2] || 'video';

const socket = io('http://localhost:4000', {
    auth: { token },
    transports: ['websocket'],
});

socket.on('connect', () => {
    console.log('Alice socket connected:', socket.id);
    socket.emit('call_invite', { conversationId: CONVERSATION_ID, calleeId: BOB_ID, type: callType }, (ack) => {
        console.log('call_invite ack:', JSON.stringify(ack));
        setTimeout(() => process.exit(0), 2000);
    });
});

socket.on('connect_error', (err) => {
    console.error('connect_error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error('timed out waiting for connect');
    process.exit(1);
}, 8000);

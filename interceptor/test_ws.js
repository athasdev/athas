#!/usr/bin/env node

const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3456/ws');

ws.on('open', () => {
    console.log('Connected to interceptor WebSocket');
});

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        console.log('Received:', JSON.stringify(message, null, 2));
    } catch (e) {
        console.log('Raw message:', data.toString());
    }
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});

ws.on('close', () => {
    console.log('WebSocket connection closed');
});

// Keep the process running
process.stdin.resume();
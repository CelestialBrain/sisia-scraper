---
description: How to test the SISIA chat frontend
---

# Testing SISIA Chat Frontend

The frontend is at **http://localhost:6101/**

## Prerequisites

Make sure the dev server is running:

```bash
cd ~/Antigravity/sisia-chat && npm run dev
```

## Browser Testing

// turbo

1. Open browser to http://localhost:6101/
2. Wait for page to load (chat interface should appear)
3. Find the chat input at bottom of page
4. Type your test query and press Enter
5. Wait 5-10 seconds for AI response
6. Take screenshot of response if needed

## API Endpoints

- Frontend: http://localhost:6101/
- Backend API: http://localhost:6102/
- WebSocket: ws://localhost:6102/ws

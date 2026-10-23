# QuickMart

    node server.js          # Node 18+, no npm install needed
    open http://localhost:3000

Files: `server.js` (backend) + `public/index.html` (the app). index.html MUST stay inside the `public/` folder.

Roles: Customer, Seller, Rider (sign up from the login screen). Set ADMIN_PHONE in .env to make your number the ADMIN, who approves sellers/riders.
Without SMS keys, the OTP is shown on screen (demo mode) and printed in the server console. For real SMS add Twilio keys in .env.
Data lives in db.json (back it up). Production: NODE_ENV=production + HTTPS.

IMPORTANT: Do NOT double-click index.html. Run `node server.js` and open http://localhost:3000 (needs Node 18+: nodejs.org).
Location pin-drop uses OpenStreetMap, so internet is needed for the map.

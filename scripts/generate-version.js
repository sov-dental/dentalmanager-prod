
const fs = require('fs');
const path = require('path');

const version = Date.now().toString();
const content = JSON.stringify({ version });

// Ensure public directory exists
const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

const filePath = path.join(publicDir, 'version.json');

fs.writeFileSync(filePath, content);
console.log(`[Version Check] Generated version.json with timestamp: ${version}`);

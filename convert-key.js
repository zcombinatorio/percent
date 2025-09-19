const bs58 = require('bs58').default;
const fs = require('fs');

// Replace with your actual private key
const privateKeyBase58 = "YOUR_PRIVATE_KEY_HERE";

const privateKeyBytes = bs58.decode(privateKeyBase58);
const jsonArray = Array.from(privateKeyBytes);

fs.writeFileSync('wallet.json', JSON.stringify(jsonArray));
console.log('Converted to wallet.json');
const fs = require('fs');

global.localStorage = { getItem: () => null };
global.document = { addEventListener: () => {} };
global.today = new Date('2026-07-26T12:00:00');
global.formatDateKey = function(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const code = fs.readFileSync('main.js', 'utf8');
const parserCode = code.substring(code.indexOf('const SmartParser = {'), code.indexOf('// --- State & Interactions ---'));
eval(parserCode);


const tests = [
    "remind me to buy grocery at 8pm",
    "remind me to buy grocery at 8:00 pm",
    "buy grocery at 8:00 pm",
    "buy grocery at 8:00 p.m.",
    "gym",
    "idea for a new app",
    "meditate for 10 minutes",
    "read a book"
];

for (const t of tests) {
    const res = SmartParser.parse(t);
    console.log(`Input: "${t}"`);
    console.log(`  Type: ${res.type}`);
    console.log(`  Content: "${res.content}"`);
    console.log(`  Date: ${res.date}`);
    console.log(`  Time: ${res.reminderTime || res.eventTime}`);
    console.log('');
}

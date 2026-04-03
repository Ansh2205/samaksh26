/*
=================================================================
  SAMAKSH 2026 - PRODUCTION SERVER (UPI INTEGRATION)
=================================================================
*/

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');

const app = express();

app.use(express.json());
app.use(cors());

// --- EVENT PRICING CONFIGURATION ---
const PRICES = {
    'finance-parliament': 500, // Change this to your actual price
    'ipl-auction': 800         // Change this to your actual price
};

// --- 1. SECURITY: Basic Authentication ---
const basicAuth = (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    const validUser = process.env.ADMIN_USER || 'admin';
    const validPass = process.env.ADMIN_PASS || 'symbi2025';

    if (login && password && login === validUser && password === validPass) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    res.status(401).send('Authentication required.');
};

app.use('/admin.html', basicAuth);
app.use('/verify.html', basicAuth);

// --- 2. SECURITY: Block Source Code Access ---
app.use((req, res, next) => {
    const reqPath = decodeURIComponent(req.path);
    if (reqPath.startsWith('/Node Serve') || reqPath.includes('server.js') || reqPath.includes('.env') || reqPath.includes('package')) {
        return res.status(403).send('403 Forbidden: Source access denied.');
    }
    next();
});

app.use(express.static(path.join(__dirname)));

// --- 3. DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin-july:Ansh2204@m0.nwuak9s.mongodb.net/?appName=M0' ;

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB');
        const collection = mongoose.connection.db.collection('registrations');
        
        // List of old problematic indexes to drop
        const indexesToDrop = ['groupCode_1', 'entryCode_1'];
        
        for (const idx of indexesToDrop) {
            try {
                await collection.dropIndex(idx);
                console.log(`🧹 Dropped legacy index: ${idx}`);
            } catch (e) {
                // If index doesn't exist, ignore error
            }
        }
    }).catch(err => console.error('❌ DB Error:', err));

// --- 4. SCHEMAS ---
const MemberSchema = new mongoose.Schema({
    name: String, email: String, phone: String, eventName: String, eventValue: String,
    entryCode: { type: String, required: true },
    day1EntryStatus: { type: String, default: 'UNUSED' }, day1EntryAt: Date,
    day2EntryStatus: { type: String, default: 'UNUSED' }, day2EntryAt: Date,
    day1LunchStatus: { type: String, default: 'UNUSED' }, day1LunchAt: Date,
    day2LunchStatus: { type: String, default: 'UNUSED' }, day2LunchAt: Date
});

const RegistrationSchema = new mongoose.Schema({
    entryCode: String, 
    organization: { name: String, contactPerson: String, contactEmail: String, contactPhone: String },
    teams: [{ teamName: String, eventValue: String, eventName: String, members: [MemberSchema] }],
    subTotal: Number, grandTotal: Number,
    paymentStatus: { type: String, default: 'pending' },
    orderId: String, paymentId: String
}, { timestamps: true });

const Registration = mongoose.model('Registration', RegistrationSchema);

/**
 * Generates a unique, recognizable entry code for the fest.
 * Pattern: SMK26-XXXX (where XXXX is random hex)
 */
function generateEntryCode() { 
    return 'SMK26-' + crypto.randomBytes(2).toString('hex').toUpperCase(); 
}

// --- 5. ENDPOINTS ---

app.post('/admin/toggle-payment', basicAuth, async (req, res) => {
    const { registrationId } = req.body;
    try {
        const reg = await Registration.findById(registrationId);
        if (!reg) return res.status(404).json({ error: 'Registration not found' });
        
        // Toggle between 'successful' and 'pending'
        reg.paymentStatus = reg.paymentStatus === 'successful' ? 'pending' : 'successful';
        await reg.save();
        
        res.json({ status: 'success', newStatus: reg.paymentStatus });
    } catch (err) { 
        res.status(500).json({ error: 'Failed to toggle payment' }); 
    }
});

app.post('/submit-registration', async (req, res) => {
    const data = req.body;
    const amount = data.grandTotal;
    const utr = data.utr || 'UPI_MANUAL';

    const escapeRegex = (string) => string ? string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';

    try {
        const primaryEmail = data.organization.contactEmail;
        const primaryName = data.organization.contactPerson;
        
        // Prevent double entries based on Name and Email
        const existingEntry = await Registration.findOne({
            "organization.contactEmail": { $regex: new RegExp(`^${escapeRegex(primaryEmail)}$`, 'i') },
            "organization.contactPerson": { $regex: new RegExp(`^${escapeRegex(primaryName)}$`, 'i') }
        });

        if (existingEntry) {
            return res.status(400).json({ error: 'A registration with this Name and Email already exists. Avoid double entry.' });
        }
    } catch (err) {
        console.error("Duplicate check error:", err);
    }

    if (data.teams && data.teams[0]?.members) {
        data.teams[0].members = data.teams[0].members.map(m => ({ ...m, entryCode: generateEntryCode() }));
    }

    try {
        const newReg = new Registration({ 
            ...data, 
            entryCode: generateEntryCode(), 
            paymentStatus: 'pending', // Default to pending so admin MUST verify it
            paymentId: utr, 
            orderId: 'UPI_' + Date.now() 
        });
        
        const saved = await newReg.save();
        res.json({ status: 'success', registrationId: saved._id, savedRegistration: saved });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: 'Registration failed' }); 
    }
});


app.post('/verify-ticket', async (req, res) => {
    const { entryCode, mode = 'event', day = 'day1' } = req.body;
    try {
        const doc = await Registration.findOne({ "teams.0.members.entryCode": entryCode });
        if (!doc) return res.status(404).json({ status: 'INVALID', message: 'Not found' });
        if (doc.paymentStatus !== 'successful') return res.json({ status: 'PENDING_PAYMENT', message: 'Unpaid' });
        
        const member = doc.teams[0].members.find(m => m.entryCode === entryCode);
        const statusField = `${day}${mode === 'event' ? 'Entry' : 'Lunch'}Status`;
        const dateField = `${day}${mode === 'event' ? 'Entry' : 'Lunch'}At`;

        if (member[statusField] === 'USED') {
            return res.json({ status: 'USED', message: `Already claimed at ${new Date(member[dateField]).toLocaleString()}`, ticket: member });
        }
        res.json({ status: 'VALID', message: 'Valid ticket', ticket: member });
    } catch (err) { res.status(500).send('Error'); }
});

app.post('/mark-ticket-used', basicAuth, async (req, res) => {
    const { entryCode, mode = 'event', day = 'day1' } = req.body;
    try {
        const statusField = `teams.0.members.$.${day}${mode === 'event' ? 'Entry' : 'Lunch'}Status`;
        const dateField = `teams.0.members.$.${day}${mode === 'event' ? 'Entry' : 'Lunch'}At`;
        await Registration.findOneAndUpdate({ "teams.0.members.entryCode": entryCode }, { $set: { [statusField]: 'USED', [dateField]: new Date() } });
        res.json({ status: 'USED_SUCCESS' });
    } catch (err) { res.status(500).send('Error'); }
});

app.get('/admin/registrations', basicAuth, async (req, res) => {
    try {
        const regs = await Registration.find({}).sort({ createdAt: -1 });
        res.json(regs.map(r => ({ id: r._id, paymentStatus: r.paymentStatus, paymentId: r.paymentId, registeredAt: r.createdAt, name: r.organization.contactPerson, email: r.organization.contactEmail, phone: r.organization.contactPhone, totalAmount: r.grandTotal, teams: r.teams })));
    } catch (err) { res.status(500).send('Error'); }
});

app.post('/admin/register-cash', basicAuth, async (req, res) => {
    const { name, email, phone, eventValue, eventName } = req.body;
    const code = generateEntryCode();
    const escapeRegex = (string) => string ? string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    
    try {
        // Prevent double entries based on Name and Email for Cash too
        const existingEntry = await Registration.findOne({
            "organization.contactEmail": { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
            "organization.contactPerson": { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
        });

        if (existingEntry) {
            return res.status(400).json({ error: 'A registration with this Name and Email already exists.' });
        }

        const calculatedAmount = PRICES[eventValue] || 500;

        const newReg = new Registration({
            entryCode: generateEntryCode(), organization: { name: "Cash", contactPerson: name, contactEmail: email, contactPhone: phone },
            teams: [{ teamName: name, eventValue, eventName, members: [{ name, email, phone, eventValue, eventName, entryCode: code }] }],
            grandTotal: calculatedAmount, paymentStatus: 'successful', paymentId: 'CASH'
        });
        const saved = await newReg.save();
        res.json({ status: 'success', registration: { entryCode: code, ...saved.toObject() } });
    } catch (err) { res.status(500).send('Error'); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`🚀 Server on port ${port}`));
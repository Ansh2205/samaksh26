const mongoose = require('mongoose');

// --- 1. Connection URI (must match server.js) ---
const MONGO_URI = 'mongodb://localhost:27017/project-july-26';

// --- 2. Define the Schema/Model (must match server.js) ---
// We only need the model to delete the data, so we simplify the schema definition
const RegistrationSchema = new mongoose.Schema({ /* simplified schema */ });
const Registration = mongoose.model('Registration', RegistrationSchema);

async function clearRegistrations() {
    try {
        // Connect to MongoDB
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB.');

        // Delete all documents in the 'registrations' collection
        const result = await Registration.deleteMany({});
        
        console.log(`\n🎉 Successfully deleted ${result.deletedCount} registration entries!`);

    } catch (error) {
        console.error('❌ Error clearing data:', error.message);
    } finally {
        // Disconnect from MongoDB
        await mongoose.connection.close();
        console.log('🚪 Disconnected from MongoDB.');
        process.exit();
    }
}

clearRegistrations();
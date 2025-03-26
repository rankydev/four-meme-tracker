import mongoose from 'mongoose';

// Mongoose connection options
const options = {
  serverSelectionTimeoutMS: 5000
};

// Database URL
const MONGODB_URI = 'mongodb://localhost:27017/four_meme_tracker';

/**
 * Connect to MongoDB database
 */
export const connectToDatabase = async () => {
  try {
    await mongoose.connect(MONGODB_URI, options);
    console.log('✅ Connected to MongoDB');
    
    // Handle connection errors after initial connection
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
    
    // Handle when the connection is disconnected
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });
    
    // If Node process ends, close the connection
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed due to app termination');
      process.exit(0);
    });
    
    return mongoose.connection;
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
};

/**
 * Get the current database connection
 */
export const getConnection = () => mongoose.connection; 
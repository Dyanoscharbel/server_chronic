
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { User } from './models';

const MONGODB_URI = "mongodb+srv://IFRIHACKATON:20242025@cluster0.hkeivcu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

export async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Vérifier si un admin existe déjà
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      // Créer l'admin par défaut
      const adminPasswordHash = await bcrypt.hash('admin2024', 10);
      const admin = new User({
        firstName: 'Admin',
        lastName: 'System',
        email: 'admin@admin.com',
        passwordHash: adminPasswordHash,
        role: 'admin'
      });
      await admin.save();
      console.log('Admin account created successfully');
    }
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

import { Router, type Express } from "express";
import { createServer, type Server } from "http";
import adminRouter from "./admin-routes";
import { storage } from "./storage";
import mongoose from "mongoose";
import { z } from "zod";
import {
  insertUserSchema,
  insertPatientSchema,
  insertDoctorSchema,
  insertLabTestSchema,
  insertPatientLabResultSchema,
  insertAppointmentSchema,
  insertNotificationSchema,
  insertWorkflowSchema,
  insertWorkflowRequirementSchema,
} from "@shared/schema";
import jwt from "jsonwebtoken";
import session from "express-session";
import MemoryStore from "memorystore";
import bcrypt from "bcrypt";
import {
  User,
  Doctor,
  Patient,
  LabTest,
  PatientLabResult,
  Notification,
  Appointment,
  Workflow,
} from "./models";
// import OpenAI from 'openai'; // Removed OpenAI import

const MemoryStoreSession = MemoryStore(session);

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Services de notification
import nodemailer from "nodemailer";
import twilio from "twilio";
import fs from "fs";
import path from "path";

// Configuration des services de notification
const emailTransporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || "";

// Services de notification
export const notificationService = {
  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log("Email credentials not configured");
      return false;
    }

    try {
      await emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to,
        subject,
        html,
      });
      return true;
    } catch (error) {
      console.error("Failed to send email:", error);
      return false;
    }
  },

  async sendSMS(to: string, body: string): Promise<boolean> {
    if (!twilioClient || !twilioPhoneNumber) {
      console.log("Twilio credentials not configured");
      return false;
    }

    try {
      await twilioClient.messages.create({
        body,
        from: twilioPhoneNumber,
        to,
      });
      return true;
    } catch (error) {
      console.error("Failed to send SMS:", error);
      return false;
    }
  },
};

// const openai = new OpenAI({ // Removed OpenAI instantiation
//   apiKey: process.env.OPENAI_API_KEY
// });

export async function registerRoutes(app: Express): Promise<Server> {
  // Session setup
  app.use(
    session({
      secret: JWT_SECRET,
      resave: false,
      saveUninitialized: false,
      store: new MemoryStoreSession({
        checkPeriod: 86400000, // prune expired entries every 24h
      }),
      cookie: {
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    }),
  );

  // Auth middleware
  const authenticate = (req: any, res: any, next: any) => {
    if (req.session.user) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id: number;
        email: string;
        role: string;
      };
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Invalid token" });
    }
  };

  // Doctor auth middleware
  const requireDoctor = (req: any, res: any, next: any) => {
    const user = req.session.user || req.user;

    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (user.role !== "medecin") {
      return res
        .status(403)
        .json({ message: "Access restricted to doctors only" });
    }

    next();
  };

  // API routes
  const apiRouter = Router();
  app.use("/api", apiRouter);

  // Public routes
  apiRouter.post("/auth/login", async (req, res) => {
    try {
      console.log("Tentative de connexion:", { email: req.body.email });
      const { email, password } = req.body;
      if (!email || !password) {
        console.log("Données manquantes:", {
          email: !!email,
          password: !!password,
        });
        return res
          .status(400)
          .json({ message: "Email et mot de passe requis" });
      }

      // Recherche l'utilisateur avec son email
      const user = await User.findOne({ email });
      console.log("Utilisateur trouvé:", { found: !!user, email });
      if (!user) {
        return res.status(401).json({ message: "Utilisateur non trouvé" });
      }

      // Vérifie le mot de passe
      const isValid = await bcrypt.compare(password, user.passwordHash);
      console.log("Mot de passe vérifié:", { isValid });
      if (!isValid) {
        return res.status(401).json({ message: "Mot de passe incorrect" });
      }

      // Set user in session
      req.session.user = {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      };

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "24h" },
      );

      // Get additional user info based on role
      let userDetails = null;
      if (user.role === "medecin") {
        userDetails = await storage.getDoctorByUserId(user.id);
      } else if (user.role === "patient") {
        userDetails = await storage.getPatientByUserId(user.id);
      }

      // Format the response properly
      res.json({
        token,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        userDetails,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Server error during login" });
    }
  });

  apiRouter.post("/auth/register", async (req, res) => {
    try {
      const { role, ...userData } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "User with this email already exists" });
      }

      // Create appropriate user type based on role
      if (role !== "medecin") {
        return res
          .status(403)
          .json({ message: "Seuls les médecins peuvent s'enregistrer" });
      }

      const { specialty, hospital, ...userFields } = userData;

      // Create user
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const newUser = new User({
        ...userFields,
        role,
        passwordHash: hashedPassword,
      });
      await newUser.save();

      // Create doctor
      const newDoctor = new Doctor({
        user: newUser._id,
        specialty,
        hospital,
      });
      await newDoctor.save();

      const doctor = await Doctor.findById(newDoctor._id).populate("user");
      res
        .status(201)
        .json({
          ...doctor.toObject(),
          user: { ...doctor.user.toObject(), passwordHash: undefined },
        });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Server error during registration" });
    }
  });

  apiRouter.post("/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ success: true });
    });
  });

  // Admin routes
  apiRouter.use("/admin", authenticate, adminRouter);

  // Users routes
  apiRouter.put("/user/profile", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;
      console.log("User ID from session:", userId);
      console.log("Session user:", req.session.user);
      const { firstName, lastName, specialty, hospital } = req.body;

      // Mettre à jour l'utilisateur
      const user = await User.findOneAndUpdate(
        { _id: userId },
        { firstName, lastName, email: req.body.email },
        { new: true },
      ).select("-passwordHash");

      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      // Mettre à jour la session
      req.session.user = {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      };

      // Si c'est un médecin, mettre à jour ses informations supplémentaires
      if (user.role === "medecin") {
        const doctor = await Doctor.findOneAndUpdate(
          { user: userId },
          { specialty, hospital },
          { new: true },
        ).populate("user");
        return res.json({
          user: {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
          },
          userDetails: doctor,
        });
      }

      res.json({ user });
    } catch (error) {
      console.error("Error updating profile:", error);
      res
        .status(500)
        .json({ message: "Erreur lors de la mise à jour du profil" });
    }
  });

  apiRouter.get("/users", authenticate, requireDoctor, async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map((user) => ({ ...user, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Patients routes
  apiRouter.get("/patients", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;

      // Trouver le docteur correspondant à l'utilisateur connecté
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      // Find only patients where doctor field matches the connected doctor's ID
      const patients = await Patient.find({ doctor: doctor._id }).populate({
        path: "user",
        select: "-passwordHash", // Exclude password hash
      });

      // Format response
      const formattedPatients = patients.map((patient) => {
        const patientObj = patient.toObject();
        return {
          ...patientObj,
          user: patientObj.user,
        };
      });

      res.json(formattedPatients);
    } catch (error) {
      console.error("\x1b[31m%s\x1b[0m", "🔴 Error fetching patients:");
      console.error("  Details:", error);
      console.error("  Stack:", error.stack);
      console.error("  Time:", new Date().toISOString());
      console.error("----------------------------------------");
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.get("/patients/:id", authenticate, async (req, res) => {
    try {
      const patientId = req.params.id;
      console.log("Fetching patient with ID:", patientId);

      if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
        console.log("Invalid patient ID:", patientId);
        return res.status(400).json({ message: "Invalid patient ID format" });
      }

      // Recherche le patient avec toutes les informations associées
      // Get the current doctor's ID from the session
      const userId = req.session.user?.id;
      if (!userId) {
        return res
          .status(401)
          .json({ message: "Doctor authentication required" });
      }

      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      const patient = await Patient.findById(patientId)
        .populate({
          path: "user",
          select: "firstName lastName email role",
        })
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "firstName lastName specialty",
          },
        });

      // Set doctor if missing
      if (!patient.doctor) {
        try {
          patient.doctor = doctor._id;
          await patient.save();

          // Reload patient with populated doctor data
          await patient.populate([
            {
              path: "user",
              select: "firstName lastName email role",
            },
            {
              path: "doctor",
              populate: {
                path: "user",
                select: "firstName lastName specialty",
              },
            },
          ]);
        } catch (error) {
          console.error("Error updating doctor:", error);
        }
      }

      if (!patient) {
        console.log("Patient not found for ID:", patientId);
        return res.status(404).json({ message: "Patient not found" });
      }

      console.log("Found patient:", patient);
      res.json({
        ...patient.toObject(),
        id: patient._id, // Ensure ID is included
      });
    } catch (error) {
      console.error("Error fetching patient:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.post("/patients", authenticate, async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        email,
        birthDate,
        gender,
        address,
        phone,
        ckdStage,
      } = req.body;

      // Get user from session
      const user = req.session.user;

      // Check if the authenticated user is a doctor
      if (!user || user.role !== "medecin") {
        return res
          .status(403)
          .json({ message: "Only doctors can create patients" });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "User with this email already exists" });
      }

      // Create new user
      const defaultPassword = "patient2025";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      const newUser = new User({
        firstName,
        lastName,
        email,
        passwordHash,
        role: "patient",
      });
      await newUser.save();

      // Find the doctor associated with the connected user
      const doctor = await Doctor.findOne({ user: user.id });
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      // Create new patient
      const newPatient = new Patient({
        user: newUser._id,
        doctor: doctor._id, // Use doctor._id instead of user.id
        birthDate,
        gender,
        address,
        phone,
        ckdStage,
      });
      await newPatient.save();

      // Fetch the complete patient data with user information
      const patientWithUser = await Patient.findById(newPatient._id).populate(
        "user",
      );

      res.json({
        ...patientWithUser.toObject(),
        user: { ...patientWithUser.user.toObject(), passwordHash: undefined },
      });
    } catch (error) {
      console.error("Create patient error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.put("/patients/:id", authenticate, async (req, res) => {
    try {
      const patientId = req.params.id;
      const {
        firstName,
        lastName,
        email,
        birthDate,
        gender,
        address,
        phone,
        ckdStage,
      } = req.body;

      // Update patient
      const patient = await Patient.findById(patientId);
      if (!patient) {
        return res.status(404).json({ message: "Patient not found" });
      }

      // Update patient data
      patient.birthDate = birthDate;
      patient.gender = gender;
      patient.address = address;
      patient.phone = phone;
      patient.ckdStage = ckdStage;
      await patient.save();

      // Update user data
      await User.findByIdAndUpdate(patient.user, {
        firstName,
        lastName,
        email,
      });

      // Get updated patient with user data
      const updatedPatient = await Patient.findById(patientId).populate("user");

      res.json({
        ...updatedPatient.toObject(),
        user: { ...updatedPatient.user.toObject(), passwordHash: undefined },
      });
    } catch (error) {
      console.error("Update patient error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.delete("/patients/:id", authenticate, async (req, res) => {
    try {
      const patientId = req.params.id;

      // Find the patient first
      const patient = await Patient.findById(patientId);
      if (!patient) {
        return res.status(404).json({ message: "Patient not found" });
      }

      // Delete the patient and user in a transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Delete the patient
        await Patient.findByIdAndDelete(patientId).session(session);

        // Delete the associated user
        await User.findByIdAndDelete(patient.user).session(session);

        // Commit the transaction
        await session.commitTransaction();
        res.json({ success: true });
      } catch (error) {
        // If there's an error, abort the transaction
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } catch (error) {
      console.error("Delete patient error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Doctors routes
  apiRouter.get("/doctors", authenticate, async (req, res) => {
    try {
      const doctors = await storage.getDoctors();
      res.json(
        doctors.map((doctor) => ({
          ...doctor,
          user: { ...doctor.user, passwordHash: undefined },
        })),
      );
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.get("/doctors/:id", authenticate, async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id, 10);
      const doctor = await storage.getDoctorById(doctorId);

      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found" });
      }

      res.json({
        ...doctor,
        user: { ...doctor.user, passwordHash: undefined },
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.post("/doctors", authenticate, async (req, res) => {
    try {
      const { firstName, lastName, email, password, specialty, hospital } =
        req.body;

      const userData = {
        firstName,
        lastName,
        email,
        passwordHash: password,
        role: "medecin",
      };

      const doctorData = {
        specialty,
        hospital,
        userId: 0, // Will be set by the storage implementation
      };

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "User with this email already exists" });
      }

      const doctor = await storage.createDoctor(doctorData, userData);
      res.status(201).json({
        ...doctor,
        user: { ...doctor.user, passwordHash: undefined },
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Lab tests routes
  apiRouter.get("/lab-tests", authenticate, async (req, res) => {
    try {
      // Récupérer les tests depuis MongoDB avec tri et tous les champs
      const labTests = await LabTest.find()
        .select("testName description unit normalMin normalMax category")
        .sort({ category: 1, testName: 1 });

      if (!labTests.length) {
        console.log("No lab tests found in database");
      }

      res.json(labTests);
    } catch (error) {
      console.error("Error fetching lab tests:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.post("/lab-tests", authenticate, async (req, res) => {
    try {
      const labTest = await storage.createLabTest(req.body);
      res.status(201).json(labTest);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Patient lab results routes
  apiRouter.get("/patient-lab-results", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;
      const user = await User.findById(userId);
      if (!user) {
        return res.status(403).json({ message: "User not found" });
      }

      if (user.role === "admin") {
        // Pour les admins, récupérer tous les résultats
        const results = await PatientLabResult.find()
          .populate({
            path: "patient",
            populate: {
              path: "user",
              select: "firstName lastName email",
            },
          })
          .populate({
            path: "doctor",
            populate: {
              path: "user",
              select: "firstName lastName specialty",
            },
          })
          .populate("labTest")
          .lean()
          .sort({ resultDate: -1 });

        return res.json(results);
      }

      // Pour les médecins, récupérer leurs résultats
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      console.log("Fetching lab results for doctor:", doctor._id);

      // Rechercher d'abord les patients de ce docteur
      const patients = await Patient.find({ doctor: doctor._id });

      // Puis trouver les résultats pour ces patients
      const results = await PatientLabResult.find({
        patient: { $in: patients.map((p) => p._id) },
      })
        .populate({
          path: "patient",
          populate: {
            path: "user",
            select: "firstName lastName email",
          },
        })
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "firstName lastName specialty",
          },
        })
        .populate("labTest")
        .lean()
        .sort({ resultDate: -1 });

      console.log("Found results:", results.length);
      res.json(results);
    } catch (error) {
      console.error("Error fetching lab results:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.get(
    "/patient-lab-results/patient/:patientId",
    authenticate,
    async (req, res) => {
      try {
        const patientId = req.params.patientId;
        const results = await PatientLabResult.find({ patient: patientId })
          .populate("labTest")
          .populate({
            path: "doctor",
            populate: {
              path: "user",
              select: "firstName lastName",
            },
          })
          .sort({ resultDate: -1 });
        res.json(results);
      } catch (error) {
        console.error("Error fetching patient lab results:", error);
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  apiRouter.delete(
    "/patient-lab-results/:id",
    authenticate,
    async (req, res) => {
      try {
        const resultId = req.params.id;

        // Démarrer une transaction
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          // Trouver le résultat avant de le supprimer
          const result = await PatientLabResult.findById(resultId);
          if (!result) {
            return res.status(404).json({ message: "Résultat non trouvé" });
          }

          // Supprimer les notifications associées
          await Notification.deleteMany({ labTest: result.labTest }).session(
            session,
          );

          // Supprimer le résultat
          await PatientLabResult.findByIdAndDelete(resultId).session(session);

          // Valider la transaction
          await session.commitTransaction();
          res.json({ success: true });
        } catch (error) {
          // En cas d'erreur, annuler la transaction
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      } catch (error) {
        console.error("Error deleting lab result:", error);
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  apiRouter.post("/patient-lab-results", authenticate, async (req, res) => {
    try {
      const { patientId, labTestId, resultDate } = req.body;
      let { resultValue } = req.body;
      const userId = req.session.user?.id;

      // Convertir la valeur en nombre et remplacer la virgule par un point si nécessaire
      if (typeof resultValue === 'string') {
        resultValue = parseFloat(resultValue.replace(',', '.'));
      }

      // Vérifier si la valeur est un nombre valide
      if (isNaN(resultValue)) {
        return res.status(400).json({ message: "La valeur du résultat doit être un nombre valide" });
      }

      // Trouver le docteur correspondant à l'utilisateur connecté
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      const newResult = new PatientLabResult({
        patient: patientId,
        doctor: doctor._id,
        labTest: labTestId,
        resultValue,
        resultDate,
      });

      await newResult.save();

      // Récupérer les informations du test et du patient pour la notification
      const labTest = await LabTest.findById(labTestId);
      const patient = await Patient.findById(patientId).populate("user");

      // Si c'est un test de créatinine, calculer et sauvegarder le DFG
      if (labTest?.testName.toLowerCase().includes("créatinine")) {
        // Calculer l'âge du patient
        const birthDate = new Date(patient.birthDate);
        const today = new Date();
        const age = today.getFullYear() - birthDate.getFullYear();

        console.log("Valeur brute de créatinine reçue:", resultValue);
        // Valider la créatinine (doit être > 0)
        if (resultValue <= 0) {
          console.error("Valeur de créatinine invalide:", resultValue);
          return res.status(400).json({ message: "Valeur de créatinine invalide" });
        }

        // Calculer le DFG avec la formule MDRD pour patients noirs
        // Créatinine doit être en mg/dL
        let dfg = 186; // Constante de base
        dfg *= Math.pow(resultValue, -1.154); // Facteur créatinine
        dfg *= Math.pow(age, -0.203); // Facteur âge

        // Facteur genre
        if (patient.gender === "F") {
          dfg *= 0.742;
        }

        // Facteur ethnie (pour patients noirs)
        dfg *= 1.212;

        // Limiter le DFG entre 0 et 200
        dfg = Math.max(0, Math.min(200, Math.round(dfg))); // Garder les limites min et max

        console.log(`DFG calculé pour le patient ${patientId}:`, dfg);

        try {
          // Chercher le test DFG dans la base de données
          const dfgTest = await LabTest.findOne({ testName: "DFG estimé" });
          if (dfgTest) {
            // Créer un nouveau résultat DFG
            const dfgResult = await PatientLabResult.create({
              patient: patientId,
              doctor: doctor._id,
              labTest: dfgTest._id,
              resultValue: dfg,
              resultDate: resultDate,
            });
            console.log("DFG enregistré avec succès:", dfgResult);
          }
        } catch (error) {
          console.error("Erreur lors de l'enregistrement du DFG:", error);
        }
      }

      if (patient && labTest) {
        // Calculer l'écart par rapport à la normale
        const normalValue = (labTest.normalMax + labTest.normalMin) / 2;
        const deviation = Math.abs((resultValue - normalValue) / normalValue);
        const isAbnormal =
          resultValue < labTest.normalMin || resultValue > labTest.normalMax;

        let message = "";
        if (deviation > 0.3) {
          message =
            resultValue < normalValue
              ? `ALERTE: Niveau dangereusement bas pour ${labTest.testName}: ${resultValue} ${labTest.unit}`
              : `ALERTE: Niveau dangereusement élevé pour ${labTest.testName}: ${resultValue} ${labTest.unit}`;
        } else if (isAbnormal) {
          message = `Attention: Résultat anormal pour ${labTest.testName}: ${resultValue} ${labTest.unit}`;
        } else {
          message = `Nouveau résultat normal pour ${labTest.testName}: ${resultValue} ${labTest.unit}`;
        }

        // Créer la notification dans MongoDB
        // Vérifier si c'est un test de DFG ou résultat DFG calculé
        const isDFGTest = labTest?.testName.toLowerCase().includes('dfg') || labTest?.testName.toLowerCase().includes('créatinine');

        const newNotification = new Notification({
          patientId: patient._id,
          doctorId: doctor._id,
          labTest: labTest._id,
          message: `Patient ${patient.user.firstName} ${patient.user.lastName}: ${message}`,
          severity: isDFGTest ? "dfg" : (deviation > 0.3 ? "error" : isAbnormal ? "warning" : "info"),
          isRead: false,
          createdAt: new Date(),
        });

        await newNotification.save();

        // Vérifier si c'est un test de créatinine
        if (labTest?.testName.toLowerCase().includes("créatinine")) {
          // Récupérer les informations du patient
          const patient = await Patient.findById(patientId).populate("user");
          if (patient) {
            // Calculer l'âge
            const birthDate = new Date(patient.birthDate);
            const age = new Date().getFullYear() - birthDate.getFullYear();

            // Calculer le DFG avec la formule MDRD
            const dfg = calculateMDRD(resultValue, age, patient.gender === "F");

            // Déterminer le nouveau stade CKD
            const newStage = determineCKDStage(dfg);

            // Mettre à jour le stade du patient si changé
            if (patient.ckdStage !== newStage) {
              patient.ckdStage = newStage;
              await patient.save();

              // Créer une notification pour le changement de stade
              const notification = new Notification({
                patientId: patient._id,
                doctorId: patient.doctor,
                message: `Le stade MRC de ${patient.user.firstName} ${patient.user.lastName} a changé: ${newStage} (DFG: ${dfg} mL/min/1.73m²)`,
                severity: "warning",
                isRead: false,
              });
              await notification.save();
            }

            // Sauvegarder le DFG comme résultat séparé
            const egfrTest = await LabTest.findOne({ testName: "DFG" });
            if (egfrTest) {
              await PatientLabResult.create({
                patient: patientId,
                doctor: patient.doctor,
                labTest: egfrTest._id,
                resultValue: dfg,
                resultDate,
              });
            }
          }
        }

        // Template d'email pour le docteur
        const doctorEmailTemplate = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <<h1 style="color: #2563eb;">Système de Suivi CKD</h1>
              <hr style="border: 1px solid #eee;">
            </div>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
              <h2 style="color: #1e40af; margin-bottom: 15px;">Nouvelle Notification Médicale</h2>
              <p style="color: #374151; line-height: 1.6;">${newNotification.message}</p>
              <p style="color: #374151;"><strong>Niveau de Sévérité:</strong> 
                <span style="color: ${newNotification.severity === "error" ? "#dc2626" : newNotification.severity === "warning" ? "#d97706" : "#059669"}">
                  ${newNotification.severity}
                </span>
              </p>
              <p style="color: #374151;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
            <div style="font-size: 12px; color: #6b7280; text-align: center; margin-top: 20px;">
              <p>Ce message a été envoyé automatiquement par le Système de Suivi CKD.</p>
              <p>Ne pas répondre à cet email.</p>
            </div>
          </div>
        `;

        // Récupérer les informations complètes du docteur
        const doctorWithUser = await Doctor.findById(doctor._id).populate(
          "user",
        );

        // Template d'email pour le patient
        const patientEmailTemplate = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h1 style="color: #2563eb;">Système de Suivi CKD</h1>
              <hr style="border: 1px solid #eee;">
            </div>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
              <h2 style="color: #1e40af; margin-bottom: 15px;">Nouveau Résultat de Test</h2>
              <div style="margin-bottom: 15px;">
                <p style="color: #374151; margin: 5px 0;"><strong>Test:</strong> ${labTest.testName}</p>
                <p style="color: #374151; margin: 5px 0;"><strong>Valeur:</strong> ${resultValue} ${labTest.unit}</p>
                <p style="color: #374151; margin: 5px 0;"><strong>Plage normale:</strong> ${labTest.normalMin} - ${labTest.normalMax} ${labTest.unit}</p>
                <p style="color: #374151; margin: 5px 0;"><strong>Date du test:</strong> ${new Date().toLocaleDateString()}</p>
              </div>
              <div style="background-color: #e5e7eb; padding: 10px; border-radius: 3px;">
                <p style="color: #4b5563; margin: 0;">Votre médecin, Dr. ${doctorWithUser.user.firstName} ${doctorWithUser.user.lastName}, a été notifié deces résultats.</p>
              </div>
            </div>
            <div style="font-size: 12px; color: #6b7280; text-align: center; margin-top: 20px;">
              <p>Ce message a été envoyé automatiquement par le Système de Suivi CKD.</p>
              <p>Pour toute question, veuillez contacter votre médecin.</p>
            </div>
          </div>
        `;

        // Envoyer l'email uniquement au patient
        await notificationService.sendEmail(
          patient.user.email,
          "Nouveau résultat de laboratoire",
          patientEmailTemplate,
        );
      }

      res.status(201).json(newResult);
    } catch (error) {
      console.error("Error creating lab result:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Appointments routes
  apiRouter.get("/appointments", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;

      // Find the doctor associated with the connected user
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      // Get appointments for this doctor only
      const appointments = await Appointment.find({ doctor: doctor._id });

      // Mettre à jour le statut des rendez-vous passés
      const now = new Date();
      const updatedAppointments = await Promise.all(
        appointments.map(async (appointment) => {
          if (
            new Date(appointment.appointmentDate) < now &&
            appointment.doctorStatus !== "confirmed" &&
            appointment.patientStatus !== "confirmed"
          ) {
            appointment.doctorStatus = "completed";
            appointment.patientStatus = "completed";
            await appointment.save();
          }
          return appointment;
        }),
      );

      // Récupérer les rendez-vous avec les informations complètes
      const populatedAppointments = await Appointment.find({
        doctor: doctor._id,
      })
        .populate({
          path: "patient",
          populate: {
            path: "user",
            select: "firstName lastName email",
          },
        })
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "firstName lastName specialty",
          },
        })
        .lean()
        .sort({ appointmentDate: 1 });

      // Log for debugging with complete data
      console.log(
        "Appointments found:",
        JSON.stringify(populatedAppointments, null, 2),
      );

      res.json(populatedAppointments);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.get(
    "/appointments/patient/:patientId",
    authenticate,
    async (req, res) => {
      try {
        const patientId = parseInt(req.params.patientId, 10);
        const appointments =
          await storage.getAppointmentsByPatientId(patientId);
        res.json(appointments);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  apiRouter.get(
    "/appointments/doctor/:doctorId",
    authenticate,
    async (req, res) => {
      try {
        const doctorId = parseInt(req.params.doctorId, 10);
        const appointments = await storage.getAppointmentsByDoctorId(doctorId);
        res.json(appointments);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  apiRouter.post("/appointments", authenticate, async (req, res) => {
    try {
      const { patientId, appointmentDate, purpose } = req.body;

      // Validation des données
      if (!patientId || !appointmentDate || !purpose) {
        return res.status(400).json({
          message: "Données manquantes",
          details: {
            patientId: !patientId ? "ID du patient requis" : null,
            appointmentDate: !appointmentDate
              ? "Date du rendez-vous requise"
              : null,
            purpose: !purpose ? "Motif du rendez-vous requis" : null,
          },
        });
      }

      const userId = req.session.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Utilisateur non authentifié" });
      }

      // Vérifier le docteur
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        console.error("Doctor not found for user:", userId);
        return res.status(403).json({ message: "Médecin non trouvé" });
      }

      // Vérifier le patient
      const patient = await Patient.findById(patientId);
      if (!patient) {
        console.error("Patient not found:", patientId);
        return res.status(404).json({ message: "Patient non trouvé" });
      }

      // Vérifier si la date est dans le passé
      const appointmentDateTime = new Date(appointmentDate);
      if (appointmentDateTime < new Date()) {
        return res
          .status(400)
          .json({
            message: "La date du rendez-vous ne peut pas être dans le passé",
          });
      }

      // Créer le rendez-vous
      const newAppointment = new Appointment({
        patient: patientId,
        doctor: doctor._id,
        appointmentDate: appointmentDateTime,
        purpose,
        doctorStatus: "pending",
        patientStatus: "pending",
      });

      await newAppointment.save();

      // Get patient and doctor with email
      const patientWithEmail =
        await Patient.findById(patientId).populate("user");
      const doctorWithUser = await Doctor.findById(doctor._id).populate("user");

      if (!patientWithEmail?.user?.email) {
        console.error("Patient email not found");
        return res.status(400).json({ message: "Patient email not found" });
      }

      if (!doctorWithUser?.user) {
        console.error("Doctor user info not found");
        return res
          .status(400)
          .json({ message: "Doctor information incomplete" });
      }

      // Template d'email pour le patient
      const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #2563eb;">Confirmation de Rendez-vous</h1>
            <hr style="border: 1px solid #eee;">
          </div>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
            <h2 style="color: #1e40af; margin-bottom: 15px;">Détails du Rendez-vous</h2>
            <p style="color: #374151;"><strong>Date:</strong> ${new Date(appointmentDateTime).toLocaleDateString()}</p>
            <p style="color: #374151;"><strong>Heure:</strong> ${new Date(appointmentDateTime).toLocaleTimeString()}</p>
            <p style="color: #374151;"><strong>Motif:</strong> ${purpose}</p>
            <p style="color: #374151;"><strong>Médecin:</strong> Dr. ${doctorWithUser.user.firstName} ${doctorWithUser.user.lastName}</p>
            <p style="color: #374151;"><strong>Lieu:</strong> ${doctorWithUser.hospital}</p>
          </div>
        </div>
      `;

      // Envoyer l'email au patient uniquement
      await notificationService.sendEmail(
        patientWithEmail.user.email,
        "Confirmation de votre rendez-vous médical",
        emailTemplate,
      );

      // Récupérer le rendez-vous avec les informations complètes
      const savedAppointment = await Appointment.findById(newAppointment._id)
        .populate({
          path: "patient",
          populate: {
            path: "user",
            select: "firstName lastName email",
          },
        })
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "firstName lastName specialty",
          },
        });

      console.log("Appointment created successfully:", savedAppointment._id);
      res.status(201).json(savedAppointment);
    } catch (error) {
      console.error("Error creating appointment:", error);
      if (error.name === "ValidationError") {
        return res.status(400).json({
          message: "Erreur de validation",
          details: Object.keys(error.errors).reduce((acc, key) => {
            acc[key] = error.errors[key].message;
            return acc;
          }, {}),
        });
      }
      res
        .status(500)
        .json({ message: "Erreur serveur lors de la création du rendez-vous" });
    }
  });

  apiRouter.put("/appointments/:id/status", authenticate, async (req, res) => {
    try {
      const appointmentId = req.params.id;
      const { status, userType } = req.body;
      const userId = req.session.user?.id;

      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      if (userType === "doctor") {
        const doctor = await Doctor.findOne({ user: userId });
        if (!doctor || !doctor._id.equals(appointment.doctor)) {
          return res.status(403).json({ message: "Not authorized" });
        }
        appointment.doctorStatus = status;
      } else if (userType === "patient") {
        const patient = await Patient.findOne({ user: userId });
        if (!patient || !patient._id.equals(appointment.patient)) {
          return res.status(403).json({ message: "Not authorized" });
        }
        appointment.patientStatus = status;
      }

      await appointment.save();
      res.json(appointment);
    } catch (error) {
      console.error("Error updating appointment status:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.delete("/appointments/:id", authenticate, async (req, res) => {
    try {
      const appointmentId = req.params.id;

      // Vérifier si le rendez-vous existe
      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ message: "Rendez-vous non trouvé" });
      }

      // Supprimer le rendez-vous
      await Appointment.findByIdAndDelete(appointmentId);

      // Répondre avec succès
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting appointment:", error);
      res
        .status(500)
        .json({ message: "Erreur serveur lors de la suppression" });
    }
  });

  // Notifications routes
  apiRouter.get("/notifications", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;
      const doctor = await Doctor.findOne({ user: userId }).select("_id");
      if (!doctor) {
        return res.status(403).json({ message: "Doctor not found" });
      }

      // Récupérer les notifications pour ce docteur
      const notifications = await Notification.find({ doctorId: doctor._id })
        .populate({
          path: "patientId",
          populate: {
            path: "user",
            select: "firstName lastName",
          },
        })
        .sort({ createdAt: -1 });

      // Compter les notifications critiques
      const criticalCount = await Notification.countDocuments({
        doctorId: doctor._id,
        severity: "error",
        isRead: false,
      });

      res.json({ notifications, criticalCount });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.post(
    "/notifications/mark-read/:id",
    authenticate,
    async (req, res) => {
      try {
        const notificationId = req.params.id;
        const notification = await Notification.findByIdAndUpdate(
          notificationId,
          { isRead: true },
          { new: true },
        );

        if (!notification) {
          return res.status(404).json({ message: "Notification not found" });
        }

        res.json(notification);
      } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  apiRouter.post(
    "/notifications/mark-all-read",
    authenticate,
    async (req, res) => {
      try {
        const userId = req.session.user?.id;

        // Trouver le docteur connecté
        const doctor = await Doctor.findOne({ user: userId });
        if (!doctor) {
          return res.status(403).json({ message: "Doctor not found" });
        }

        // Mettre à jour toutes les notifications du docteur
        const result = await Notification.updateMany(
          { doctorId: doctor._id, isRead: false },
          { isRead: true },
        );

        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Error marking all notifications as read:", error);
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  apiRouter.post("/notifications", authenticate, async (req, res) => {
    try {
      const notification = await storage.createNotification(req.body);
      res.status(201).json(notification);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Workflow routes
  apiRouter.get("/workflows", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res.status(403).json({ message: "Doctor not found" });
      }

      const workflows = await Workflow.find({ createdBy: doctor._id });
      res.json(workflows);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.delete("/workflows/:id", authenticate, async (req, res) => {
    try {
      const workflowId = req.params.id;
      const userId = req.session.user?.id;

      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res.status(403).json({ message: "Doctor not found" });
      }

      const workflow = await Workflow.findOne({
        _id: workflowId,
        createdBy: doctor._id,
      });
      if (!workflow) {
        return res.status(404).json({ message: "Workflow not found" });
      }

      await Workflow.findByIdAndDelete(workflowId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.get("/workflows/:id", authenticate, async (req, res) => {
    try {
      const workflowId = parseInt(req.params.id, 10);
      const workflow = await storage.getWorkflowById(workflowId);

      if (!workflow) {
        return res.status(404).json({ message: "Workflow not found" });
      }

      const requirements = await storage.getWorkflowRequirements(workflowId);
      res.json({ ...workflow, requirements });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.post("/workflows", authenticate, async (req, res) => {
    try {
      const { name, description, ckdStage, requirements } = req.body;

      const userId = req.session.user?.id;
      console.log("Creating workflow for user:", userId);

      const doctor = await Doctor.findOne({ user: userId });
      console.log("Found doctor:", doctor);

      if (!doctor) {
        return res.status(403).json({ message: "Doctor not found" });
      }

      const workflow = new Workflow({
        name,
        description,
        ckdStage,
        createdBy: doctor._id,
        requirements,
      });

      await workflow.save();

      // Chercher tous les patients du même stage CKD
      const patientsWithStage = await Patient.find({
        ckdStage: workflow.ckdStage,
        doctor: doctor._id,
      }).populate("user");

      // Récupérer les informations complètes du médecin
      const doctorWithUser = await Doctor.findById(doctor._id).populate("user");

      // Envoyer un email au médecin
      const doctorEmailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #2563eb;">Nouveau Workflow Créé</h1>
            <hr style="border: 1px solid #eee;">
          </div>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
            <h2 style="color: #1e40af; margin-bottom: 15px;">${workflow.name}</h2>
            <p style="color: #374151; line-height: 1.6;">${workflow.description}</p>
            <p style="color: #374151;"><strong>Stage CKD:</strong> ${workflow.ckdStage}</p>
            <p style="color: #374151;"><strong>Nombre de patients concernés:</strong> ${patientsWithStage.length}</p>
            <div style="background-color: #e5e7eb; padding: 10px; border-radius: 3px; margin-top: 15px;">
              <p style="color: #4b5563; margin: 5px 0;"><strong>Créé par:</strong> Dr. ${doctorWithUser.user.firstName} ${doctorWithUser.user.lastName}</p>
              <p style="color: #4b5563; margin: 5px 0;"><strong>Spécialité:</strong> ${doctorWithUser.specialty}</p>
              <p style="color: #4b5563; margin: 5px 0;"><strong>Hôpital:</strong> ${doctorWithUser.hospital}</p>
            </div>
            <div style="margin-top: 15px;">
              <h3 style="color: #1e40af;">Exigences du workflow:</h3>
              ${workflow.requirements
                .map(
                  (req) => `
                <div style="border-left: 3px solid #2563eb; padding-left: 10px; margin: 10px 0;">
                  <p style="color: #374151; margin: 3px 0;"><strong>Test:</strong> ${req.testName}</p>
                  <p style="color: #374151; margin: 3px 0;"><strong>Fréquence:</strong> ${req.frequency}</p>
                  <p style="color: #374151; margin: 3px 0;"><strong>Alerte:</strong> ${req.alert.type} ${req.alert.value} ${req.alert.unit}</p>
                  <p style="color: #374151; margin: 3px 0;"><strong>Action:</strong> ${req.action}</p>
                </div>
              `,
                )
                .join("")}
            </div>
          </div>
        </div>
      `;

      await notificationService.sendEmail(
        doctor.user.email,
        "Nouveau workflow créé",
        doctorEmailTemplate,
      );

      // Envoyer un email à chaque patient concerné
      for (const patient of patientsWithStage) {
        const patientEmailTemplate = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h1 style="color: #2563eb;">Nouveau Protocole de Suivi</h1>
              <hr style="border: 1px solid #eee;">
            </div>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
              <p style="color: #374151;">Cher(e) ${patient.user.firstName} ${patient.user.lastName},</p>
              <p style="color: #374151; line-height: 1.6;">
                Votre médecin, Dr. ${doctorWithUser.user.firstName} ${doctorWithUser.user.lastName}, 
                a mis en place un nouveau protocole de suivi pour votre stade CKD (${workflow.ckdStage}).
              </p>
              <h3 style="color: #1e40af;">${workflow.name}</h3>
              <p style="color: #374151;">${workflow.description}</p>
              <div style="background-color: #e5e7eb; padding: 10px; border-radius: 3px; margin-top: 15px;">
                <p style="color: #4b5563; margin: 0;">
                  Ce protocole aidera à mieux suivre l'évolution de votre état de santé.
                  N'hésitez pas à contacter votre médecin pour plus d'informations.
                </p>
              </div>
            </div>
          </div>
        `;

        await notificationService.sendEmail(
          patient.user.email,
          "Nouveau protocole de suivi mis en place",
          patientEmailTemplate,
        );
      }

      res.status(201).json(workflow);
    } catch (error) {
      console.error("Error creating workflow:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  apiRouter.post(
    "/workflows/:id/requirements",
    authenticate,
    async (req, res) => {
      try {
        const workflowId = parseInt(req.params.id, 10);

        // Verify the workflow exists
        const workflow = await storage.getWorkflowById(workflowId);
        if (!workflow) {
          return res.status(404).json({ message: "Workflow not found" });
        }

        const requirement = await storage.addWorkflowRequirement({
          ...req.body,
          workflowId,
        });

        res.status(201).json(requirement);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  // Dashboard statistics
  apiRouter.get("/dashboard/stats", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;
      const doctor = await Doctor.findOne({ user: userId }).select("_id");
      if (!doctor) {
        return res
          .status(403)
          .json({ message: "Doctor not found for the connected user" });
      }

      // Find only patients where doctor field matches the connected doctor's ID
      const patients = await Patient.find({ doctor: doctor._id });
      const appointments = await storage.getAppointments();
      const results = await storage.getPatientLabResults();

      // Count all appointments for the connected doctor
      const totalAppointments = await Appointment.countDocuments({
        doctor: doctor._id,
      });

      // Simulate some critical alerts for demo
      const criticalAlerts = 3;

      // Pending lab results - same approach
      const pendingLabResults = 8;

      // Calculate CKD stage distribution for doctor's patients only
      const stageDistribution = {
        "Stage 1": 0,
        "Stage 2": 0,
        "Stage 3A": 0,
        "Stage 3B": 0,
        "Stage 4": 0,
        "Stage 5": 0,
      };

      // Only count patients belonging to the connected doctor
      const doctorPatients = await Patient.find({ doctor: doctor._id });
      doctorPatients.forEach((patient) => {
        if (
          patient.ckdStage &&
          stageDistribution.hasOwnProperty(patient.ckdStage)
        ) {
          (stageDistribution as any)[patient.ckdStage]++;
        }
      });

      // eGFR trend data (mock for demo)
      const months = ["January", "February", "March", "April", "May", "June"];
      const egfrTrend = months.map((month, index) => ({
        month,
        value: 52 - index,
      }));

      res.json({
        totalPatients: patients.length,
        totalAppointments,
        criticalAlerts,
        pendingLabResults,
        stageDistribution,
        egfrTrend,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Recent patients for dashboard
  apiRouter.get(
    "/dashboard/recent-patients",
    authenticate,
    async (req, res) => {
      try {
        // Get doctor ID from session
        const doctorId = req.session.user?.id;

        // Calculate date 6 months ago
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        // Find most recently added patients for this doctor
        const recentPatients = await Patient.find({
          doctor: doctorId,
          user: { $ne: null }, // Ensure user exists
        })
          .populate("user")
          .sort({ createdAt: -1 }) // Tri par date de création décroissante
          .limit(4); // Limite aux 4 derniers patients

        // Augment with latest eGFR value where available
        const enhancedPatients = await Promise.all(
          recentPatients.map(async (patient) => {
            // Get patient lab results
            const patientResults =
              await storage.getPatientLabResultsByPatientId(patient.id);

            // Find eGFR test results
            const eGFRResults = patientResults.filter(
              (r) => r.labTestId === 1, // Assuming eGFR test ID is 1
            );

            // Sort by date to get latest
            eGFRResults.sort(
              (a, b) =>
                new Date(b.resultDate).getTime() -
                new Date(a.resultDate).getTime(),
            );

            const latestEGFR =
              eGFRResults.length > 0 ? eGFRResults[0].resultValue : null;

            // Get last appointment as "last visit" date
            const appointments = await storage.getAppointmentsByPatientId(
              patient.id,
            );
            appointments.sort(
              (a, b) =>
                new Date(b.appointmentDate).getTime() -
                new Date(a.appointmentDate).getTime(),
            );

            const lastVisit =
              appointments.length > 0 ? appointments[0].appointmentDate : null;

            // Calculate age from birth date
            const birthDate = new Date(patient.birthDate);
            const ageDifMs = Date.now() - birthDate.getTime();
            const ageDate = new Date(ageDifMs);
            const age = Math.abs(ageDate.getUTCFullYear() - 1970);

            return {
              ...patient,
              user: { ...patient.user, passwordHash: undefined },
              age,
              latestEGFR,
              lastVisit,
            };
          }),
        );

        res.json(enhancedPatients);
      } catch (error) {
        console.error("Dashboard recent patients error:", error);
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  // Upcoming appointments for dashboard
  apiRouter.get(
    "/dashboard/upcoming-appointments",
    authenticate,
    async (req, res) => {
      try {
        const userId = req.session.user?.id;
        console.log("Looking for doctor with user ID:", userId);
        const doctor = await Doctor.findOne({ user: userId });
        if (!doctor) {
          console.log("No doctor found for user ID:", userId);
          return res.status(403).json({ message: "Doctor not found" });
        }
        console.log("Found doctor:", doctor._id);

        console.log("Fetching appointments for doctor:", doctor._id);

        // Get all appointments for this doctor without any filters
        const appointments = await Appointment.find({ doctor: doctor._id })
          .populate({
            path: "patient",
            populate: {
              path: "user",
              select: "firstName lastName email",
            },
          })
          .populate({
            path: "doctor",
            populate: {
              path: "user",
              select: "firstName lastName specialty",
            },
          })
          .sort({ appointmentDate: -1 }) // Les plus récents d'abord
          .limit(3);

        // Augment with patient and doctor details
        const enhancedAppointments = await Promise.all(
          appointments.map(async (apt) => {
            const patient = await storage.getPatientById(apt.patient);
            const doctor = await storage.getDoctorById(apt.doctor);

            return {
              ...apt,
              patient: patient
                ? {
                    id: patient.id,
                    firstName: patient.user.firstName,
                    lastName: patient.user.lastName,
                    initials: `${patient.user.firstName.charAt(0)}${patient.user.lastName.charAt(0)}`,
                  }
                : null,
              doctor: doctor
                ? {
                    id: doctor.id,
                    firstName: doctor.user.firstName,
                    lastName: doctor.user.lastName,
                  }
                : null,
            };
          }),
        );

        res.json(enhancedAppointments);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  // Recent alerts for dashboard
  apiRouter.get("/dashboard/recent-alerts", authenticate, async (req, res) => {
    try {
      // For demo purposes, generate sample alerts
      const alerts = [
        {
          id: 1,
          type: "critical",
          title: "Critical eGFR Decline",
          message:
            "Fatou Coulibaly's eGFR dropped from 29 to 22 in the last 3 months",
          patientId: 4,
          patientInitials: "FC",
          time: "1 hour ago",
        },
        {
          id: 2,
          type: "warning",
          title: "Elevated Blood Pressure",
          message:
            "Robert Moussoh's last three BP readings were above 160/95 mmHg",
          patientId: 1,
          patientInitials: "RM",
          time: "3 hours ago",
        },
        {
          id: 3,
          type: "info",
          title: "Missed Appointment",
          message: "Abdul Traore missed his scheduled appointment on June 12",
          patientId: 3,
          patientInitials: "AT",
          time: "Yesterday",
        },
      ];

      res.json(alerts);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Routes pour la gestion du thème
  apiRouter.post("/user/theme", authenticate, async (req, res) => {
    try {
      const { primaryColor, variant, appearance, radius } = req.body;

      // Mettre à jour le fichier theme.json
      const themePath = path.resolve(process.cwd(), "theme.json");
      const themeData = {
        primary: primaryColor,
        variant,
        appearance,
        radius,
      };

      fs.writeFileSync(themePath, JSON.stringify(themeData, null, 2));

      res.json({ success: true, message: "Theme updated successfully" });
    } catch (error) {
      console.error("Error updating theme:", error);
      res.status(500).json({ message: "Failed to update theme" });
    }
  });

  // Routes pour le changement de mot de passe
  apiRouter.post("/user/change-password", authenticate, async (req, res) => {
    try {
      const userId = req.session.user?.id;
      const { currentPassword, newPassword } = req.body;

      // Trouver l'utilisateur
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      // Vérifier l'ancien mot de passe
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        return res
          .status(401)
          .json({ message: "Mot de passe actuel incorrect" });
      }

      // Hasher et sauvegarder le nouveau mot de passe
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.passwordHash = hashedPassword;
      await user.save();

      res.json({ success: true });
    } catch (error) {
      console.error("Erreur changement mot de passe:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  apiRouter.put("/workflows/:id", authenticate, async (req, res) => {
    try {
      const workflowId = req.params.id;
      const userId = req.session.user?.id;
      const { name, description, ckdStage, requirements } = req.body;

      // Vérifier le docteur
      const doctor = await Doctor.findOne({ user: userId });
      if (!doctor) {
        return res.status(403).json({ message: "Doctor not found" });
      }

      // Trouver et mettre à jour le workflow
      const workflow = await Workflow.findOne({
        _id: workflowId,
        createdBy: doctor._id,
      });
      if (!workflow) {
        return res.status(404).json({ message: "Workflow not found" });
      }

      // Mettre à jour les champs
      workflow.name = name;
      workflow.description = description;
      workflow.ckdStage = ckdStage;
      workflow.requirements = requirements;

      // Sauvegarder les modifications
      await workflow.save();

      res.json(workflow);
    } catch (error) {
      console.error("Error updating workflow:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/chatbot", authenticate, async (req, res) => {
    try {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY not found");
        return res.status(500).json({ message: "Configuration API manquante" });
      }
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        apiVersion: "v1beta",
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
      });

      const chat = model.startChat({
        context:
          "Vous êtes un assistant médical spécialisé dans la néphrologie et les maladies rénales. Répondez de manière professionnelle et précise.",
      });

      const result = await chat.sendMessage(req.body.message);
      const response = await result.response;

      res.json({
        message: response.text(),
      });
    } catch (error) {
      console.error("Gemini Error:", error);
      res.status(500).json({
        message: "Erreur lors de la communication avec l'assistant",
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}

// Add functions to calculate MDRD and determine CKD stage
function calculateMDRD(
  creatinine: number,
  age: number,
  isFemale: boolean,
): number {
  // Implement MDRD formula for Black patients here.  This is a placeholder.
  // Consider using a more accurate and updated formula if available.
  // This formula is simplified and may not be clinically accurate.
  let dfg = 186 * Math.pow(creatinine, -1.154) * Math.pow(age, -0.203);
  if (isFemale) {
    dfg *= 0.742;
  }
  return Math.round(dfg);
}

function determineCKDStage(dfg: number): string {
  // Implement CKD staging based on DFG value here. This is a placeholder.
  //  Replace with actual CKD staging guidelines.
  if (dfg >= 90) return "Stage 1";
  if (dfg >= 60) return "Stage 2";
  if (dfg >= 45) return "Stage 3A";
  if (dfg >= 30) return "Stage 3B";
  if (dfg >= 15) return "Stage 4";
  return "Stage 5";
}
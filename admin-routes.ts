import { Router } from "express";
import { Doctor, User, Patient, LabTest, PatientLabResult, Workflow, Appointment } from './models';
import bcrypt from 'bcrypt';

const adminRouter = Router();

// Middleware pour vérifier si l'utilisateur est admin
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.session.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Accès réservé aux administrateurs' });
  }
  next();
};

// Statistiques admin
adminRouter.get('/stats', requireAdmin, async (req, res) => {
  try {
    const totalDoctors = await Doctor.countDocuments();
    const totalPatients = await Patient.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalAppointments = await Appointment.countDocuments();
    const totalLabResults = await PatientLabResult.countDocuments();

    const patientsByStage = await Patient.aggregate([
      { $group: { _id: "$ckdStage", count: { $sum: 1 } } }
    ]);

    res.json({
      totalDoctors,
      totalPatients,
      totalUsers,
      totalAppointments,
      totalLabResults,
      patientsByStage
    });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// CRUD Médecins
adminRouter.get('/doctors', requireAdmin, async (req, res) => {
  try {
    const doctors = await Doctor.find().populate('user');
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

adminRouter.post('/doctors', requireAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, specialty, hospital } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Un utilisateur avec cet email existe déjà' });
    }

    const user = await User.create({
      email,
      passwordHash: await bcrypt.hash(password, 10),
      firstName,
      lastName,
      role: 'medecin'
    });

    const doctor = await Doctor.create({
      user: user._id,
      specialty,
      hospital
    });

    const populatedDoctor = await doctor.populate('user');
    res.status(201).json(populatedDoctor);
  } catch (error) {
    console.error('Erreur création médecin:', error);
    res.status(500).json({ message: 'Erreur lors de la création du médecin' });
  }
});

adminRouter.put('/doctors/:id', requireAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, specialty, hospital } = req.body;
    const doctorId = req.params.id;

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Médecin non trouvé' });
    }

    await User.findByIdAndUpdate(doctor.user, {
      firstName,
      lastName,
      email
    });

    doctor.specialty = specialty;
    doctor.hospital = hospital;
    await doctor.save();

    const updatedDoctor = await Doctor.findById(doctorId).populate('user');
    res.json(updatedDoctor);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

adminRouter.delete('/doctors/:id', requireAdmin, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ message: 'Médecin non trouvé' });
    }

    // Supprimer le médecin et l'utilisateur associé
    await Doctor.findByIdAndDelete(req.params.id);
    await User.findByIdAndDelete(doctor.user);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// CRUD Patients
adminRouter.get('/patients', requireAdmin, async (req, res) => {
  try {
    const patients = await Patient.find()
      .populate('user')
      .populate({
        path: 'doctor',
        populate: { path: 'user' }
      });
    res.json(patients);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

adminRouter.post('/patients', requireAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, doctorId, birthDate, gender, address, phone, ckdStage } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email déjà utilisé' });
    }

    const passwordHash = await bcrypt.hash('patient2024', 10);
    const newUser = new User({
      firstName,
      lastName,
      email,
      passwordHash,
      role: 'patient'
    });
    await newUser.save();

    const newPatient = new Patient({
      user: newUser._id,
      doctor: doctorId,
      birthDate,
      gender,
      address,
      phone,
      ckdStage
    });
    await newPatient.save();

    const patient = await Patient.findById(newPatient._id)
      .populate('user')
      .populate({
        path: 'doctor',
        populate: { path: 'user' }
      });

    res.status(201).json(patient);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

adminRouter.put('/patients/:id', async (req, res) => { // Modification ici
  try {
    const { firstName, lastName, email, doctorId, birthDate, gender, address, phone, ckdStage } = req.body;
    const patientId = req.params.id;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient non trouvé' });
    }

    await User.findByIdAndUpdate(patient.user, {
      firstName,
      lastName,
      email
    });

    patient.doctor = doctorId;
    patient.birthDate = birthDate;
    patient.gender = gender;
    patient.address = address;
    patient.phone = phone;
    patient.ckdStage = ckdStage;
    await patient.save();

    const updatedPatient = await Patient.findById(patientId)
      .populate('user')
      .populate({
        path: 'doctor',
        populate: { path: 'user' }
      });

    res.json(updatedPatient);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

adminRouter.delete('/patients/:id', requireAdmin, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ message: 'Patient non trouvé' });
    }

    // Supprimer le patient et l'utilisateur associé
    await Patient.findByIdAndDelete(req.params.id);
    await User.findByIdAndDelete(patient.user);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Gestion des rendez-vous
adminRouter.get('/appointments', requireAdmin, async (req, res) => {
  try {
    const appointments = await Appointment.find()
      .populate({
        path: 'patient',
        populate: { path: 'user' }
      })
      .populate({
        path: 'doctor',
        populate: { path: 'user' }
      })
      .sort({ appointmentDate: -1 });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Gestion des résultats de laboratoire
adminRouter.get('/lab-results', requireAdmin, async (req, res) => {
  try {
    const results = await PatientLabResult.find()
      .populate('patient')
      .populate('doctor')
      .populate('labTest')
      .sort({ resultDate: -1 });
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Gestion des workflows
adminRouter.get('/workflows', requireAdmin, async (req, res) => {
  try {
    const workflows = await Workflow.find()
      .populate({
        path: 'createdBy',
        populate: { path: 'user' }
      });
    res.json(workflows);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

export default adminRouter;
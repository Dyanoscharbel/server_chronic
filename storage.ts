import { 
  users, patients, doctors, labTests, patientLabResults, appointments, notifications, workflows, workflowRequirements,
  type User, type InsertUser, type Patient, type InsertPatient, type Doctor, type InsertDoctor,
  type LabTest, type InsertLabTest, type PatientLabResult, type InsertPatientLabResult,
  type Appointment, type InsertAppointment, type Notification, type InsertNotification,
  type Workflow, type InsertWorkflow, type WorkflowRequirement, type InsertWorkflowRequirement
} from "@shared/schema";
import bcrypt from 'bcrypt';

// Define the interface for our storage
export interface IStorage {
  // User methods
  getUsers(): Promise<User[]>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  verifyUserCredentials(email: string, password: string): Promise<User | null>;
  
  // Patient methods
  getPatients(): Promise<(Patient & { user: User })[]>;
  getPatientById(id: number): Promise<(Patient & { user: User }) | undefined>;
  getPatientByUserId(userId: number): Promise<(Patient & { user: User }) | undefined>;
  createPatient(patient: InsertPatient, user: InsertUser): Promise<Patient & { user: User }>;
  updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient | undefined>;
  deletePatient(id: number): Promise<boolean>;
  
  // Doctor methods
  getDoctors(): Promise<(Doctor & { user: User })[]>;
  getDoctorById(id: number): Promise<(Doctor & { user: User }) | undefined>;
  getDoctorByUserId(userId: number): Promise<(Doctor & { user: User }) | undefined>;
  createDoctor(doctor: InsertDoctor, user: InsertUser): Promise<Doctor & { user: User }>;
  
  // Lab tests methods
  getLabTests(): Promise<LabTest[]>;
  getLabTestById(id: number): Promise<LabTest | undefined>;
  createLabTest(labTest: InsertLabTest): Promise<LabTest>;
  
  // Patient lab results methods
  getPatientLabResults(): Promise<PatientLabResult[]>;
  getPatientLabResultById(id: number): Promise<PatientLabResult | undefined>;
  getPatientLabResultsByPatientId(patientId: number): Promise<PatientLabResult[]>;
  createPatientLabResult(result: InsertPatientLabResult): Promise<PatientLabResult>;
  
  // Appointment methods
  getAppointments(): Promise<Appointment[]>;
  getAppointmentById(id: number): Promise<Appointment | undefined>;
  getAppointmentsByPatientId(patientId: number): Promise<Appointment[]>;
  getAppointmentsByDoctorId(doctorId: number): Promise<Appointment[]>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  updateAppointmentStatus(id: number, status: string): Promise<Appointment | undefined>;
  
  // Notification methods
  getNotifications(): Promise<Notification[]>;
  getNotificationById(id: number): Promise<Notification | undefined>;
  getNotificationsByUserId(userId: number): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: number): Promise<Notification | undefined>;
  
  // Workflow methods
  getWorkflows(): Promise<Workflow[]>;
  getWorkflowById(id: number): Promise<Workflow | undefined>;
  createWorkflow(workflow: InsertWorkflow): Promise<Workflow>;
  getWorkflowRequirements(workflowId: number): Promise<WorkflowRequirement[]>;
  addWorkflowRequirement(requirement: InsertWorkflowRequirement): Promise<WorkflowRequirement>;
}

import { LabTest } from './models';

class MemStorage implements IStorage {
  private users: Map<number, User>;
  private patients: Map<number, Patient>;
  private doctors: Map<number, Doctor>;
  private labTests: Map<number, LabTest>;
  private patientLabResults: Map<number, PatientLabResult>;
  private appointments: Map<number, Appointment>;
  private notifications: Map<number, Notification>;
  private workflows: Map<number, Workflow>;
  private workflowRequirements: Map<number, WorkflowRequirement>;
  
  private userId: number = 1;
  private patientId: number = 1;
  private doctorId: number = 1;
  private labTestId: number = 1;
  private resultId: number = 1;
  private appointmentId: number = 1;
  private notificationId: number = 1;
  private workflowId: number = 1;
  private requirementId: number = 1;

  constructor() {
    this.users = new Map<number, User>();
    this.patients = new Map<number, Patient>();
    this.doctors = new Map<number, Doctor>();
    this.labTests = new Map<number, LabTest>();
    this.patientLabResults = new Map<number, PatientLabResult>();
    this.appointments = new Map<number, Appointment>();
    this.notifications = new Map<number, Notification>();
    this.workflows = new Map<number, Workflow>();
    this.workflowRequirements = new Map<number, WorkflowRequirement>();
    
    // Seed some initial data - this is async but we can't make constructor async
    // so we'll just call it and handle any errors internally
    this.seedInitialData().catch(err => {
      console.error("Error seeding initial data:", err);
    });
  }

  private async seedInitialData() {
    // Vérifier si des tests existent déjà
    const existingTests = await LabTest.countDocuments();
    if (existingTests > 0) {
      console.log('Lab tests already exist, skipping initialization');
      return;
    }

    await LabTest.create([
      {
        testName: "Créatinine sanguine",
        description: "Mesure de la fonction rénale",
        unit: "mg/dL",
        normalMin: 0.5,
        normalMax: 1.2,
        category: "Sanguin"
      },
      {
        testName: "DFG estimé",
        description: "Débit de filtration glomérulaire estimé",
        unit: "mL/min/1.73m²",
        normalMin: 90,
        normalMax: 120,
        category: "Sanguin"
      },
      {
        testName: "Urée sanguine",
        description: "Mesure de la fonction rénale",
        unit: "mg/dL",
        normalMin: 7,
        normalMax: 20,
        category: "Sanguin"
      },
      {
        testName: "Sodium",
        description: "Électrolyte sanguin",
        unit: "mmol/L",
        normalMin: 135,
        normalMax: 145,
        category: "Sanguin"
      },
      {
        testName: "Potassium",
        description: "Électrolyte sanguin",
        unit: "mmol/L",
        normalMin: 3.5,
        normalMax: 5.0,
        category: "Sanguin"
      },
      {
        testName: "Calcium",
        description: "Électrolyte sanguin",
        unit: "mmol/L",
        normalMin: 2.1,
        normalMax: 2.6,
        category: "Sanguin"
      },
      {
        testName: "Phosphore",
        description: "Minéral sanguin",
        unit: "mmol/L",
        normalMin: 0.8,
        normalMax: 1.5,
        category: "Sanguin"
      },
      {
        testName: "Magnésium",
        description: "Électrolyte sanguin",
        unit: "mmol/L",
        normalMin: 0.7,
        normalMax: 1.0,
        category: "Sanguin"
      },
      {
        testName: "Bicarbonates",
        description: "Équilibre acido-basique",
        unit: "mmol/L",
        normalMin: 22,
        normalMax: 30,
        category: "Sanguin"
      },
      {
        testName: "Chlore",
        description: "Électrolyte sanguin",
        unit: "mmol/L",
        normalMin: 98,
        normalMax: 106,
        category: "Sanguin"
      },
      {
        testName: "Protéines totales",
        description: "Protéines sanguines",
        unit: "g/L",
        normalMin: 60,
        normalMax: 80,
        category: "Sanguin"
      },
      {
        testName: "Albumine",
        description: "Protéine sanguine",
        unit: "g/L",
        normalMin: 35,
        normalMax: 50,
        category: "Sanguin"
      },
      {
        testName: "Parathormone",
        description: "Hormone parathyroïdienne",
        unit: "pg/mL",
        normalMin: 10,
        normalMax: 65,
        category: "Sanguin"
      },
      {
        testName: "Hémoglobine Homme",
        description: "Taux d'hémoglobine masculin",
        unit: "g/dL",
        normalMin: 13,
        normalMax: 17,
        category: "Sanguin"
      },
      {
        testName: "Hémoglobine Femme",
        description: "Taux d'hémoglobine féminin",
        unit: "g/dL",
        normalMin: 12,
        normalMax: 16,
        category: "Sanguin"
      },
      {
        testName: "Protéinurie",
        description: "Protéines dans les urines",
        unit: "mg/24h",
        normalMin: 0,
        normalMax: 150,
        category: "Urinaire"
      },
      {
        testName: "Albuminurie/créatininurie",
        description: "Rapport albumine/créatinine urinaire",
        unit: "mg/g",
        normalMin: 0,
        normalMax: 30,
        category: "Urinaire"
      },
      {
        testName: "Sodium urinaire",
        description: "Électrolyte urinaire",
        unit: "mmol/L",
        normalMin: 40,
        normalMax: 220,
        category: "Urinaire"
      },
      {
        testName: "Potassium urinaire",
        description: "Électrolyte urinaire",
        unit: "mmol/L",
        normalMin: 25,
        normalMax: 125,
        category: "Urinaire"
      },
      {
        testName: "Clairance de la créatinine",
        description: "Mesure de la fonction rénale",
        unit: "mL/min",
        normalMin: 90,
        normalMax: 120,
        category: "Spécialisé"
      },
      {
        testName: "Clairance de l'inuline",
        description: "Mesure précise du DFG",
        unit: "mL/min",
        normalMin: 100,
        normalMax: 120,
        category: "Spécialisé"
      }
    ]);

    // Tests sanguins
    // Les tests sont maintenant stockés dans MongoDB
    // Vous pouvez les ajouter via l'interface d'administration

    this.createLabTest({
      testName: "Sodium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 135,
      normalMax: 145
    });

    this.createLabTest({
      testName: "Potassium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 3.5,
      normalMax: 5.0
    });

    this.createLabTest({
      testName: "Calcium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 2.1,
      normalMax: 2.6
    });

    this.createLabTest({
      testName: "Phosphore",
      description: "Minéral sanguin",
      unit: "mmol/L",
      normalMin: 0.8,
      normalMax: 1.5
    });

    this.createLabTest({
      testName: "Magnésium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 0.7,
      normalMax: 1.0
    });

    this.createLabTest({
      testName: "Bicarbonates",
      description: "Équilibre acido-basique",
      unit: "mmol/L",
      normalMin: 22,
      normalMax: 30
    });

    this.createLabTest({
      testName: "Chlore",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 98,
      normalMax: 106
    });

    this.createLabTest({
      testName: "Protéines totales",
      description: "Protéines sanguines",
      unit: "g/L",
      normalMin: 60,
      normalMax: 80
    });

    this.createLabTest({
      testName: "Albumine",
      description: "Protéine sanguine",
      unit: "g/L",
      normalMin: 35,
      normalMax: 50
    });

    this.createLabTest({
      testName: "Parathormone",
      description: "Hormone parathyroïdienne",
      unit: "pg/mL",
      normalMin: 10,
      normalMax: 65
    });

    this.createLabTest({
      testName: "Hémoglobine Homme",
      description: "Taux d'hémoglobine masculin",
      unit: "g/dL",
      normalMin: 13,
      normalMax: 17
    });

    this.createLabTest({
      testName: "Hémoglobine Femme",
      description: "Taux d'hémoglobine féminin",
      unit: "g/dL",
      normalMin: 12,
      normalMax: 16
    });

    this.createLabTest({
      testName: "Hématocrite Homme",
      description: "Pourcentage du volume sanguin occupé par les globules rouges (homme)",
      unit: "%",
      normalMin: 40,
      normalMax: 54
    });

    this.createLabTest({
      testName: "Hématocrite Femme",
      description: "Pourcentage du volume sanguin occupé par les globules rouges (femme)",
      unit: "%",
      normalMin: 37,
      normalMax: 47
    });

    this.createLabTest({
      testName: "Glycémie à jeun",
      description: "Taux de glucose sanguin à jeun",
      unit: "mg/dL",
      normalMin: 70,
      normalMax: 100
    });

    this.createLabTest({
      testName: "Glycémie postprandiale",
      description: "Taux de glucose sanguin après repas",
      unit: "mg/dL",
      normalMin: 0,
      normalMax: 140
    });

    this.createLabTest({
      testName: "Hémoglobine glyquée",
      description: "HbA1c",
      unit: "%",
      normalMin: 0,
      normalMax: 5.7
    });

    this.createLabTest({
      testName: "Cholestérol total",
      description: "Taux de cholestérol sanguin total",
      unit: "mg/dL",
      normalMin: 0,
      normalMax: 200
    });

    this.createLabTest({
      testName: "Triglycérides",
      description: "Taux de triglycérides sanguins",
      unit: "mg/dL",
      normalMin: 0,
      normalMax: 150
    });

    this.createLabTest({
      testName: "HDL",
      description: "Cholestérol HDL",
      unit: "mg/dL",
      normalMin: 40,
      normalMax: 999
    });

    this.createLabTest({
      testName: "LDL",
      description: "Cholestérol LDL",
      unit: "mg/dL",
      normalMin: 0,
      normalMax: 100
    });

    // Analyses d'urine
    this.createLabTest({
      testName: "Protéinurie",
      description: "Protéines dans les urines",
      unit: "mg/24h",
      normalMin: 0,
      normalMax: 150
    });

    this.createLabTest({
      testName: "Albuminurie/créatininurie",
      description: "Rapport albumine/créatinine urinaire",
      unit: "mg/g",
      normalMin: 0,
      normalMax: 30
    });

    this.createLabTest({
      testName: "Sodium urinaire",
      description: "Taux de sodium dans les urines",
      unit: "mmol/L",
      normalMin: 40,
      normalMax: 220
    });

    this.createLabTest({
      testName: "Potassium urinaire",
      description: "Taux de potassium dans les urines",
      unit: "mmol/L",
      normalMin: 25,
      normalMax: 125
    });

    // Examens spécialisés
    this.createLabTest({
      testName: "Clairance de la créatinine",
      description: "Mesure du taux de filtration de la créatinine",
      unit: "mL/min",
      normalMin: 90,
      normalMax: 120
    });

    this.createLabTest({
      testName: "Clairance de l'inuline",
      description: "Mesure précise du taux de filtration glomérulaire",
      unit: "mL/min",
      normalMin: 100,
      normalMax: 120
    });

    this.createLabTest({
      testName: "Sodium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 135,
      normalMax: 145
    });

    this.createLabTest({
      testName: "Potassium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 3.5,
      normalMax: 5.0
    });

    this.createLabTest({
      testName: "Calcium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 2.1,
      normalMax: 2.6
    });

    this.createLabTest({
      testName: "Phosphore",
      description: "Minéral sanguin",
      unit: "mmol/L",
      normalMin: 0.8,
      normalMax: 1.5
    });

    this.createLabTest({
      testName: "Magnésium",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 0.7,
      normalMax: 1.0
    });

    this.createLabTest({
      testName: "Bicarbonates",
      description: "Équilibre acido-basique",
      unit: "mmol/L",
      normalMin: 22,
      normalMax: 30
    });

    this.createLabTest({
      testName: "Chlore",
      description: "Électrolyte sanguin",
      unit: "mmol/L",
      normalMin: 98,
      normalMax: 106
    });

    this.createLabTest({
      testName: "Protéines totales",
      description: "Protéines sanguines",
      unit: "g/L",
      normalMin: 60,
      normalMax: 80
    });

    this.createLabTest({
      testName: "Albumine",
      description: "Protéine sanguine",
      unit: "g/L",
      normalMin: 35,
      normalMax: 50
    });

    this.createLabTest({
      testName: "Parathormone",
      description: "Hormone parathyroïdienne",
      unit: "pg/mL",
      normalMin: 10,
      normalMax: 65
    });

    this.createLabTest({
      testName: "Hémoglobine Homme",
      description: "Taux d'hémoglobine masculin",
      unit: "g/dL",
      normalMin: 13,
      normalMax: 17
    });

    this.createLabTest({
      testName: "Hémoglobine Femme",
      description: "Taux d'hémoglobine féminin",
      unit: "g/dL",
      normalMin: 12,
      normalMax: 16
    });

    // Analyses d'urine
    this.createLabTest({
      testName: "Protéinurie",
      description: "Protéines dans les urines",
      unit: "mg/24h",
      normalMin: 0,
      normalMax: 150
    });

    this.createLabTest({
      testName: "Albuminurie/créatininurie",
      description: "Rapport albumine/créatinine urinaire",
      unit: "mg/g",
      normalMin: 0,
      normalMax: 30
    });

    this.createLabTest({
      testName: "Sodium urinaire",
      description: "Électrolyte urinaire",
      unit: "mmol/L",
      normalMin: 40,
      normalMax: 220
    });

    this.createLabTest({
      testName: "Potassium urinaire",
      description: "Électrolyte urinaire",
      unit: "mmol/L",
      normalMin: 25,
      normalMax: 125
    });

    // Examens spécialisés
    this.createLabTest({
      testName: "Clairance de la créatinine",
      description: "Mesure de la fonction rénale",
      unit: "mL/min",
      normalMin: 90,
      normalMax: 120
    });

    this.createLabTest({
      testName: "Clairance de l'inuline",
      description: "Mesure précise du DFG",
      unit: "mL/min",
      normalMin: 100,
      normalMax: 120
    });

    // Create sample doctor
    await this.createDoctor(
      { 
        specialty: "Néphrologie",
        hospital: "Hôpital Universitaire",
        userId: 0 // Will be set by createUser
      },
      {
        firstName: "Dr. Martin",
        lastName: "Dubois",
        email: "dr.martin@example.com",
        passwordHash: "password123",
        role: "medecin"
      }
    );

    // Create sample patient
    await this.createPatient(
      {
        birthDate: "1975-05-15",
        gender: "M",
        address: "123 Rue Principale",
        phone: "+33123456789",
        ckdStage: "Stage 3A",
        userId: 0 // Will be set by createUser
      },
      {
        firstName: "Jean",
        lastName: "Dupont",
        email: "jean.dupont@example.com",
        passwordHash: "password123",
        role: "patient"
      }
    );

    // Create sample admin
    await this.createUser({
      firstName: "Admin",
      lastName: "User",
      email: "admin@example.com",
      passwordHash: "admin123",
      role: "admin"
    });
  }

  // User methods
  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUserById(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = this.userId++;
    const hashedPassword = await bcrypt.hash(user.passwordHash, 10);
    const newUser: User = { 
      ...user, 
      id, 
      passwordHash: hashedPassword,
      createdAt: new Date()
    };
    this.users.set(id, newUser);
    return newUser;
  }

  async verifyUserCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    return isPasswordValid ? user : null;
  }

  // Patient methods
  async getPatients(): Promise<(Patient & { user: User })[]> {
    const result: (Patient & { user: User })[] = [];
    
    for (const patient of this.patients.values()) {
      const user = await this.getUserById(patient.userId);
      if (user) {
        result.push({ ...patient, user });
      }
    }
    
    return result;
  }

  async getPatientById(id: number): Promise<(Patient & { user: User }) | undefined> {
    const patient = this.patients.get(id);
    if (!patient) return undefined;
    
    const user = await this.getUserById(patient.userId);
    if (!user) return undefined;
    
    return { ...patient, user };
  }

  async getPatientByUserId(userId: number): Promise<(Patient & { user: User }) | undefined> {
    const patient = Array.from(this.patients.values()).find(p => p.userId === userId);
    if (!patient) return undefined;
    
    const user = await this.getUserById(patient.userId);
    if (!user) return undefined;
    
    return { ...patient, user };
  }

  async createPatient(patient: InsertPatient, userData: InsertUser): Promise<Patient & { user: User }> {
    const user = await this.createUser({ ...userData, role: 'patient' });
    
    const id = this.patientId++;
    const newPatient: Patient = { ...patient, id, userId: user.id };
    this.patients.set(id, newPatient);
    
    return { ...newPatient, user };
  }

  async updatePatient(id: number, patientData: Partial<InsertPatient>): Promise<Patient | undefined> {
    const patient = this.patients.get(id);
    if (!patient) return undefined;
    
    const updatedPatient: Patient = { ...patient, ...patientData };
    this.patients.set(id, updatedPatient);
    
    return updatedPatient;
  }

  async deletePatient(id: number): Promise<boolean> {
    const patient = this.patients.get(id);
    if (!patient) return false;
    
    this.patients.delete(id);
    this.users.delete(patient.userId);
    
    return true;
  }

  // Doctor methods
  async getDoctors(): Promise<(Doctor & { user: User })[]> {
    const result: (Doctor & { user: User })[] = [];
    
    for (const doctor of this.doctors.values()) {
      const user = await this.getUserById(doctor.userId);
      if (user) {
        result.push({ ...doctor, user });
      }
    }
    
    return result;
  }

  async getDoctorById(id: number): Promise<(Doctor & { user: User }) | undefined> {
    const doctor = this.doctors.get(id);
    if (!doctor) return undefined;
    
    const user = await this.getUserById(doctor.userId);
    if (!user) return undefined;
    
    return { ...doctor, user };
  }

  async getDoctorByUserId(userId: number): Promise<(Doctor & { user: User }) | undefined> {
    const doctor = Array.from(this.doctors.values()).find(d => d.userId === userId);
    if (!doctor) return undefined;
    
    const user = await this.getUserById(doctor.userId);
    if (!user) return undefined;
    
    return { ...doctor, user };
  }

  async createDoctor(doctor: InsertDoctor, userData: InsertUser): Promise<Doctor & { user: User }> {
    const user = await this.createUser({ ...userData, role: 'medecin' });
    
    const id = this.doctorId++;
    const newDoctor: Doctor = { ...doctor, id, userId: user.id };
    this.doctors.set(id, newDoctor);
    
    return { ...newDoctor, user };
  }

  // Lab tests methods
  async getLabTests(): Promise<LabTest[]> {
    return Array.from(this.labTests.values());
  }

  async getLabTestById(id: number): Promise<LabTest | undefined> {
    return this.labTests.get(id);
  }

  async createLabTest(labTest: InsertLabTest): Promise<LabTest> {
    const id = this.labTestId++;
    const newLabTest: LabTest = { ...labTest, id };
    this.labTests.set(id, newLabTest);
    return newLabTest;
  }

  // Patient lab results methods
  async getPatientLabResults(): Promise<PatientLabResult[]> {
    return Array.from(this.patientLabResults.values());
  }

  async getPatientLabResultById(id: number): Promise<PatientLabResult | undefined> {
    return this.patientLabResults.get(id);
  }

  async getPatientLabResultsByPatientId(patientId: number): Promise<PatientLabResult[]> {
    return Array.from(this.patientLabResults.values()).filter(result => result.patientId === patientId);
  }

  async createPatientLabResult(result: InsertPatientLabResult): Promise<PatientLabResult> {
    const id = this.resultId++;
    const newResult: PatientLabResult = { ...result, id };
    this.patientLabResults.set(id, newResult);
    return newResult;
  }

  // Appointment methods
  async getAppointments(): Promise<Appointment[]> {
    return Array.from(this.appointments.values());
  }

  async getAppointmentById(id: number): Promise<Appointment | undefined> {
    return this.appointments.get(id);
  }

  async getAppointmentsByPatientId(patientId: number): Promise<Appointment[]> {
    return Array.from(this.appointments.values()).filter(appointment => appointment.patientId === patientId);
  }

  async getAppointmentsByDoctorId(doctorId: number): Promise<Appointment[]> {
    return Array.from(this.appointments.values()).filter(appointment => appointment.doctorId === doctorId);
  }

  async createAppointment(appointment: InsertAppointment): Promise<Appointment> {
    const id = this.appointmentId++;
    const newAppointment: Appointment = { ...appointment, id };
    this.appointments.set(id, newAppointment);
    return newAppointment;
  }

  async updateAppointmentStatus(id: number, status: string): Promise<Appointment | undefined> {
    const appointment = this.appointments.get(id);
    if (!appointment) return undefined;
    
    const updatedAppointment: Appointment = { ...appointment, status };
    this.appointments.set(id, updatedAppointment);
    
    return updatedAppointment;
  }

  // Notification methods
  async getNotifications(): Promise<Notification[]> {
    return Array.from(this.notifications.values());
  }

  async getNotificationById(id: number): Promise<Notification | undefined> {
    return this.notifications.get(id);
  }

  async getNotificationsByUserId(userId: number): Promise<Notification[]> {
    return Array.from(this.notifications.values())
      .filter(notification => notification.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const id = this.notificationId++;
    const newNotification: Notification = { 
      ...notification, 
      id, 
      isRead: false,
      createdAt: new Date() 
    };
    this.notifications.set(id, newNotification);
    return newNotification;
  }

  async markNotificationAsRead(id: number): Promise<Notification | undefined> {
    const notification = this.notifications.get(id);
    if (!notification) return undefined;
    
    const updatedNotification: Notification = { ...notification, isRead: true };
    this.notifications.set(id, updatedNotification);
    
    return updatedNotification;
  }

  // Workflow methods
  async getWorkflows(): Promise<Workflow[]> {
    return Array.from(this.workflows.values());
  }

  async getWorkflowById(id: number): Promise<Workflow | undefined> {
    return this.workflows.get(id);
  }

  async createWorkflow(workflow: InsertWorkflow): Promise<Workflow> {
    const id = this.workflowId++;
    const newWorkflow: Workflow = { 
      ...workflow, 
      id, 
      createdAt: new Date() 
    };
    this.workflows.set(id, newWorkflow);
    return newWorkflow;
  }

  async getWorkflowRequirements(workflowId: number): Promise<WorkflowRequirement[]> {
    return Array.from(this.workflowRequirements.values())
      .filter(req => req.workflowId === workflowId);
  }

  async addWorkflowRequirement(requirement: InsertWorkflowRequirement): Promise<WorkflowRequirement> {
    const id = this.requirementId++;
    const newRequirement: WorkflowRequirement = { ...requirement, id };
    this.workflowRequirements.set(id, newRequirement);
    return newRequirement;
  }
}

export const storage = new MemStorage();

import express from "express";
import multer from "multer";
import {
  // CRUD principal de usuarios
  uploadUsers,
  createUser,
  getAllUsers,
  updateUserStatus,
  getUserById,
  updateUser,

  // Doctores
  registerDoctor,
  getDoctorById,
  updateDoctor,
  changeDoctorState,
  getDoctorsBySpecialty,

  // Enfermeros
  registerNurse,
  getNurseById,
  updateNurse,
  changeNurseState,

  // Filtros generales
  getUsersByRole,
  getBulkUsers
} from "../controllers/UserController.js";

const router = express.Router();

// ==================== Configuración de Multer ====================
function csvFilter(req, file, cb) {
  if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten archivos CSV"), false);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: csvFilter,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB
});
// ==================== Filtros generales ====================
router.post("/bulk", getBulkUsers);
// Filtrar usuarios por rol (MÉDICO, ENFERMERO, PACIENTE, etc.)
router.get("/by-role", getUsersByRole);
// ==================== Usuarios genéricos ====================

// Carga masiva CSV
router.post("/upload-users", upload.single("file"), uploadUsers);

// Crear usuario (puede ser paciente o admin, por ejemplo)
router.post("/create", createUser);

// Obtener todos los usuarios (con paginación y filtros opcionales)
router.get("/all", getAllUsers);

// Obtener usuario individual con department/specialization enriquecidos
router.get("/:id", getUserById);

// Actualizar usuario genérico
router.put("/:id", updateUser);

// Cambiar estado (ACTIVE / INACTIVE / PENDING)
router.patch("/status/:id", updateUserStatus);

// ==================== Doctores ====================

// Registrar nuevo doctor
router.post("/doctors", registerDoctor);

// Obtener doctores filtrados por especialidad
router.get("/doctors/by-specialty", getDoctorsBySpecialty);

// Obtener doctor por ID
router.get("/doctors/:id", getDoctorById);

// Actualizar doctor
router.put("/doctors/:id", updateDoctor);

// Cambiar estado del doctor
router.patch("/doctors/state/:id", changeDoctorState);

// ==================== Enfermeros ====================

// Registrar nueva enfermera
router.post("/nurses", registerNurse);

// Obtener enfermero por ID
router.get("/nurses/:id", getNurseById);

// Actualizar enfermero
router.put("/nurses/:id", updateNurse);

// Cambiar estado del enfermero
router.patch("/nurses/state/:id", changeNurseState);



export default router;

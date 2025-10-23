import express from "express";
import multer from "multer";
import { uploadUsers, 
  createUser, 
  getAllUsers, 
  updateUserStatus, 
  getUserById,
  registerDoctor,
  registerNurse,
  getUsersByRole,
  getDoctorsBySpecialty,
  getDoctorById,
  getNurseById,
  updateDoctor,
  updateNurse,
  changeDoctorState,
  changeNurseState,} from "../controllers/UserController.js";

const router = express.Router();

// Solo CSV
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
  limits: { fileSize: 60 * 1024 * 1024 },
});

//Registrar un doctor
router.post("/doctors", registerDoctor);
//Registrar una enfermera
router.post("/nurses", registerNurse);
//Filtrar por rol
router.get("/by-role", getUsersByRole);
//Filtrar doctores por especialidad
router.get("/by-specialty", getDoctorsBySpecialty);
//Obtener doctor/enfermero por ID
router.get("/doctors/:id", getDoctorById);
router.get("/nurses/:id", getNurseById);
//Actualizar doctor/enfermero
router.put("/doctors/:id", updateDoctor);
router.put("/nurses/:id", updateNurse);
//Cambiar estado
router.patch("/doctors/state/:id", changeDoctorState);
router.patch("/nurses/state/:id", changeNurseState);

router.post("/upload-users", upload.single("file"), uploadUsers);
router.post("/create",createUser)
router.get("/all", getAllUsers);
router.patch("/status/:id", updateUserStatus);
router.get("/:id", getUserById)
export default router;

import express from "express";
import multer from "multer";
import { uploadUsers, getAllUsers, createUser, updateUserStatus } from "../controllers/UserController.js";

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

// Rutas
router.post("/upload-users", upload.single("file"), uploadUsers);
router.post("/create",createUser)
router.get("/all", getAllUsers);
router.patch("/status/:id", updateUserStatus);
export default router;

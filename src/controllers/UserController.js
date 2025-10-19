import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { Readable } from "stream";
import csv from "csv-parser";
import { validateUserData } from "../middlewares/validateUserData.js";

const prisma = new PrismaClient();

// Normalizador de roles
export function normalizeRole(role) {
  if (!role) return "PACIENTE";
  const r = role.toString().trim().toLowerCase();
  if (r.includes("admin")) return "ADMINISTRADOR";
  if (r.includes("medic")) return "MEDICO";
  if (r.includes("enfermer")) return "ENFERMERO";
  return "PACIENTE";
}

// ----------------------
// Obtener todos los usuarios
// ----------------------
export const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.users.findMany();
    res.json(users);
  } catch (err) {
    console.error("Error al obtener usuarios:", err);
    res.status(500).json({ message: "Error al obtener usuarios" });
  }
};

// ----------------------
// Carga masiva de usuarios desde CSV
// ----------------------
export const uploadUsers = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No se subió ningún archivo" });

  // Tamaño límite: 60MB
  if (req.file.size > 60 * 1024 * 1024) {
    return res.status(400).json({ message: "El archivo supera el límite de 60MB" });
  }

  const results = [];

  try {
    const stream = Readable.from(req.file.buffer.toString());

    stream
      .pipe(csv({ separator: "," }))
      .on("data", (data) => {
        if (!data.email || !data.fullname || !data.current_password) return;
        results.push(data);
      })
      .on("end", async () => {
        let inserted = 0;
        let duplicates = 0;
        let errors = 0;
        let invalid = 0;

        for (const user of results) {
          try {
            // Validar campos antes de procesar
            const validationErrors = validateUserData(user);
            if (validationErrors.length > 0) {
              console.warn(`Usuario inválido (${user.email}):`, validationErrors.join(", "));
              invalid++;
              continue;
            }

            // Verificar duplicados
            const existing = await prisma.users.findUnique({
              where: { email: user.email.toLowerCase().trim() },
            });
            if (existing) {
              duplicates++;
              continue;
            }

            //Encriptar contraseña
            const hashedPassword = await bcrypt.hash(user.current_password, 10);

            // Crear usuario
            await prisma.users.create({
              data: {
                email: user.email.trim().toLowerCase(),
                fullname: user.fullname.trim(),
                role: normalizeRole(user.role),
                current_password: hashedPassword,
                status: user.status?.trim() || "PENDING",
                specialization: user.specialization?.trim() || null,
                department: user.department?.trim() || null,
                license_number: user.license_number?.trim() || null,
                phone: user.phone?.trim() || null,
                date_of_birth: user.date_of_birth ? new Date(user.date_of_birth) : null,
              },
            });

            inserted++;
          } catch (err) {
            console.error(`Error con ${user.email}:`, err.message);
            errors++;
          }
        }

        // Resultado final
        return res.json({
          message: "Carga completada",
          total: results.length,
          insertados: inserted,
          duplicados: duplicates,
          invalidos: invalid,
          errores: errors,
        });
      });
  } catch (error) {
    console.error("Error al procesar el archivo:", error);
    return res.status(500).json({ message: "Error al procesar el archivo" });
  }
};

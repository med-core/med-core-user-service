import { Readable } from "stream";
import csv from "csv-parser";
import bcrypt from "bcrypt";
import { getPrismaClient } from "../config/database.js";

// Normalizador de roles
function normalizeRole(role) {
  if (!role) return "PACIENTE";
  const r = role.toString().trim().toLowerCase();
  if (r.includes("admin")) return "ADMINISTRADOR";
  if (r.includes("medic")) return "MEDICO";
  if (r.includes("enfermer")) return "ENFERMERO";
  return "PACIENTE";
}

// Obtener todos los usuarios
export const getAllUsers = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const users = await prisma.users.findMany();
    res.json(users);
  } catch (err) {
    console.error("Error al obtener usuarios:", err);
    res.status(500).json({ message: "Error al obtener usuarios" });
  }
};

export const createUser = async (req, res) => {
  const prisma = getPrismaClient();

  try {
    const { email, fullname, role, status, identificacion } = req.body;

    const user = await prisma.users.create({
      data: {
        email,
        fullname,
        role: role || "PACIENTE",
        status: status || "PENDING",
        identificacion: identificacion || null,
      },
    });

    res.status(201).json({ user });
  } catch (error) {
    console.error("Error creando usuario:", error);
    res.status(500).json({ message: "Error creando usuario", error: error.message });
  }
};

// Cargar usuarios desde CSV
export const uploadUsers = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No se subió ningún archivo" });

  if (req.file.size > 60 * 1024 * 1024) {
    return res.status(400).json({ message: "El archivo supera el límite de 60MB" });
  }

  const prisma = getPrismaClient();
  const results = [];

  try {
    // Leer CSV directamente del buffer
    const stream = Readable.from(req.file.buffer.toString());

    stream
      .pipe(csv({ separator: "," }))
      .on("data", (data) => {
        // Acepta cualquier fila válida con email, fullname y password
        if (!data.email || !data.fullname || !data.current_password) return;
        results.push(data);
      })
      .on("end", async () => {
        let inserted = 0;
        let duplicates = 0;
        let errors = 0;

        for (const user of results) {
          try {
            const existing = await prisma.users.findUnique({
              where: { email: user.email.toLowerCase().trim() },
            });

            if (existing) {
              duplicates++;
              continue;
            }

            const hashedPassword = await bcrypt.hash(user.current_password, 10);

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
                identificacion: user.identificacion?.trim() || null,
              },
            });

            inserted++;
          } catch (err) {
            console.error(`Error con ${user.email}:`, err.message);
            errors++;
          }
        }

        return res.json({
          message: "Carga completada correctamente",
          total: results.length,
          insertados: inserted,
          duplicados: duplicates,
          errores: errors,
        });
      });
  } catch (error) {
    console.error("Error al procesar el archivo:", error);
    return res.status(500).json({ message: "Error al procesar el archivo" });
  }
};

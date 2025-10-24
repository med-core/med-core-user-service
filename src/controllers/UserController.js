import { Readable } from "stream";
import csv from "csv-parser";
import bcrypt from "bcrypt";
import { getPrismaClient } from "../config/database.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Normalizador de roles
function normalizeRole(role) {
  if (!role) return "PACIENTE";
  const r = role.toString().trim().toLowerCase();
  if (r.includes("admin")) return "ADMINISTRADOR";
  if (r.includes("medic")) return "MEDICO";
  if (r.includes("enfermer")) return "ENFERMERO";
  return "PACIENTE";
}

// Obtener todos los usuarios con filtros
export const getAllUsers = async (req, res) => {
  try {
    const prisma = getPrismaClient();

    // Extraer los filtros
    const { role, specialty, specialization, state, page = 1, limit = 20 } = req.query;

    // Crear el filtro dinámico
    const where = {};

    // Filtro por rol (doctor/nurse/patient)
    if (role) {
      const normalizedRole = role.toUpperCase();
      if (["MEDICO", "ENFERMERO", "PACIENTE", "ADMINISTRADOR"].includes(normalizedRole)) {
        where.role = normalizedRole;
      }
    }

    // Filtro por estado (active|inactive|pending)
    if (state) {
      const normalizedState = state.toUpperCase();
      if (["ACTIVE", "INACTIVE", "PENDING"].includes(normalizedState)) {
        where.status = normalizedState;
      }
    }

    // Filtro por especialidad (medicos)
    const specialtyFilter = specialty || specialization;
    if (specialtyFilter) {
      where.specialization = { contains: specialtyFilter, mode: "insensitive" };
      where.role = "MEDICO"; // fuerza solo médicos
    }
    // Paginación
    const take = parseInt(limit) || 20;
    const skip = (parseInt(page) - 1) * take;

    // Consultamos los usuarios filtrados
    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.users.count({ where }),
    ]);

    const totalPages = Math.ceil(total / take);

    res.json({
      total,
      totalPages,
      currentPage: parseInt(page),
      perPage: take,
      users,
    });
  } catch (err) {
    console.error("Error al obtener usuarios:", err);
    res.status(500).json({ message: "Error al obtener usuarios" });
  }
};

//crear usuario
export const createUser = async (req, res) => {
  const prisma = getPrismaClient();

  try {
    const hashedPassword = await bcrypt.hash(user.current_password, 10);
    const { email, fullname, role, status, identificacion, current_password } = req.body;
    console.log("Body recibido:", req.body);
    const user = await prisma.users.create({
      data: {
        email,
        fullname,
        role: role || "PACIENTE",
        status: status || "PENDING",
        identificacion: identificacion || null,
        current_password: hashedPassword,
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
    const stream = Readable.from(req.file.buffer);

    stream
      .pipe(csv({ separator: ",", quote: '"' }))
      .on("data", (data) => {
        console.log("Fila leída:", data);
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
export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedUser = await prisma.users.update({
      where: { id },
      data: { status },
    });

    return res.status(200).json({ message: "Estado actualizado", user: updatedUser });
  } catch (error) {
    console.error("Error updating user status:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};
// Obtener un usuario por ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.users.findUnique({ where: { id } });

    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    return res.status(200).json({
      id: user.id,
      email: user.email,
      fullname: user.fullname,
      status: user.status,
      role: user.role,
    });
  } catch (error) {
    console.error("Error al obtener usuario por ID:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ==================== DOCTORES ====================

// Registrar un doctor
export const registerDoctor = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const { fullname, email, department, specialization, license_number, phone } = req.body;

    if (!email || !fullname)
      return res.status(400).json({ message: "Email y nombre completo son requeridos" });

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing)
      return res.status(409).json({ message: "Ya existe un usuario con este correo" });

    const doctor = await prisma.users.create({
      data: {
        fullname,
        email: email.toLowerCase().trim(),
        department,
        specialization,
        license_number,
        phone,
        role: "MEDICO",
        status: "ACTIVE",
        current_password: await bcrypt.hash("123456", 10), // password por defecto
      },
    });

    res.status(201).json({ message: "Doctor registrado exitosamente", doctor });
  } catch (error) {
    console.error("Error registrando doctor:", error);
    res.status(500).json({ message: "Error al registrar doctor" });
  }
};

// Obtener todos los doctores por especialidad
export const getDoctorsBySpecialty = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const { specialty } = req.query;

    const where = { role: "MEDICO" };
    if (specialty) where.specialization = { equals: specialty, mode: "insensitive" };

    const doctors = await prisma.users.findMany({ where });
    res.json(doctors);
  } catch (error) {
    console.error("Error obteniendo doctores:", error);
    res.status(500).json({ message: "Error al obtener doctores" });
  }
};

// Obtener doctor por ID
export const getDoctorById = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const doctor = await prisma.users.findUnique({ where: { id: req.params.id } });

    if (!doctor || doctor.role !== "MEDICO")
      return res.status(404).json({ message: "Doctor no encontrado" });

    res.json(doctor);
  } catch (error) {
    console.error("Error al obtener doctor:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// Actualizar doctor
export const updateDoctor = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const updated = await prisma.users.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ message: "Doctor actualizado", updated });
  } catch (error) {
    console.error("Error actualizando doctor:", error);
    res.status(500).json({ message: "Error al actualizar doctor" });
  }
};

// Cambiar estado de doctor
export const changeDoctorState = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const updated = await prisma.users.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
    });
    res.json({ message: "Estado del doctor actualizado", updated });
  } catch (error) {
    console.error("Error cambiando estado del doctor:", error);
    res.status(500).json({ message: "Error al cambiar estado del doctor" });
  }
};

// ==================== ENFERMEROS ====================

// Registrar un enfermero
export const registerNurse = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const { fullname, email, department, phone } = req.body;

    if (!email || !fullname)
      return res.status(400).json({ message: "Email y nombre completo son requeridos" });

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing)
      return res.status(409).json({ message: "Ya existe un usuario con este correo" });

    const nurse = await prisma.users.create({
      data: {
        fullname,
        email: email.toLowerCase().trim(),
        department,
        phone,
        role: "ENFERMERO",
        status: "ACTIVE",
        current_password: await bcrypt.hash("123456", 10),
      },
    });

    res.status(201).json({ message: "Enfermero registrado exitosamente", nurse });
  } catch (error) {
    console.error("Error registrando enfermero:", error);
    res.status(500).json({ message: "Error al registrar enfermero" });
  }
};

// Obtener enfermero por ID
export const getNurseById = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const nurse = await prisma.users.findUnique({ where: { id: req.params.id } });

    if (!nurse || nurse.role !== "ENFERMERO")
      return res.status(404).json({ message: "Enfermero no encontrado" });

    res.json(nurse);
  } catch (error) {
    console.error("Error al obtener enfermero:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// Actualizar enfermero
export const updateNurse = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const updated = await prisma.users.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ message: "Enfermero actualizado", updated });
  } catch (error) {
    console.error("Error actualizando enfermero:", error);
    res.status(500).json({ message: "Error al actualizar enfermero" });
  }
};

// Cambiar estado enfermero
export const changeNurseState = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const updated = await prisma.users.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
    });
    res.json({ message: "Estado del enfermero actualizado", updated });
  } catch (error) {
    console.error("Error cambiando estado del enfermero:", error);
    res.status(500).json({ message: "Error al cambiar estado del enfermero" });
  }
};

// ==================== FILTRO POR ROL ====================
export const getUsersByRole = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const { role } = req.query;

    if (!role) {
      return res.status(400).json({ message: "Debe especificar un rol" });
    }

    // Normalizar el rol a mayúsculas
    const normalizedRole = role.toUpperCase();

    // Validamos que sea un rol permitido
    const validRoles = ["ADMINISTRADOR", "MEDICO", "ENFERMERO", "PACIENTE"];
    if (!validRoles.includes(normalizedRole)) {
      return res.status(400).json({ message: "Rol no válido" });
    }

    const users = await prisma.users.findMany({
      where: { role: normalizedRole },
    });

    res.json(users);
  } catch (error) {
    console.error("Error filtrando usuarios por rol:", error);
    res.status(500).json({ message: "Error al filtrar usuarios" });
  }
};

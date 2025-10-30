import { Readable } from "stream";
import csv from "csv-parser";
import bcrypt from "bcrypt";
import { getPrismaClient } from "../config/database.js";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

const DEPARTMENT_SERVICE_URL = process.env.DEPARTMENT_SERVICE_URL || "http://med-core-department-service:3000";
const SPECIALIZATION_SERVICE_URL = process.env.SPECIALIZATION_SERVICE_URL || "http://med-core-specialization-service:3000";
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://med-core-auth-service:3000";

// ==================== Normalizador de roles ====================
function normalizeRole(role) {
  if (!role) return "PACIENTE";
  const r = role.toString().trim().toLowerCase();
  if (r.includes("admin")) return "ADMINISTRADOR";
  if (r.includes("medic") || r.includes("doctor")) return "MEDICO";
  if (r.includes("enfermer")) return "ENFERMERO";
  return "PACIENTE";
}

// ==================== Obtener todos los usuarios ====================
export const getAllUsers = async (req, res) => {
  try {
    const prisma = getPrismaClient();
    const { role, state, page = 1, limit = 20 } = req.query;

    const where = {};

    if (role) {
      const normalizedRole = role.toUpperCase();
      if (["MEDICO", "ENFERMERO", "PACIENTE", "ADMINISTRADOR"].includes(normalizedRole)) {
        where.role = normalizedRole;
      }
    }

    if (state) {
      const normalizedState = state.toUpperCase();
      if (["ACTIVE", "INACTIVE", "PENDING"].includes(normalizedState)) {
        where.status = normalizedState;
      }
    }

    const take = parseInt(limit) || 20;
    const skip = (parseInt(page) - 1) * take;

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
    res.json({ total, totalPages, currentPage: parseInt(page), perPage: take, users });
  } catch (err) {
    console.error("Error al obtener usuarios:", err);
    res.status(500).json({ message: "Error al obtener usuarios" });
  }
};

// ==================== Crear usuario ====================
export const createUser = async (req, res) => {
  const prisma = getPrismaClient();
  try {
    const {
      email,
      fullname,
      role,
      status,
      identificacion,
      current_password,
      departmentId,
      specializationId,
    } = req.body;

    if (departmentId) {
      try {
        await axios.get(`${DEPARTMENT_SERVICE_URL}/departments/${departmentId}`);
      } catch {
        return res.status(400).json({ message: "Departamento no encontrado" });
      }
    }

    if (specializationId) {
      try {
        await axios.get(`${SPECIALIZATION_SERVICE_URL}/specializations/${specializationId}`);
      } catch {
        return res.status(400).json({ message: "Especialización no encontrada" });
      }
    }

    const hashedPassword = await bcrypt.hash(current_password, 10);

    const user = await prisma.users.create({
      data: {
        email,
        fullname,
        role: role || "PACIENTE",
        status: status || "PENDING",
        identificacion: identificacion || null,
        current_password: hashedPassword,
        departmentId: departmentId || null,
        specializationId: specializationId || null,
      },
    });

    res.status(201).json({ user });
  } catch (error) {
    console.error("Error creando usuario:", error);
    res.status(500).json({ message: "Error creando usuario", error: error.message });
  }
};

// ==================== Carga masiva ====================
export const uploadUsers = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No se subió ningún archivo" });
  if (req.file.size > 60 * 1024 * 1024)
    return res.status(400).json({ message: "El archivo supera el límite de 60MB" });

  const results = [];

  try {
    const stream = Readable.from(req.file.buffer);
    stream
      .pipe(csv({ separator: ",", quote: '"' }))
      .on("data", (data) => {
        if (!data.email || !data.fullname || !data.current_password) return;
        results.push(data);
      })
      .on("end", async () => {
        let inserted = 0,
          duplicates = 0,
          errors = 0,
          authFails = 0;

        for (const user of results) {
          try {
            const email = user.email.trim().toLowerCase();
            const fullname = user.fullname.trim();
            const role = normalizeRole(user.role);
            const status = user.status?.trim().toUpperCase();
            const password = user.current_password;

            // Verificar duplicados locales
            const existing = await prisma.users.findUnique({ where: { email } });
            if (existing) {
              duplicates++;
              continue;
            }

            // ==========================================
            // Buscar o crear DEPARTMENT
            // ==========================================
            const deptName = user.department ? user.department.trim() : null;
            let departmentId = null;

            if (deptName) {
              try {
                const deptResponse = await axios.post(
                  `${DEPARTMENT_SERVICE_URL}/api/v1/departments/find-or-create`,
                  { name: deptName }
                );
                departmentId = deptResponse.data?.id;
              } catch (err) {
                console.error(`No se pudo vincular department para ${email}:`, err.message);
              }
            }

            // ==========================================
            // Buscar o crear SPECIALIZATION y asociarla al DEPARTMENT
            // ==========================================
            const specName = user.specialization ? user.specialization.trim() : null;
            let specializationId = null;

            if (specName && departmentId) {
              try {
                const specResponse = await axios.post(
                  `${SPECIALIZATION_SERVICE_URL}/api/v1/specializations/find-or-create`,
                  {
                    name: specName,
                    departmentId,
                  }
                );
                specializationId = specResponse.data?.id;
              } catch (err) {
                console.error(`No se pudo vincular specialization para ${email}:`, err.message);
              }
            }

            // ==========================================
            // Crear usuario local en Users
            // ==========================================
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await prisma.users.create({
              data: {
                email,
                fullname,
                role,
                current_password: hashedPassword,
                status,
                departmentId,
                specializationId,
                license_number: user.license_number?.trim() || null,
                phone: user.phone?.trim() || null,
                date_of_birth: user.date_of_birth ? new Date(user.date_of_birth) : null,
              },
            });
            inserted++;

            // ==========================================
            // Crear registro en Auth con userId
            // ==========================================
            try {
              await axios.post(`${AUTH_SERVICE_URL}/api/v1/auth/bulk-sign-up`, {
                email,
                fullname,
                password,
                role,
                verified: true,
                userId: newUser.id, // <--- Aquí va el userId
              });
            } catch (authErr) {
              console.error(`Error al crear en AuthService para ${email}:`, authErr.message);
              authFails++;
            }

          } catch (err) {
            console.error(`Error con ${user.email}:`, err.message);
            errors++;
          }
        }

        return res.json({
          message: "Carga masiva completada",
          total: results.length,
          insertados: inserted,
          duplicados: duplicates,
          errores: errors,
          auth_fails: authFails,
        });
      });
  } catch (error) {
    console.error("Error al procesar el archivo:", error);
    return res.status(500).json({ message: "Error al procesar el archivo" });
  }
};

// ==================== Obtener usuario por ID ====================
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.users.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    const [department, specialization] = await Promise.all([
      user.departmentId
        ? axios.get(`${DEPARTMENT_SERVICE_URL}/departments/${user.departmentId}`).then(res => res.data).catch(() => null)
        : null,
      user.specializationId
        ? axios.get(`${SPECIALIZATION_SERVICE_URL}/specializations/${user.specializationId}`).then(res => res.data).catch(() => null)
        : null,
    ]);

    return res.status(200).json({
      ...user,
      department,
      specialization,
    });
  } catch (error) {
    console.error("Error al obtener usuario por ID:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ==================== Actualizar usuario ====================
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (data.departmentId) {
      try {
        await axios.get(`${DEPARTMENT_SERVICE_URL}/departments/${data.departmentId}`);
      } catch {
        return res.status(400).json({ message: "Departamento no encontrado" });
      }
    }

    if (data.specializationId) {
      try {
        await axios.get(`${SPECIALIZATION_SERVICE_URL}/specializations/${data.specializationId}`);
      } catch {
        return res.status(400).json({ message: "Especialización no encontrada" });
      }
    }

    const updatedUser = await prisma.users.update({
      where: { id },
      data,
    });

    return res.status(200).json({ message: "Usuario actualizado", user: updatedUser });
  } catch (error) {
    console.error("Error actualizando usuario:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ==================== Cambiar estado ====================
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

// ==================== Registro de doctor ====================
export const registerDoctor = async (req, res) => {
  try {
    const data = req.body;
    data.role = "MEDICO";

    // Crear usuario local en Users
    const hashedPassword = await bcrypt.hash(data.current_password, 10);
    const newUser = await prisma.users.create({
      data: {
        email: data.email.toLowerCase(),
        fullname: data.fullname,
        role: data.role,
        current_password: hashedPassword,
        status: data.status?.toUpperCase() || "ACTIVE",
        departmentId: data.departmentId || null,
        specializationId: data.specializationId || null,
        license_number: data.license_number || null,
        phone: data.phone || null,
        date_of_birth: data.date_of_birth ? new Date(data.date_of_birth) : null,
      },
    });

    // Crear usuario en Auth Service
    try {
      await axios.post(`${AUTH_SERVICE_URL}/api/v1/auth/bulk-sign-up`, {
        email: data.email,
        fullname: data.fullname,
        password: data.current_password,
        role: data.role,
        verified: true,
        userId: newUser.id, // <-- referencia al usuario local
      });
    } catch (authErr) {
      console.error(`Error al crear en AuthService para ${data.email}:`, authErr.message);
      return res.status(500).json({ message: "Usuario creado localmente, pero fallo en AuthService" });
    }

    res.status(201).json({ message: "Doctor registrado correctamente", user: newUser });

  } catch (error) {
    console.error("Error registrando médico:", error);
    res.status(500).json({ message: "Error registrando médico" });
  }
};


// ==================== Registro de enfermero ====================
// ==================== Registro de enfermero ====================
export const registerNurse = async (req, res) => {
  try {
    const data = req.body;
    data.role = "ENFERMERO";

    // Crear usuario local en Users
    const hashedPassword = await bcrypt.hash(data.current_password, 10);
    const newUser = await prisma.users.create({
      data: {
        email: data.email.toLowerCase(),
        fullname: data.fullname,
        role: data.role,
        current_password: hashedPassword,
        status: data.status?.toUpperCase() || "ACTIVE",
        departmentId: data.departmentId || null,
        specializationId: data.specializationId || null,
        license_number: data.license_number || null,
        phone: data.phone || null,
        date_of_birth: data.date_of_birth ? new Date(data.date_of_birth) : null,
      },
    });

    // Crear usuario en Auth Service
    try {
      await axios.post(`${AUTH_SERVICE_URL}/api/v1/auth/bulk-sign-up`, {
        email: data.email,
        fullname: data.fullname,
        password: data.current_password,
        role: data.role,
        verified: true,
        userId: newUser.id, // referencia al usuario local
      });
    } catch (authErr) {
      console.error(`Error al crear en AuthService para ${data.email}:`, authErr.message);
      return res.status(500).json({ message: "Usuario creado localmente, pero fallo en AuthService" });
    }

    res.status(201).json({ message: "Enfermero registrado correctamente", user: newUser });

  } catch (error) {
    console.error("Error registrando enfermero:", error);
    res.status(500).json({ message: "Error registrando enfermero" });
  }
};


// ==================== Obtener doctor por ID ====================
export const getDoctorById = async (req, res) => {
  req.params.role = "MEDICO";
  return getUserById(req, res);
};

// ==================== Obtener enfermero por ID ====================
export const getNurseById = async (req, res) => {
  req.params.role = "ENFERMERO";
  return getUserById(req, res);
};

// ==================== Actualizar doctor ====================
export const updateDoctor = async (req, res) => {
  req.body.role = "MEDICO";
  return updateUser(req, res);
};

// ==================== Actualizar enfermero ====================
export const updateNurse = async (req, res) => {
  req.body.role = "ENFERMERO";
  return updateUser(req, res);
};

// ==================== Cambiar estado doctor ====================
export const changeDoctorState = async (req, res) => {
  return updateUserStatus(req, res);
};

// ==================== Cambiar estado enfermero ====================
export const changeNurseState = async (req, res) => {
  return updateUserStatus(req, res);
};

// ==================== Filtrar usuarios por rol ====================
export const getUsersByRole = async (req, res) => {
  try {
    const { role } = req.query;
    const users = await prisma.users.findMany({
      where: { role: role?.toUpperCase() },
      orderBy: { fullname: "asc" },
    });
    res.json(users);
  } catch (error) {
    console.error("Error filtrando usuarios por rol:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ==================== Filtrar doctores por especialidad ====================
export const getDoctorsBySpecialty = async (req, res) => {
  try {
    const { specialty } = req.query;
    if (!specialty) return res.status(400).json({ message: "Debe proporcionar el nombre de la especialidad" });

    // ==========================================
    // 1. Consultar specialization-service
    // ==========================================
    let specialization;
    try {
      const specResponse = await axios.get(`${SPECIALIZATION_SERVICE_URL}/api/v1/specializations?name=${encodeURIComponent(specialty)}`);
      if (Array.isArray(specResponse.data) && specResponse.data.length > 0) {
        specialization = specResponse.data[0];
      }
    } catch (err) {
      console.error("Error consultando specialization-service:", err.message);
      return res.status(502).json({ message: "Error al consultar el servicio de especializaciones" });
    }

    if (!specialization) return res.status(404).json({ message: `Especialidad "${specialty}" no encontrada` });

    // ==========================================
    // 2. Consultar usuarios (solo médicos) con esa specializationId
    // ==========================================
    let doctors = [];
    try {
      doctors = await prisma.users.findMany({
        where: {
          role: "MEDICO",
          specializationId: specialization.id,
        },
        orderBy: { fullname: "asc" },
        select: {
          id: true,
          email: true,
          fullname: true,
          departmentId: true,
          specializationId: true,
          phone: true,
          license_number: true,
        },
      });
    } catch (err) {
      console.error("Error consultando base de usuarios:", err.message);
      return res.status(500).json({ message: "Error al obtener los doctores de la base de datos" });
    }

    // ==========================================
    // 3. Responder con la lista de doctores
    // ==========================================
    res.json(doctors);

  } catch (error) {
    console.error("Error inesperado:", error.message);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

export const getBulkUsers = async (req, res) => {
  try {
    const { userIds } = req.body;
    console.log("user-service: bulk request for IDs:", userIds);

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "userIds debe ser un array" });
    }

    const prisma = getPrismaClient(); // ← tu función

    const users = await prisma.users.findMany({
      where: {
        id: { in: userIds },
        role: "PACIENTE",
      },
      select: {
        id: true,
        email: true,
        fullname: true,
        role: true,
        phone: true,
        identificacion: true,
      },
    });

    console.log("user-service: usuarios encontrados:", users.length);

    res.json({ data: users });
  } catch (err) {
    console.error("Error en bulk users:", err);
    res.status(500).json({ message: "Error interno" });
  }
};





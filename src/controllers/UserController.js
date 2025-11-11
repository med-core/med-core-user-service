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
  const buffer = req.file.buffer;
  const stream = Readable.from(buffer);

  stream
    .pipe(csv({ separator: ',', headers: true }))
    .on('data', (row) => {
      if (row.email && row.fullname) results.push(row);
    })
    .on('end', async () => {
      let stats = {
        total: results.length,
        users: 0,
        auth: 0,
        patients: 0,
        doctors: 0,
        nurses: 0,
        duplicates: 0,
        errors: [],
      };

      for (const row of results) {
        const email = row.email.trim().toLowerCase();
        const fullname = row.fullname.trim();
        const role = normalizeRole(row.role);
        const password = row.current_password || row.password || 'Temp1234!';

        try {
          // 1. Verificar duplicado en Users
          const existingUser = await prisma.users.findUnique({ where: { email } });
          if (existingUser) {
            stats.duplicates++;
            stats.errors.push({ email, error: 'Email ya existe en Users' });
            continue;
          }

          // 2. Crear o buscar departamento
          let departmentId = null;
          if (row.department) {
            try {
              const deptRes = await axios.post(`${DEPARTMENT_SERVICE_URL}/api/v1/departments/find-or-create`, {
                name: row.department.trim(),
              });
              departmentId = deptRes.data.id;
            } catch (err) {
              stats.errors.push({ email, error: 'Departamento no creado' });
            }
          }

          // 3. Crear o buscar especialización
          let specializationId = null;
          if (row.specialization && departmentId) {
            try {
              const specRes = await axios.post(`${SPECIALIZATION_SERVICE_URL}/api/v1/specializations/find-or-create`, {
                name: row.specialization.trim(),
                departmentId,
              });
              specializationId = specRes.data.id;
            } catch (err) {
              stats.errors.push({ email, error: 'Especialización no creada' });
            }
          }

          // 4. Crear usuario en User Service
          const hashedPassword = await bcrypt.hash(password, 10);
          const newUser = await prisma.users.create({
            data: {
              email,
              fullname,
              role,
              current_password: hashedPassword,
              status: row.status?.trim().toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
              departmentId,
              specializationId,
              license_number: row.license_number?.trim() || null,
              phone: row.phone?.trim() || null,
              date_of_birth: row.date_of_birth ? new Date(row.date_of_birth) : null,
            },
          });

          stats.users++;

          // 5. Crear en Auth Service
          try {
            await axios.post(`${AUTH_SERVICE_URL}/api/v1/auth/bulk-sign-up`, {
              userId: newUser.id,
              email,
              password,
              verified: true,
            });
            stats.auth++;
          } catch (err) {
            stats.errors.push({ email, error: 'Fallo en Auth: ' + (err.response?.data?.message || err.message) });
          }

          // 6. Crear perfil según rol
          if (role === 'PACIENTE') {
            try {
              await axios.post(`${PATIENT_SERVICE_URL}/api/v1/patients/bulk`, {
                userId: newUser.id,
                documentNumber: row.documentNumber || `TEMP-${Date.now()}`,
                birthDate: row.date_of_birth ? new Date(row.date_of_birth) : null,
                age: row.age ? parseInt(row.age) : null,
                gender: row.gender || 'OTRO',
                phone: row.phone || null,
                address: row.address || null,
              });
              stats.patients++;
            } catch (err) {
              stats.errors.push({ email, error: 'Fallo en Patient Service' });
            }
          }

          if (role === 'MEDICO') {
            try {
              await axios.post(`${DOCTOR_SERVICE_URL}/api/v1/doctors/bulk`, {
                userId: newUser.id,
                licenseNumber: row.license_number || `LIC-${Date.now()}`,
                specializationId,
                departmentId,
                consultationTime: 30,
                availableFrom: '08:00',
                availableTo: '17:00',
              });
              stats.doctors++;
            } catch (err) {
              stats.errors.push({ email, error: 'Fallo en Doctor Service' });
            }
          }

          if (role === 'ENFERMERO') {
            try {
              await axios.post(`${NURSE_SERVICE_URL}/api/v1/nurses/bulk`, {
                userId: newUser.id,
                departmentId,
                shift: row.shift?.toLowerCase() || 'morning',
              });
              stats.nurses++;
            } catch (err) {
              stats.errors.push({ email, error: 'Fallo en Nurse Service' });
            }
          }

        } catch (err) {
          stats.errors.push({ email, error: err.message });
        }
      }

      res.status(200).json({
        message: 'Carga masiva completada',
        stats,
      });
    })
    .on('error', (err) => {
      console.error('Error parsing CSV:', err);
      res.status(500).json({ message: 'Error al procesar CSV' });
    });
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





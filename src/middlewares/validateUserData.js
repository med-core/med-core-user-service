export const regex = {
  fullname: /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{2,100}$/,
  identification: /^[0-9]{5,15}$/,
  phone: /^[0-9+\-()\s]{6,20}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  specialization: /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{0,100}$/,
  department: /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{0,100}$/,
  license_number: /^[A-Za-z0-9\-]{0,50}$/
};

// --- Sanitiza texto contra XSS ---
export const sanitizeString = (str) => {
  return str ? String(str).replace(/[<>]/g, "").trim() : "";
};

// --- Validaciones principales ---
export const validateUserData = (user) => {
  const errors = [];

  // Sanitizar todos los campos
  for (const key in user) {
    user[key] = sanitizeString(user[key]);
  }

  // Campos obligatorios
  if (!user.fullname) errors.push("El nombre completo es obligatorio");
  if (!user.email) errors.push("El correo electrónico es obligatorio");
  if (!user.identification) errors.push("El número de identificación es obligatorio");
  if (!user.date_of_birth) errors.push("La fecha de nacimiento es obligatoria");

  // Formatos
  if (user.fullname && !regex.fullname.test(user.fullname)) errors.push("Nombre inválido");
  if (user.email && !regex.email.test(user.email)) errors.push("Correo electrónico inválido");
  if (user.identification && !regex.identification.test(user.identification)) errors.push("Número de identificación inválido");
  if (user.phone && !regex.phone.test(user.phone)) errors.push("Número de teléfono inválido");
  if (user.specialization && !regex.specialization.test(user.specialization)) errors.push("Especialización inválida");
  if (user.department && !regex.department.test(user.department)) errors.push("Departamento inválido");
  if (user.license_number && !regex.license_number.test(user.license_number)) errors.push("Número de licencia inválido");

  // Edad
  const birthDate = new Date(user.date_of_birth);
  const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (isNaN(age) || age < 0 || age > 100) errors.push("Edad fuera del rango permitido (0-100 años)");

  return errors;
};

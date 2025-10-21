import { PrismaClient } from "@prisma/client";


let prismaClientInstance;

export function getPrismaClient() {
    if (!prismaClientInstance) {
        // La instancia solo se crea si el entorno ya está cargado
        prismaClientInstance = new PrismaClient();
    }
    return prismaClientInstance;
}

export async function connectDB() {
    const prisma = getPrismaClient(); // Obtiene o crea la instancia
    try {
        await prisma.$connect();
        console.log("Conexión a MongoDB establecida con Prisma.");
    } catch (error) {
        console.error("Error conectando a MongoDB:", error);
        process.exit(1);
    }
}
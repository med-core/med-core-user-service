import express from "express";
import cors from "cors";
import userRoutes from "./router/userRoutes.js";
import { connectDB } from "./config/database.js";
import {sendError} from "./utils/errorHandler.js"


const app = express();
// Middleware CORS
app.use(
    cors({
        origin: [
            'http://localhost:5173'
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    })
);
app.use(express.json());

// Healthcheck endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Prefijo de rutas
app.use("/api/v1/users", userRoutes);

// Prueba de ruta base
app.get("/", (req, res) => {
    res.send("User Service funcionando correctamente");
});
app.use((err, req, res, next) => {
  sendError(err, res);
});

const PORT = process.env.PORT || 3000;

// FUNCIÓN ASÍNCRONA para iniciar el servidor después de la conexión a la DB
async function startServer() {
    try {
        await connectDB();
        console.log("Conexión a MongoDB establecida para User Service.");

        app.listen(PORT, () => {
            console.log(`User Service corriendo en el puerto ${PORT}`);
        });

    } catch (error) {
        console.error("Fallo crítico al iniciar el User Service:", error.message);
        process.exit(1);
    }
}

startServer();

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userRoutes from "./router/userRoutes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Prefijo de rutas
app.use("/api/users", userRoutes);

// Prueba
app.get("/", (req, res) => {
  res.send("User Service funcionando correctamente");
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`User Service corriendo en el puerto ${PORT}`);
});
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

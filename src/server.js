require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { connectDatabase } = require("./config/database");
const authRoutes = require("./routes/auth.routes");
const kitsRoutes = require("./routes/kits.routes");
const { createCorsOptions } = require("./middleware/request-protection.middleware");
const { errorHandler, notFoundHandler } = require("./middleware/error.middleware");

const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors(createCorsOptions()));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/kits", kitsRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "TRAO Application Backend is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    database: "connected",
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    await connectDatabase();

    console.log("Database connection completed successfully");

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
};

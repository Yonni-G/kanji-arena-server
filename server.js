// server.js
const express = require("express");
const mongoose = require("mongoose");

const dotenv = require('dotenv');
dotenv.config({ path: '.env.development.local' });

const cookieParser = require("cookie-parser");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const gameRoutes = require("./routes/gameRoutes");
const { errorHandler } = require("./middleware/errorMiddleware");

dotenv.config();
const app = express();

const allowedOrigins = [
    "http://localhost:4200",
    "https://www.yonni.com"
];


const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    exposedHeaders: ['Authorization']
};

app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use("/api/users", userRoutes);
app.use("/api/games", gameRoutes);
app.use(errorHandler);

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));


// yonni
app.get("/", (req, res) => {
    res.send("Bienvenue sur mon API !");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

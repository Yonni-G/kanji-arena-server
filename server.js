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
const langMiddleware = require("./middleware/langMiddleware");
const { createTranslator } = require('./translations/translator');

dotenv.config();
const app = express();

const allowedOrigins = [
    "http://localhost:4200",
    "https://www.kanji-arena.com",
    "https://kanji-arena.com",
    "http://kanjiah.cluster021.hosting.ovh.net"
];


const corsOptions = {
    origin: (origin, callback) => {
        console.log("CORS Origin:", origin);
        
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

// On détecte et stocke la langue
app.use(langMiddleware);

// Création du traducteur
app.use((req, res, next) => {
    req.t = createTranslator(req.lang || 'fr');
    //console.log("Langue détectée :", req.lang);
    next();
});

// On charge les routes
app.use("/api/:lang/users", userRoutes);
app.use("/api/:lang/games", gameRoutes);


mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));


// yonni
app.get("/", (req, res) => {
    res.send("Bienvenue sur mon API !");
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const jwt = require("jsonwebtoken");

exports.authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Access denied. No token provided." });
    }

    const token = authHeader.split(" ")[1]; // Token d'accès

    try {
        // Vérifier si le token d'accès est valide
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Ajoute les infos de l'utilisateur à req.user
        return next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            // Le token est expiré → on peut le refresh → on envoie 401
            return res.status(401).json({ message: "Token expired." });
        }

        // Token invalide (mal formé, modifié, etc.) → pas récupérable → 403
        return res.status(403).json({ message: `Invalid token.` });
    }
};

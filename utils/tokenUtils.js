const jwt = require("jsonwebtoken");
const crypto = require('crypto');

const generateGameToken = (payload) => {
    return jwt.sign(
        payload,
        process.env.JWT_GAME_SECRET,
        { expiresIn: "2m" } // 2min max pour répondre à une carte
    );
};


const generateAccessToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            username: user.username
         },
        process.env.JWT_SECRET,
        { expiresIn: "15d" } // Expiration 15 jours
    );
};

const generateRefreshToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            username: user.username
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "7d" } // Expiration du refresh token de 7 jours
    );
};
// Fonction de chiffrement sans modification
function encryptPayload(payload) {
    // Créer un vecteur d'initialisation (IV) aléatoire de 16 octets
    const iv = crypto.randomBytes(16);

    // Hachage de la clé pour obtenir une clé de 256 bits (32 octets) avec SHA-256
    const key = crypto.createHash('sha256').update(process.env.JWT_AES_KEY).digest();

    // Initialiser le chiffrement AES avec l'algorithme 'aes-256-cbc' et le IV
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    // Chiffrer les données
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Retourner les données chiffrées et l'IV (nécessaire pour le déchiffrement)
    return { iv: iv.toString('hex'), encryptedData: encrypted };
}

// Fonction de déchiffrement sans modification
function decryptPayload(encryptedPayload) {
    const { iv, encryptedData } = encryptedPayload;

    // Hachage de la clé pour obtenir une clé de 256 bits (32 octets) avec SHA-256
    const key = crypto.createHash('sha256').update(process.env.JWT_AES_KEY).digest();

    // Initialiser le déchiffrement AES avec l'algorithme 'aes-256-cbc' et le IV
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));

    // Déchiffrer les données
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Retourner les données déchiffrées
    return JSON.parse(decrypted);
}

module.exports = { generateAccessToken, generateRefreshToken, generateGameToken, encryptPayload, decryptPayload };

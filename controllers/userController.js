// controllers/userController.js
const User = require("../schemas/userSchema");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const { generateAccessToken } = require("../utils/tokenUtils");
const jwt = require("jsonwebtoken");
const { transporter, formatContactMessage } = require("./commonController");

exports.getUserIdFromAccessToken = async (req, res) => {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.split(' ')[1];

    if (!accessToken) return null;

    try {
        const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
        return decoded.id;
    } catch (err) {
        console.log(err);        
        return null;
    }
};

exports.getAlertOutOfRanking = async (req, res) => {    

    try {
        const userId = await exports.getUserIdFromAccessToken(req, res);        
        const user = await User.findOne(
            { _id: userId }
        );

        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        return res.status(200).json({ alertOutOfRanking: user.alertOutOfRanking });
    } catch (err) {
        console.error("Erreur dans getAlertOutOfRanking:", err);
        return res.status(500).json({ message: "Erreur serveur." });
    }
};

exports.setAlertOutOfRanking = async (req, res) => {    

    const userId = await exports.getUserIdFromAccessToken(req, res);
    
    const { alertOutOfRanking } = req.body;

    if (alertOutOfRanking === undefined) {
        return res.status(400).json({ message: "Le champ 'alertOutOfRanking' est requis." });
    }

    try {
        const user = await User.findOneAndUpdate(
            { _id: userId },
            { alertOutOfRanking },
            { new: true }
        );       

        if (!user) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        return res.status(200).json({ message: "Votre choix a bien été enregistré." });
    } catch (err) {
        console.error("Erreur dans setAlertOutOfRanking:", err);
        return res.status(500).json({ message: "Erreur serveur." });
    }
};

exports.checkResetToken = async (req, res) => {
    const { resetToken } = req.body; // Récupérer le token depuis le body
    //return res.status(400).json({ resetToken });
    try {
        // Vérifier si le token est valide et non expiré
        const user = await User.findOne({ resetToken, resetTokenExpiration: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ message: "Votre lien de réinitialisation a expiré ou est invalide. Veuillez demander un nouveau lien." });

        return res.status(200).json({ message: "Reset token valide" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Erreur serveur" });
    }
}

// Inscription d'un utilisateur
exports.register = async (req, res, next) => {
    try {
        console.log("Register request received:", req.body);
        // Récupérer les données du formulaire
        const { username, nationality, email, password, confirmPassword } = req.body;

        // Vérifier si tous les champs sont remplis
        if (!username || !nationality || !email || !password || !confirmPassword) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }

        // Vérifier la validité de la nationalité
        const nationalityPattern = /^[a-zA-Z]{2}$/; // Format pour les codes de pays à deux lettres
        if (!nationalityPattern.test(nationality)) {
            return res.status(400).json({ message: "Saisissez un code de nationalité valide (2 lettres)" });
        }

        // Vérifier la validité de l'email
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            return res.status(400).json({ message: "Saisissez une adresse email correcte" });
        }

        // Vérifier la longueur du nom d'utilisateur avec le même pattern que le front
        const usernamePattern = /^[a-zA-Z0-9]{3,12}$/;
        if (!usernamePattern.test(username)) {
            return res.status(400).json({ message: "Le nom d'utilisateur doit contenir entre 3 et 12 caractères alphanumériques" });
        }

        // on controle le même pattern du mdp que le front
        // Vérifier la force du mot de passe
        const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordPattern.test(password)) {
            return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial" });
        }

        // Vérifier si les mots de passe correspondent
        if (password !== confirmPassword) {
            return res.status(400).json({ message: "Les mots de passe ne correspondent pas !" });
        }

        const existingUsername = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
        if (existingUsername) {
            return res.status(400).json({ message: "Désolé ! Ce pseudo est déjà utilisé ! Trouves-en un autre !" });
        }

        const existingEmail = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
        if (existingEmail) {
            return res.status(400).json({ message: "Cette adresse email est déjà utilisée !" });
        }

        // Créer un nouvel utilisateur
        const user = new User({ username, nationality, email: email.toLowerCase(), password });

        // Sauvegarder l'utilisateur dans la base de données
        await user.save();

        // Répondre avec un message de succès
        return res.status(201).json({ message: "Vous êtes bien inscrit à Kanji-Arena ! Connectez-vous dès maintenant pour commencer à jouer !" });
    } catch (error) {
        console.log(error);        
        return res.status(500).json({ message: "Erreur technique. Veuillez réessayer ultérieurement." });
    }
};

// Connexion d'un utilisateur
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Vérifier si tous les champs sont remplis
        if (!email || !password) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }

        // Vérifier la validité de l'email
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            return res.status(400).json({ message: "Saisissez une adresse email correcte" });
        }

        // on controle le même pattern du mdp que le front
        // Vérifier la force du mot de passe
        const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        
        if (!passwordPattern.test(password)) {
            return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial" });
        }

        const user = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Vos identifiants sont invalides, veuillez réessayer." });
        }

        const accessToken = generateAccessToken(user);
        await user.save();

        return res.json({ accessToken, message: "Bienvenue, vous pouvez jouer à Kanji-Arena !" });
    } catch (error) {
        next(error);
    }
};

// Forgot password (envoi du lien de réinitialisation)
exports.forgotPassword = async (req, res, next) => {

    try {
        const { email } = req.body;

        // Vérifier si tous les champs sont remplis
        if (!email) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }

        // Vérifier la validité de l'email
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            return res.status(400).json({ message: "Saisissez une adresse email correcte" });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(200).json({ message: "Si un compte utilisateur existe avec cette adresse email, un lien de réinitialisation vous a été envoyé !" });

        const token = crypto.randomBytes(32).toString("hex");
        user.resetToken = token;
        user.resetTokenExpiration = Date.now() + 14400000; // 4 heure de validité du token
        await user.save();

        const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

        await transporter.sendMail({
            from: `"Kanji-Arena" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Réinitialisation du mot de passe",
            text: `Cliquez sur ce lien pour réinitialiser votre mot de passe : ${resetLink}`,
        });

        res.status(200).json({ message: "Si un compte utilisateur existe avec cette adresse email, un lien de réinitialisation vous a été envoyé." });
    } catch (error) {
        next(error);
    }
};

// Réinitialisation du mot de passe
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, password, confirmPassword } = req.body;

        // Vérifier si tous les champs sont remplis
        if (!token || !password || !confirmPassword) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
        }
        // Vérifier la force du mot de passe
        const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordPattern.test(password)) {
            return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial" });
        }
        // Vérifier si les mots de passe correspondent
        if (password !== confirmPassword) {
            return res.status(400).json({ message: "Les mots de passe ne correspondent pas" });
        }
        // Vérifier la validité du token
        const user = await User.findOne({ resetToken: token, resetTokenExpiration: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ message: "Token invalide ou expiré" });

        user.password = password;
        user.resetToken = undefined;
        user.resetTokenExpiration = undefined;
        await user.save();

        return res.status(200).json({ message: 'Mot de passe modifié avec succès ! Vous pouvez dès à présent vous connecter à nouveau.' });
    } catch (error) {
        next(error);
    }
};
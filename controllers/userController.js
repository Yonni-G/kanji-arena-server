// controllers/userController.js
const User = require("../schemas/userSchema");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { generateAccessToken, generateRefreshToken } = require("../utils/tokenUtils");
//require("dotenv").config();
const jwt = require("jsonwebtoken");

const transporter = nodemailer.createTransport({
    name: 'yonni.com',
    host: "ssl0.ovh.net", // Serveur SMTP OVH
    port: 465, // Port sécurisé SSL
    secure: true, // `true` pour SSL
    auth: {
        user: process.env.EMAIL_USER, // Ton adresse e-mail OVH
        pass: process.env.EMAIL_PASS, // Mot de passe de ton e-mail
    },
});

exports.getUserIdFromAccessToken = async (req, res) => {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.split(' ')[1];
    const refreshToken = req.cookies.refreshToken;

    if (!accessToken) return null;

    try {
        const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
        return decoded.id;
    } catch (err) {
        if (err.name === "TokenExpiredError" && refreshToken) {
            try {
            
                const user = await User.findOne({ refreshToken });
                if (!user) return null;

                const newAccessToken = generateAccessToken(user);

                // ✅ Option 1 : remettre en header pour le client (interceptor ou futur appel)
                res.setHeader('Authorization', `Bearer ${newAccessToken}`);
                // console.log(`nouveau access token : ${newAccessToken}`);
                

                // ✅ Option 2 (facultative) : tu peux aussi le mettre dans un cookie
                // res.cookie('accessToken', newAccessToken, { httpOnly: true });

                return user._id;
            } catch (refreshError) {
                console.error("Erreur de refresh :", refreshError);
                return null;
            }
        }
        return null;
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
            { userId },
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

// on va vérifier si le user possède un cookie de refresh token
exports.checkRefreshToken = async (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ message: "Pas de refresh token" });

    try {
        const user = await User.findOne({ refreshToken });
        if (!user) return res.status(401).json({ message: "Refresh token invalide" });

        // Générer un nouveau access token
        const accessToken = generateAccessToken(user);
        return res.json({ accessToken });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Erreur serveur" });
    }
}

exports.checkResetToken = async (req, res) => {
    const { resetToken } = req.body; // Récupérer le token depuis le body
    //return res.status(400).json({ resetToken });
    try {
        // Vérifier si le token est valide et non expiré
        const user = await User.findOne({ resetToken, resetTokenExpiration: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ message: "Votre lien de réinitialisation a expiré ou est invalide. Veuillez demander un nouveau lien." });

        res.status(200).json({ message: "Reset token valide" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Erreur serveur" });
    }
}

exports.protectedRoute = (req, res) => {
    // Ici, tu as accès à l'utilisateur via req.user, ajouté par le middleware
    res.json({
        message: "Vous avez accès à cette route protégée",
        user: req.user, // Par exemple, tu renvoies les données de l'utilisateur
    });
};

// Inscription d'un utilisateur
exports.register = async (req, res, next) => {
    try {
        const { username, email, password, confirmPassword } = req.body;

        // Vérifier si tous les champs sont remplis
        if (!username || !email || !password || !confirmPassword) {
            return res.status(400).json({ message: "Tous les champs sont requis" });
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
        const user = new User({ username, email: email.toLowerCase(), password });


        // Sauvegarder l'utilisateur dans la base de données
        await user.save();

        // Répondre avec un message de succès
        return res.status(201).json({ message: "Vous êtes bien inscrit à Kanji-Master ! Connectez-vous dès maintenant pour commencer à jouer !" });
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
        const refreshToken = generateRefreshToken(user);
        user.refreshToken = refreshToken;
        await user.save();

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true, secure: true, sameSite: "None", // Ajoute une durée de vie (ici, 7 jours)
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({ accessToken, message: "Bienvenue, vous pouvez jouer à Kanji-Master !" });
    } catch (error) {
        next(error);
    }
};

// Déconnexion d'un utilisateur
exports.logout = async (req, res, next) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) return res.status(401).json({ message: "Pas de refresh token" });

        const user = await User.findOne({ refreshToken });
        if (!user) return res.status(401).json({ message: "Refresh token invalide" });

        user.refreshToken = undefined;
        await user.save();

        res.clearCookie("refreshToken", { httpOnly: true, secure: true, sameSite: "None" });
        res.status(200).json({ message: "Déconnexion réussie" });
    } catch (error) {
        next(error);
    }
}

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
        if (!user) res.status(200).json({ message: "Si un compte utilisateur existe avec cette adresse email, un lien de réinitialisation vous a été envoyé !" });

        const token = crypto.randomBytes(32).toString("hex");
        user.resetToken = token;
        user.resetTokenExpiration = Date.now() + 14400000; // 4 heure de validité du token
        await user.save();

        const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

        await transporter.sendMail({
            from: `"Kanji-Master" <${process.env.EMAIL_USER}>`,
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

        res.status(200).json({ message: 'Mot de passe modifié avec succès ! Vous pouvez dès à présent vous connecter à nouveau.' });
    } catch (error) {
        next(error);
    }
};
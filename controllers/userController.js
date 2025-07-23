// controllers/userController.js

const User = require("../schemas/userSchema");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { generateAccessToken } = require("../utils/tokenUtils");
const jwt = require("jsonwebtoken");
const { transporter } = require("./commonController");

/* On déclare ici l'ensemble de nos regexp */
const NATIONALITY_PATTERN = /^[a-zA-Z]{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9]{3,12}$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};:'",.<>?/~]).{8,}$/;

const getUserIdFromAccessToken = async (req, res) => {
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
        const userId = await getUserIdFromAccessToken(req, res);
        const user = await User.findOne({ _id: userId });

        if (!user) {
            return res.status(404).json({ message: req.t("user_not_found") });
        }

        return res.status(200).json({ alertOutOfRanking: user.alertOutOfRanking });
    } catch (err) {
        console.error("Erreur dans getAlertOutOfRanking:", err);
        return res.status(500).json({ message: req.t("server_error") });
    }
};

exports.setAlertOutOfRanking = async (req, res) => {
    const userId = await getUserIdFromAccessToken(req, res);
    const { alertOutOfRanking } = req.body;

    if (alertOutOfRanking === undefined) {
        return res.status(400).json({ message: req.t("alert_out_of_ranking_required") });
    }

    try {
        const user = await User.findOneAndUpdate(
            { _id: userId },
            { alertOutOfRanking },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: req.t("user_not_found") });
        }

        return res.status(200).json({ message: req.t("alert_out_of_ranking_saved") });
    } catch (err) {
        console.error("Erreur dans setAlertOutOfRanking:", err);
        return res.status(500).json({ message: req.t("server_error") });
    }
};

exports.checkResetToken = async (req, res) => {
    const { resetToken } = req.body;
    try {
        const user = await User.findOne({ resetToken, resetTokenExpiration: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ message: req.t("reset_link_invalid_or_expired") });

        return res.status(200).json({ message: req.t("reset_token_valid") });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: req.t("server_error") });
    }
};

// Inscription d'un utilisateur
exports.register = async (req, res, next) => {
    try {
        console.log("Register request received:", req.body);
        const { username, nationality, email, password, confirmPassword } = req.body;

        if (!username || !nationality || !email || !password || !confirmPassword) {
            return res.status(400).json({ message: req.t("all_fields_required") });
        }
        
        if (!NATIONALITY_PATTERN.test(nationality)) {
            return res.status(400).json({ message: req.t("invalid_nationality_code") });
        }
        
        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ message: req.t("invalid_email") });
        }

        //const usernamePattern = /^[\p{L}\d]{3,12}$/u; // \p{L} = toute lettre unicode, \d = chiffre        
        if (!USERNAME_PATTERN.test(username)) {
            return res.status(400).json({ message: req.t("invalid_username_length") });
        }

        if (!PASSWORD_PATTERN.test(password)) {
            return res.status(400).json({ message: req.t("weak_password") });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ message: req.t("passwords_do_not_match") });
        }

        const existingUsername = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
        if (existingUsername) {
            return res.status(400).json({ message: req.t("username_taken") });
        }

        const existingEmail = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
        if (existingEmail) {
            return res.status(400).json({ message: req.t("email_taken") });
        }

        const user = new User({ username, nationality, email: email.toLowerCase(), password });
        await user.save();

        return res.status(201).json({ message: req.t("register_success") });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: req.t("technical_error") });
    }
};

// Connexion d'un utilisateur
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: req.t("all_fields_required") });
        }

        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ message: req.t("invalid_email") });
        }

        if (!PASSWORD_PATTERN.test(password)) {
            return res.status(400).json({ message: req.t("weak_password") });
        }

        const user = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: req.t("invalid_credentials") });
        }

        const accessToken = generateAccessToken(user);
        await user.save();

        return res.json({ accessToken, message: req.t("login_success") });
    } catch (error) {
        next(error);
    }
};

// Forgot password (envoi du lien de réinitialisation)
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: req.t("all_fields_required") });
        }

        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ message: req.t("invalid_email") });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(200).json({ message: req.t("reset_link_sent") });

        const token = crypto.randomBytes(32).toString("hex");
        user.resetToken = token;
        user.resetTokenExpiration = Date.now() + 14400000; // 4 heures
        await user.save();

        const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

        await transporter.sendMail({
            from: `"Kanji-Arena" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: req.t("reset_email_subject"),
            text: req.t("reset_email_body", { resetLink }),
        });

        res.status(200).json({ message: req.t("reset_link_sent") });
    } catch (error) {
        next(error);
    }
};

// Réinitialisation du mot de passe
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, password, confirmPassword } = req.body;

        if (!token || !password || !confirmPassword) {
            return res.status(400).json({ message: req.t("all_fields_required") });
        }
        if (!PASSWORD_PATTERN.test(password)) {
            return res.status(400).json({ message: req.t("weak_password") });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ message: req.t("passwords_do_not_match") });
        }
        const user = await User.findOne({ resetToken: token, resetTokenExpiration: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ message: req.t("reset_token_invalid_or_expired") });

        user.password = password;
        user.resetToken = undefined;
        user.resetTokenExpiration = undefined;
        await user.save();

        return res.status(200).json({ message: req.t("password_reset_success") });
    } catch (error) {
        next(error);
    }
};

const nodemailer = require("nodemailer");

// Transporteur SMTP
const transporter = nodemailer.createTransport({
    name: 'kanji-arena.com',
    host: "ssl0.ovh.net",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Fonction utilitaire pour formater un message
function formatContactMessage({ name, email, message }) {
    return `Message de ${name} <${email}>\n\n${message}`;
}

// Fonction contrôleur pour envoyer un mail de contact
const sendContactMessage = async (req, res) => {
    const { name, email, message } = req.body;

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        replyTo: email,
        subject: `Nouveau message de contact de ${name}`,
        text: formatContactMessage({ name, email, message }),
    };

    try {
        await transporter.sendMail(mailOptions);
        return res.status(200).json({ message: "Votre message a été envoyé avec succès." });
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'e-mail :", error);
        return res.status(500).json({ message: "Erreur lors de l'envoi de l'e-mail." });
    }
};

// Export
module.exports = {
    transporter,
    sendContactMessage,
};

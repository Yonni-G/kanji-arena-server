// schemas/userSchema.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now() },
    alertOutOfRanking: { type: Boolean, default: true},
    resetToken: { type: String },
    resetTokenExpiration: { type: Date },
});

// Hachage du mot de passe avant la sauvegarde de l'utilisateur
UserSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});


module.exports = mongoose.model("User", UserSchema);
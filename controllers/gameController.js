// gameController.js
const jwt = require("jsonwebtoken");
const ChronoClassic = require('../models/ChronoClassic');
const ChronoReverse = require('../models/ChronoReverse');
const GameMode = require('../models/GameMode');
const { generateGameToken, encryptPayload, decryptPayload } = require('../utils/tokenUtils');
const { getUserIdFromAccessToken } = require('../controllers/userController');
const KanjiDB = require('../schemas/kanjiSchema');
const { transporter } = require('./commonController'); 
const User = require("../schemas/userSchema");

// CONSTANTES
const NB_KANJIS_CHOICES = 3; // Nombre de kanjis à choisir pour chaque carte
const NB_SUCCESS_FOR_WINNING = 10; // nombre de points pour gagner
const NB_LIMIT_RANKING = 100; // Nbre de chronos max qu'on recupere
const NB_LIMIT_ALERT_RANKING = 10; // Seuls les X premiers joueurs sont notifiés que leur score a été battu

const modelMap = {
    classic: ChronoClassic,
    reverse: ChronoReverse,
    // ajouter d'autres modes ici
};

const _getKanjis = async (nb_kanjis_choices, lang) => {
    const kanjis = await KanjiDB.aggregate([
        { $sample: { size: nb_kanjis_choices } }
    ]);

    return kanjis.map(k => {
        const meanings = k[`meaning-${lang}`] || [];
        k.meaning = meanings.length > 0 ? meanings[0] : "rien";

        // On supprime les anciens champs pour ne pas polluer la réponse
        delete k["meaning-fr"];
        delete k["meaning-en"];

        return k;
    });
};  
  
  

// startGame retourne :
// 1/ un token de jeu qui contient dans son payload :
//  - le startTime
//  - le nombre de succès
// 2/ une card
exports.startGame = (getCardFunction) => {
    return async (req, res) => {
        try {
            const response = await generateResponse(0, Date.now(), getCardFunction, req.lang);
            return res.status(200).json(response)
        } catch (error) {
            console.log(error)
            return res.status(500).json({ message: req.t("game_error_unable_starting_game") });
        }
    }
}
exports.loadRanking = (gameMode = GameMode.CLASSIC) => {
    const Model = modelMap[gameMode];
    return async (req, res) => {
        try {
            const [topChronos, totalChronos] = await Promise.all([
                Model.find()
                    .sort({ chrono: 1 })                        // tri croissant
                    .limit(NB_LIMIT_RANKING)                    // top N
                    .populate('userId', 'username nationality')             // jointure Users
                    .lean()                                     // objets JS simples
                    .then(chronos => {
                        // Modifie le tableau pour gérer les utilisateurs manquants
                        return chronos.map(chrono => {
                            if (!chrono.userId) {
                                chrono.userId = { username: req.t("game_label_anonymous"), nationality: 'fr' }; // Si pas d'utilisateur, mettre "Anonyme"
                            }
                            return chrono;
                        });
                    }),

                Model.countDocuments()                            // total de tous les chronos
            ]);

            // Ensuite, tu peux retourner ou utiliser `topChronos` et `totalChronos` comme d'habitude.
            const chronos = topChronos.map((entry, index) => ({
                ranking: index + 1,
                username: entry.userId.username,
                nationality: entry.userId.nationality,
                chronoValue: entry.chrono,
                createdAt: entry.createdAt || new Date() // Assure que createdAt est toujours défini
            }));

            // on construit notre objet de données avec des métriques
            const metrics = {
                nbLimitRanking: NB_LIMIT_RANKING,
                totalChronos
            };

            // à ce tableau de rank, on va associer le meilleur chrono et classement de notre joueur s'il est connecté
            let userBestChrono = null;
            const userId = await getUserIdFromAccessToken(req, res);

            if(userId) {
                const bestChrono = await Model.findOne({ userId })
                .sort({ chrono: 1 })
                .populate('userId', 'username nationality');

                if (bestChrono) {
                    const betterCount = await Model.countDocuments({ chrono: { $lt: bestChrono.chrono } });
                    const userRank = betterCount + 1;
                    let username = bestChrono.userId?.username || req.t("game_label_anonymous");
                    let nationality = bestChrono.userId?.nationality || 'fr';
                    userBestChrono = {
                        chronoValue: bestChrono.chrono,
                        ranking: userRank,
                        username: username,
                        nationality: nationality
                    }
                }
            }

            return res.status(200).json({ metrics, userBestChrono, chronos });
        } catch(error) {
            console.log(error)
            return res.status(500).json({ message: req.t("game_error_unable_loading_ranking") });
        }

    }

}

function formatChrono(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

async function notifyOutOfRanking(newChrono, Model, gameMode, newUser) {
    // 1. Déterminer le rang du nouveau chrono
    const betterChronosCount = await Model.countDocuments({
        chrono: { $lt: newChrono.chrono }
    });
    const ranking = betterChronosCount + 1;

    // 2. Vérifier si ce chrono est dans le top à notifier
    if (ranking > NB_LIMIT_ALERT_RANKING) {
        console.log(`Le chrono ${newChrono.chrono} est au rang ${ranking}, pas de notification.`);
        return; // Pas de notification si trop bas
    }
    console.log(`Le chrono ${newChrono.chrono} est au rang ${ranking}, notification.`);

    // 3. Trouver le chrono qui vient d'être éjecté du top

    const chronos = await Model.find()
        .sort({ chrono: 1 }) // tri croissant
        .skip(ranking)       // saute les meilleurs + le nouveau
        .limit(1)            // prend le suivant
        .populate('userId', 'username email alertOutOfRanking');


    if (!chronos.length) {
        console.log(`Aucun chrono éjecté du top.`);
        return; // Personne à notifier
    }

    const ejectedChrono = chronos[0];

    // 4. Vérifier si ce joueur a activé l'alerte
    if (
        ejectedChrono.userId &&
        ejectedChrono.userId.alertOutOfRanking &&
        ejectedChrono.userId.email
        && (!newUser || String(ejectedChrono.userId._id) !== String(newUser._id)) // <-- évite de notifier le joueur qui vient de battre son propre chrono
    ) {
        // 5. Envoie la notification (ici exemple par email)
        sendOutOfRankingNotification({
            user: ejectedChrono.userId,
            oldChrono: ejectedChrono.chrono,
            newUser,
            newChrono: newChrono.chrono,
            gameMode,
            oldRanking: ranking
        }).catch(e => {
            console.error("Erreur lors de l'envoi du mail de notification :", e);
        });;

        console.log(
            `Notification envoyée à ${ejectedChrono.userId.username} (${ejectedChrono.userId.email}) : sorti du top ${NB_LIMIT_ALERT_RANKING}`
        );
    }
}

async function sendOutOfRankingNotification({ user, oldChrono, newUser, newChrono, gameMode, oldRanking }) {
    const formattedOld = formatChrono(oldChrono);
    const formattedNew = formatChrono(newChrono);

    const gameModeUpper = gameMode.toUpperCase();
    const arenaUrl = `${process.env.EMAIL_USER}/games/${gameMode}`;

    await transporter.sendMail({
        from: `"Kanji-Arena" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: `⚔️ ${user.username}, votre place #${oldRanking} a été conquise dans l’arène ${gameModeUpper}`,
        html: `
<p style="font-size:1.2em;"><strong>🛡️ Ave, ${user.username} !</strong></p>

<p>
    <em>🏟️ Le sable de l’arène a parlé…</em><br>
    Vous venez de perdre votre place de numéro <strong>#${oldRanking}</strong> dans le classement du jeu <strong>🏛️ ${gameModeUpper}</strong>.
</p>

<p>
    C'est le <strong>gladiateur</strong> <b style="color:#b22222;">${newUser.username} 🗡️</b> qui vous détrône, il a frappé fort avec un chrono de <strong style="color:#007bff;">⏱️ ${formattedNew}</strong> !
</p>

<p>
    <em>Votre chrono héroïque à vous est de :</em> <strong style="color:#007bff;">⏳ ${formattedOld}</strong>
</p>

<p>
    <span style="font-size:1.1em;">⚔️ Le combat n’est jamais terminé.<br>
    <strong>Reprenez votre glaive et défendez votre honneur !</strong></span>
</p>

<p>
    <a href="${arenaUrl}" style="background:#ffd700;color:#222;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;margin-top:10px;">
        🏃‍♂️ Rejoignez l’arène sans tarder
    </a>
</p>

<p style="margin-top:2em;">
    <em>🏅 Gloire à vous, gladiateur de Kanji-Arena !</em><br>
    — <span style="color:#888;">L’arène romaine</span>
</p>
`

    });

}


exports.checkAnswer = (getCardFunction, gameMode = GameMode.CLASSIC) => {
    return async (req, res) => {
        const { gameToken, choiceIndex } = req.body;

        if (!gameToken || choiceIndex === undefined) {
            return res.status(401).json({ message: req.t("game_error_missing_answer_parameters") });
        }

        try {
            // Vérifie la validité du token 
            const decoded = jwt.verify(gameToken, process.env.JWT_GAME_SECRET);
            // et déchiffre son contenu
            const payload = decryptPayload(decoded);

            // on va comparer les reponses
            let correct = false;

            if (choiceIndex === payload.correctIndex) {
                correct = true;
                payload.success = (payload.success || 0) + 1; // au cas où success n'est pas défini
            }
            // le joueur a gagné
            if (payload.success >= NB_SUCCESS_FOR_WINNING) {
                const userId = await getUserIdFromAccessToken(req, res);
                const chronoValue = Date.now() - payload.startTime;

                const Model = modelMap[gameMode];

                // on sauve son chrono s'il est connecté
                if (userId && Model) {
                    try {
                        const chrono = new Model({
                            userId: userId,
                            chrono: chronoValue,
                        });
                        await chrono.save();
                        // fonction qui va éventuellement envoyer un email au joueur dont le chrono vient d'être battu
                        // Récupère le joueur qui vient de battre le score
                        const newUser = await User.findById(userId).select('username');
                        await notifyOutOfRanking(chrono, Model, gameMode, newUser);

                    } catch (err) {
                        console.error("Erreur lors de l'enregistrement du chrono :", err);
                        return res.status(500).json({ error: req.t("game_error_server") });
                    }
                }

                const betterChronosCount = await Model.countDocuments({
                    chrono: { $lt: chronoValue }
                });

                const ranking = betterChronosCount + 1;

                return res.status(200).json({
                    chronoValue: chronoValue,
                    ranking: ranking
                });
            }

            // on genere une nouvelle response
            const response = await generateResponse(payload.success, payload.startTime, getCardFunction, req.lang);

            // on ajoute "correct" dans l'objet response retourné
            return res.status(200).json({
                correct: correct,
                correctIndex: payload.correctIndex,
                ...response,
            });

        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ message: req.t("error_expired_token") });
            }

            return res.status(401).json({ message: req.t("error_invalid_token") });
        }
    }
};


// on crée une response
/*
    gameToken
    card {
        proposal
        choices [
            label
            label            
        ]
    }
*/

async function generateResponse(success, startTime, getCardFunction, lang) {

    // on tire un chiffre entre 0 et NB_KANJIS_CHOICES : définit la place de la bonne réponse
    const correctIndex = Math.floor(Math.random() * NB_KANJIS_CHOICES);
    // on va créer un nouveau token de game
    const gameToken = generateGameToken(encryptPayload({ correctIndex, success, startTime }));
    //console.log(gameToken)
    // on crée une question
    const card = await _getCard(getCardFunction, correctIndex, lang)
    //console.log(card);
    const response = {
        gameToken: gameToken,
        card: card
    }
    return response;
}

const _getCard = async (getCardFunction, correctIndex, lang) => {

    // on recupere x kanjis au hasard
    const kanjis_list = await _getKanjis(NB_KANJIS_CHOICES, lang);
    //console.log(kanjis_list);

    // on construit notre card
    const card = getCardFunction(kanjis_list, correctIndex);

    return card;
}

exports.getClassicCard = function (kanjis_list, correctIndex) {
    // on construit nos choix sans le premier kanji
    const choices = kanjis_list.slice(1).map((kanji) => ({
        label: kanji.meaning,
    }));

    // on construit notre card
    const card = {
        proposal: kanjis_list[0].kanji,
        choices: choices,
    }

    // on écrase le label par celui de la bonne réponse
    card.choices.splice(correctIndex, 0, { label: kanjis_list[0].meaning });

    return card;
}

exports.getReverseCard = function (kanjis_list, correctIndex) {
    // on construit nos choix sans le premier kanji
    const choices = kanjis_list.slice(1).map((kanji) => ({
        label: kanji.kanji,
    }));

    // on construit notre card
    const card = {
        proposal: kanjis_list[0].meaning,
        choices: choices,
    }

    // on écrase le kanji par celui de la bonne réponse
    card.choices.splice(correctIndex, 0, { label: kanjis_list[0].kanji });

    return card;
}

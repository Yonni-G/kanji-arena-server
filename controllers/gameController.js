// gameController.js
const jwt = require("jsonwebtoken");
const ChronoClassic = require('../models/ChronoClassic');
const ChronoReverse = require('../models/ChronoReverse');
const GameMode = require('../models/GameMode');
const { generateGameToken, encryptPayload, decryptPayload } = require('../utils/tokenUtils');
const { getUserIdFromAccessToken } = require('../controllers/userController');
const KanjiDB = require('../schemas/kanjiSchema');
const Progression = require('../schemas/progressionSchema');
const { transporter } = require('./commonController');
const User = require("../schemas/userSchema");

// CONSTANTES
const NB_KANJIS_CHOICES = 3; // Nombre de kanjis à choisir pour chaque carte
const NB_SUCCESS_FOR_WINNING = 2; // nombre de points pour gagner
const NB_COEFF_MULTIPLICATEUR = 2; // on va charger x fois plus de kanjis que le nombre de succès requis
const NB_MIN_CARDS = NB_SUCCESS_FOR_WINNING / 2; // nombre mini de cards à partir duquel on va recharger des cards
const NB_LIMIT_RANKING = 100; // Nbre de chronos max qu'on recupere
const NB_LIMIT_ALERT_RANKING = 100; // Seuls les X premiers joueurs sont notifiés que leur score a été battu

const modelMap = {
    classic: ChronoClassic,
    reverse: ChronoReverse,
    // ajouter d'autres modes ici
};

// retourne une liste de x kanjis au hasard, de niveau jlptGrade
const _getKanjis = async (lang, jlptGrade) => {

    const kanjis = await KanjiDB.aggregate([
        { $match: { jlpt: { $gte: jlptGrade } } }, // JLPT >= niveau choisi
        { $sample: { size: NB_KANJIS_CHOICES * NB_SUCCESS_FOR_WINNING * NB_COEFF_MULTIPLICATEUR } }
    ]);

    // ici on fait un petit hack comme on a pas encore les sens japonais : si la langue du user est "ja", on force à "en" pour recuperer les traduction anglaises
    if (lang === 'ja') {
        lang = 'en';
    }
    return kanjis.map(k => {
        const meanings = k[`meaning-${lang}`] || [];
        // on recupere le premier sens du kanji, on considère que c'est le plus pertinent
        // si pas de sens, on met "rien" (pour débogage)
        k.meaning = meanings.length > 0 ? meanings[0] : "rien";
        // on ajoute un autre champ meaning_more, il contient un tableau avec les éventuels autres sens du kanji
        k.meaning_more = meanings.slice(1) || [];

        // On supprime les anciens champs pour ne pas polluer la réponse
        delete k["meaning-fr"];
        delete k["meaning-en"];

        return k;
    });
};

// on crée une response
/*
    gameToken
    cards {
        proposal
        more
        choices [
            label
            more
            label
            more
        ]
    }[]
*/

async function generateResponse(success, startTime, getCardFunction, lang, jlptGrade, kanjis_joues, correctIndexes, currentCardIndex) {

    let cards = [];
    // console.log(correctIndexes.length, currentCardIndex, NB_MIN_CARDS);

    // on ne va recharger des cartes uniquement si on va atteindre la fin de la liste
    if ((correctIndexes.length - currentCardIndex) <= NB_MIN_CARDS) {
        // on génère une liste de correctIndexes
        const newCorrectIndexes = [];
        for (let i = 0; i < NB_SUCCESS_FOR_WINNING * NB_COEFF_MULTIPLICATEUR; i++) {
            const correctIndex = Math.floor(Math.random() * NB_KANJIS_CHOICES);
            newCorrectIndexes.push(correctIndex);
        }

        // on génère nos cards en leur passant la position de leur réponse correcte
        cards = await _getCards(getCardFunction, newCorrectIndexes, lang, jlptGrade);
        // bon code : on prend le même index dans kanjis_a_deviner
        kanjis_joues = kanjis_joues.concat(
            cards.cards.map((c, idx) => ({
                kanji: cards.kanjis_a_deviner[idx], // index i
                correct: false
            }))
        );

        //console.log(kanjis_joues);
        // on va ajouter les les nouveaux correctIndexes à notre ancien tableau oldCorrectIndexes
        // on concatène les deux tableaux
        correctIndexes = correctIndexes.concat(newCorrectIndexes);
    }

    //console.log(correctIndexes, currentCardIndex);

    // on va créer un nouveau token de game
    const gameToken = generateGameToken(encryptPayload({ correctIndexes, success, startTime, jlptGrade, kanjis_joues, currentCardIndex }));

    const response = {
        gameToken: gameToken,
        cards: cards.cards || cards
    }
    return response;
}

// retourne un ensemble de cards à partir d'une liste de kanjis
// getCardFunction est soit getClassicCard soit getReverseCard
const _getCards = async (getCardFunction, correctIndexes, lang, jlptGrade) => {

    // on recupere x kanjis au hasard
    const kanjis_list = await _getKanjis(lang, jlptGrade);
    //console.log(kanjis_list);

    // on construit nos cards par paquet de NB_KANJIS_CHOICES
    const cards = [];
    const kanjis_a_deviner = [];
    // on boucle sur les kanjis_list par tranche de NB_KANJIS_CHOICES
    for (let i = 0; i < kanjis_list.length; i += NB_KANJIS_CHOICES) {
        const card = getCardFunction(kanjis_list.slice(i, i + NB_KANJIS_CHOICES), correctIndexes[i / NB_KANJIS_CHOICES]);
        cards.push(card);
        kanjis_a_deviner.push(kanjis_list[i].kanji);
    }
    //console.log("kanjis_a_deviner:", kanjis_a_deviner);
    // on retourne un objet avec nos cards mais aussi le kanji à deviner (nécessaire pour l'espace apprenant)
    return { cards, kanjis_a_deviner };
}

exports.getClassicCard = function (kanjis_list, correctIndex) {
    // on construit nos choix sans le premier kanji
    const choices = kanjis_list.slice(1).map((kanji) => ({
        label: kanji.meaning,
        // Ajoutons le champ "more" avec les significations supplémentaires
        more: kanji.meaning_more
    }));

    // on construit notre card
    const card = {
        proposal: kanjis_list[0].kanji,
        choices: choices,
    }

    // on insère le label de la bonne réponse ainsi que les éventuelles significations supplémentaires
    card.choices.splice(correctIndex, 0, { label: kanjis_list[0].meaning, more: kanjis_list[0].meaning_more });

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
        // Ajoutons le champ "more" avec les significations supplémentaires
        more: kanjis_list[0].meaning_more,
        choices: choices,
    }

    // on insere le kanji de la bonne réponse
    card.choices.splice(correctIndex, 0, { label: kanjis_list[0].kanji });
    return card;
}

// startGame retourne une response avec :
// 1/ un token de jeu qui contient dans son payload :
//  - les index des réponses correctes
//  - le startTime
//  - le nombre de succès
//  - le jlptGrade (on le stocke dans le payload pour 1/ ne pas l'envoyer à chaque fois dans les checkAnswer 2/ pour éviter les tricheries)
// 2/ des cards de niveau jlptGrade
exports.startGame = (getCardFunction) => {
    return async (req, res) => {
        try {
            const jlptGrade = Number(req.params.jlpt);
            const response = await generateResponse(0, Date.now(), getCardFunction, req.lang, jlptGrade, [], [], 0);
            return res.status(200).json(response)
        } catch (error) {
            console.log(error)
            return res.status(500).json({ message: req.t("game_error_unable_starting_game") });
        }
    }
}


exports.checkAnswer = (getCardFunction, gameMode = GameMode.CLASSIC) => {
    return async (req, res) => {
        const { gameToken, choiceIndex, mode } = req.body;

        if (!gameToken || choiceIndex === undefined || !mode || !['chrono', 'training'].includes(mode)) {
            return res.status(401).json({ message: req.t("game_error_missing_answer_parameters") });
        }

        try {
            // Vérifie la validité du token 
            const decoded = jwt.verify(gameToken, process.env.JWT_GAME_SECRET);
            // Déchiffre son contenu
            const payload = decryptPayload(decoded);

            // On va comparer les réponses
            let correct = false;

            if (choiceIndex === payload.correctIndexes[payload.currentCardIndex]) {
                correct = true;
                payload.success = (payload.success || 0) + 1; // au cas où success n'est pas défini  
                // Marquer le dernier kanji demandé comme correct
                if (payload.kanjis_joues && payload.kanjis_joues.length > 0) {
                    payload.kanjis_joues[payload.currentCardIndex].correct = correct;
                }
            }
            
            // Le joueur a gagné
            if (payload.success >= NB_SUCCESS_FOR_WINNING) {

                const userId = await getUserIdFromAccessToken(req, res);
                const chronoValue = Date.now() - payload.startTime;
                const Model = modelMap[gameMode];

                // On sauve les données du joueur connecté
                if (userId && Model) {
                    // on sauve les progressions du joueur quel que soit le mode
                    if (payload.kanjis_joues) {
                        try {
                            await enregistrerProgressions(userId, payload.kanjis_joues.slice(0, payload.currentCardIndex + 1));
                        } catch (err) {
                            console.error("Erreur lors de l'enregistrement des progressions :", err);
                            return res.status(500).json({ error: req.t("game_error_server") });
                        }
                    } 
                    // on sauvegarde le chrono
                    if(mode === 'chrono') {
                        try {
                            // son chrono
                            const chrono = new Model({
                                userId: userId,
                                chrono: chronoValue,
                                jlpt: payload.jlptGrade
                            });
                            await chrono.save();

                            // Récupère le joueur qui vient de battre le score
                            const newUser = await User.findById(userId).select('username');
                            await notifyOutOfRanking(payload.jlptGrade, chrono, Model, gameMode, newUser);

                        } catch (err) {
                            console.error("Erreur lors de l'enregistrement du chrono :", err);
                            return res.status(500).json({ error: req.t("game_error_server") });
                        }                        
                    }

                }
                // connecté ou non, on calcule le rang du chrono du joueur
                if(mode === 'chrono') {
                    const betterChronosCount = await Model.countDocuments({
                        chrono: { $lt: chronoValue },
                        jlpt: payload.jlptGrade
                    });

                    const ranking = betterChronosCount + 1;
                    return res.status(200).json({
                        chronoValue: chronoValue,
                        ranking: ranking
                    }); 
                }
                else if (mode === 'training') {
                    // En mode training, on ne retourne pas le chrono
                    return res.status(200).json({
                        training: true
                    });
                }                
            }
            
            // On génère une response
            const response = await generateResponse(payload.success, payload.startTime, getCardFunction, req.lang, payload.jlptGrade, payload.kanjis_joues, payload.correctIndexes, payload.currentCardIndex + 1);

            // On ajoute la réponse "correct" dans l'objet response retourné afin que le client sache si la réponse est correcte ou non
            return res.status(200).json({
                correct: correct,// pour informer si c'est bon ou pas
                correctIndex: payload.correctIndexes[payload.currentCardIndex],//pour stocker les bonnes reponses coté client
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

async function enregistrerProgressions(userId, kanjis_joues) {
    //console.log(kanjis_joues);
    const kanjiErrors = kanjis_joues
        .filter(item => item.correct === false)
        .map(item => ({ kanji: item.kanji }));

    const kanjiSuccesses = kanjis_joues
        .filter(item => item.correct === true)
        .map(item => ({ kanji: item.kanji }));

    // 1. Récupérer toutes les progressions du joueur
    const progressions = await Progression.find({ userId });  
    const progressionMap = Object.fromEntries(progressions.map(doc => [doc.kanji, doc]));

    // 2. Préparer les opérations
    const newProgressions = [];
    const updates = [];
    const kanjiProcessed = new Set();

    // Traitement Erreurs
    kanjiErrors.forEach(error => {
        kanjiProcessed.add(error.kanji);
        const ex = progressionMap[error.kanji];

        if (!ex) {
            newProgressions.push({
                userId,
                kanji: error.kanji,
                errorCount: 1,
                inProgress: false
            });
        } else {
            updates.push({
                updateOne: {
                    filter: { _id: ex._id },
                    update: {
                        $inc: { errorCount: 1 },
                        $set: { inProgress: false, updatedAt: new Date() }
                    }
                }
            });
        }
    });

    // Traitement Succès
    kanjiSuccesses.forEach(success => {
        if (kanjiProcessed.has(success.kanji)) return; // évite doublon
        const ex = progressionMap[success.kanji];
        if (!ex) {
            // ici tu peux créer un nouveau doc avec errorCount:0 si tu veux…
        } else {
            updates.push({
                updateOne: {
                    filter: { _id: ex._id },
                    update: {
                        $inc: { errorCount: -1 },
                        $set: { inProgress: true, updatedAt: new Date() }
                    }
                }
            });
        }
    });

    // 3. Exécution en base de données
    if (newProgressions.length) await Progression.insertMany(newProgressions);
    if (updates.length) await Progression.bulkWrite(updates);

    // 4. Nettoyage des progressions à errorCount <= 0
    await Progression.deleteMany({ userId, errorCount: { $lte: 0 } });
}

exports.loadRanking = (gameMode = GameMode.CLASSIC) => {
    const Model = modelMap[gameMode];
    return async (req, res) => {
        try {
            const jlptGrade = Number(req.params.jlpt);
            const [topChronos, totalChronos] = await Promise.all([
                Model.find({ jlpt: jlptGrade })
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

                Model.countDocuments({ jlpt: jlptGrade })                            // total de tous les chronos
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

            if (userId) {
                const bestChrono = await Model
                    .findOne({ userId, jlpt: jlptGrade })
                    .sort({ chrono: 1 })
                    .populate('userId', 'username nationality');

                if (bestChrono) {
                    const betterCount = await Model.countDocuments({ jlpt: jlptGrade, chrono: { $lt: bestChrono.chrono } });
                    const userRank = betterCount + 1;
                    let username = bestChrono.userId?.username || req.t("game_label_anonymous");
                    let nationality = bestChrono.userId?.nationality || 'fr';
                    userBestChrono = {
                        chronoValue: bestChrono.chrono,
                        jlptGrade: jlptGrade,
                        ranking: userRank,
                        username: username,
                        nationality: nationality
                    }
                }
            }

            return res.status(200).json({ metrics, userBestChrono, chronos });
        } catch (error) {
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

async function notifyOutOfRanking(jlptGrade, newChrono, Model, gameMode, newUser) {
    // 1. Déterminer le rang du nouveau chrono
    const betterChronosCount = await Model.countDocuments({
        chrono: { $lt: newChrono.chrono },
        jlpt: jlptGrade
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
        .find({ jlpt: jlptGrade })
        .sort({ chrono: 1 }) // tri croissant
        .skip(ranking)       // saute les meilleurs + le nouveau
        .limit(1)            // prend le suivant
        .populate('userId', 'username nationality email alertOutOfRanking');


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
        // 4bis. Vérifier si c'était son meilleur chrono
        const bestChrono = await Model.findOne({ jlpt: jlptGrade, userId: ejectedChrono.userId._id })
            .sort({ chrono: 1 });

        if (!bestChrono || String(bestChrono._id) !== String(ejectedChrono._id)) {
            console.log(`Le chrono éjecté n'était pas le meilleur du joueur (${ejectedChrono.userId.username}), pas de notification.`);
            return;
        }

        // 5. Envoie la notification (ici exemple par email)
        sendOutOfRankingNotification({
            user: ejectedChrono.userId,
            jlptGrade: jlptGrade,
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

async function sendOutOfRankingNotification({ user, jlptGrade, oldChrono, newUser, newChrono, gameMode, oldRanking }) {
    const { createTranslator } = require('../translations/translator');

    const formattedOld = formatChrono(oldChrono);
    const formattedNew = formatChrono(newChrono);
    const gameModeUpper = gameMode.toUpperCase();
    const arenaUrl = `${process.env.EMAIL_USER}/games/${gameMode}`;

    /* ici on charge le texte du mail dans la langue du user battu */
    const userLang = user.nationality === 'fr' ? 'fr' :
        user.nationality === 'jp' ? 'ja' : 'en';

    const t = createTranslator(userLang);

    await transporter.sendMail({
        from: `"Kanji-Arena" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: t("alert_out_ranking_subject", {
            username: user.username,
            oldRanking,
            gameModeUpper,
            jlptGrade
        }),
        html: `
<p style="font-size:1.2em;"><strong>${t("alert_out_ranking_greeting", { username: user.username })}</strong></p>

<p>${t("alert_out_ranking_intro", { oldRanking, gameModeUpper, jlptGrade })}</p>
<p>${t("alert_out_ranking_new_gladiator", { newUsername: newUser.username, formattedNew })}</p>
<p>${t("alert_out_ranking_your_time", { formattedOld })}</p>
<p>${t("alert_out_ranking_motivation")}</p>

<p>
  <a href="${arenaUrl}" style="background:#ffd700;color:#222;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;margin-top:10px;">
    ${t("alert_out_ranking_cta")}
  </a>
</p>

<p style="margin-top:2em;">${t("alert_out_ranking_footer")}</p>
`

    });
}
// gameController.js
const jwt = require("jsonwebtoken");

const ChronoClassic = require('../models/ChronoClassic');
const ChronoReverse = require('../models/ChronoReverse');
const GameMode = require('../models/GameMode');

const { generateGameToken, encryptPayload, decryptPayload } = require('../utils/tokenUtils');
const { getUserIdFromAccessToken } = require('../controllers/userController');


const KanjiDB = require('../schemas/kanjiSchema');
// CONSTANTES
const NB_KANJIS_CHOICES = 3; // Nombre de kanjis à choisir pour chaque carte
const NB_SUCCESS_FOR_WINNING = 1; // nombre de points pour gagner
const NB_LIMIT_RANKING = 100; // Nbre de chronos max qu'on recupere

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
        k.meaning = meanings.length > 0 ? meanings[0] : "";

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
                    .populate('userId', 'username')             // jointure Users
                    .lean()                                     // objets JS simples
                    .then(chronos => {
                        // Modifie le tableau pour gérer les utilisateurs manquants
                        return chronos.map(chrono => {
                            if (!chrono.userId) {
                                chrono.userId = { username: req.t("game_label_anonymous") }; // Si pas d'utilisateur, mettre "Anonyme"
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
                chronoValue: entry.chrono,
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
                .populate('userId', 'username');

                if (bestChrono) {
                    const betterCount = await Model.countDocuments({ chrono: { $lt: bestChrono.chrono } });
                    const userRank = betterCount + 1;
                    let username = bestChrono.userId?.username || req.t("game_label_anonymous")
                    userBestChrono = {
                        chronoValue: bestChrono.chrono,
                        ranking: userRank,
                        username: username
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
            if (payload.success >= NB_SUCCESS_FOR_WINNING) {
                const userId = await getUserIdFromAccessToken(req, res);
                const chronoValue = Date.now() - payload.startTime;

                const Model = modelMap[gameMode];

                if (userId && Model) {
                    try {
                        const chrono = new Model({
                            userId: userId,
                            chrono: chronoValue,
                        });

                        await chrono.save();


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
            const response = await generateResponse(payload.success, payload.startTime, getCardFunction);

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

    // on tire un chiffre entre 0 et NB_KANJIS_CHOICES définit la place de la bonne réponse
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
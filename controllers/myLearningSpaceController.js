const { getUserIdFromAccessToken } = require('../controllers/userController');
const User = require("../schemas/userSchema");
const Progression = require('../schemas/progressionSchema');

exports.myLearningSpace = async (req, res) => {
    try {
        const userId = await getUserIdFromAccessToken(req, res);
        const user = await User.findOne({ _id: userId });

        if (!user) {
            return res.status(404).json({ message: req.t("user_not_found") });
        }

        // ici on fait un petit hack comme on a pas les sens japonais : si la langue est "ja", on force à "en" pour recuperer les traduction anglaises
        if (req.lang === 'ja') {
            req.lang = 'en';
        }
        // Construire dynamiquement la clé
        const meaningField = `kanjiDetails.meaning-${req.lang}`;

        // Créer l'objet project dynamique
        const projectStage = {
            _id: 0,  // Exclut le champ _id de la sortie
            kanji: 1,
            errorCount: 1,
            inProgress: 1,
            updatedAt: 1,
            createdAt: 1,
        };
        projectStage[meaningField] = 1;
        projectStage['kanjiDetails.jlpt'] = 1; // Inclure le kanji dans les détails

        const progressions = await Progression.aggregate([
            { $match: { userId: user._id } },  // filtrer par userId
            {
                $lookup: {
                    from: 'kanjis',                // nom de la collection kanjis dans MongoDB
                    localField: 'kanji',           // champ dans Progression (string kanji)
                    foreignField: 'kanji',         // champ dans Kanjis (string kanji)
                    as: 'kanjiDetails'             // résultat joint
                }
            },
            {
                $unwind: {
                    path: '$kanjiDetails',
                    preserveNullAndEmptyArrays: true  // optionnel, si pas de correspondance tu as quand même la progression
                }
            },
            {
                $project: projectStage  // utiliser l'objet project dynamique
            },
            {
                $sort: {
                    errorCount: -1,     // Trier d'abord par errorCount décroissant (plus d'erreurs en premier)
                    updatedDate: -1,    // Puis par updatedDate décroissante (plus récent en premier)
                    createdDate: -1     // Enfin par createdDate décroissante (plus récent en premier)
                }
            }

        ]);

        const dynamicKey = `meaning-${req.lang}`;

        const results = progressions.map(prog => {
            if (prog.kanjiDetails && prog.kanjiDetails[dynamicKey]) {
                // Créer ou remplacer la clé 'meaning' avec la valeur sous 'meaning-en' ou autre
                prog.kanjiDetails.meaning = prog.kanjiDetails[dynamicKey];

                // Supprimer la clé dynamique pour ne garder que 'meaning'
                delete prog.kanjiDetails[dynamicKey];
            }
            return prog;
        });

        return res.status(200).json({ items: results });

    } catch (error) {
        console.error("Error in myLearningSpace:", error);
        return res.status(500).json({ message: req.t("server_error") });
    }
}
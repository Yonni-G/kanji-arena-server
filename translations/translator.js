const translations = require('./translations.json');

function createTranslator(lang = 'fr') {
    return function t(key) {
        return translations[key] && translations[key][lang]
            ? translations[key][lang]
            : key;
    };
}

module.exports = { createTranslator };

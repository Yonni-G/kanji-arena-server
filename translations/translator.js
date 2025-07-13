const translations = require('./translations.json');

function createTranslator(lang = 'fr') {
    return function t(key, vars = {}) {
        let str = translations[key] && translations[key][lang]
            ? translations[key][lang]
            : key;

        // Remplacement des variables {variable}
        for (const [k, v] of Object.entries(vars)) {
            str = str.replace(new RegExp(`{${k}}`, 'g'), v);
        }
        return str;
    };
}

module.exports = { createTranslator };
